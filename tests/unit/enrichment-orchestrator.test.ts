import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VipSettings } from '../../src/shared/types';
import { DEFAULT_VIP } from '../../src/shared/store';

const enrichCambridge = vi.fn(async () => ({
  definitions: ['a learner definition'],
  audio: [{ url: 'https://audio.example/cambridge.mp3', accent: 'UK' }],
}));
const enrichFreeDictionary = vi.fn(async () => ({ translations: ['casa'] }));
const enrichBritannica = vi.fn(async () => ({ definitions: ['an editorial learner definition'] }));

// The production implementations import large bundled JSON assets and
// IndexedDB-backed packs. The orchestrator contract is what this suite is
// exercising, so compact deterministic doubles keep it fast and offline.
vi.mock('../../src/background/enrichment/sources/bundled', () => ({
  bundledSource: { id: 'bundled', label: 'Bundled', enrich: async () => ({}) },
}));
vi.mock('../../src/background/enrichment/sources/yomitan-packs', () => ({
  yomitanPacksSource: { id: 'yomitanPacks', label: 'Yomitan', enrich: async () => ({}) },
}));
vi.mock('../../src/background/enrichment/sources/cambridge', () => ({
  cambridgeSource: { id: 'cambridge', label: 'Cambridge', enrich: enrichCambridge },
}));
vi.mock('../../src/background/enrichment/sources/free-dictionary', () => ({
  freeDictionarySource: { id: 'freeDictionary', label: 'Free Dictionary', enrich: enrichFreeDictionary },
}));
vi.mock('../../src/background/enrichment/sources/britannica-dictionary', () => ({
  britannicaDictionarySource: { id: 'britannicaDictionary', label: 'Britannica', enrich: enrichBritannica },
}));
vi.mock('../../src/background/enrichment/sources/wordnet', () => ({
  wordnetSource: {
    id: 'wordnet',
    label: 'WordNet',
    enrich: vi.fn(async (_token: string, _ctx: unknown) => ({
      definitions: ['a bundled offline sense'],
      relationGroups: [{ definition: 'a bundled offline sense', synonyms: ['sense-group-synonym'] }],
    })),
  },
}));
vi.mock('../../src/shared/db', () => ({ getDB: () => ({}) }));

const {
  clearMemEnrichmentCache,
  definitionContextReasons,
  pickCollocations,
  pickDefinitions,
  pickExamples,
  pickEtymology,
  pickImageCandidate,
  pickLexicalTranslations,
  pickRelatedTerms,
  pickSenseRelationGroups,
  runEnrichment,
} = await import('../../src/background/enrichment/orchestrator');

function withAllSourcesDisabled(): VipSettings {
  return Object.fromEntries(
    Object.entries(DEFAULT_VIP).map(([key, value]) => [key, typeof value === 'boolean' ? false : value]),
  ) as VipSettings;
}

