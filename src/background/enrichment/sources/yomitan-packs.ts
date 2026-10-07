/**
 * Yomitan installed packs source — Standard tier.
 *
 * Queries the IndexedDB-backed Yomitan dictionary cache (filled by
 * `src/content/nlp/yomitan.ts`'s `importYomitanPack*`) for the user's
 * installed kty-* packs. This is the most powerful Standard-tier
 * resource — `kty-en-es` has ~61k terms and `kty-en-ipa` ~140k IPA rows
 * (verified 2026-10-07 from the shipped ZIPs), covering phrasal verbs,
 * idioms, MWEs and slang that no other free source ships.
 *
 * Output shape:
 *   - `definitions`        — from monolingual packs (kty-en-en, kty-es-es)
 *   - `translations`       — from bilingual packs (kty-en-es, kty-es-en)
 *   - `examples`           — pulled from the structured-content blocks
 *                            when the pack ships them inline
 *   - `phonetic`           — from IPA packs (kty-en-ipa) via term_meta
 *
 * Performance: a single `lookupYomitanTerm()` call hits the
 * `dict_terms` table once, sorted by popularity then pack-install
 * order. Typical p99 < 5 ms on a 100k-row table because the lookup
 * is keyed on `expression` (indexed).
 */

import { lookupYomitanTerm } from '../../../content/nlp/yomitan';
import type { EnrichmentSource, SourcePartial } from '../types';

export const yomitanPacksSource: EnrichmentSource = {
  id: 'yomitanPacks',
  label: 'Yomitan',
  async enrich(token, ctx): Promise<SourcePartial> {
    const lang = (ctx.sourceLang || 'en').slice(0, 2);
    const result = await lookupYomitanTerm(token, lang);
    if (!result) return {};
    const { entry } = result;

    const partial: SourcePartial = {};
    if (entry.phonetic) partial.phonetic = entry.phonetic;
    if (entry.translation && entry.translation !== '—') {
      partial.translations = [entry.translation];
    }
    if (entry.monolingual) {
      // The monolingual Yomitan field is the long-form English / native
      // definition. Surface it as a definition so the merger can pick
      // the best one across sources.
      partial.definitions = [entry.monolingual];
    }
    if (entry.examples?.length) {
      partial.examples = entry.examples.map((text) => ({ text }));
    }
    if (entry.synonyms?.length) partial.synonyms = entry.synonyms;
    if (entry.antonyms?.length) partial.antonyms = entry.antonyms;
    if (entry.collocations?.length) partial.collocations = entry.collocations;
    return partial;
  },
};
