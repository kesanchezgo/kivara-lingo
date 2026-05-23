/**
 * Bundled dictionary source — Standard tier.
 *
 * Wraps `lookupDictionary()` from `src/content/nlp/dictionary.ts` so the
 * orchestrator can include the curated bundle (en.json + en-extensions
 * + en-cefr + mwes + thesaurus + Academic Collocation List) in the
 * fan-out. Without this, the chain duplicates work — service-worker
 * already calls `lookupDictionary()` for the popover's first wave, but
 * the AI/Anki path goes through `runEnrichment()` directly and was
 * skipping the bundle entirely.
 *
 * Always returns within microseconds (it's a hash lookup), so no
 * timeout / abort handling is needed.
 */

import { lookupDictionary } from '../../../content/nlp/dictionary';
import type { EnrichmentSource, SourcePartial } from '../types';

export const bundledSource: EnrichmentSource = {
  id: 'bundled',
  label: 'Bundled',
  async enrich(token, ctx): Promise<SourcePartial> {
    const lang = (ctx.sourceLang || 'en').slice(0, 2);
    const entry = lookupDictionary(token, lang);
    if (!entry) return {};

    const partial: SourcePartial = {};
    if (entry.phonetic) partial.phonetic = entry.phonetic;
    if (entry.translation && entry.translation !== '—') {
      partial.translations = [entry.translation];
    }
    // Bundle does carry the long-form bilingual sometimes; keep it.
    // The orchestrator merger will already join translations[] → bilingual.
    if (entry.monolingual) partial.definitions = [entry.monolingual];
    if (entry.examples?.length) {
      partial.examples = entry.examples.map((text) => ({ text }));
    }
    if (entry.synonyms?.length) partial.synonyms = entry.synonyms;
    if (entry.antonyms?.length) partial.antonyms = entry.antonyms;
    if (entry.collocations?.length) partial.collocations = entry.collocations;
    if (entry.frequencyRank) partial.frequencyRank = entry.frequencyRank;
    return partial;
  },
};
