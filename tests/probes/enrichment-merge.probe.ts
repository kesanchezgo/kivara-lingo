/**
 * Live, opt-in quality probe. Run explicitly with:
 *
 *   pnpm exec vitest run tests/probes/enrichment-merge.probe.ts --maxWorkers=1
 *
 * It is deliberately named `.probe.ts` so the normal unit suite does not
 * depend on third-party dictionary sites. The generated report records the
 * fields after the orchestrator has merged all online provider payloads.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { DEFAULT_VIP } from '../../src/shared/store';

const localTranslations: Record<string, string> = {
  give: 'dar',
  wonderful: 'maravilloso',
  anything: 'algo',
  anybody: 'alguien',
  week: 'semana',
  know: 'saber',
  run: 'correr',
  'break up': 'separarse',
  'piece of cake': 'pan comido',
};

// The live probe needs the production orchestrator but not a browser's
// Vite JSON transform or installed IndexedDB packs. Seed only the offline
// primary translation, which is the same first-wave guarantee users get
// before the network sources merge in.
vi.mock('../../src/background/enrichment/sources/bundled', () => ({
  bundledSource: {
    id: 'bundled', label: 'Bundled',
    enrich: async (token: string) => localTranslations[token] ? { translations: [localTranslations[token]] } : {},
  },
}));
vi.mock('../../src/background/enrichment/sources/yomitan-packs', () => ({
  yomitanPacksSource: { id: 'yomitanPacks', label: 'Yomitan', enrich: async () => ({}) },
}));
vi.mock('../../src/shared/db', () => ({ getDB: () => ({}) }));

const { clearMemEnrichmentCache, runEnrichment } = await import('../../src/background/enrichment/orchestrator');

const corpus = [
  ['give', "It's my father. He wants to give me a Mercedes convertible."],
  ['wonderful', 'Oh, yeah, last week, you had a wonderful nutty cake.'],
  ['anything', 'Does anybody want anything else?'],
  ['anybody', 'Does anybody want anything else?'],
  ['week', 'Oh, yeah, last week, you had a wonderful nutty cake.'],
  ['know', "or I don't know."],
  ['run', 'I run every morning before work.'],
  ['break up', 'They decided to break up after college.'],
  ['piece of cake', 'The exam was a piece of cake.'],
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
    image: Boolean(result.vip?.imageUrl),
    etymology: Boolean(result.vip?.etymology),
    video: Boolean(result.vip?.videoLinks?.length),
  };
}

function content(result: Awaited<ReturnType<typeof runEnrichment>>) {
  const entry = result.entry;
  return {
    translation: entry?.translation,
    bilingual: entry?.bilingual,
    monolingual: entry?.monolingual,
    phonetic: entry?.phonetic,
    examples: entry?.examples?.slice(0, 4),
    synonyms: entry?.synonyms?.slice(0, 12),
    antonyms: entry?.antonyms?.slice(0, 8),
    collocations: entry?.collocations?.slice(0, 12),
    audio: entry?.audio?.slice(0, 8),
    imageUrl: result.vip?.imageUrl,
    etymology: result.vip?.etymology,
    videoLinks: result.vip?.videoLinks?.slice(0, 4),
    attributedDefinitions: result.vip?.definitions?.slice(0, 6),
    attributedTranslations: result.vip?.translations?.slice(0, 8),
    attributedExamples: result.vip?.examples?.slice(0, 8),
  };
}

describe('live online merge probe', () => {
  for (const [token, sentence] of corpus) {
    for (const tier of ['standard', 'vip'] as const) {
      it(`${tier}: ${token}`, async () => {
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
          purpose: 'card',
          bypassCache: true,
        });
        rows.push({
          token,
          tier,
          ms: Date.now() - started,
          successfulSources: result.successfulSources,
          failedSources: result.failedSources,
          fields: fields(result),
          content: content(result),
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
    note: 'Bundled is seeded with only its primary translation; all other fields are merged from live online sources.',
    rows,
  };
  mkdirSync('docs/reports/final-quality', { recursive: true });
  const file = `docs/reports/final-quality/enrichment-merge-probe-${date}.json`;
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`WROTE ${file}`);
});
