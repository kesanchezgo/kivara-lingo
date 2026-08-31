import type { EnrichmentSource, EnrichmentContext } from '../src/background/enrichment/types';
import { freeDictionarySource } from '../src/background/enrichment/sources/free-dictionary';
import { datamuseSource } from '../src/background/enrichment/sources/datamuse';
import { wiktionarySource } from '../src/background/enrichment/sources/wiktionary';
import { wiktionaryHtmlSource } from '../src/background/enrichment/sources/wiktionary-html';
import { wiktionaryApiSource } from '../src/background/enrichment/sources/wiktionary-api';
import { wiktApiSource } from '../src/background/enrichment/sources/wiktapi';
import { britannicaDictionarySource } from '../src/background/enrichment/sources/britannica-dictionary';
import { mobyThesaurusSource } from '../src/background/enrichment/sources/moby-thesaurus';
import { thesaurusComSource } from '../src/background/enrichment/sources/thesaurus-com';
import { wordHippoSource } from '../src/background/enrichment/sources/wordhippo';
import { theIdiomsSource } from '../src/background/enrichment/sources/the-idioms';
import { etymonlineSource } from '../src/background/enrichment/sources/etymonline';
import { tatoebaSource } from '../src/background/enrichment/sources/tatoeba';
import { linguaLibreSource } from '../src/background/enrichment/sources/lingua-libre';
import { googleTtsSource } from '../src/background/enrichment/sources/google-tts';
import { youglishSource } from '../src/background/enrichment/sources/youglish';
import { bingImagesSource } from '../src/background/enrichment/sources/bing-images';
import { openverseSource } from '../src/background/enrichment/sources/openverse';
import { wikimediaCommonsSource } from '../src/background/enrichment/sources/wikimedia-commons';
import { duckduckgoImagesSource } from '../src/background/enrichment/sources/duckduckgo-images';
import { cambridgeSource } from '../src/background/enrichment/sources/cambridge';
import { oxfordLearnersSource } from '../src/background/enrichment/sources/oxford-learners';
import { longmanSource } from '../src/background/enrichment/sources/longman';
import { dictionaryComSource } from '../src/background/enrichment/sources/dictionary-com';
import { merriamWebsterSource } from '../src/background/enrichment/sources/merriam-webster';
import { ozdicSource } from '../src/background/enrichment/sources/ozdic';
import { ponsSource } from '../src/background/enrichment/sources/pons';
import { bablaSource } from '../src/background/enrichment/sources/babla';
import { dictCcSource } from '../src/background/enrichment/sources/dictcc';
import { reversoSource } from '../src/background/enrichment/sources/reverso-context';
import { lingueeSource } from '../src/background/enrichment/sources/linguee';
import { promtContextSource } from '../src/background/enrichment/sources/promt-context';
import { wordReferenceSource } from '../src/background/enrichment/sources/wordreference';
import { spanishDictSource } from '../src/background/enrichment/sources/spanishdict';
import { forvoSource } from '../src/background/enrichment/sources/forvo';
import { unsplashSource } from '../src/background/enrichment/sources/unsplash';
import { pixabaySource } from '../src/background/enrichment/sources/pixabay';
import { mkdirSync, writeFileSync } from 'node:fs';

// Direct Node audits do not have extension APIs. Keep a dedicated in-memory
// store for this run so provider rate limits and cookie-dependent code follow
// their production branches without reading or clearing the user's real
// extension state.
const probeStorage: Record<string, unknown> = {};
const chromeProbe = {
  runtime: { getURL: (path: string) => `chrome-extension://quality-probe/${path}` },
  cookies: {
    getAll: async () => [],
    getAllCookieStores: async () => [{ id: '0', tabIds: [] }],
    set: async () => undefined,
  },
  declarativeNetRequest: { updateSessionRules: async () => undefined },
  storage: {
    local: {
      get: async (key: string) => ({ [key]: probeStorage[key] }),
      set: async (values: Record<string, unknown>) => { Object.assign(probeStorage, values); },
      remove: async (key: string) => { delete probeStorage[key]; },
    },
  },
};
if (!('chrome' in globalThis)) {
  (globalThis as typeof globalThis & { chrome: typeof chromeProbe }).chrome = chromeProbe;
}

