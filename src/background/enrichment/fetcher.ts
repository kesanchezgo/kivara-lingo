/**
 * Tiny fetch helper for the enrichment sources.
 *
 *   - Adds a per-call timeout so a hung CDN never holds back the popover.
 *   - Treats non-2xx as failure (returns null instead of throwing) so each
 *     source's `try/catch` boilerplate stays minimal.
 *   - Sets a generic User-Agent so a few defensive sites (Cambridge,
 *     Forvo, etc.) don't 403 the request when the default
 *     `Mozilla/5.0` CSP-style header is missing in service-worker fetches.
 *   - Uses `cache: 'no-store'` so we don't accidentally pin a stale HTML
 *     blob in the HTTP cache for sites that frequently A/B test markup.
 *   - Validates the URL AND every redirect hop (see shared/net-guard). The
 *     URL comes from scraped pages and from user settings, so a redirect to
 *     loopback/LAN must not be honoured.
 *
 * Sources that need the parsed HTML get `fetchHtml`. Sources that talk
 * to a JSON API use `fetchJson`. Both honour the same timeout / abort
 * semantics.
 */

import { assertPublicHttpUrl } from '../../shared/net-guard';

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * Temporary MV3-runtime diagnostics. DISABLED: it logged every URL the
 * enrichment chain touched — i.e. the full list of words a user looked up —
 * on each request, which is exactly the kind of trail that should not exist
 * in a production build. Kept (and one-line to re-enable) because it is
 * still the fastest way to see why a source stopped answering.
 */
const ENRICHMENT_FETCH_DIAGNOSTICS = false;

function logFetchDiagnostic(event: string, details: Record<string, unknown>): void {
  if (!ENRICHMENT_FETCH_DIAGNOSTICS) return;
  console.info(`[kivara:enrichment:fetch] ${event}`, details);
}

interface FetchOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Opt in per source when the public site relies on a browser session cookie. */
  credentials?: RequestCredentials;
  /** Observe the status before non-2xx responses are reduced to `null`. */
  onResponse?: (response: Response) => void;
}

/** Race a fetch against a timeout. Throws AbortError on cancellation. */
export async function fetchWithTimeout(
  url: string,
  opts: FetchOptions,
): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  // Bridge the caller's signal (orchestrator cancel) into our controller so
  // a cancel mid-flight stops the request too. The listener is REMOVED in
  // `finally`: this used to attach one per call and never detach it, so a
  // long-lived signal accumulated listeners for every request ever made.
  const onOuterAbort = () => ctrl.abort();
  if (opts.signal?.aborted) ctrl.abort();
  else opts.signal?.addEventListener('abort', onOuterAbort, { once: true });
  const startedAt = performance.now();
  const allowHttp = /^http:/i.test(url);
  try {
    // Redirects are FOLLOWED. Handling them by hand with `redirect:'manual'`
    // is not possible from a service worker: that mode returns an opaque
    // redirect (status 0, no headers), so `Location` cannot be read and every
    // legitimate hop — http→https upgrade, a www prefix, a CDN, Wikimedia
    // `Special:FilePath`, GitHub releases → codeload — dies with "HTTP 0".
    //
    // The guard therefore checks where the request ENDED UP: `res.url` is the
    // final URL after every hop, and a response from a loopback / LAN /
    // metadata address is dropped before the caller can read it.
    const res = await fetch(url, {
      method: 'GET',
      credentials: opts.credentials ?? 'omit',
      cache: 'no-store',
      redirect: 'follow',
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.5',
        'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
        ...(opts.headers ?? {}),
      },
      signal: ctrl.signal,
    });
    if (res.ok && res.url && res.url !== url && !isPublicHttpUrlSync(res.url, allowHttp)) {
      logFetchDiagnostic('blocked-destination', { url, finalUrl: res.url });
      await res.body?.cancel().catch(() => {});
      // The caller's observer is for status bookkeeping — a request we refused
      // never got a status, so it must not look like a 200 that answered.
      return null;
    }
    logFetchDiagnostic('response', {
      url,
      finalUrl: res.url,
      status: res.status,
      ok: res.ok,
      redirected: res.redirected,
      contentType: res.headers.get('content-type'),
      contentLength: res.headers.get('content-length'),
      elapsedMs: Math.round(performance.now() - startedAt),
    });
    // A non-2xx must not leave the body open: an ignored 500 keeps the
    // connection (and its half-read stream) held until GC.
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      logFetchDiagnostic('response', {
        url,
        finalUrl: res.url,
        status: res.status,
        ok: false,
        redirected: res.redirected,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
      opts.onResponse?.(res);
      return null;
    }
    logFetchDiagnostic('response', {
      url,
      finalUrl: res.url,
      status: res.status,
      redirected: res.redirected,
      contentType: res.headers.get('content-type'),
      contentLength: res.headers.get('content-length'),
      elapsedMs: Math.round(performance.now() - startedAt),
    });
    return res;
  } catch (error) {
    logFetchDiagnostic('error', {
      url,
      elapsedMs: Math.round(performance.now() - startedAt),
      aborted: ctrl.signal.aborted,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    return null;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onOuterAbort);
  }
}

function isPublicHttpUrlSync(url: string, allowHttp = false): boolean {
  try {
    assertPublicHttpUrl(url, { allowHttp });
    return true;
  } catch {
    return false;
  }
}

export async function fetchHtml(
  url: string,
  opts: FetchOptions,
): Promise<string | null> {
  const res = await fetchWithTimeout(url, opts);
  if (!res) return null;
  try {
    const body = await res.text();
    logFetchDiagnostic('html-body', {
      url,
      finalUrl: res.url,
      bytes: new TextEncoder().encode(body).byteLength,
      characters: body.length,
    });
    return body;
  } catch (error) {
    logFetchDiagnostic('html-read-error', {
      url,
      finalUrl: res.url,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    return null;
  }
}

export async function fetchJson<T = unknown>(
  url: string,
  opts: FetchOptions,
): Promise<T | null> {
  const res = await fetchWithTimeout(url, opts);
  if (!res) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Lightweight DOM parser for service-worker land. The SW can't use
 * `DOMParser` directly in some Chrome builds (it's not on the global),
 * so we lazy-import via `globalThis.DOMParser`. If unavailable, we
 * fall back to a regex-based extractor — the sources that need true
 * DOM walking degrade gracefully (return empty partial).
 */
export function parseHtml(html: string): Document | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const D = (globalThis as any).DOMParser;
  if (typeof D !== 'function') return null;
  try {
    return new D().parseFromString(html, 'text/html');
  } catch {
    return null;
  }
}

/**
 * Helper for sources that just need `textContent` from a CSS selector.
 * Returns `[]` when the parser is unavailable, so callers can use
 * `selectAllText(doc, '.x')` without null-check boilerplate.
 */
export function selectAllText(doc: Document | null, selector: string): string[] {
  if (!doc) return [];
  try {
    return Array.from(doc.querySelectorAll(selector))
      .map((el) => (el.textContent ?? '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Same as `selectAllText` but returns a single attribute per match. */
export function selectAllAttr(
  doc: Document | null,
  selector: string,
  attr: string,
): string[] {
  if (!doc) return [];
  try {
    return Array.from(doc.querySelectorAll(selector))
      .map((el) => (el.getAttribute(attr) ?? '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Resolve a relative URL against a base. Used by sources that scrape
 * audio links — Cambridge, Oxford, etc. ship `<source src="/media/…">`
 * paths that need to be promoted to absolute URLs before we hand them
 * to the audio player.
 */
export function resolveUrl(base: string, href: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}