describe('enrichment quality ranking', () => {
  it.each([
    {
      token: 'apple',
      sentence: 'She ate a ripe apple.',
      local: 'manzana',
      noisy: ['manzano', 'manzanar', 'Nueva York', 'manzana asada', 'pelar una manzana'],
    },
    {
      token: 'run',
      sentence: 'She ran home.',
      local: 'correr',
      noisy: ['gotear', 'encallar', 'derretirse', 'ir (en coche)', 'competir con'],
    },
    {
      token: 'each',
      sentence: 'Each student has a book.',
      local: 'cada',
      noisy: ['apuesta a colocado', 'su mutuo respeto/desprecio', 'por cabeza', 'cada día'],
    },
    {
      token: 'lit',
      sentence: 'The show was lit.',
      local: 'genial',
      noisy: ['luminoso', 'chick lit', 'bien iluminado', 'literatura', 'pasado'],
    },
  ])('keeps the bundled $token gloss ahead of one-source noise', ({ token, sentence, local, noisy }) => {
    const translations = [
      ...noisy.map((text) => ({ source: 'pons', text })),
      { source: 'bundled', text: local },
    ];

    const ranked = pickLexicalTranslations(token, translations, { sentence });

    expect(ranked[0]).toBe(local);
    expect(ranked).not.toContain(noisy[0]);
  });

  it('keeps an identical cross-language technical cognate from the bundle', () => {
    expect(pickLexicalTranslations('tensor', [
      { source: 'pons', text: 'screw shackle' },
      { source: 'wordReference', text: 'músculo tensor' },
      { source: 'bundled', text: 'tensor' },
    ], { sentence: 'The model uses a tensor.' })).toEqual(['tensor']);
  });

  it('ranks the manage gloss ahead of the bundle motion sense for a business sentence', () => {
    // Real candidates observed in the 2026-08-30 MV3 audit: dictCc publishes
    // `dirigir`, wordReference `manejar`, while the bundle only carries the
    // motion sense `correr`. The company/business sentence must surface the
    // management gloss, not the sense-default one.
    const ranked = pickLexicalTranslations('run', [
      { source: 'bundled', text: 'correr' },
      { source: 'cambridge', text: 'correr' },
      { source: 'dictCc', text: 'dirigir' },
      { source: 'wordReference', text: 'manejar' },
      { source: 'pons', text: 'ir (en coche)' },
    ], { sentence: 'She runs the company from home.' });

    expect(ranked[0]).toBe('dirigir');
    // `correr` may remain as an alternate gloss (it IS a real sense of
    // "run" and the bilingual fold shows alternates), but never first.
    expect(ranked.indexOf('correr')).toBeGreaterThan(0);
  });

  it('uses Spanish polarity and quantifier context even when providers omit the exact gloss', () => {
    expect(pickLexicalTranslations('anything', [
      { source: 'bundled', text: 'cualquier cosa' },
      { source: 'reverso', text: 'algo' },
    ], { sentence: "I don't need anything.", targetLang: 'es' })[0]).toBe('nada');

    expect(pickLexicalTranslations('anything', [
      { source: 'bundled', text: 'algo' },
    ], { sentence: 'You can choose anything you like.', targetLang: 'es' })[0]).toBe('cualquier cosa');

    expect(pickLexicalTranslations('anybody', [
      { source: 'wordReference', text: 'cualquier persona' },
    ], { sentence: 'I did not see anybody.', targetLang: 'es' })[0]).toBe('nadie');

    expect(pickLexicalTranslations('anybody', [
      { source: 'wordReference', text: 'alguien' },
    ], { sentence: 'Anybody can apply.', targetLang: 'es' })[0]).toBe('cualquiera');
  });

  it('selects modern contextual definitions over secondary senses', () => {
    expect(pickDefinitions([
      { source: 'cambridge', text: '→ anyone' },
      { source: 'merriamWebster', text: 'any person : anyone' },
      { source: 'wiktionaryApi', text: 'A person of some consideration or standing.' },
    ], 'anybody', 'Anybody can apply.')[0].text).toBe('any person : anyone');

    expect(pickDefinitions([
      { source: 'dictionaryCom', text: 'a simple past tense and past participle of light' },
      { source: 'merriamWebster', text: 'excellent, exciting' },
    ], 'lit', 'The show was lit.')[0].text).toBe('excellent, exciting');
  });

  it('selects a definition matching the sentence sense', () => {
    const ranked = pickDefinitions([
      { source: 'longman', text: 'to break into a lot of small pieces' },
      { source: 'cambridge', text: 'when a romantic relationship ends' },
    ], 'break up', 'They decided to break up after college because their relationship was over.');

    expect(ranked[0].text).toContain('relationship');
  });

  it('keeps precise dictionary synonyms ahead of broad Moby associations', () => {
    const ranked = pickRelatedTerms('know', [
      { source: 'mobyThesaurus', text: 'coitize' },
      { source: 'mobyThesaurus', text: 'go to bed with' },
      { source: 'thesaurusCom', text: 'understand' },
      { source: 'freeDictionary', text: 'recognize' },
    ], 2);

    expect(ranked).toEqual(['understand', 'recognize']);
  });

  it('keeps corroboration-only relations hidden unless independent sources agree', () => {
    expect(pickRelatedTerms('support', [
      { source: 'datamuse', text: 'backing' },
      { source: 'mobyThesaurus', text: 'maintenance' },
    ], 5)).toEqual([]);

    expect(pickRelatedTerms('support', [
      { source: 'datamuse', text: 'backing' },
      { source: 'wordHippo', text: 'backing' },
    ], 5)).toEqual(['backing']);

    expect(pickRelatedTerms('support', [
      { source: 'datamuse', text: 'backing' },
      { source: 'mobyThesaurus', text: 'backing' },
    ], 5)).toEqual([]);
  });

  it('selects one editorial relation group using definition and sentence context', () => {
    const selected = pickSenseRelationGroups('run', [
      {
        source: 'cambridge',
        example: 'She runs to catch the bus.',
        synonyms: ['sprint', 'jog'],
      },
      {
        source: 'cambridge',
        example: 'She runs a successful business.',
        synonyms: ['manage', 'operate'],
      },
    ], 'She runs the company from home.', [
      { source: 'longman', text: 'to organize or be in charge of a business' },
    ]);

    expect(selected).toHaveLength(1);
    expect(selected[0]?.synonyms).toEqual(['manage', 'operate']);

    expect(pickSenseRelationGroups('run', [{
      source: 'longman',
      definition: 'to move quickly using your legs',
      synonyms: ['jog', 'sprint'],
    }], 'She runs the company from home.', [
      { source: 'longman', text: 'to organize or be in charge of a business' },
    ])).toEqual([]);
  });

  it('requires editorial or corroborated evidence for collocations', () => {
    expect(pickCollocations('support', [
      { source: 'datamuse', text: 'public support' },
    ])).toEqual([]);

    expect(pickCollocations('support', [
      { source: 'longman', text: 'strong support' },
      { source: 'datamuse', text: 'public support' },
      { source: 'pons', text: 'public support' },
    ])).toEqual(['public support', 'strong support']);
  });

  it('rejects corpus adverb bigrams as headword collocations', () => {
    // "freely give", "clearly give", "directly give", "currently give"
    // were the observed 2026-08-30 corpus noise for `give` — frequency
    // artifacts from Datamuse bigrams, not learner collocations.
    expect(pickCollocations('give', [
      { source: 'datamuse', text: 'freely give' },
      { source: 'datamuse', text: 'clearly give' },
      { source: 'datamuse', text: 'directly give' },
      { source: 'datamuse', text: 'currently give' },
    ])).toEqual([]);

    // Even corroborated by two sources, an adverb bigram stays out —
    // the noise replicates across corpus-based providers.
    expect(pickCollocations('give', [
      { source: 'datamuse', text: 'freely give' },
      { source: 'wiktionaryHtml', text: 'freely give' },
    ])).toEqual([]);
  });

  it('publishes ozdic collocations only with corroboration, like every non-displayable source', () => {
    // ozdic is sense-aware but corpus-derived: a single-source ozdic chunk
    // does not publish on its own (same contract as Datamuse/PONS).
    expect(pickCollocations('give', [
      { source: 'ozdic', text: 'give advice' },
    ])).toEqual([]);

    // Corroborated by an editorial source, the chunk publishes.
    expect(pickCollocations('give', [
      { source: 'ozdic', text: 'give advice' },
      { source: 'longman', text: 'give advice' },
    ])).toEqual(['give advice']);
  });

  it('rejects infinitive-marked chunks and bare corpus adverbs', () => {
    // "to run aground" (dictionary phrasal listing) and "clean forget"
    // (bare corpus adverb pair) were the observed 2026-08-30 residues after
    // the -ly filter; legitimate chunks still pass.
    expect(pickCollocations('run', [
      { source: 'longman', text: 'to run aground' },
      { source: 'oxfordLearners', text: 'to run aground' },
    ])).toEqual([]);

    expect(pickCollocations('forget', [
      { source: 'longman', text: 'clean forget' },
      { source: 'oxfordLearners', text: 'clean forget' },
    ])).toEqual([]);

    // The sense-correct chunk and plain learner pairs survive.
    expect(pickCollocations('run', [
      { source: 'longman', text: 'run a company' },
      { source: 'oxfordLearners', text: 'run a company' },
    ])).toEqual(['run a company']);
  });

  it('never exposes The Idioms as a standalone definition authority', () => {
    expect(pickDefinitions([
      { source: 'theIdioms', text: 'an unsupported explanation of this idiom' },
    ], 'piece of cake', 'The exam was a piece of cake.')).toEqual([]);
  });

  it('uses explicit etymology authority instead of provider completion order', () => {
    expect(pickEtymology([
      { source: 'wiktionaryHtml', text: 'From an earlier English form recorded in Wiktionary.' },
      { source: 'theIdioms', text: 'A popular but unsupported origin story.' },
      { source: 'etymonline', text: 'From Old English through a documented historical form.' },
      { source: 'merriamWebster', text: 'A concise editorial word history.' },
    ])).toBe('From Old English through a documented historical form.');
  });

  it('can leave unsafe images empty and prefers curated open candidates', () => {
    expect(pickImageCandidate('anything', [
      { source: 'bingImages', url: 'https://example.test/anything-logo.jpg', title: 'Anything logo' },
    ])).toBeUndefined();

    expect(pickImageCandidate('piece of cake', [
      { source: 'openverse', url: 'https://example.test/cake.jpg', title: 'A piece of cake on a plate' },
    ])).toBeUndefined();

    expect(pickImageCandidate('apple', [
      { source: 'bingImages', url: 'https://example.test/apple-news.jpg', title: 'Apple news headline' },
      { source: 'openverse', url: 'https://example.test/fruit.jpg', title: 'Red apple fruit', width: 1200, height: 800 },
    ])?.url).toBe('https://example.test/fruit.jpg');
  });

  it('keeps idiomatic examples ahead of literal phrase matches', () => {
    const ranked = pickExamples('piece of cake', [
      { source: 'dictionaryCom', text: 'Tom cut his sister a piece of cake.', translation: 'Tom le cortó un pedazo de torta.' },
      { source: 'reverso', text: 'The exam was a piece of cake.', translation: 'El examen fue pan comido.' },
    ], 'The exam was a piece of cake.', 2);

    expect(ranked[0].source).toBe('reverso');
  });

  it('prioritizes aligned token examples and diversifies their sources', () => {
    const ranked = pickExamples('forget', [
      { source: 'dictionaryCom', text: 'A sentence about memory without the headword.' },
      { source: 'promtContext', text: "I won't forget that.", translation: 'No olvidaré eso.' },
      { source: 'promtContext', text: 'Forget about that right now.', translation: 'Olvídate de eso de momento.' },
      { source: 'promtContext', text: "Don't forget about us!", translation: '¡No te olvides de nosotros!' },
      { source: 'tatoeba', text: 'Never forget your friends.', translation: 'Nunca olvides a tus amigos.' },
      { source: 'reverso', text: 'She forgot the address.', translation: 'Olvidó la dirección.' },
    ], 'Please do not forget the address.', 4);

    expect(ranked.map((example) => example.source)).toContain('tatoeba');
    expect(ranked.filter((example) => example.source === 'promtContext')).toHaveLength(2);
    expect(ranked[0].text.toLowerCase()).toContain('forget');
    expect(ranked.every((example) => example.translation)).toBe(true);
  });
});

