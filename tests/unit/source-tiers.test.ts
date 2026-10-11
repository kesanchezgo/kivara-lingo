import { describe, it, expect } from 'vitest';
import { SOURCE_TIERS, sourceGate, sourceTier, sourceTierRank } from "../../src/background/enrichment/source-tiers";
import type { EnrichmentSource } from "../../src/shared/types";
import { bablaSource } from "../../src/background/enrichment/sources/babla";
import { bingImagesSource } from "../../src/background/enrichment/sources/bing-images";
import { britannicaDictionarySource } from "../../src/background/enrichment/sources/britannica-dictionary";
import { bundledSource } from "../../src/background/enrichment/sources/bundled";
import { cambridgeSource } from "../../src/background/enrichment/sources/cambridge";
import { datamuseSource } from "../../src/background/enrichment/sources/datamuse";
import { dictCcSource } from "../../src/background/enrichment/sources/dictcc";
import { dictionaryComSource } from "../../src/background/enrichment/sources/dictionary-com";
import { duckduckgoImagesSource } from "../../src/background/enrichment/sources/duckduckgo-images";
import { etymonlineSource } from "../../src/background/enrichment/sources/etymonline";
import { forvoSource } from "../../src/background/enrichment/sources/forvo";
import { freeDictionarySource } from "../../src/background/enrichment/sources/free-dictionary";
import { googleTtsSource } from "../../src/background/enrichment/sources/google-tts";
import { linguaLibreSource } from "../../src/background/enrichment/sources/lingua-libre";
import { lingueeSource } from "../../src/background/enrichment/sources/linguee";
import { longmanSource } from "../../src/background/enrichment/sources/longman";
import { merriamWebsterSource } from "../../src/background/enrichment/sources/merriam-webster";
import { mobyThesaurusSource } from "../../src/background/enrichment/sources/moby-thesaurus";
import { merriamWebsterThesaurusSource } from "../../src/background/enrichment/sources/mw-thesaurus";
import { openverseSource } from "../../src/background/enrichment/sources/openverse";
import { oxfordLearnersSource } from "../../src/background/enrichment/sources/oxford-learners";
import { ozdicSource } from "../../src/background/enrichment/sources/ozdic";
import { pixabaySource } from "../../src/background/enrichment/sources/pixabay";
import { ponsSource } from "../../src/background/enrichment/sources/pons";
import { promtContextSource } from "../../src/background/enrichment/sources/promt-context";
import { reversoSource } from "../../src/background/enrichment/sources/reverso-context";
import { spanishDictSource } from "../../src/background/enrichment/sources/spanishdict";
import { tatoebaSource } from "../../src/background/enrichment/sources/tatoeba";
import { theIdiomsSource } from "../../src/background/enrichment/sources/the-idioms";
import { thesaurusComSource } from "../../src/background/enrichment/sources/thesaurus-com";
import { unsplashSource } from "../../src/background/enrichment/sources/unsplash";
import { wikimediaCommonsSource } from "../../src/background/enrichment/sources/wikimedia-commons";
import { wiktApiSource } from "../../src/background/enrichment/sources/wiktapi";
import { wiktionaryApiSource } from "../../src/background/enrichment/sources/wiktionary-api";
import { wiktionaryHtmlSource } from "../../src/background/enrichment/sources/wiktionary-html";
import { wiktionarySource } from "../../src/background/enrichment/sources/wiktionary";
import { wordHippoSource } from "../../src/background/enrichment/sources/wordhippo";
import { wordnetSource } from "../../src/background/enrichment/sources/wordnet";
import { wordReferenceSource } from "../../src/background/enrichment/sources/wordreference";
import { yomitanPacksSource } from "../../src/background/enrichment/sources/yomitan-packs";
import { youglishSource } from "../../src/background/enrichment/sources/youglish";

