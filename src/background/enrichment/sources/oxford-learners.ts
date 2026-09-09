/**
 * Oxford Advanced Learner's Dictionary scraper — VIP source.
 *
 * Pattern based on `NearHuscarl/oxford-dictionary-api` and the
 * markup of `oxfordlearnersdictionaries.com` (verified 2026-04).
 *
 * Useful for B2-C2 learners because Oxford ships:
 *   - precise definitions with grammar codes
 *   - UK + US audio MP3s
 *   - high-quality example sentences vetted by editors
 *   - light collocations through the `cf` (collocation flag) class
 */

import { fetchHtml, resolveUrl } from '../fetcher';
import {
  extractByClass,
  extractAttrByClass,
  stripHtml,
} from '../html-utils';
import type { EnrichmentSource, SourcePartial } from '../types';

const BASE = 'https://www.oxfordlearnersdictionaries.com';

export const oxfordLearnersSource: EnrichmentSource = {
  id: 'oxfordLearners',
  label: 'Oxford',
  async enrich(token, ctx): Promise<SourcePartial> {
    const slug = encodeURIComponent(token.trim().toLowerCase().replace(/\s+/g, '-'));
    const url = `${BASE}/definition/english/${slug}`;
    const html = await fetchHtml(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    if (!html) return {};

    const partial: SourcePartial = {};

    // IPA — `phon` class with leading slash.
    const phons = extractByClass(html, 'phon', 'span').map(stripHtml);
    if (phons.length) {
      // First UK pronunciation, raw HTML may or may not contain wrapping /…/.
      const raw = phons[0].replace(/^\/|\/$/g, '');
      if (raw) partial.phonetic = `/${raw}/`;
    }

    // Audio: `<div class="sound audio_play_button pron-uk" data-src-mp3="…">`.
    // Oxford uses data-src-mp3 / data-src-ogg.
    const ukRe = /class\s*=\s*["'][^"']*pron-uk[^"']*["'][^>]*\bdata-src-mp3\s*=\s*["']([^"']+)["']/i;
    const usRe = /class\s*=\s*["'][^"']*pron-us[^"']*["'][^>]*\bdata-src-mp3\s*=\s*["']([^"']+)["']/i;
    const audio: Array<{ url: string; accent?: string }> = [];
    const ukM = ukRe.exec(html);
    if (ukM) audio.push({ url: resolveUrl(BASE, ukM[1]), accent: 'UK' });
    const usM = usRe.exec(html);
    if (usM) audio.push({ url: resolveUrl(BASE, usM[1]), accent: 'US' });
    if (audio.length) partial.audio = audio;

    // Definitions: `<span class="def">`.
    const definitions = extractByClass(html, 'def', 'span')
      .map(stripHtml)
      .filter((s) => s.length > 8);
    if (definitions.length) partial.definitions = definitions.slice(0, 4);

    // Examples: `<span class="x">`.
    const examples = extractByClass(html, 'x', 'span')
      .map(stripHtml)
      .filter((s) => s.length > 8 && s.length < 220);
    if (examples.length) {
      partial.examples = examples.slice(0, 4).map((text) => ({ text }));
    }

    // NOTE: Oxford's `<span class="cf">` (collocation flag) spans carry
    // GRAMMAR patterns (`give something to somebody`), not learner-ready
    // chunks. They die downstream in normalizeCollocation (something/
    // somebody rule) but cost pool noise, so we do not emit them at all.
    // Real Oxford collocations live in the paywalled OCOLL dictionary
    // (`free: false`), not on this page. Verified live 2026-09-06 on
    // `give`/`run`: all cf spans are something/somebody templates.

    return partial;
  },
};
