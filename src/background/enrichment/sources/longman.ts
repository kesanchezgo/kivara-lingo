/**
 * Longman Dictionary of Contemporary English scraper — VIP source.
 *
 * `ldoceonline.com`. Definitions written using a 2 000-word "Defining
 * Vocabulary" — the easiest to read definitions of any major learner's
 * dictionary, ideal for B1-B2 learners.
 *
 * Markup verified 2026-04:
 *   - `<span class="DEF">` definitions
 *   - `<span class="EXAMPLE">` examples
 *   - `<span class="PRON">/bɪɡ/</span>` IPA
 *   - `<span class="speaker brefile fa fa-volume-up" data-src-mp3="…">` audio
 *   - `<span class="COLLO">` collocation flag
 */

import { fetchHtml, resolveUrl } from '../fetcher';
import { extractByClass, stripHtml } from '../html-utils';
import type { EnrichmentSource, SourcePartial } from '../types';

const BASE = 'https://www.ldoceonline.com';

export const longmanSource: EnrichmentSource = {
  id: 'longman',
  label: 'Longman',
  async enrich(token, ctx): Promise<SourcePartial> {
    const slug = encodeURIComponent(token.trim().toLowerCase().replace(/\s+/g, '-'));
    const url = `${BASE}/dictionary/${slug}`;
    const html = await fetchHtml(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    if (!html) return {};

    const partial: SourcePartial = {};

    const phons = extractByClass(html, 'PRON', 'span').map(stripHtml);
    if (phons.length) {
      const raw = phons[0].replace(/^\/+|\/+$/g, '').trim();
      if (raw) partial.phonetic = `/${raw}/`;
    }

    // Audio: any element with data-src-mp3.
    const audio: Array<{ url: string; accent?: string }> = [];
    const audioRe = /\bdata-src-mp3\s*=\s*["']([^"']+\.mp3[^"']*)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = audioRe.exec(html)) && audio.length < 4) {
      const fix = resolveUrl(BASE, m[1]);
      const accent = /breamefile|usage_amefile|ame_/i.test(m[1]) ? 'US' : 'UK';
      if (!audio.some((a) => a.url === fix)) audio.push({ url: fix, accent });
    }
    if (audio.length) partial.audio = audio;

    const definitions = extractByClass(html, 'DEF', 'span')
      .map(stripHtml)
      .filter((s) => s.length > 6);
    if (definitions.length) partial.definitions = definitions.slice(0, 4);

    const examples = extractByClass(html, 'EXAMPLE', 'span')
      .map(stripHtml)
      .filter((s) => s.length > 8 && s.length < 220);
    if (examples.length) {
      partial.examples = examples.slice(0, 4).map((text) => ({ text }));
    }

    const collocations = extractByClass(html, 'COLLO', 'span')
      .map(stripHtml)
      .filter((s) => s && s.length < 60);
    if (collocations.length) {
      partial.collocations = Array.from(new Set(collocations)).slice(0, 10);
    }

    return partial;
  },
};
