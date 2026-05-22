/**
 * MAIN-world subtitle interceptor.
 *
 * Runs at `document_start` in the page's main world (via the second
 * content_scripts entry in manifest.json with `"world": "MAIN"`). Patches
 * `window.fetch` and `XMLHttpRequest` so that every response that looks like
 * a subtitle file (WebVTT / TTML / DFXP) gets parsed and the resulting cues
 * are forwarded to the ISOLATED-world content script via
 * `window.postMessage`.
 *
 * Why MAIN world: streaming sites enforce strict CSP that blocks
 * `<script src=...>` injection, and the player calls live in the page's own
 * realm. Manifest-declared MAIN content scripts bypass CSP at the runtime
 * level (Chrome 102+).
 *
 * Subtitle detection happens in two passes:
 *   1. URL fast-path — file extension or path keyword match (cheap).
 *   2. Content sniff — for "interesting" hosts (streaming CDNs, the current
 *      origin, etc.) we read the response body and check for the WEBVTT /
 *      TTML signatures. This catches platforms (notably HBO Max) that serve
 *      WebVTT segments without a `.vtt` extension in the URL.
 */
import { parseAny, detectSubtitleKind, detectTrackLanguage } from './parsers';

const TAG = '[Kivara Lingo / MAIN]';
const EVENT = 'kivara-lingo:subtitle-track';

declare global {
  interface Window {
    __KIVARA_MAIN_INSTALLED?: boolean;
  }
}