describe('enrichment field provenance', () => {
  beforeEach(() => {
    clearMemEnrichmentCache();
    enrichCambridge.mockClear();
    enrichFreeDictionary.mockClear();
    enrichBritannica.mockClear();
  });

  it('explains every published field with winner, source and reason codes', async () => {
    // The manage sense of "run" in a business sentence is the documented
    // WSD case: the provenance record must carry the domain reason codes
    // that made it win, plus the runner-ups it beat. The mocked wordnet
    // returns a generic gloss, so the definition that wins is the one
    // mock sources provide — assert on the contract, not on a specific
    // gloss: every published field gets a record, reasons follow the
    // ok-*/penalty-* convention, and runner-ups are attributed.
    const vip = {
      ...withAllSourcesDisabled(),
      freeDictionary: true,
      wordnet: true,
      enabled: false,
    };
    const result = await runEnrichment('run', {
      sourceLang: 'en',
      targetLang: 'es',
      sentence: 'She runs the company from home.',
      vip,
      bypassCache: true,
    });

    const provenance = result.vip.provenance ?? [];
    expect(provenance.length).toBeGreaterThan(0);

    const fields = new Set(provenance.map((record) => record.field));
    // Every contextually-ranked field that published a value must have a
    // provenance record.
    expect(fields.has('definition')).toBe(true);

    for (const record of provenance) {
      expect(record.field).toBeTruthy();
      expect(typeof record.winner).toBe('string');
      expect(record.winner.length).toBeGreaterThan(0);
      // Reason codes follow the ok-*/penalty-* convention.
      for (const reason of record.reasons ?? []) {
        expect(/^(?:ok|penalty)-/.test(reason)).toBe(true);
      }
    }

    const definition = provenance.find((record) => record.field === 'definition');
    expect(definition?.source).toBe('wordnet');
    expect(typeof definition?.candidates).toBe('number');
  });

  it('emits the domain reason codes for the documented manage-sense case', () => {
    // Direct contract test against the real ranking (no mocks): the manage
    // gloss must carry both the semantic-signal bonus and the domain-gloss
    // bonus, and the literal motion gloss must carry the domain penalty.
    const manageReasons = definitionContextReasons(
      'direct or control; projects, businesses, etc.',
      'run',
      'She runs the company from home.',
    );
    expect(manageReasons).toContain('ok-manage-sense');
    expect(manageReasons).toContain('ok-domain-gloss');
    expect(manageReasons).not.toContain('penalty-motion-vs-domain');

    const motionReasons = definitionContextReasons(
      'to move very quickly by moving your legs',
      'run',
      'She runs the company from home.',
    );
    expect(motionReasons).toContain('penalty-motion-vs-domain');
    expect(motionReasons).not.toContain('ok-domain-gloss');

    const ranked = pickDefinitions([
      { source: 'wordnet', text: 'direct or control; projects, businesses, etc.' },
      { source: 'longman', text: 'to move very quickly by moving your legs' },
    ], 'run', 'She runs the company from home.');
    expect(ranked[0].text).toContain('direct or control');
  });

  it('keeps the provenance scale internal: scores are per-field only', async () => {
    // Scores from different fields use different scales (definitions can go
    // negative with contextual bonuses) — the contract only guarantees
    // comparability WITHIN a field. The mocked sources emit generic
    // glosses with no contextual signal, so a neutral score of 0 is the
    // expected value; the invariant is that the number is the raw ranking
    // output, not normalized.
    const vip = {
      ...withAllSourcesDisabled(),
      freeDictionary: true,
      wordnet: true,
      enabled: false,
    };
    const result = await runEnrichment('run', {
      sourceLang: 'en',
      targetLang: 'es',
      sentence: 'She runs the company from home.',
      vip,
      bypassCache: true,
    });

    const definition = result.vip.provenance?.find((record) => record.field === 'definition');
    // Raw mock gloss: no contextual bonus applies, so the score is the
    // exact neutral 0 the ranking produced.
    expect(definition?.score).toBe(0);
  });
});

