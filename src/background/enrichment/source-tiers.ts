/**
 * Which tier each enrichment source belongs to, for the MERGE's benefit.
 *
 * mergeFields must not import the orchestrator (no cycles, no TDZ when the
 * service worker boots), but it used to inherit tier behavior accidentally:
 * partials arrived in fan-out order, so "first write wins" meant "whichever
 * network call answered first", and the same word could produce a different
 * card run to run — cached for days. The tier map gives the merge a stable
 * rank so the winner is the source's standing, not its latency.
 *
 * The orchestrator BUILDS its source lists from this module (see
 * STANDARD_SOURCE_KEYS), so this file is the single source of truth for
 * tier membership — the lists and the map cannot drift apart.
 */

/**
 * Editorial: published, commercially edited dictionaries (the scrapes the
 * VIP tier carries). Standard: public APIs, open datasets, local packs and
 * synthesis. The mnemonic for "editorial" in every case below: a human
 * linguist edited what the source publishes.
 *
 *  - cambridge, oxfordLearners, longman, merriamWebster,
 *    merriamWebsterThesaurus, britannicaDictionary: commercial print/online
 *    dictionaries.
 *  - dictionaryCom (the `collins` toggle): editorial definitions/IPA, kept
 *    for the same reason Cambridge is.
 *  - pons, dictCc, reverso, linguee, babla, wordReference, spanishdict:
 *    professional bilingual dictionaries and editorial corpora.
 *  - ozdic: the Oxford Collocations mirror — editorial collocation data.
 *  - promtContext, tatoeba: machine corpora and CC-BY user-contributed
 *    sentences — NOT editorially reviewed; standard by tier.
 */
export type SourceTier = 'vip' | 'editorial' | 'standard';

/**
 * Every source id the orchestrator knows about, mapped to its tier.
 * The keys MUST cover the ids of every source in the orchestrator's
 * VIP_SOURCES + STANDARD_SOURCE_KEYS tables: there is a test
 * (source-tiers.test.ts) that fails when a source shows up there without
 * an entry here.
 */
export const SOURCE_TIERS: Record<string, SourceTier> = {
  // Standard tier — see the orchestrator's reclassification note for why
  // each of these sits outside VIP.
  freeDictionary: 'standard',
  datamuse: 'standard',
  wiktionary: 'standard',
  wiktionaryHtml: 'standard',
  wiktionaryApi: 'standard',
  wiktApi: 'standard',
  mobyThesaurus: 'standard',
  thesaurusCom: 'standard',
  wordHippo: 'standard',
  theIdioms: 'standard',
  bundled: 'standard',
  yomitanPacks: 'standard',
  etymonline: 'standard',
  promtContext: 'standard',
  tatoeba: 'standard',
  linguaLibre: 'standard',
  googleTtsFallback: 'standard',
  unsplash: 'standard',
  pixabay: 'standard',
  bingImages: 'standard',
  openverse: 'standard',
  wikimediaCommons: 'standard',
  duckduckgoImages: 'standard',
  youglish: 'standard',
  wordnet: 'standard',

  // Editorial tier — published dictionaries and professional corpora.
  britannicaDictionary: 'editorial',
  cambridge: 'editorial',
  oxfordLearners: 'editorial',
  longman: 'editorial',
  dictionaryCom: 'editorial',
  merriamWebster: 'editorial',
  merriamWebsterThesaurus: 'editorial',
  pons: 'editorial',
  babla: 'editorial',
  dictCc: 'editorial',
  reverso: 'editorial',
  linguee: 'editorial',
  wordReference: 'editorial',
  spanishDict: 'editorial',
  ozdic: 'editorial',
  // Forvo: crowd-read pronunciations from native speakers — it is audio,
  // not a dictionary. Standard tier; the merge's audio dedup ranks it
  // ahead of synthetic TTS internally.
  forvo: 'standard',
};

/** Lower wins: the tier's standing in a merge race. VIP > editorial > standard. */
const TIER_RANK: Record<SourceTier, number> = {
  vip: 0,
  editorial: 1,
  standard: 2,
};

/**
 * The tier of a source id. Unknown ids rank last ('standard'), so a source
 * added without a tier entry still merges — it just loses every
 * first-write-wins field, which is the safe default (a wrong-but-loud tier
 * map would let a random source overwrite Cambridge).
 */
export function sourceTier(id: string): SourceTier {
  return SOURCE_TIERS[id] ?? 'standard';
}

export function sourceTierRank(id: string): number {
  return TIER_RANK[sourceTier(id)];
}
