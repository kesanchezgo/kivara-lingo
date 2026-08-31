/**
 * Forvo scraper — VIP source.
 *
 * No Forvo account / API key required — we scrape the public HTML page.
 *
 * Pattern verified live 2026-05. Forvo embeds audio info in:
 *
 *   onclick="Play(<id>,'<oldMp3B64>','<oldOggB64>',false,
 *                '<newMp3B64>','<newOggB64>','h','<word>','<lang>');"
 *
 * The 5th argument (newMp3B64) decodes to a path like
 * `u/f/uf_9410655_39_582127.mp3` which serves a 200 OK MP3 from
 * `https://audio00.forvo.com/audios/mp3/<decoded>` (and also
 * `audio12.forvo.com` — both CDN fronts work).
 *
 * The 2nd argument (oldMp3B64) decodes to a legacy path that 404s
 * since 2023 — must NOT be used.
 *
 * Each row's surrounding HTML carries a `from_USA` / `from_United_Kingdom`
 * / `from_Canada` / `from_Australia` flag class for accent tagging.
 *
 * IMPORTANT: Forvo sits behind Cloudflare bot-detection but in our
 * tests passes from any browser-like fingerprint (curl with default
 * Schannel TLS works; the extension SW also works). If a 403 happens
 * in production we degrade silently — Cambridge / Oxford / Lingua
 * Libre / Wikimedia / Google TTS cover the audio chain.
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

function b64Decode(b64: string): string | null {
  try {
    // atob exists in service-worker globalThis.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const decoded = (globalThis as any).atob(b64);
    return decoded || null;
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
      credentials: 'include',
    });
    if (!html) return {};

    // Capture the 9-arg Play() signature. We need arg[1] (id) and
    // arg[5] (newMp3B64). Args are positional, comma-separated, all
    // single-quoted strings except `false` and the id.
    const re =
      /Play\(\s*(\d+)\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*(?:true|false)\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']*)'\s*,\s*'([^']+)'/g;

    const audio: Array<{ url: string; accent?: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && audio.length < 5) {
      const newMp3 = b64Decode(m[4]);
      if (!newMp3) continue;
      const url2 = `https://audio00.forvo.com/audios/mp3/${newMp3}`;

      // Best-effort accent: scan ~1500 chars before this Play() for
      // the row's `from_*` flag class.
      const before = html.slice(Math.max(0, m.index - 1500), m.index);
      let accent: string | undefined;
      if (/from_USA|United States/i.test(before)) accent = 'US';
      else if (/from_United_?Kingdom|United Kingdom/i.test(before)) accent = 'UK';
      else if (/from_Australia/i.test(before)) accent = 'AU';
      else if (/from_Canada/i.test(before)) accent = 'CA';
      else if (/from_Ireland/i.test(before)) accent = 'IE';

      if (!audio.some((a) => a.url === url2)) audio.push({ url: url2, accent });
    }

    if (!audio.length) return {};
    return { audio };
  },
};
