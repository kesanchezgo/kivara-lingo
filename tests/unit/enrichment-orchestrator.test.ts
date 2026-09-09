import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VipSettings } from '../../src/shared/types';
import { DEFAULT_VIP } from '../../src/shared/store';

const enrichCambridge = vi.fn(async () => ({
  definitions: ['a learner definition'],
  audio: [{ url: 'https://audio.example/cambridge.mp3', accent: 'UK' }],
}));
const enrichFreeDictionary = vi.fn(async () => ({ translations: ['casa'] }));
const enrichBritannica = vi.fn(async () => ({ definitions: ['an editorial learner definition'] }));
const enrichTatoeba = vi.fn(async () => ({
  examples: [] as Array<{ text: string; translation?: string }>,
}));

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
vi.mock('../../src/background/enrichment/sources/tatoeba', () => ({
  tatoebaSource: { id: 'tatoeba', label: 'Tatoeba', enrich: enrichTatoeba },
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

// Deterministic double for the translator the backfill reuses. It echoes a
// predictable Spanish string so tests can assert the example gained a
// native-language line without touching the network or IndexedDB.
// The head-token gloss (apple → manzana) is resolved by translating the bare
// token into the target language. The repair path consults that gloss to
// decide whether a community (tatoeba) translation actually mentions the
// word's real meaning. This dictionary lets the mock return a real gloss for
// known head words while echoing `ES::<sentence>` for everything else.
const TOKEN_GLOSS: Record<string, string> = { apple: 'manzana' };
const translateTextMock = vi.fn(
  async (req: { text: string; sourceLang: string; targetLang: string }) => {
    const gloss = TOKEN_GLOSS[req.text.trim().toLowerCase()];
    return {
      ok: true as const,
      translatedText: gloss ?? `ES::${req.text}`,
      provider: 'mymemory' as const,
      cached: false,
    };
  },
);
vi.mock('../../src/background/translate', () => ({
  translateText: (req: { text: string; sourceLang: string; targetLang: string }) =>
    translateTextMock(req),
}));

const {
  clearMemEnrichmentCache,
  definitionContextReasons,
  pickCollocations,
  pickDefinitions,
  pickExamples,
  pickEtymology,
  pickImageCandidate,
  rankImageCandidates,
  pickLexicalTranslations,
  pickRelatedTerms,
  pickSenseRelationGroups,
  hasSubstantiveSenseOverlap,
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

  it('drops taxonomy, hypernym glosses and periphrases even from displayable sources', () => {
    // WordNet/Wiktionary are displayable, so their Latin binomials, hypernym
    // glosses and definitional paraphrases reach the card unless rejected by
    // shape. Verified 2026-09-06 MV3 corpus: apple/each/anybody/piece of cake.
    expect(pickRelatedTerms('apple', [
      { source: 'wordnet', text: 'malus pumila' },
      { source: 'wordnet', text: 'orchard apple tree' },
      { source: 'thesaurusCom', text: 'fruit' },
    ], 12)).toEqual(['fruit']);

    const each = pickRelatedTerms('each', [
      { source: 'wordnet', text: 'apiece' },
      { source: 'wordnet', text: 'to each one' },
      { source: 'wordnet', text: 'for each one' },
      { source: 'wordnet', text: 'each and every one' },
    ], 12);
    expect(each).toContain('apiece');
    expect(each).not.toContain('to each one');
    expect(each).not.toContain('each and every one');

    const anybody = pickRelatedTerms('anybody', [
      { source: 'wordnet', text: 'anyone' },
      { source: 'wordnet', text: 'any of' },
      { source: 'wordnet', text: 'a person' },
    ], 12);
    expect(anybody).toContain('anyone');
    expect(anybody).not.toContain('any of');
    expect(anybody).not.toContain('a person');

    // A genuine hyphenated one-word synonym survives.
    expect(pickRelatedTerms('lit', [
      { source: 'wordnet', text: 'light-colored' },
    ], 12)).toContain('light-colored');
  });

  it('drops a literal-component word as a synonym of a multiword idiom', () => {
    // "cake" leaking in as a synonym of "piece of cake" is the literal sense,
    // not an equivalent of the whole phrase. Verified 2026-09-06 MV3 corpus.
    const r = pickRelatedTerms('piece of cake', [
      { source: 'thesaurusCom', text: 'breeze' },
      { source: 'wiktionaryApi', text: 'cake' },
      { source: 'thesaurusCom', text: 'cinch' },
    ], 12);
    expect(r).toContain('breeze');
    expect(r).toContain('cinch');
    expect(r).not.toContain('cake');
  });

  it('drops explanatory phrases and clauses posing as synonyms', () => {
    // Live 2026-09-06 corpus: `forget` VIP leaked glosses as synonyms —
    // "my mind goes blank", "have no recollection of something",
    // "don’t remember/can’t remember", "take/keep your mind off something".
    // These are dictionary explanations, not lexical equivalents. A real
    // short phrasal synonym ("blank out") survives.
    const r = pickRelatedTerms('forget', [
      { source: 'cambridge', text: 'blank out' },
      { source: 'cambridge', text: 'slip your mind' },
      { source: 'cambridge', text: 'my mind goes blank' },
      { source: 'cambridge', text: 'have no recollection of something' },
      { source: 'cambridge', text: 'don’t remember/can’t remember' },
      { source: 'cambridge', text: 'take/keep your mind off something' },
      { source: 'cambridge', text: 'put something behind you' },
    ], 12);
    expect(r).toContain('blank out');
    expect(r).not.toContain('my mind goes blank');
    expect(r).not.toContain('have no recollection of something');
    expect(r).not.toContain('don’t remember/can’t remember');
    expect(r).not.toContain('take/keep your mind off something');
  });

  it('anchors Free Dictionary synonyms too, since it flattens all senses', () => {
    // Live 2026-09-06 corpus: `give` (transfer-possession sentence) leaked
    // "guess"/"predict"/"estimate"/"yield"/"cede" from Free Dictionary, which
    // merges the synonym lists of EVERY sense into one flat array. It is
    // therefore sense-blind for relations and must ride the context anchor
    // like the other flat thesauri. The transfer-sense synonyms survive.
    const context = new Set(['provide', 'transfer', 'hand', 'donate', 'possession']);
    const anchored = pickRelatedTerms('give', [
      { source: 'freeDictionary', text: 'provide' },
      { source: 'freeDictionary', text: 'donate' },
      { source: 'freeDictionary', text: 'guess' },
      { source: 'freeDictionary', text: 'estimate' },
      { source: 'freeDictionary', text: 'cede' },
    ], 12, context);
    expect(anchored).toContain('provide');
    expect(anchored).toContain('donate');
    expect(anchored).not.toContain('guess');
    expect(anchored).not.toContain('estimate');
    expect(anchored).not.toContain('cede');
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

  it('anchors flat synonyms to the active sense when context is supplied', () => {
    // `bank` (river edge) in a sentence about the river. The flat pool has no
    // relationGroups (pure Datamuse/WordHippo/Thesaurus.com), so the sense
    // gate in mergeFields never fires. Without a context anchor the finance
    // sense (`depository`, `savings bank`) bleeds through. Verified corpus.
    const contextTerms = new Set(['river', 'water', 'edge', 'slope', 'shore']);
    const anchored = pickRelatedTerms('bank', [
      { source: 'thesaurusCom', text: 'shore' },
      { source: 'wordHippo', text: 'shore' },
      { source: 'thesaurusCom', text: 'depository' },
      { source: 'wordHippo', text: 'depository' },
      { source: 'thesaurusCom', text: 'savings bank' },
      { source: 'wordHippo', text: 'savings bank' },
    ], 8, contextTerms);
    expect(anchored).toContain('shore');
    expect(anchored).not.toContain('depository');
    expect(anchored).not.toContain('savings bank');
  });

  it('leaves flat synonyms untouched when no context is supplied', () => {
    // Backwards compatibility: the merge path calls without context for
    // monosemous words. No anchor means no sense filtering — pure
    // corroboration/priority behaviour, unchanged.
    const unanchored = pickRelatedTerms('bank', [
      { source: 'thesaurusCom', text: 'shore' },
      { source: 'wordHippo', text: 'shore' },
      { source: 'thesaurusCom', text: 'depository' },
      { source: 'wordHippo', text: 'depository' },
    ], 8);
    expect(unanchored).toContain('shore');
    expect(unanchored).toContain('depository');
  });

  it('keeps a curated editorial synonym even without context overlap', () => {
    // A displayable/editorial source is trusted on its own; the context
    // anchor only gates the noisy corroboration-tier sources. A precise
    // Cambridge synonym must never be dropped just because it does not
    // literally repeat a sentence word.
    const contextTerms = new Set(['river', 'water', 'edge']);
    const anchored = pickRelatedTerms('bank', [
      { source: 'cambridge', text: 'embankment' },
      { source: 'datamuse', text: 'depository' },
    ], 8, contextTerms);
    expect(anchored).toContain('embankment');
    expect(anchored).not.toContain('depository');
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

  it('publishes a solo learner-dictionary chunk for a polysemous verb', () => {
    // `run`/`give` returned NO collocations on 2026-09-06 despite 5-7
    // collocation sources: their ozdic sense group did not clear the
    // contextual gate, and the editorial-flat fallback required two
    // independent sources for an identical chunk (rare across wording
    // differences). A single clean chunk from a learner-dictionary
    // authority (Longman/Oxford/Cambridge) is now trustworthy on its own.
    expect(pickCollocations('run', [
      { source: 'longman', text: 'run a company' },
    ])).toEqual(['run a company']);

    expect(pickCollocations('give', [
      { source: 'oxfordLearners', text: 'give a speech' },
    ])).toEqual(['give a speech']);
  });

  it('anchors flat editorial collocations to the active sense when context is supplied', () => {
    // `run` in a management sentence. Two editorial sources corroborate both
    // "run a company" (correct sense) and "run a marathon" (motion sense).
    // Without a context anchor both publish; the sentence disambiguates.
    const contextTerms = new Set(['company', 'business', 'manage', 'organize', 'charge']);
    const anchored = pickCollocations('run', [
      { source: 'longman', text: 'run a company' },
      { source: 'oxfordLearners', text: 'run a company' },
      { source: 'longman', text: 'run a marathon' },
      { source: 'oxfordLearners', text: 'run a marathon' },
    ], contextTerms);
    expect(anchored).toContain('run a company');
    expect(anchored).not.toContain('run a marathon');
  });

  it('leaves editorial collocations untouched when no context is supplied', () => {
    // Backwards compatibility: monosemous words merge without a context anchor.
    const unanchored = pickCollocations('run', [
      { source: 'longman', text: 'run a company' },
      { source: 'oxfordLearners', text: 'run a company' },
      { source: 'longman', text: 'run a marathon' },
      { source: 'oxfordLearners', text: 'run a marathon' },
    ]);
    expect(unanchored).toContain('run a company');
    expect(unanchored).toContain('run a marathon');
  });

  it('rejects a periphrastic gloss masquerading as a collocation', () => {
    // Live 2026-09-06 corpus: `week` VIP published "a day of the week" as a
    // collocation. It is a definitional paraphrase (article + of + the),
    // not a reusable learner chunk. A chunk framed as "<det> ... of the
    // <token>" is a gloss, not a collocation.
    expect(pickCollocations('week', [
      { source: 'longman', text: 'a day of the week' },
      { source: 'oxfordLearners', text: 'a day of the week' },
    ])).toEqual([]);
    // A genuine week chunk still survives.
    expect(pickCollocations('week', [
      { source: 'longman', text: 'working week' },
      { source: 'oxfordLearners', text: 'working week' },
    ])).toEqual(['working week']);
  });

  it('rejects a light-verb glossword posing as a synonym', () => {
    // Live 2026-09-06 corpus: `know` standard published syn ["have"], because
    // the WordNet gloss is "to HAVE knowledge; to HAVE information" and the
    // sense anchor is built from that gloss — so "have" trivially overlaps
    // its own definition word. A light/relational verb (have/get/make/do/be)
    // is a glossword, never a real synonym of a content word; it must be
    // rejected even when the context anchor "matches".
    const knowContext = new Set(['have', 'knowledge', 'information', 'informed']);
    expect(pickRelatedTerms('know', [
      { source: 'datamuse', text: 'have' },
      { source: 'wordHippo', text: 'have' },
    ], 8, knowContext)).not.toContain('have');

    // A genuine content synonym still survives — a curated editorial source
    // bypasses the anchor, and the light-verb reject only touches glosswords.
    expect(pickRelatedTerms('know', [
      { source: 'cambridge', text: 'understand' },
    ], 8, knowContext)).toContain('understand');
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

  it('kills dictionary debris: stray etc, domain labels, multi-hyphen numbers', () => {
    // Verified live 2026-09-09 on `week` vip: PONS/Longman rows leak
    // shorthand (`once times etc a week`), register labels
    // (`spirit week SCHOOL USA`) and number phrases
    // (`a thirty-seven-and-a-half hour week`) into the pool. None is a
    // reusable learner chunk; all three signatures are general, not
    // token-specific. Genuine week chunks still survive.
    expect(pickCollocations('week', [
      { source: 'longman', text: 'once times etc a week' },
      { source: 'longman', text: 'twice times etc a week' },
      { source: 'pons', text: 'spirit week SCHOOL USA' },
      { source: 'longman', text: 'a thirty-seven-and-a-half hour week' },
    ])).toEqual([]);
    expect(pickCollocations('week', [
      { source: 'longman', text: 'working week' },
      { source: 'oxfordLearners', text: 'working week' },
    ])).toEqual(['working week']);
    expect(pickCollocations('week', [
      { source: 'longman', text: 'eventful week' },
    ])).toEqual(['eventful week']);
  });

  it('kills a pure argument template but keeps a chunk with one content word', () => {
    // Template-pattern guard, verified live 2026-09-09: the old blunt
    // something/somebody rule killed PONS (to hand) "give someone
    // something to eat" even though its sense group had won the gate.
    // A bare argument pattern carries no content word beside the headword.
    expect(pickCollocations('give', [
      { source: 'pons', text: 'give something to somebody' },
    ])).toEqual([]);
    expect(pickCollocations('run', [
      { source: 'pons', text: 'run somebody something' },
    ])).toEqual([]);
    // One content word beside the headword makes it real — even with
    // pronoun slots in the chunk.
    expect(pickCollocations('give', [
      { source: 'pons', text: 'give somebody control' },
    ])).toEqual([]); // single corpus-tier source, still corroboration-only
    expect(pickCollocations('give', [
      { source: 'pons', text: 'give somebody control' },
      { source: 'longman', text: 'give somebody control' },
    ])).toContain('give somebody control');
    expect(pickCollocations('give', [
      { source: 'pons', text: 'give someone something to eat', senseBound: true },
    ])).toEqual(['give someone something to eat']);
  });

  it('lets a sense-bound chunk publish solo: the sense gate is its corroboration', () => {
    // A sense-bound chunk already won the merger's contextual gate via its
    // group's gloss — that win IS the corroboration, so no second source
    // is needed. Shape rules still apply: a template pattern never rides.
    // Verified live 2026-09-09: PONS (to hand) "give her something to eat".
    expect(pickCollocations('give', [
      { source: 'pons', text: 'give someone something to eat', senseBound: true },
    ])).toEqual(['give someone something to eat']);
    expect(pickCollocations('give', [
      { source: 'pons', text: 'give something to somebody', senseBound: true },
    ])).toEqual([]);
  });

  it('lets a dictionary-attested adverb chunk through while corpus bigrams stay out', () => {
    // `well run` lives in Longman's manage-sense COLLO block (run__3,
    // verified live 2026-09-06) — lexicographer-attested, not a corpus
    // accident. Datamuse -ly bigrams stay rejected even corroborated.
    expect(pickCollocations('run', [
      { source: 'longman', text: 'well run' },
    ])).toEqual(['well run']);
    expect(pickCollocations('give', [
      { source: 'datamuse', text: 'freely give' },
      { source: 'wiktionaryHtml', text: 'freely give' },
    ])).toEqual([]);
  });

  it('rates a sense-group win substantive only on content-word overlap', () => {
    // `give` group overlapping the anchor only via argument-structure
    // words (`someone`/`something` frame EVERY sense) proves nothing —
    // its chunks must still ride the flat anchor. Verified live
    // 2026-09-06: Longman give__4 won on {someone, something} alone.
    const anchor = new Set(['key', 'please', 'put', 'hand', 'someone', 'someth']);
    expect(hasSubstantiveSenseOverlap(
      { guide: 'to tell someone information or details about something' },
      anchor,
      'give',
    )).toBe(false);
    // A real content overlap (`business`/`organize`) earns the bypass:
    // `well run` never appears in prose but belongs to the manage sense.
    const manageAnchor = new Set(['business', 'home', 'organize', 'charge']);
    expect(hasSubstantiveSenseOverlap(
      { guide: 'to organize or be in charge of a business' },
      manageAnchor,
      'run',
    )).toBe(true);
    // Definition glue is generic too: `be`/`have`/`about` frame every
    // dictionary gloss, so a group winning only on them proves nothing.
    // Verified live 2026-09-09: the MW experience-sense of `know` beat the
    // answer-sense on `someth` alone for "I do not know the answer."
    expect(hasSubstantiveSenseOverlap(
      { guide: 'to have direct experience of something' },
      new Set(['answer', 'not', 'sure', 'about', 'someth', 'have']),
      'know',
    )).toBe(false);
    expect(hasSubstantiveSenseOverlap(
      {
        guide: 'to be certain',
        definition: 'to be sure about something',
        example: 'I am certain of the answer.',
      },
      new Set(['answer', 'not', 'sure', 'about', 'someth', 'certain']),
      'know',
    )).toBe(true);
    // No anchor (monosemous path) never earns it.
    expect(hasSubstantiveSenseOverlap(
      { guide: 'to organize or be in charge of a business' },
      undefined,
      'run',
    )).toBe(false);
  });

  it('selects the Longman manage-sense group when singular meets plural', () => {
    // Verified 2026-09-09 MV3 miss: the winning definition carries
    // "businesses" (plural) while Longman's manage guide carries "business"
    // (singular). The old stemmer cut them apart (busines vs business), the
    // manage group scored overlap 0, and `run`/manage published [].
    const selected = pickSenseRelationGroups('run', [
      {
        source: 'longman',
        guide: 'if a machine or engine runs, it operates',
        definition: 'if a machine or engine runs, it operates',
        collocations: ['run on electricity'],
      },
      {
        source: 'longman',
        guide: 'to organize or be in charge of an activity, business, organization, or country',
        definition: 'to organize or be in charge of an activity, business, organization, or country',
        collocations: ['well run', 'badly run'],
      },
    ], 'She runs the company from home.', [
      { source: 'wordnet', text: 'direct or control; projects, businesses, etc.' },
    ]);

    expect(selected).toHaveLength(1);
    expect(selected[0]?.collocations).toEqual(['well run', 'badly run']);
  });

  it('meets inflected verbs with their citation stem', () => {
    // 3rd-person -s on a silent-e stem (`organizes`) hid behind the
    // sibilant+es cut (`organiz`); an -ings plural (`somethings`) hid behind
    // the -ing cut. Both cuts are kept so either number meets.
    expect(hasSubstantiveSenseOverlap(
      { guide: 'she organizes events' },
      new Set(['organize']),
      'team',
    )).toBe(true);
    expect(hasSubstantiveSenseOverlap(
      { guide: 'she houses guests' },
      new Set(['house']),
      'team',
    )).toBe(true);
  });
  it('rejects infinitive-marked chunks and bare corpus adverbs', () => {
    // "to run aground" (dictionary phrasal listing) and "clean forget"
    // (bare corpus adverb pair) were the observed 2026-08-30 residues after
    // the -ly filter; legitimate chunks still pass.
    expect(pickCollocations('run', [
      { source: 'longman', text: 'to run aground' },
      { source: 'oxfordLearners', text: 'to run aground' },
    ])).toEqual([]);

    // A bare adverb + verb pair from CORPUS-tier sources stays out even
    // when corroborated — the noise replicates across corpus-based
    // providers ("clean forget", verified 2026-08-30 as corpus residue).
    expect(pickCollocations('forget', [
      { source: 'datamuse', text: 'clean forget' },
      { source: 'wiktionaryHtml', text: 'clean forget' },
    ])).toEqual([]);

    // ...but a dictionary-attested adverb chunk is not corpus noise: it
    // comes from a lexicographer's COLLO block, so the SOURCE decides, not
    // the shape. Live 2026-09-06: Longman's manage-sense block (run__3 "to
    // organize or be in charge of...") carries "well/badly run".
    expect(pickCollocations('run', [
      { source: 'longman', text: 'well run' },
    ])).toEqual(['well run']);

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

  it('ranks a confident paragraph above a hedging one regardless of source order', () => {
    // A hedging paragraph loses even when it comes from the top source:
    // "legend says…" is anecdote, not record. Verified 2026-09-09: The
    // Idioms ships origin anecdotes that read as history but are not.
    expect(pickEtymology([
      { source: 'etymonline', text: 'Legend says the phrase comes from a sailor, maybe in the 1800s.' },
      { source: 'merriamWebster', text: 'A concise editorial word history.' },
    ])).toBe('A concise editorial word history.');
    // Two hedges still prefer the better source — but a hedge-only pool
    // stays honest only when the sources behind it are authorities. This
    // is covered by the all-hedge test below; here the confident case
    // already proved the sort order.
    expect(pickEtymology([
      { source: 'wiktionaryHtml', text: 'From an earlier English form recorded in Wiktionary.' },
      { source: 'etymonline', text: 'Maybe from Old English, though this is uncertain.' },
    ])).toBe('From an earlier English form recorded in Wiktionary.');
  });

  it('publishes nothing when every etymology candidate hedges', () => {
    // No etymology beats a doubtful one: an empty field is the honest card.
    expect(pickEtymology([
      { source: 'etymonline', text: 'Perhaps from Old English, origin unknown.' },
      { source: 'merriamWebster', text: 'Tradition holds it comes from legend, it is said.' },
    ])).toBeUndefined();
    expect(pickEtymology([])).toBeUndefined();
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

  it('rejects images for low-imageability function words in general, not a fixed list', () => {
    // Indefinite pronouns / quantifiers / determiners are unimageable as a
    // CLASS — no hand-maintained blocklist. `everyone`/`whatever`/`some`
    // were never in the old LOW_IMAGEABILITY_TOKENS set but must still fail.
    for (const word of ['everyone', 'whatever', 'some', 'someone', 'none', 'nothing']) {
      expect(pickImageCandidate(word, [
        { source: 'openverse', url: `https://example.test/${word}.jpg`, title: `${word} concept`, width: 1200, height: 800 },
      ])).toBeUndefined();
    }
  });

  it('still images a concrete noun that merely contains a stopword substring', () => {
    // Generalization must not over-block: `week` was hardcoded, but a real
    // concrete depiction with strong lexical evidence should still win when
    // the token is genuinely imageable. `bee` (short, concrete) must pass.
    expect(pickImageCandidate('bee', [
      { source: 'openverse', url: 'https://example.test/bee.jpg', title: 'A honey bee on a flower', tags: ['bee', 'insect'], width: 1200, height: 800 },
    ])?.url).toBe('https://example.test/bee.jpg');
  });

  it('gates any idiom-flagged phrase on figurative evidence, not just one phrase', () => {
    // The figurative gate must be general. A DIFFERENT idiom than the
    // hardcoded "piece of cake": a literal depiction with no figurative
    // metadata is rejected; the same phrase WITH figurative evidence passes.
    expect(pickImageCandidate('spill the beans', [
      { source: 'openverse', url: 'https://example.test/beans.jpg', title: 'Spilled beans on a table', width: 1200, height: 800 },
    ], { isIdiom: true })).toBeUndefined();

    expect(pickImageCandidate('spill the beans', [
      { source: 'openverse', url: 'https://example.test/reveal.jpg', title: 'Spill the beans idiom meaning reveal a secret', width: 1200, height: 800 },
    ], { isIdiom: true })?.url).toBe('https://example.test/reveal.jpg');
  });

  it('always prefers a qualifying primary source over any fallback source', () => {
    // Hard hierarchy: a free-license, metadata-rich source (Wikimedia/
    // Openverse) wins the slot even when a fallback (Bing/DDG) hit scores
    // lower on raw lexical match. "Few trustworthy > many noisy."
    const winner = pickImageCandidate('apple', [
      { source: 'bingImages', url: 'https://example.test/bing-apple.jpg', title: 'apple apple apple fresh apple', width: 1200, height: 800 },
      { source: 'openverse', url: 'https://example.test/ov-apple.jpg', title: 'apple', width: 1200, height: 800 },
    ]);
    expect(winner?.source).toBe('openverse');
  });

  it('lets a fallback source publish ONLY when no primary source qualified', () => {
    // No primary candidate at all -> a Bing hit with a lexical anchor may
    // surface. This is the niche-term safety net.
    const winner = pickImageCandidate('umbrella', [
      { source: 'bingImages', url: 'https://example.test/umbrella.jpg', title: 'a red umbrella in the rain', width: 1200, height: 800 },
    ]);
    expect(winner?.source).toBe('bingImages');
  });

  it('rejects a fallback hit that has no lexical anchor to the token', () => {
    // A raw Bing/DDG search hit whose metadata and URL never mention the
    // token is almost always off-sense noise — dropped even as a last
    // resort. Empty beats wrong.
    expect(pickImageCandidate('umbrella', [
      { source: 'duckduckgoImages', url: 'https://example.test/random123.jpg', title: 'summer vibes stock photo', width: 1200, height: 800 },
    ])).toBeUndefined();
  });

  it('kills did-you-know / infographic / breaking-news subjects', () => {
    // The bad-subject filter now catches the audit's `know` -> "did you
    // know" family and `week` -> news family from either a primary or a
    // fallback source.
    expect(pickImageCandidate('fact', [
      { source: 'openverse', url: 'https://example.test/f.jpg', title: 'Did you know fact infographic', width: 1200, height: 800 },
    ])).toBeUndefined();
    expect(pickImageCandidate('storm', [
      { source: 'bingImages', url: 'https://example.test/s.jpg', title: 'Breaking news: storm headline', width: 1200, height: 800 },
    ])).toBeUndefined();
  });

  it('blocks indefinite compounds by morphology and function words by POS', () => {
    // Morphological pattern: never-listed indefinite compounds are caught
    // without touching the fixed list.
    for (const word of ['anywhere', 'everywhere', 'somehow']) {
      expect(pickImageCandidate(word, [
        { source: 'openverse', url: `https://example.test/${word}.jpg`, title: `${word} concept`, width: 1200, height: 800 },
      ])).toBeUndefined();
    }
    // POS signal: a token spelled like a normal word is still blocked when
    // its dominant sense is a closed grammatical class.
    expect(rankImageCandidates('mine', [
      { source: 'openverse', url: 'https://example.test/mine.jpg', title: 'mine', width: 1200, height: 800 },
    ], { pos: 'pronoun' }).winner).toBeUndefined();
    // ...but a genuinely depictable noun with the same spelling passes when
    // the POS says noun.
    expect(rankImageCandidates('mine', [
      { source: 'openverse', url: 'https://example.test/coalmine.jpg', title: 'a coal mine', tags: ['mine'], width: 1200, height: 800 },
    ], { pos: 'noun' }).winner?.url).toBe('https://example.test/coalmine.jpg');
  });

  it('rejects a false-friend caption in another language (corpus: lit -> French bed)', () => {
    // Openverse aggregates multilingual captions; the English token "lit"
    // (= on fire / great) must not publish a French bed just because the
    // caption string contains "lit".
    const ranking = rankImageCandidates('lit', [
      { source: 'openverse', url: 'https://example.test/bed.jpg', title: "Lit 'Aube et Crepuscule' d'Emile Galle (musee de l'Ecole de Nancy)", width: 1200, height: 800 },
    ]);
    expect(ranking.winner).toBeUndefined();
    expect(ranking.scored[0]?.reasons).toContain('penalty-non-english-metadata');
    // A genuine English caption with one stray foreign word still passes.
    expect(pickImageCandidate('cat', [
      { source: 'openverse', url: 'https://example.test/cat.jpg', title: 'A cat de Paris on the sofa', tags: ['cat'], width: 1200, height: 800 },
    ])?.url).toBe('https://example.test/cat.jpg');
  });

  it('blocks known relational verbs deterministically (corpus: support/give/forget)', () => {
    // Corpus 2026-09-06: support->"Twitter Support", give->"Give to
    // Humanity", forget->"We can't forget" matched by title text but
    // depicted logos / posters. WordNet did not tag their POS in the run,
    // so the deterministic low-imageability list is the safety net.
    for (const [word, title] of [['support', 'Twitter Support'], ['give', 'Give to Humanity'], ['forget', "We can't forget"]] as const) {
      expect(pickImageCandidate(word, [
        { source: 'openverse', url: `https://example.test/${word}.jpg`, title, width: 1200, height: 800 },
      ])).toBeUndefined();
    }
  });

  it('blocks caption-only matches for POS-tagged verbs, allows concept-anchored ones', () => {
    // The structural strict-depiction gate fires whenever a source DOES tag
    // the token as a verb, independently of the list. `dispatch` is not in
    // the low-imageability list, so only the POS signal gates it.
    expect(rankImageCandidates('dispatch', [
      { source: 'openverse', url: 'https://example.test/d.jpg', title: 'Dispatch to Humanity', width: 1200, height: 800 },
    ], { pos: 'verb' }).winner).toBeUndefined();
    // Wikimedia is concept-anchored (Wikidata P180): a verb hit from it is
    // trustworthy and still publishes.
    expect(rankImageCandidates('dispatch', [
      { source: 'wikimediaCommons', url: 'https://example.test/d.jpg', title: 'File:A courier dispatches a parcel.jpg', width: 1200, height: 800 },
    ], { pos: 'verb' }).winner?.source).toBe('wikimediaCommons');
    // An Openverse hit WITH explicit depiction tags also publishes — tags
    // are a real depiction signal, unlike a bare caption. `run` is
    // imageable and not in the list.
    expect(rankImageCandidates('run', [
      { source: 'openverse', url: 'https://example.test/run.jpg', title: 'runner', tags: ['run', 'running', 'race'], width: 1200, height: 800 },
    ], { pos: 'verb' }).winner?.url).toBe('https://example.test/run.jpg');
  });

  it('kills vector-art / graphics / premium-photo / wikihow subjects (corpus escapes)', () => {
    // "Support Group Vector Art" and "How to Give Flowers - wikiHow" slipped
    // past the old filter because of the space / domain form.
    for (const title of ['Rocket Vector Art, Icons, and Graphics', 'How to fold a Rocket - wikiHow', 'Premium Photo | A toy rocket']) {
      expect(pickImageCandidate('rocket', [
        { source: 'openverse', url: 'https://example.test/x.jpg', title, width: 1200, height: 800 },
      ])).toBeUndefined();
    }
  });

  it('exposes the full scored pool with reason codes for the probe', () => {
    // rankImageCandidates is the probe's evidence source: every candidate
    // carries its score and machine-readable reasons, and the empty case
    // names WHY nothing published.
    const ranking = rankImageCandidates('apple', [
      { source: 'openverse', url: 'https://example.test/ov.jpg', title: 'apple', width: 1200, height: 800 },
      { source: 'bingImages', url: 'https://example.test/bing-logo.jpg', title: 'apple logo brand' },
    ]);
    expect(ranking.winner?.source).toBe('openverse');
    expect(ranking.scored.length).toBe(2);
    const bing = ranking.scored.find((s) => s.candidate.source === 'bingImages');
    expect(bing?.reasons).toContain('penalty-bad-subject');
    expect(bing?.score).toBe(Number.POSITIVE_INFINITY);

    const empty = rankImageCandidates('know', []);
    expect(empty.winner).toBeUndefined();
    expect(empty.emptyReason).toBe('low-imageability-token');

    const noCand = rankImageCandidates('apple', []);
    expect(noCand.emptyReason).toBe('no-candidates');
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

describe('enrichment example translation backfill', () => {
  beforeEach(() => {
    clearMemEnrichmentCache();
    enrichCambridge.mockClear();
    enrichFreeDictionary.mockClear();
    enrichBritannica.mockClear();
    enrichTatoeba.mockClear();
    translateTextMock.mockClear();
  });

  it('backfills a native-language translation on a monolingual example', async () => {
    // Cambridge is a monolingual source: it returns an English-only example
    // with no `translation`. The orchestrator must fill it via translateText.
    enrichCambridge.mockResolvedValueOnce({
      definitions: ['a learner definition'],
      examples: [{ text: 'She ate a ripe apple.' }],
    } as unknown as Awaited<ReturnType<typeof enrichCambridge>>);

    const vip = { ...withAllSourcesDisabled(), enabled: true, cambridge: true, cambridgeAudio: false };
    const result = await runEnrichment('apple', {
      sourceLang: 'en', targetLang: 'es', sentence: 'She ate a ripe apple.', vip, bypassCache: true,
    });

    const filled = result.vip.examples?.find((e) => e.text === 'She ate a ripe apple.');
    expect(filled?.translation).toBe('ES::She ate a ripe apple.');
    expect(translateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'She ate a ripe apple.', sourceLang: 'en', targetLang: 'es' }),
    );
    // The card's rendered example line reflects the backfilled translation.
    expect(result.entry?.examples?.[0]).toBe('She ate a ripe apple. — ES::She ate a ripe apple.');
  });

  it('leaves an already-translated example untouched (no extra provider call)', async () => {
    enrichCambridge.mockResolvedValueOnce({
      definitions: ['a learner definition'],
      examples: [{ text: 'I love apples!', translation: '¡Me encantan las manzanas!' }],
    } as unknown as Awaited<ReturnType<typeof enrichCambridge>>);

    const vip = { ...withAllSourcesDisabled(), enabled: true, cambridge: true, cambridgeAudio: false };
    const result = await runEnrichment('apple', {
      sourceLang: 'en', targetLang: 'es', sentence: 'I love apples!', vip, bypassCache: true,
    });

    const kept = result.vip.examples?.find((e) => e.text === 'I love apples!');
    expect(kept?.translation).toBe('¡Me encantan las manzanas!');
    expect(translateTextMock).not.toHaveBeenCalled();
  });

  it('does not translate when source and target language match', async () => {
    enrichCambridge.mockResolvedValueOnce({
      definitions: ['a learner definition'],
      examples: [{ text: 'She ate a ripe apple.' }],
    } as unknown as Awaited<ReturnType<typeof enrichCambridge>>);

    const vip = { ...withAllSourcesDisabled(), enabled: true, cambridge: true, cambridgeAudio: false };
    await runEnrichment('apple', {
      sourceLang: 'en', targetLang: 'en', sentence: 'She ate a ripe apple.', vip, bypassCache: true,
    });

    expect(translateTextMock).not.toHaveBeenCalled();
  });

  it('repairs a suspect tatoeba translation whose native gloss is absent', async () => {
    // Tatoeba is community-sourced: a volunteer paired "I love apples!" with
    // "¡Me encantan las naranjas!" (naranjas = oranges, wrong). The head word
    // apple → manzana; "manzana" is nowhere in the Spanish, so it's suspect
    // and must be overridden by our own provider-chain translation.
    enrichTatoeba.mockResolvedValueOnce({
      examples: [{ text: 'I love apples!', translation: '¡Me encantan las naranjas!' }],
    } as unknown as Awaited<ReturnType<typeof enrichTatoeba>>);

    const vip = { ...withAllSourcesDisabled(), enabled: true, tatoeba: true };
    const result = await runEnrichment('apple', {
      sourceLang: 'en', targetLang: 'es', sentence: 'I love apples!', vip, bypassCache: true,
    });

    const repaired = result.vip.examples?.find((e) => e.text === 'I love apples!');
    expect(repaired?.translation).toBe('ES::I love apples!');
    // The head-token gloss was resolved by translating the bare token, and the
    // suspect sentence was then re-translated.
    expect(translateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'apple', sourceLang: 'en', targetLang: 'es' }),
    );
    expect(translateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'I love apples!', sourceLang: 'en', targetLang: 'es' }),
    );
  });

  it('keeps a correct tatoeba translation that contains the expected gloss', async () => {
    // Here the Spanish translation legitimately contains "manzanas" — the
    // gloss of apple — so it is trustworthy and must NOT be re-translated.
    enrichTatoeba.mockResolvedValueOnce({
      examples: [{ text: 'I love apples!', translation: '¡Me encantan las manzanas!' }],
    } as unknown as Awaited<ReturnType<typeof enrichTatoeba>>);

    const vip = { ...withAllSourcesDisabled(), enabled: true, tatoeba: true };
    const result = await runEnrichment('apple', {
      sourceLang: 'en', targetLang: 'es', sentence: 'I love apples!', vip, bypassCache: true,
    });

    const kept = result.vip.examples?.find((e) => e.text === 'I love apples!');
    expect(kept?.translation).toBe('¡Me encantan las manzanas!');
    // The gloss lookup for the head token may run, but the (correct) sentence
    // itself must never be re-translated.
    expect(translateTextMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ text: 'I love apples!' }),
    );
  });

  it('does not repair a suspect translation when the expected gloss is unknown', async () => {
    // Fail-safe: when the head-token gloss can't be resolved (here the provider
    // just echoes the untranslatable token back verbatim), we cannot judge, so
    // we keep whatever the source gave us rather than destroy it on a guess.
    translateTextMock.mockImplementationOnce(async (req) => ({
      ok: true as const,
      translatedText: req.text, // echo ⇒ treated as "no gloss"
      provider: 'mymemory' as const,
      cached: false,
    }));
    enrichTatoeba.mockResolvedValueOnce({
      examples: [{ text: 'I love zqplups!', translation: '¡Me encantan las naranjas!' }],
    } as unknown as Awaited<ReturnType<typeof enrichTatoeba>>);

    const vip = { ...withAllSourcesDisabled(), enabled: true, tatoeba: true };
    const result = await runEnrichment('zqplups', {
      sourceLang: 'en', targetLang: 'es', sentence: 'I love zqplups!', vip, bypassCache: true,
    });

    const kept = result.vip.examples?.find((e) => e.text === 'I love zqplups!');
    expect(kept?.translation).toBe('¡Me encantan las naranjas!');
    // The suspect sentence itself must not be re-translated.
    expect(translateTextMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ text: 'I love zqplups!' }),
    );
  });
});
