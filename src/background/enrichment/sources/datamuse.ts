/**
 * Datamuse API — collocations + related-word relations.
 *
 * No key, no rate limit, no signup. Endpoint: `api.datamuse.com/words`.
 *
 * Used for several relations:
 *   - `rel_bgb` (Right-Bigram-Before): words appearing immediately AFTER
 *      the headword in Google Books — collocations like "big girl".
 *   - `rel_bga` (Right-Bigram-After): words appearing immediately BEFORE
 *      — "very big", "really big".
 *   - `rel_syn`: synonyms.
 *   - `rel_ant`: antonyms.
 *
 * Each relation maps to a separate slot in `SourcePartial`. We keep
 * the top-N by Datamuse's `score` (which reflects corpus frequency).
 */

import { fetchJson } from '../fetcher';
import type { EnrichmentContext, EnrichmentSource, SourcePartial } from '../types';

interface DatamuseHit {
  word: string;
  score?: number;
}

const BASE = 'https://api.datamuse.com/words';

async function rel(token: string, code: string, max: number, ctx: EnrichmentContext): Promise<string[]> {
  const url = `${BASE}?${code}=${encodeURIComponent(token)}&max=${max}`;
  const data = await fetchJson<DatamuseHit[]>(url, {
    timeoutMs: ctx.timeoutMs,
    signal: ctx.signal,
  });
  if (!Array.isArray(data)) return [];
  return data.map((h) => (h.word ?? '').trim()).filter(Boolean);
}

export const datamuseSource: EnrichmentSource = {
  id: 'datamuse',
  label: 'Datamuse',
  async enrich(token, ctx): Promise<SourcePartial> {
    if ((ctx.sourceLang || 'en').slice(0, 2) !== 'en') return {};
    const t = token.trim().toLowerCase();
    if (!t) return {};

    // Run the four relations in parallel; if any fails the others still
    // populate.
    const [collocAfter, collocBefore, synonyms, antonyms] = await Promise.all([
      rel(t, 'rel_bgb', 16, ctx), // words AFTER the headword
      rel(t, 'rel_bga', 8, ctx),  // words BEFORE
      rel(t, 'rel_syn', 12, ctx),
      rel(t, 'rel_ant', 8, ctx),
    ]);

    // Collocations as full bigrams. "big girl", "big deal", etc. for
    // rel_bgb. For rel_bga, swap the order.
    const collocations = new Set<string>();
    for (const w of collocAfter) collocations.add(`${t} ${w}`);
    for (const w of collocBefore) collocations.add(`${w} ${t}`);

    const partial: SourcePartial = {};
    if (collocations.size) {
      partial.collocations = Array.from(collocations).slice(0, 12);
    }
    if (synonyms.length) partial.synonyms = synonyms;
    if (antonyms.length) partial.antonyms = antonyms;
    return partial;
  },
};
