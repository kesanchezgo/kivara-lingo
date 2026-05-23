/**
 * Forvo scraper — VIP source.
 *
 * Pattern based on `jamesnicolas/yomichan-forvo-server` and
 * `Rascalov/Anki-Simple-Forvo-Audio`. No Forvo account / API key
 * required — we scrape the public HTML page.
 *
 * Forvo embeds the audio URL in an `onclick="Play(...)"` JavaScript
 * call. The Play function takes base64-encoded MP3 paths. We extract
 * those bases and decode them to absolute audio URLs.
 *
 *   onclick="Play(NNN,'<base64-mp3-path>','<base64-ogg-path>',false,
 *                'audio/mp3',...);"
 *
 * Each row also lists the speaker's locale (US, UK, Australia, etc.)
 * so we can tag accents.
 *
 * IMPORTANT: Forvo sits behind Cloudflare bot-detection and returns
 * 403 to non-browser clients (curl, Node). The extension service
 * worker uses the browser's real network stack so the request can
 * succeed at runtime where a Node-side audit can't. If a 403 happens
 * in production we degrade silently and the audio chain falls back
 * to Cambridge / Oxford / Wikimedia / Google TTS.
 */

import { fetchHtml } from '../fetcher';
import type { EnrichmentSource, SourcePartial } from '../types';

const LANG_MAP: Record<string, string> = {
  en: 'en',
  es: 'es',
  fr: 'fr',
  de: 'de',
  it: 'it',
  pt: 'pt',
  ru: 'ru',
  ja: 'ja',
  zh: 'zh',
  ko: 'ko',
};

function b64ToUrl(b64: string): string | null {
  try {
    // atob exists in service-worker globalThis.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const decoded = (globalThis as any).atob(b64);
    if (!decoded) return null;
    if (decoded.startsWith('http')) return decoded;
    return `https://audio00.forvo.com/${decoded}`;
  } catch {
    return null;
  }
}

export const forvoSource: EnrichmentSource = {
  id: 'forvo',
  label: 'Forvo',
  async enrich(token, ctx): Promise<SourcePartial> {
    const lang = LANG_MAP[(ctx.sourceLang || 'en').slice(0, 2)];
    if (!lang) return {};
    const slug = encodeURIComponent(token.trim());
    const url = `https://forvo.com/word/${slug}/#${lang}`;
    const html = await fetchHtml(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    if (!html) return {};

    // Each audio row: onclick="Play(NNN,'b64_mp3_path','b64_ogg_path',false, ...)"
    // We grab the b64 mp3 path. The Play call signature varies slightly
    // across Forvo versions; we try the most common ones in order.
    const re = /Play\(\s*\d+\s*,\s*'([^']+)'\s*,\s*'([^']+)'/g;
    const audio: Array<{ url: string; accent?: string }> = [];
    let m: RegExpExecArray | null;
    let count = 0;
    while ((m = re.exec(html)) && count < 5) {
      const url2 = b64ToUrl(m[1]) || b64ToUrl(m[2]);
      if (url2 && /\.mp3(\?|$)/i.test(url2)) {
        // Best-effort accent: the surrounding HTML usually has a flag
        // class like "from_USA" or "from_UnitedKingdom".
        const after = html.slice(m.index, m.index + 1500);
        let accent: string | undefined;
        if (/from_USA|United States/i.test(after)) accent = 'US';
        else if (/from_United_?Kingdom|United Kingdom/i.test(after)) accent = 'UK';
        else if (/from_Australia/i.test(after)) accent = 'AU';
        else if (/from_Canada/i.test(after)) accent = 'CA';
        if (!audio.some((a) => a.url === url2)) audio.push({ url: url2, accent });
      }
      count += 1;
    }

    if (!audio.length) return {};
    return { audio };
  },
};
