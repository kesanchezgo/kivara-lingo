/**
 * WordReference scraper — VIP source.
 *
 * `wordreference.com` is a community-curated translator dictionary
 * loved for natural EN-ES / EN-FR equivalents. Pattern reference:
 * `FedericoVaga/PyWordReference`.
 *
 * Markup verified 2026-04:
 *   - `<table class="WRD">` translation table
 *   - `<td class="ToWrd">` target word column (Spanish)
 *   - `<td class="FrEx">` source-language example
 *   - `<td class="ToEx">` target-language example
 */

import { fetchHtml } from '../fetcher';
import { extractByClass, stripHtml } from '../html-utils';
import type { EnrichmentSource, SourcePartial } from '../types';

const PAIR: Record<string, string> = {
  'en-es': 'enes',
  'es-en': 'esen',
  'en-fr': 'enfr',
  'fr-en': 'fren',
  'en-it': 'enit',
  'it-en': 'iten',
  'en-de': 'ende',
  'de-en': 'deen',
  'en-pt': 'enpt',
  'pt-en': 'pten',
};

export const wordReferenceSource: EnrichmentSource = {
  id: 'wordReference',
  label: 'WordRef',
  async enrich(token, ctx): Promise<SourcePartial> {
    const code = PAIR[`${(ctx.sourceLang || 'en').slice(0, 2)}-${(ctx.targetLang || 'es').slice(0, 2)}`];
    if (!code) return {};
    const slug = encodeURIComponent(token.trim().toLowerCase());
    const url = `https://www.wordreference.com/${code}/${slug}`;
    const html = await fetchHtml(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    if (!html) return {};

    const partial: SourcePartial = {};

    const translations = extractByClass(html, 'ToWrd', 'td')
      .map(stripHtml)
      // WR appends the part of speech after the word; trim it.
      .map((s) => s.split(/\s+(?:nf|nm|adj|adv|vt|vi|prep|pron|conj|det|noun|verb|adjective)\b/i)[0])
      .filter((s) => s && s.length < 60);
    if (translations.length) {
      partial.translations = Array.from(new Set(translations)).slice(0, 6);
    }

    const sources = extractByClass(html, 'FrEx', 'td').map(stripHtml);
    const targets = extractByClass(html, 'ToEx', 'td').map(stripHtml);
    const examples: Array<{ text: string; translation?: string }> = [];
    const n = Math.min(sources.length, targets.length, 4);
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
