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
 *   - `md=f` metadata: Google Books Ngrams log-frequency of the headword
 *      itself (`f:9.85` for `apple`). This is the Standard tier's
 *      frequency evidence — a recognised public corpus (Google Books)
 *      with no key and no extra request: it rides on the rel_syn call.
 *
 * Each relation maps to a separate slot in `SourcePartial`. We keep
 * the top-N by Datamuse's `score` (which reflects corpus frequency).
 */

import { fetchJson } from '../fetcher';
import type { EnrichmentContext, EnrichmentSource, SourcePartial } from '../types';

interface DatamuseHit {
  word: string;
  score?: number;
  tags?: string[];
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

/** Google Books frequency band from Datamuse's `f:` tag.
 * Verified live 2026-08-30: the `f:` value is LINEAR occurrences per
 * million words (`run` → 96.4, `know` → 383.3, `apple` → 9.85,
 * `tensor` → 2.23), NOT a log10 value. Bands mirror Longman's 1-3
 * learner bands: 1 = ubiquitous, 2 = very common, 3 = common,
 * 4 = uncommon. */
function booksFrequencyBand(tags: string[]): number | undefined {
  for (const tag of tags) {
    const match = /^f:([0-9.]+)$/.exec(tag ?? '');
    if (!match) continue;
    const perMillion = Number(match[1]);
    if (!Number.isFinite(perMillion) || perMillion <= 0) continue;
    if (perMillion >= 200) return 1;
    if (perMillion >= 30) return 2;
    if (perMillion >= 3) return 3;
    return 4;
  }
  return undefined;
}

export const datamuseSource: EnrichmentSource = {
  id: 'datamuse',
  label: 'Datamuse',
  async enrich(token, ctx): Promise<SourcePartial> {
    if ((ctx.sourceLang || 'en').slice(0, 2) !== 'en') return {};
    const t = token.trim().toLowerCase();
    if (!t) return {};

    // Run the relations in parallel; if any fails the others still
    // populate. A separate `sp=` + `md=f` query returns the headword row
    // with its Google Books frequency tag (`rel_syn=` empty returns []
    // — verified live, so the headword needs its own query).
    const [collocAfter, collocBefore, synonyms, antonyms, freqHits] = await Promise.all([
      rel(t, 'rel_bgb', 16, ctx), // words AFTER the headword
      rel(t, 'rel_bga', 8, ctx),  // words BEFORE
      rel(t, 'rel_syn', 12, ctx),
      rel(t, 'rel_ant', 8, ctx),
      fetchJson<DatamuseHit[]>(`${BASE}?sp=${encodeURIComponent(t)}&md=f&max=1`, {
        timeoutMs: ctx.timeoutMs,
        signal: ctx.signal,
      }).catch(() => [] as DatamuseHit[]),
    ]);

    const headword = Array.isArray(freqHits)
      ? freqHits.find((h) => (h.word ?? '').toLowerCase() === t)
      : undefined;
    const frequencyBand = headword?.tags?.length
      ? booksFrequencyBand(headword.tags)
      : undefined;

    // Collocations as full bigrams. "big girl", "big deal", etc. for
    // rel_bgb. For rel_bga, swap the order.
    const collocations = new Set<string>();
    for (const w of collocAfter) collocations.add(`${t} ${w}`);
    for (const w of collocBefore) collocations.add(`${w} ${t}`);

    const partial: SourcePartial = {};
    if (collocations.size) {
      // Exclude the headword itself from bigram collocations.
      partial.collocations = Array.from(collocations).slice(0, 12);
    }
    if (synonyms.length) partial.synonyms = synonyms;
    if (antonyms.length) partial.antonyms = antonyms;
    if (frequencyBand) {
      // NOTE: `source` is attached by the orchestrator's mergeFields
      // (`{ ...evidence, source: source.id }`), so the source-partial shape
      // (`FrequencyEvidence`) must NOT carry it here.
      partial.frequencyEvidence = [{ scale: 'books-band', value: String(frequencyBand) }];
    }
    return partial;
  },
};