const ALL_SOURCES: EnrichmentSource[] = [
  bablaSource, bingImagesSource, britannicaDictionarySource, bundledSource,
  cambridgeSource, datamuseSource, dictCcSource, dictionaryComSource,
  duckduckgoImagesSource, etymonlineSource, forvoSource, freeDictionarySource,
  googleTtsSource, linguaLibreSource, lingueeSource, longmanSource,
  merriamWebsterSource, mobyThesaurusSource, merriamWebsterThesaurusSource,
  openverseSource, oxfordLearnersSource, ozdicSource, pixabaySource,
  ponsSource, promtContextSource, reversoSource, spanishDictSource,
  tatoebaSource, theIdiomsSource, thesaurusComSource, unsplashSource,
  wikimediaCommonsSource, wiktApiSource, wiktionaryApiSource,
  wiktionaryHtmlSource, wiktionarySource, wordHippoSource, wordnetSource,
  wordReferenceSource, yomitanPacksSource, youglishSource,
];
/**
 * The tier/gate contract, from the merge's and the fan-out's points of view.
 *
 * mergeFields must be tier-aware WITHOUT importing the orchestrator (no
 * cycles, no TDZ at service-worker boot), so source-tiers.ts holds the map
 * on its own. That makes the map and the source registry able to drift, in
 * two independent ways 74a5a10 broke in turn:
 *
 *  1. a source with no tier entry silently loses every first-write field
 *     (fallback 'standard') — the quiet failure;
 *  2. deriving the ACTIVATION set from the tier sent Forvo/Unsplash/Pixabay/
 *     Promt running with the VIP master off — the loud one.
 *
 * Both tripwires live here, against the real registry (imported, not glob'd).
 */
describe('source tiers and gates', () => {
  it('classifies every registered source', () => {
    // 41 sources today. A NEW source that ships without an entry in
    // SOURCE_TIERS fails HERE — not through a default that quietly changes
    // the card. (Falsified: dropping `forvo`'s entry fails this case.)
    expect(ALL_SOURCES.length).toBeGreaterThanOrEqual(41);
    for (const source of ALL_SOURCES) {
      expect(SOURCE_TIERS).toHaveProperty(source.id);
      expect(['vip', 'editorial', 'standard']).toContain(SOURCE_TIERS[source.id]!.tier);
      expect(['standard', 'vip']).toContain(SOURCE_TIERS[source.id]!.gate);
    }
  });

  it("keeps the VIP-OFF fan-out identical to the pre-74a5a10 literal", () => {
    // THE regression tripwire: the set that runs with the master switch OFF.
    // 74a5a10 derived it from the tier map and added forvo + unsplash +
    // pixabay + promtContext to the always-on list. The gate axis below
    // reproduces the STANDARD_SOURCE_KEYS literal that shipped before it,
    // and this pins that set against the registry. (Falsified: seeding one
    // axis from the other fails this case.)
    const gateStandard = ALL_SOURCES
      .filter((s) => sourceGate(s.id) === 'standard')
      .map((s) => s.id)
      .sort();
    expect(gateStandard).toEqual(EXPECTED_VIP_OFF_SOURCES);
  });

  it('ranks editorial above standard in the MERGE, independent of the GATE', () => {
    // The two axes answer different questions; they must not track each
    // other. forvo/unsplash/pixabay/promt rank low in the merge but run
    // behind the master switch: priority and access, both recorded.
    expect(sourceTier('oxfordLearners')).toBe('editorial');
    expect(sourceTier('bundled')).toBe('standard');
    expect(sourceGate('forvo')).toBe('vip');
    expect(sourceTier('forvo')).toBe('standard');
    expect(sourceTierRank('oxfordLearners')).toBeLessThan(sourceTierRank('bundled'));
  });

  it('sends unknown ids to the SAFE defaults on BOTH axes', () => {
    // Loses the merge race (standard) AND stays behind the master switch
    // (vip): a source added without an entry must neither overwrite the
    // edited dictionaries nor run for free.
    expect(sourceTier('someNewSource')).toBe('standard');
    expect(sourceGate('someNewSource')).toBe('vip');
  });
});

/** Snapshot of the always-on set — the review's requested pin. */
const EXPECTED_VIP_OFF_SOURCES = [
  'bingImages',
  'bundled',
  'datamuse',
  'duckduckgoImages',
  'etymonline',
  'freeDictionary',
  'googleTtsFallback',
  'linguaLibre',
  'mobyThesaurus',
  'openverse',
  'tatoeba',
  'theIdioms',
  'thesaurusCom',
  'wikimediaCommons',
  'wiktApi',
  'wiktionary',
  'wiktionaryApi',
  'wiktionaryHtml',
  'wordHippo',
  'wordnet',
  'yomitanPacks',
  'youglish',
];