(() => {
  if (window.__KIVARA_MAIN_INSTALLED) return;
  window.__KIVARA_MAIN_INSTALLED = true;

  // Fast-path URL matchers — these match in O(1) and skip the content sniff.
  const fastMatchers: Array<(url: string) => boolean> = [
    // Netflix TTML/DFXP
    (url) =>
      /nflxvideo\.net/i.test(url) &&
      (/[?&]o=\d/.test(url) || /\.dfxp(\?|$)/i.test(url) || /\.xml(\?|$)/i.test(url)),
    // Disney+ WebVTT
    (url) => /disneyplus\.com/i.test(url) && /\.vtt(\?|$)/i.test(url),
    (url) => /\.bamgrid\.com/i.test(url) && /\.vtt(\?|$)/i.test(url),
    // HBO Max / Max WebVTT — narrower than the previous `(hbomax|max)\.com`
    // which over-matched things like `maxcdn-other-thing.com`.
    (url) =>
      /(?:^|\/\/)([a-z0-9-]+\.)?(hbomax|hbomaxsdash|maxcdn|maxstream)\.(?:com|net)/i.test(url) &&
      /\.vtt(\?|$)/i.test(url),
    (url) => /(?:play|cdn)\.max\.com/i.test(url) && /\.vtt(\?|$)/i.test(url),
    // Prime Video TTML/DFXP — often hosted on cloudfront
    (url) => /cloudfront\.net/i.test(url) && /\.dfxp(\?|$)/i.test(url),
    (url) => /(media-amazon|primevideo)\.com/i.test(url) && /\.(xml|dfxp|ttml)(\?|$)/i.test(url),
    // Generic extension match — covers same-origin and unknown CDNs.
    (url) => /\.(vtt|ttml|dfxp)(\?|$)/i.test(url),
    // Path-keyword match — captures URLs that have no extension but live
    // under a subtitle-ish path segment (covers HBO segmented VTT, where the
    // URL ends in `/subtitle/<n>` without `.vtt`).
    (url) =>
      /\/(subtitles?|captions?|webvtt|wvtt|texttrack|timedtext|t\/sub)(?:\/|\?|$)/i.test(url),
  ];

  // Hosts where we *also* run the content sniff (i.e. the URL pattern is
  // unknown but the host is known to serve streaming media). Keep this list
  // narrow to avoid pointless body reads on analytics / ad / API endpoints.
  const SNIFF_HOSTS: RegExp[] = [
    /(^|\.)hbomax\.com$/i,
    /(^|\.)max\.com$/i,
    /hbomaxsdash/i,
    /maxcdn/i,
    /(^|\.)nflxvideo\.net$/i,
    /(^|\.)disneyplus\.com$/i,
    /\.bamgrid\.com$/i,
    /(^|\.)primevideo\.com$/i,
    /media-amazon\.com$/i,
    /cloudfront\.net$/i,
    /akamaihd\.net$/i,
  ];

  // Extensions / hosts that are obviously NOT subtitles — skip them so we
  // don't waste bandwidth reading binary streams or analytics pings.
  const SKIP_EXT =
    /\.(m4s|mp4|m4a|m4v|ts|aac|webm|mpd|m3u8|jpg|jpeg|png|webp|gif|svg|woff2?|ttf|js|css|wasm)(\?|$)/i;
  const SKIP_HOSTS: RegExp[] = [
    /events\.brightline\.tv/i,
    /\.litix\.io$/i,
    /\.fwmrm\.net$/i,
    /branch\.io$/i,
    /app\.link$/i,
    /google-analytics\.com$/i,
    /googletagmanager\.com$/i,
    /doubleclick\.net$/i,
  ];

  function hostOf(url: string): string {
    try {
      return new URL(url, window.location.href).hostname;
    } catch {
      return '';
    }
  }

  /**
   * Rewrite the `lang` parameter in a YouTube timedtext URL to match the
   * user's configured source language. The source language is synced to
   * `document.documentElement.dataset.kivaraSourceLang` by the isolated-world
   * content script.
   *
   * IMPORTANT: only rewrite when the URL has NO `tlang`. YouTube uses
   * `lang=<src>&tlang=<dst>` for auto-translated tracks; rewriting `lang`
   * on those would break the source side of the translation pair and
   * effectively delete the user-selected dual subtitle. We must let those
   * through unchanged.
   */
  function rewriteTimedtextLang(url: string): string {
    const sourceLang = document.documentElement.getAttribute('data-kivara-source-lang');
    if (!sourceLang) return url;
    try {
      const parsed = new URL(url, window.location.href);
      // Skip if this is an auto-translated request (has `tlang`). Those
      // are explicit user selections — they want the SOURCE in `lang`
      // translated to `tlang`, so we must NOT rewrite either.
      if (parsed.searchParams.get('tlang')) return url;
      const currentLang = parsed.searchParams.get('lang');
      if (currentLang === sourceLang) return url;
      parsed.searchParams.set('lang', sourceLang);
      return parsed.toString();
    } catch {
      return url;
    }
  }

  function isFastMatch(url: string): boolean {
    try {
      return fastMatchers.some((m) => m(url));
    } catch {
      return false;
    }
  }

  function shouldSniff(url: string): boolean {
    if (SKIP_EXT.test(url)) return false;
    const host = hostOf(url);
    if (!host) return false;
    if (SKIP_HOSTS.some((re) => re.test(host))) return false;
    return SNIFF_HOSTS.some((re) => re.test(host)) || host === window.location.hostname;
  }

  function looksLikeSubtitle(body: string): boolean {
    if (!body) return false;
    return detectSubtitleKind('', body) !== null;
  }

  function postCues(url: string, body: string) {
    try {
      const cues = parseAny(url, body);
      if (!cues.length) return;
      const language = detectTrackLanguage(url, body);
      window.postMessage(
        {
          source: EVENT,
          url,
          language,
          cues,
        },
        '*',
      );
    } catch (err) {
      console.warn(TAG, 'parse failed for', url, err);
    }
  }

  function maybePostCues(url: string, body: string, fromSniff: boolean) {
    // Sniff requests aren't guaranteed to be subtitles — gate them on the
    // body header so we don't try to parse random JSON / HTML.
    if (fromSniff && !looksLikeSubtitle(body)) return;
    postCues(url, body);
  }

  const origFetch = window.fetch;
  window.fetch = async function patchedFetch(...args: Parameters<typeof fetch>): Promise<Response> {
    // Rewrite YouTube timedtext lang parameter to match user's source language
    try {
      const url =
        typeof args[0] === 'string'
          ? args[0]
          : (args[0] as Request)?.url || (args[0] as URL)?.href || '';
      if (url && /\/api\/timedtext\?/.test(url)) {
        const rewritten = rewriteTimedtextLang(url);
        if (rewritten !== url) {
          if (typeof args[0] === 'string') {
            args[0] = rewritten;
          } else if (args[0] instanceof Request) {
            args[0] = new Request(rewritten, args[0]);
          }
        }
      }
    } catch {
      // Don't break fetch if rewrite fails
    }

    const response = await origFetch.apply(this, args);
    try {
      const url =
        typeof args[0] === 'string'
          ? args[0]
          : (args[0] as Request)?.url || (args[0] as URL)?.href || '';
      if (!url) return response;
      const fast = isFastMatch(url);
      const sniff = !fast && shouldSniff(url);
      if (fast || sniff) {
        response
          .clone()
          .text()
          .then((body) => maybePostCues(url, body, sniff))
          .catch(() => {});
      }
    } catch (err) {
      console.warn(TAG, 'fetch wrap failed', err);
    }
    return response;
  };

  // Decode an arraybuffer / blob xhr.response into text, best-effort. Returns
  // `null` if we can't reasonably convert (e.g. non-text MIME type, oversized
  // payload, or a blob that needs async reading from the load handler).
  function decodeXhrBody(xhr: XMLHttpRequest): string | null {
    const t = xhr.responseType;
    try {
      if (t === '' || t === 'text') {
        return typeof xhr.responseText === 'string' ? xhr.responseText : null;
      }
      if (t === 'arraybuffer' && xhr.response instanceof ArrayBuffer) {
        if (xhr.response.byteLength > 2 * 1024 * 1024) return null;
        return new TextDecoder('utf-8', { fatal: false }).decode(xhr.response);
      }
      if (t === 'json') return null;
      if (typeof xhr.response === 'string') return xhr.response;
    } catch {
      // ignore — we just won't try to parse this one
    }
    return null;
  }

  const OrigXHR = window.XMLHttpRequest;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function PatchedXHR(this: any) {
    const xhr = new OrigXHR();
    let interceptUrl: string | null = null;
    let sniffOnly = false;
    const origOpen = xhr.open;
    xhr.open = function (
      method: string,
      url: string | URL,
      async_?: boolean,
      username?: string | null,
      password?: string | null,
    ) {
      try {
        let u = typeof url === 'string' ? url : url.href;
        // Rewrite YouTube timedtext lang parameter
        if (/\/api\/timedtext\?/.test(u)) {
          const rewritten = rewriteTimedtextLang(u);
          if (rewritten !== u) {
            u = rewritten;
            url = u;
          }
        }
        if (isFastMatch(u)) {
          interceptUrl = u;
          sniffOnly = false;
        } else if (shouldSniff(u)) {
          interceptUrl = u;
          sniffOnly = true;
        }
      } catch {
        // ignore
      }
      return origOpen.call(this, method, url as string, async_ ?? true, username ?? null, password ?? null);
    };
    xhr.addEventListener('load', () => {
      if (!interceptUrl) return;
      try {
        const body = decodeXhrBody(xhr);
        if (body) maybePostCues(interceptUrl, body, sniffOnly);
      } catch (err) {
        // Players that use `responseType = 'arraybuffer'` (HBO Max, etc.) used
        // to throw an InvalidStateError here because we read `responseText`
        // unconditionally. `decodeXhrBody` now handles that, but keep this
        // guard so any future surprise doesn't spam the console.
        const name = (err as { name?: string })?.name;
        if (name !== 'InvalidStateError') {
          console.warn(TAG, 'XHR load handler failed', err);
        }
      }
    });
    return xhr;
  }
  PatchedXHR.prototype = OrigXHR.prototype;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).XMLHttpRequest = PatchedXHR;

  console.log(TAG, 'fetch / XHR interception installed');
})();
