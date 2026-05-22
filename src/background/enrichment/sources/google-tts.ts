/**
 * Google Translate TTS — last-resort synthetic audio fallback.
 *
 * The endpoint `translate.google.com/translate_tts` returns an MP3 of
 * the synthesised audio for the given text. No API key or signup is
 * required for short payloads (< ~200 chars). We use it ONLY for the
 * single headword as a fallback when no human-recorded source
 * (Cambridge / Oxford / Forvo / Lingua Libre / Wikimedia) returned
 * a hit.
 *
 * The endpoint enforces a `client=tw-ob` parameter (Tab-with-Other-
 * Browser) to skip its anti-scrape gating. This is the well-known
 * "neutral speaker" TTS — synthetic but acceptable as a backup.
 */

import type { EnrichmentSource, SourcePartial } from '../types';

const LANG_OK = new Set(['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'zh', 'ko']);

export const googleTtsSource: EnrichmentSource = {
  id: 'googleTtsFallback',
  label: 'Google TTS',
  async enrich(token, ctx): Promise<SourcePartial> {
    const lang = (ctx.sourceLang || 'en').slice(0, 2);
    if (!LANG_OK.has(lang)) return {};
    const t = token.trim();
    if (!t || t.length > 100) return {};

    // The TTS endpoint doesn't return JSON — it streams MP3 audio. We
    // just build the URL and return it; the player consumes the URL
    // directly. We don't actually fetch it here (no need to validate
    // — the URL is deterministic and infinitely cached).
    const url =
      `https://translate.google.com/translate_tts` +
      `?ie=UTF-8&q=${encodeURIComponent(t)}&tl=${lang}&client=tw-ob`;
    return { audio: [{ url, accent: 'TTS' }] };
  },
};
