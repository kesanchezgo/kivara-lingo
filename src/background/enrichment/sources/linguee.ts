/**
 * Linguee scraper — VIP source.
 *
 * Linguee ships translations and bilingual examples curated from real
 * web documents. Pattern based on `imankulov/linguee-api` and
 * `felipe-augusto/linguee`.
 *
 * Linguee doesn't have a public API. We hit the search HTML page and
 * extract:
 *   - top translations (head word equivalents)
 *   - external example sentences (1-2 sentence parallel pairs)
 */

import { fetchHtml } from '../fetcher';
import { extractByClass, stripHtml } from '../html-utils';
import type { EnrichmentSource, SourcePartial } from '../types';

const LANG_PAIR: Record<string, string> = {
  'en-es': 'english-spanish',
  'es-en': 'spanish-english',
  'en-fr': 'english-french',
  'fr-en': 'french-english',
  'en-de': 'english-german',
  'de-en': 'german-english',
  'en-pt': 'english-portuguese',
  'pt-en': 'portuguese-english',
  'en-it': 'english-italian',
  'it-en': 'italian-english',
};

export const lingueeSource: EnrichmentSource = {
  id: 'linguee',
  label: 'Linguee',
  async enrich(token, ctx): Promise<SourcePartial> {
    const pair = `${(ctx.sourceLang || 'en').slice(0, 2)}-${(ctx.targetLang || 'es').slice(0, 2)}`;
    const slug = LANG_PAIR[pair];
    if (!slug) return {};
    const url = `https://www.linguee.com/${slug}/search?source=auto&query=${encodeURIComponent(token)}`;
    const html = await fetchHtml(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    if (!html) return {};

    const partial: SourcePartial = {};

    // Top translations live in `<a class="dictLink">` inside the
    // `lemma_desc` block.
    const translations = extractByClass(html, 'dictLink', 'a')
      .map(stripHtml)
      .filter((s) => s && s.length < 60);
    if (translations.length) {
      partial.translations = Array.from(new Set(translations)).slice(0, 6);
    }

    // Example pairs: `<span class="tag_s">` (source) +
    // `<span class="tag_t">` (target). Linguee renders them
    // back-to-back so we pair them sequentially.
    const sources = extractByClass(html, 'tag_s', 'span').map(stripHtml);
    const targets = extractByClass(html, 'tag_t', 'span').map(stripHtml);
    const examples: Array<{ text: string; translation?: string }> = [];
    const n = Math.min(sources.length, targets.length, 5);
    for (let i = 0; i < n; i += 1) {
      const s = sources[i];
      const t = targets[i];
      if (s && s.length > 8 && s.length < 220) {
        examples.push({ text: s, translation: t || undefined });
      }
    }
    if (examples.length) partial.examples = examples;

    return partial;
  },
};
