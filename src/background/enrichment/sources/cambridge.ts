/**
 * Cambridge Dictionary scraper — VIP source.
 *
 * Scrape pattern based on `Carapacik/cambridge-dictionary-scraper` and
 * `chenelias/cambridge-dictionary-api`. We hit the bilingual EN-ES page
 * when the user is learning English from Spanish (best of both worlds —
 * EN definitions + ES translations) and fall back to the monolingual
 * EN-EN page when the bilingual one 404s.
 *
 * Markup conventions verified against live HTML 2026-04:
 *   - `<span class="ipa dipa">/bɪɡ/</span>`           IPA
 *   - `<source type="audio/mpeg" src="...uk_pron.mp3">` UK audio
 *   - `<source type="audio/mpeg" src="...us_pron.mp3">` US audio
 *   - `<div class="def ddef_d">` definition
 *   - `<span class="trans dtrans">grande</span>`     EN→ES translation
 *   - `<div class="examp dexamp">` example sentences
 *   - `<a class="dictlink" href="…">` collocation links (in collocations
 *      block when the page has one)
 *
 * Returns a partial with: definitions, translations, examples,
 * collocations, IPA, audio.
 */

import { fetchHtml, resolveUrl } from '../fetcher';
import {
  extractByClass,
  extractAttrByClass,
  extractAnchorsByClass,
  stripHtml,
} from '../html-utils';
import type { EnrichmentContext, EnrichmentSource, SourcePartial } from '../types';

const BASE = 'https://dictionary.cambridge.org';

function urlFor(token: string, sourceLang: string, targetLang: string): string {
  const slug = encodeURIComponent(token.trim().toLowerCase().replace(/\s+/g, '-'));
  // Bilingual EN→ES has the most useful data when both langs are EN/ES.
  const src = sourceLang.slice(0, 2);
  const tgt = targetLang.slice(0, 2);
  if (src === 'en' && tgt === 'es') return `${BASE}/dictionary/english-spanish/${slug}`;
  if (src === 'en') return `${BASE}/dictionary/english/${slug}`;
  if (src === 'es' && tgt === 'en') return `${BASE}/dictionary/spanish-english/${slug}`;
  return `${BASE}/dictionary/english/${slug}`;
}

export const cambridgeSource: EnrichmentSource = {
  id: 'cambridge',
  label: 'Cambridge',
  async enrich(token, ctx): Promise<SourcePartial> {
    const url = urlFor(token, ctx.sourceLang || 'en', ctx.targetLang || 'es');
    const html = await fetchHtml(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    if (!html) return {};

    const partial: SourcePartial = {};

    // IPA — keep the first occurrence (typically UK), fall back to US.
    const ipas = extractByClass(html, 'ipa', 'span').map(stripHtml);
    if (ipas.length) partial.phonetic = `/${ipas[0].replace(/^\/+|\/+$/g, '')}/`;

    // Audio — UK + US `<source>` elements. Cambridge usually ships
    // `uk_pron.mp3` and `us_pron.mp3` paths.
    const audioPaths = extractAttrByClass(html, '', 'src', 'source')
      .filter((p) => /\.mp3(\?|$)/i.test(p))
      .filter((p) => /pron|speaker|amp3/i.test(p));
    const audio: Array<{ url: string; accent?: string }> = [];
    for (const p of audioPaths) {
      const abs = resolveUrl(BASE, p);
      const accent = /us_pron|\/us\//i.test(p) ? 'US' : /uk_pron|\/uk\//i.test(p) ? 'UK' : undefined;
      // De-duplicate: same accent appearing twice (one per dialect block).
      if (!audio.some((a) => a.url === abs)) audio.push({ url: abs, accent });
    }
    if (audio.length) partial.audio = audio.slice(0, 4);

    // Definitions: `<div class="def ddef_d">`.
    const definitions = extractByClass(html, 'ddef_d', 'div')
      .map(stripHtml)
      .map((s) => s.replace(/:\s*$/, ''))
      .filter((s) => s.length > 6);
    if (definitions.length) partial.definitions = definitions.slice(0, 4);

    // Translations: `<span class="trans dtrans">…</span>` (only present
    // on the bilingual page, where it ships ES translations).
    const translations = extractByClass(html, 'dtrans', 'span')
      .map(stripHtml)
      .filter((s) => s && s.length < 80);
    if (translations.length) {
      partial.translations = Array.from(new Set(translations)).slice(0, 6);
    }

    // Examples: `<div class="examp dexamp">`.
    const examples = extractByClass(html, 'dexamp', 'div')
      .map(stripHtml)
      .filter((s) => s.length > 8 && s.length < 220);
    if (examples.length) {
      partial.examples = examples.slice(0, 4).map((text) => ({ text }));
    }

    // Collocations: anchors inside the `daccord_b` collocation block.
    // Cambridge surfaces these as clickable links to other entries.
    const collocAnchors = extractAnchorsByClass(html, 'dictlink');
    const collocations = collocAnchors
      .map((a) => a.text)
      .filter((s) => s && s.split(/\s+/).length >= 2 && s.length < 60);
    if (collocations.length) {
      partial.collocations = Array.from(new Set(collocations)).slice(0, 10);
    }

    return partial;
  },
};
