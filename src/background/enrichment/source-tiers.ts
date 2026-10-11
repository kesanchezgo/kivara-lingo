/**
 * Which tier each enrichment source belongs to, for the MERGE's benefit, and
 * whether its ACTIVATION sits behind the VIP master switch.
 *
 * TWO AXES, deliberately separate (74a5a10 conflated them and shipped a
 * real regression): `tier` is the merge's rank; `gate` is whether the source
 * runs behind the master switch at all. Deriving the standard source list
 * from the tier map sent Forvo, Unsplash, Pixabay and Promt running with the
 * VIP master switch OFF — those four are standard by PRIORITY but VIP by
 * ACCESS.
 *
 * mergeFields must not import the orchestrator (no cycles, no TDZ when the
 * service worker boots), but it used to inherit tier behavior accidentally:
 * partials arrived in fan-out order, so "first write wins" meant "whichever
 * network call answered first", and the same word could produce a different
 * card run to run — cached for days. The tier map gives the merge a stable
 * rank so the winner is the source's standing, not its latency.
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
 * The ACTIVATION axis, kept deliberately separate from the tier: 74a5a10
 * conflated them and shipped a real regression — deriving the standard
 * source list from the tier map sent Forvo, Unsplash, Pixabay and Promt
 * running with the VIP master switch OFF. The tier is the merge's rank;
 * the gate is whether the source runs behind the master switch at all.
 */
export type SourceGate = 'standard' | 'vip';

export interface SourceClassification {
  /** Merge priority — which source wins a first-write-wins field. */
  tier: SourceTier;
  /** Activation — runs with VIP off, or needs the master switch on. */
  gate: SourceGate;
}

/**
 * Every source id the orchestrator knows about. The keys MUST cover every
 * source the orchestrator can build partials for — source-tiers.test.ts
 * fails when a source ships without an entry here.
 *
 * The gate column reproduces the pre-74a5a10 STANDARD_SOURCE_KEYS list
 * exactly: fourteen dictionaries sit behind the master switch (gate: 'vip')
 * and everything else runs regardless (gate: 'standard').
 */
export const SOURCE_TIERS: Record<string, SourceClassification> = {
  // Standard tier — see the orchestrator's reclassification note for why
  // each of these sits outside VIP.
  freeDictionary: { tier: 'standard', gate: 'standard' },
  datamuse: { tier: 'standard', gate: 'standard' },
  wiktionary: { tier: 'standard', gate: 'standard' },
  wiktionaryHtml: { tier: 'standard', gate: 'standard' },
  wiktionaryApi: { tier: 'standard', gate: 'standard' },
  wiktApi: { tier: 'standard', gate: 'standard' },
  mobyThesaurus: { tier: 'standard', gate: 'standard' },
  thesaurusCom: { tier: 'standard', gate: 'standard' },
  wordHippo: { tier: 'standard', gate: 'standard' },
  theIdioms: { tier: 'standard', gate: 'standard' },
  bundled: { tier: 'standard', gate: 'standard' },
  yomitanPacks: { tier: 'standard', gate: 'standard' },
  etymonline: { tier: 'standard', gate: 'standard' },
  promtContext: { tier: 'standard', gate: 'vip' },
  tatoeba: { tier: 'standard', gate: 'standard' },
  linguaLibre: { tier: 'standard', gate: 'standard' },
  googleTtsFallback: { tier: 'standard', gate: 'standard' },
  unsplash: { tier: 'standard', gate: 'vip' },
  pixabay: { tier: 'standard', gate: 'vip' },
  bingImages: { tier: 'standard', gate: 'standard' },
  openverse: { tier: 'standard', gate: 'standard' },
  wikimediaCommons: { tier: 'standard', gate: 'standard' },
  duckduckgoImages: { tier: 'standard', gate: 'standard' },
  youglish: { tier: 'standard', gate: 'standard' },
  wordnet: { tier: 'standard', gate: 'standard' },

  // Editorial tier — published dictionaries and professional corpora.
  britannicaDictionary: { tier: 'editorial', gate: 'vip' },
  cambridge: { tier: 'editorial', gate: 'vip' },
  oxfordLearners: { tier: 'editorial', gate: 'vip' },
  longman: { tier: 'editorial', gate: 'vip' },
  dictionaryCom: { tier: 'editorial', gate: 'vip' },
  merriamWebster: { tier: 'editorial', gate: 'vip' },
  merriamWebsterThesaurus: { tier: 'editorial', gate: 'vip' },
  pons: { tier: 'editorial', gate: 'vip' },
  babla: { tier: 'editorial', gate: 'vip' },
  dictCc: { tier: 'editorial', gate: 'vip' },
  reverso: { tier: 'editorial', gate: 'vip' },
  linguee: { tier: 'editorial', gate: 'vip' },
  wordReference: { tier: 'editorial', gate: 'vip' },
  spanishDict: { tier: 'editorial', gate: 'vip' },
  ozdic: { tier: 'editorial', gate: 'vip' },
  // Forvo: crowd-read pronunciations from native speakers — audio, not a
  // dictionary, so 'standard' by priority; but a for-credit source, so it
  // belongs behind the master switch like the other paid feeds. 74a5a10 made
  // it standard on BOTH axes by accident and it started hitting Forvo with
  // VIP off — the gate axis is what that bug was missing.
  forvo: { tier: 'standard', gate: 'vip' },
};

/** Lower wins: the tier's standing in a merge race. VIP > editorial > standard. */
const TIER_RANK: Record<SourceTier, number> = {
  vip: 0,
  editorial: 1,
  standard: 2,
};

/** Unknown ids fall back to the SAFE defaults (see above). */
const UNMAPPED: SourceClassification = { tier: 'standard', gate: 'vip' };

/**
 * The tier of a source id. An unmapped source ranks last ('standard') AND is
 * VIP-gated: a new source must never win a first-write-wins field while the
 * map is being filled in, and it must not run for free before someone
 * decides it should.
 */
export function sourceTier(id: string): SourceTier {
  return SOURCE_TIERS[id]?.tier ?? UNMAPPED.tier;
}

/**
 * The ACTIVATION of a source id — the axis 74a5a10 lost when it derived the
 * gate from the tier. The orchestrator's fan-out uses ONLY this: a source
 * whose master switch is off never runs, whatever its merge rank.
 */
export function sourceGate(id: string): SourceGate {
  return SOURCE_TIERS[id]?.gate ?? UNMAPPED.gate;
}

export function sourceTierRank(id: string): number {
  return TIER_RANK[sourceTier(id)];
}