describe('enrichment orchestrator tier and cache selection', () => {
  beforeEach(() => {
    clearMemEnrichmentCache();
    enrichCambridge.mockClear();
    enrichFreeDictionary.mockClear();
    enrichBritannica.mockClear();
  });

  it('runs Standard sources while the VIP master switch is off', async () => {
    const vip = { ...withAllSourcesDisabled(), freeDictionary: true, enabled: false };
    const result = await runEnrichment('house', {
      sourceLang: 'en', targetLang: 'es', vip, bypassCache: true,
    });

    expect(enrichFreeDictionary).toHaveBeenCalledOnce();
    expect(result.successfulSources).toEqual(['freeDictionary']);
    expect(result.entry?.translation).toBe('casa');
  });

  it('runs Britannica only as an editorial VIP source', async () => {
    const disabled = { ...withAllSourcesDisabled(), britannicaDictionary: true, enabled: false };
    const standard = await runEnrichment('house', {
      sourceLang: 'en', targetLang: 'es', vip: disabled, bypassCache: true,
    });
    const premium = await runEnrichment('house', {
      sourceLang: 'en', targetLang: 'es', vip: { ...disabled, enabled: true }, bypassCache: true,
    });

    expect(standard.successfulSources).toEqual([]);
    expect(enrichBritannica).toHaveBeenCalledOnce();
    expect(premium.entry?.monolingual).toBe('an editorial learner definition');
  });

  it('runs bundled WordNet in the Standard tier without the VIP master switch', async () => {
    // `wordnet` is Standard: the master switch stays off, every other
    // source stays off, and the offline OEWN shards still answer.
    const vip = { ...withAllSourcesDisabled(), wordnet: true, enabled: false };
    const result = await runEnrichment('run', {
      sourceLang: 'en',
      targetLang: 'es',
      sentence: 'She ran home.',
      vip,
      bypassCache: true,
    });

    expect(result.successfulSources).toEqual(['wordnet']);
    expect(result.vip.definitions?.length).toBeGreaterThan(0);
    // The relation groups are sense-bound, so the merger can publish
    // sense-matched synonyms instead of lemma-level noise.
    expect(result.entry.monolingual).toBeDefined();
  });

  it('honours Cambridge audio separately from Cambridge lexical data', async () => {
    const vip = {
      ...withAllSourcesDisabled(), enabled: true, cambridge: true, cambridgeAudio: false,
    };
    const noAudio = await runEnrichment('house', {
      sourceLang: 'en', targetLang: 'es', vip, bypassCache: true,
    });
    const withAudio = await runEnrichment('house', {
      sourceLang: 'en', targetLang: 'es', vip: { ...vip, cambridgeAudio: true }, bypassCache: true,
    });

    expect(noAudio.entry?.monolingual).toBe('a learner definition');
    expect(noAudio.entry?.audio).toBeUndefined();
    expect(withAudio.entry?.audio?.[0]?.url).toBe('https://audio.example/cambridge.mp3');
  });

  it('does not reuse a context-ranked cache entry for a different sentence', async () => {
    const vip = { ...withAllSourcesDisabled(), enabled: true, cambridge: true, cambridgeAudio: false };
    await runEnrichment('anything', {
      sourceLang: 'en', targetLang: 'es', sentence: 'You can choose anything.', vip,
    });
    await runEnrichment('anything', {
      sourceLang: 'en', targetLang: 'es', sentence: 'I do not want anything.', vip,
    });

    expect(enrichCambridge).toHaveBeenCalledTimes(2);
  });

  it('does not serve a cached result after an individual source is disabled', async () => {
    const enabled = { ...withAllSourcesDisabled(), enabled: true, cambridge: true, cambridgeAudio: false };
    const first = await runEnrichment('house', {
      sourceLang: 'en', targetLang: 'es', vip: enabled,
    });
    const afterDisable = await runEnrichment('house', {
      sourceLang: 'en', targetLang: 'es', vip: { ...enabled, cambridge: false },
    });

    expect(first.entry?.monolingual).toBe('a learner definition');
    expect(afterDisable.entry?.monolingual).toBeUndefined();
    expect(afterDisable.successfulSources).toEqual([]);
    expect(enrichCambridge).toHaveBeenCalledOnce();
  });
});
