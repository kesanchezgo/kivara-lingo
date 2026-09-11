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
import type { EnrichmentSource, SenseRelationGroup, SourcePartial } from '../types';

/** Sense-scoped curated collocation groups the bundle publishes alongside
 * its flat verb-object pairs. Mirrors the Longman Sense-block contract:
 * the merger's contextual gate (`pickSenseRelationGroups`) picks the
 * CURRENT sense's chunks instead of dumping every sense flat. Only
 * `run` needs one today (manage vs motion); more verbs grow here only
 * with live-pool evidence, never by guessing. */
const BUNDLED_SENSE_COLLOCATION_GROUPS: Array<{ token: string } & SenseRelationGroup> = [
  {
    token: 'run',
    guide: 'to organize or be in charge of a business',
    definition: 'to organize or be in charge of a business',
    collocations: ['run a company', 'run a business'],
  },
];

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
    const senseGroups = BUNDLED_SENSE_COLLOCATION_GROUPS.filter(
      (group) => group.token === token.trim().toLowerCase(),
    ).map(({ token: _token, ...group }) => group);
    if (senseGroups.length) partial.relationGroups = senseGroups;
    if (entry.frequencyRank) partial.frequencyRank = entry.frequencyRank;
    return partial;
  },
};