const standard: EnrichmentSource[] = [
  freeDictionarySource, datamuseSource, wiktionarySource, wiktionaryHtmlSource, wiktionaryApiSource,
  wiktApiSource, britannicaDictionarySource,
  mobyThesaurusSource, thesaurusComSource, wordHippoSource, theIdiomsSource, etymonlineSource,
  tatoebaSource, linguaLibreSource, googleTtsSource, youglishSource, bingImagesSource, openverseSource,
  wikimediaCommonsSource, duckduckgoImagesSource,
];
const vip: EnrichmentSource[] = [
  cambridgeSource, oxfordLearnersSource, longmanSource, dictionaryComSource, merriamWebsterSource,
  ozdicSource, ponsSource, bablaSource, dictCcSource, reversoSource, lingueeSource,
  promtContextSource, wordReferenceSource, spanishDictSource, forvoSource, unsplashSource, pixabaySource,
];
const words = [
  { token: 'give', kind: 'verb-polysemy', sentence: "It's my father. He wants to give me a Mercedes convertible." },
  { token: 'wonderful', kind: 'adjective', sentence: 'Oh, yeah, last week, you had a wonderful nutty cake.' },
  { token: 'anything', kind: 'indefinite-pronoun', sentence: 'Does anybody want anything else?' },
  { token: 'anybody', kind: 'indefinite-pronoun-person', sentence: 'Does anybody want anything else?' },
  { token: 'week', kind: 'noun-time', sentence: 'Oh, yeah, last week, you had a wonderful nutty cake.' },
  { token: 'know', kind: 'verb-context', sentence: "or I don't know." },
  { token: 'break up', kind: 'phrasal-verb', sentence: 'They decided to break up after college.' },
  { token: 'piece of cake', kind: 'idiom', sentence: 'The exam was a piece of cake.' },
  { token: 'run', kind: 'verb-polysemy', sentence: 'I run every morning before work.' },
];

function shape(partial: Record<string, unknown> | undefined) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(partial ?? {})) {
    if (Array.isArray(v)) out[k] = { count: v.length, sample: v.slice(0, 8) };
    else if (typeof v === 'string') out[k] = v.length > 500 ? `${v.slice(0, 500)}…` : v;
    else out[k] = v;
  }
  return out;
}

function nonEmptyFields(partial: Record<string, unknown> | undefined): string[] {
  return Object.entries(partial ?? {})
    .filter(([, value]) => Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== '')
    .map(([field]) => field);
}

async function runOne(source: EnrichmentSource, token: string, sentence: string) {
  const ctx: EnrichmentContext = { sourceLang: 'en', targetLang: 'es', sentence, timeoutMs: 8000 };
  const started = Date.now();
  try {
    const partial = await source.enrich(token, ctx);
    const record = partial as Record<string, unknown>;
    return {
      ok: true,
      hasData: nonEmptyFields(record).length > 0,
      fields: nonEmptyFields(record),
      ms: Date.now() - started,
      partial,
      shape: shape(record),
    };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
}

const report: any = {
  generatedAt: new Date().toISOString(),
  words,
  tiers: { standard: [], vip: [] },
  exclusions: [
    'bundled (requires Vite JSON transforms)',
    'yomitanPacks (requires installed IndexedDB dictionaries)',
  ],
  results: [],
};
for (const source of standard) report.tiers.standard.push({ id: source.id, label: source.label });
for (const source of vip) report.tiers.vip.push({ id: source.id, label: source.label });
for (const item of words) {
  const sources = [...standard, ...vip];
  const settled = await Promise.all(
    sources.map(async (source) => ({
      source: source.id,
      tier: standard.includes(source) ? 'standard' : 'vip',
      ...(await runOne(source, item.token, item.sentence)),
    })),
  );
  report.results.push({ ...item, sources: settled });
  console.log(`AUDITED ${item.token}: ${settled.filter((r: any) => r.hasData).length}/${settled.length} sources with data`);
}

const fieldNames = [
  'definitions', 'translations', 'examples', 'synonyms', 'antonyms',
  'collocations', 'phonetic', 'audio', 'imageUrl', 'etymology',
  'videoLinks', 'frequencyRank',
];

report.coverage = Object.fromEntries(['standard', 'vip'].map((tier) => {
  const sourceIds = new Set((report.tiers[tier] as Array<{ id: string }>).map((source) => source.id));
  const attempts = report.results.flatMap((result: any) => result.sources.filter((source: any) => source.tier === tier));
  const bySource = Object.fromEntries([...sourceIds].map((id) => {
    const rows = attempts.filter((row: any) => row.source === id);
    const latencies = rows.map((row: any) => row.ms).sort((a: number, b: number) => a - b);
    const fieldCounts = Object.fromEntries(fieldNames.map((field) => [
      field,
      rows.filter((row: any) => row.fields?.includes(field)).length,
    ]));
    return [id, {
      responsesWithData: rows.filter((row: any) => row.hasData).length,
      attempts: rows.length,
      medianMs: latencies.length ? latencies[Math.floor(latencies.length / 2)] : null,
      fields: fieldCounts,
    }];
  }));
  const mergedFields = Object.fromEntries(fieldNames.map((field) => [
    field,
    report.results.filter((result: any) => result.sources.some((source: any) => source.tier === tier && source.fields?.includes(field))).length,
  ]));
  return [tier, { tokens: words.length, mergedFieldCoverage: mergedFields, bySource }];
}));
mkdirSync('docs/reports', { recursive: true });
const file = `docs/reports/enrichment-source-audit-${new Date().toISOString().slice(0, 10)}.json`;
writeFileSync(file, JSON.stringify(report, null, 2));
console.log(`WROTE ${file}`);
