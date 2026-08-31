/**
 * Live, opt-in hover audit across the word taxonomy.
 *
 *   pnpm exec vitest run tests/probes/enrichment-hover-coverage.probe.ts --maxWorkers=1
 *
 * The production popover intentionally omits image fetches; those belong to
 * saved-card enrichment. This probe therefore measures exactly the first
 * hover path: local/translation, lexical extras, audio and VIP metadata.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { DEFAULT_VIP } from '../../src/shared/store';

const localTranslations: Record<string, string> = {
  apple: 'manzana',
  freedom: 'libertad',
  run: 'correr',
  wonderful: 'maravilloso',
  quickly: 'rápidamente',
  anything: 'algo',
  each: 'cada',
  despite: 'a pesar de',
  nevertheless: 'sin embargo',
  "don't": 'no',
  'well-known': 'conocido',
  tensor: 'tensor',
  lit: 'genial',
  'look up': 'buscar',
  'kick the bucket': 'estirar la pata',
};

vi.mock('../../src/background/enrichment/sources/bundled', () => ({
  bundledSource: {
    id: 'bundled',
    label: 'Bundled',
    enrich: async (token: string) =>
      localTranslations[token] ? { translations: [localTranslations[token]] } : {},
  },
}));
vi.mock('../../src/background/enrichment/sources/yomitan-packs', () => ({
  yomitanPacksSource: { id: 'yomitanPacks', label: 'Yomitan', enrich: async () => ({}) },
}));
vi.mock('../../src/shared/db', () => ({ getDB: () => ({}) }));

const { clearMemEnrichmentCache, runEnrichment } =
  await import('../../src/background/enrichment/orchestrator');

const corpus = [
  ['noun-concrete', 'apple', 'apple', 'She ate a ripe apple.'],
  ['noun-abstract', 'freedom', 'freedom', 'They value freedom.'],
  ['verb-irregular', 'ran', 'run', 'She ran home.'],
  ['adjective', 'wonderful', 'wonderful', 'It was a wonderful day.'],
  ['adverb', 'quickly', 'quickly', 'Please answer quickly.'],
  ['pronoun-indefinite', 'anything', 'anything', 'Do you need anything?'],
  ['determiner', 'each', 'each', 'Each student has a book.'],
  ['preposition', 'despite', 'despite', 'Despite rain, we left.'],
  ['connector', 'nevertheless', 'nevertheless', 'Nevertheless, they continued.'],
  ['contraction', "don't", "don't", "I don't know."],
  ['hyphenated', 'well-known', 'well-known', 'She is a well-known author.'],
  ['technical', 'tensor', 'tensor', 'The model uses a tensor.'],
  ['slang-polysemy', 'lit', 'lit', 'The show was lit.'],
  ['phrasal-inflected', 'looking up', 'look up', 'She was looking up the word.'],
  ['idiom-inflected', 'kicked the bucket', 'kick the bucket', 'The old horse kicked the bucket.'],
  ['unknown-fallback', 'quizzaciously', 'quizzaciously', 'He smiled quizzaciously.'],
] as const;

const rows: Array<Record<string, unknown>> = [];

function fields(result: Awaited<ReturnType<typeof runEnrichment>>) {
  const entry = result.entry;
  return {
    bilingual: Boolean(entry?.bilingual || entry?.translation),
    monolingual: Boolean(entry?.monolingual),
    phonetic: Boolean(entry?.phonetic),
    examples: Boolean(entry?.examples?.length),
    synonyms: Boolean(entry?.synonyms?.length),
    antonyms: Boolean(entry?.antonyms?.length),
    collocations: Boolean(entry?.collocations?.length),
    audio: Boolean(entry?.audio?.length),
    etymology: Boolean(result.vip?.etymology),
    video: Boolean(result.vip?.videoLinks?.length),
  };
}

describe('live hover coverage by word type', () => {
  for (const [kind, surface, token, sentence] of corpus) {
    for (const tier of ['standard', 'vip'] as const) {
      it(tier + ': ' + kind, async () => {
        clearMemEnrichmentCache();
        const started = Date.now();
        const result = await runEnrichment(token, {
          sourceLang: 'en',
          targetLang: 'es',
          sentence,
          vip: {
            ...DEFAULT_VIP,
            enabled: tier === 'vip',
            perSourceTimeoutMs: 8000,
            cacheTtlDays: 0,
          },
          purpose: 'popover',
          bypassCache: true,
        });
        rows.push({
          kind,
          surface,
          requestedToken: token,
          tier,
          ms: Date.now() - started,
          successfulSources: result.successfulSources,
          failedSources: result.failedSources,
          fields: fields(result),
          bilingual: result.entry?.bilingual || result.entry?.translation,
        });
        expect(result.entry).toBeTruthy();
      });
    }
  }
});

afterAll(() => {
  const date = new Date().toISOString().slice(0, 10);
  const report = {
    generatedAt: new Date().toISOString(),
    note: 'The bundle is seeded only with a primary translation so this Node probe can load. The dedicated unit test validates the actual bundled assets. Results are the live remote hover merge; image sources are intentionally skipped in popover mode.',
    rows,
  };
  mkdirSync('docs/reports/final-quality', { recursive: true });
  const file = 'docs/reports/final-quality/enrichment-hover-coverage-probe-' + date + '.json';
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log('WROTE ' + file);
});
