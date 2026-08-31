/**
 * Live provider probe using the real enrichment source modules (no browser/UI automation).
 *
 * Run:
 *   pnpm exec tsx tests/probes/all-enrichment-providers.probe.ts
 *
 * This does not modify provider code, parsers, headers, credentials, or scraping logic.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import type { EnrichmentContext, EnrichmentSource, SourcePartial } from '../../src/background/enrichment/types';

import { freeDictionarySource } from '../../src/background/enrichment/sources/free-dictionary';
import { datamuseSource } from '../../src/background/enrichment/sources/datamuse';
import { wiktionarySource } from '../../src/background/enrichment/sources/wiktionary';
import { wiktionaryHtmlSource } from '../../src/background/enrichment/sources/wiktionary-html';
import { wiktionaryApiSource } from '../../src/background/enrichment/sources/wiktionary-api';
import { wiktApiSource } from '../../src/background/enrichment/sources/wiktapi';
import { britannicaDictionarySource } from '../../src/background/enrichment/sources/britannica-dictionary';
import { mobyThesaurusSource } from '../../src/background/enrichment/sources/moby-thesaurus';
import { thesaurusComSource } from '../../src/background/enrichment/sources/thesaurus-com';
import { wordHippoSource } from '../../src/background/enrichment/sources/wordhippo';
import { theIdiomsSource } from '../../src/background/enrichment/sources/the-idioms';
import { cambridgeSource } from '../../src/background/enrichment/sources/cambridge';
import { oxfordLearnersSource } from '../../src/background/enrichment/sources/oxford-learners';
import { longmanSource } from '../../src/background/enrichment/sources/longman';
import { dictionaryComSource } from '../../src/background/enrichment/sources/dictionary-com';
import { merriamWebsterSource } from '../../src/background/enrichment/sources/merriam-webster';
import { ozdicSource } from '../../src/background/enrichment/sources/ozdic';
import { ponsSource } from '../../src/background/enrichment/sources/pons';
import { bablaSource } from '../../src/background/enrichment/sources/babla';
import { dictCcSource } from '../../src/background/enrichment/sources/dictcc';
import { reversoSource } from '../../src/background/enrichment/sources/reverso-context';
import { lingueeSource } from '../../src/background/enrichment/sources/linguee';
import { promtContextSource } from '../../src/background/enrichment/sources/promt-context';
import { wordReferenceSource } from '../../src/background/enrichment/sources/wordreference';
import { spanishDictSource } from '../../src/background/enrichment/sources/spanishdict';
import { tatoebaSource } from '../../src/background/enrichment/sources/tatoeba';
import { forvoSource } from '../../src/background/enrichment/sources/forvo';
import { linguaLibreSource } from '../../src/background/enrichment/sources/lingua-libre';
import { googleTtsSource } from '../../src/background/enrichment/sources/google-tts';
import { unsplashSource } from '../../src/background/enrichment/sources/unsplash';
import { pixabaySource } from '../../src/background/enrichment/sources/pixabay';
import { bingImagesSource } from '../../src/background/enrichment/sources/bing-images';
import { openverseSource } from '../../src/background/enrichment/sources/openverse';
import { wikimediaCommonsSource } from '../../src/background/enrichment/sources/wikimedia-commons';
import { duckduckgoImagesSource } from '../../src/background/enrichment/sources/duckduckgo-images';
import { youglishSource } from '../../src/background/enrichment/sources/youglish';
import { etymonlineSource } from '../../src/background/enrichment/sources/etymonline';

const probeStorage: Record<string, unknown> = {};
const chromeProbe = {
  runtime: { getURL: (path: string) => `chrome-extension://provider-probe/${path}` },
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

const token = process.env.KIVARA_TOKEN || 'give';
const sourceLang = process.env.KIVARA_SOURCE_LANG || 'en';
const targetLang = process.env.KIVARA_TARGET_LANG || 'es';
const timeoutMs = Number(process.env.KIVARA_PROVIDER_TIMEOUT_MS || 8000);

const window = new Window();
Object.defineProperty(globalThis, 'DOMParser', { value: window.DOMParser, configurable: true });

const sources: EnrichmentSource[] = [
  freeDictionarySource, datamuseSource, wiktionarySource, wiktionaryHtmlSource,
  wiktionaryApiSource, wiktApiSource, britannicaDictionarySource, mobyThesaurusSource,
  thesaurusComSource, wordHippoSource, theIdiomsSource, cambridgeSource,
  oxfordLearnersSource, longmanSource, dictionaryComSource, merriamWebsterSource,
  ozdicSource, ponsSource, bablaSource, dictCcSource, reversoSource, lingueeSource,
  promtContextSource, wordReferenceSource, spanishDictSource, tatoebaSource, forvoSource,
  linguaLibreSource, googleTtsSource, unsplashSource, pixabaySource,
  bingImagesSource, openverseSource, wikimediaCommonsSource, duckduckgoImagesSource,
  youglishSource, etymonlineSource,
];

type HttpRow = {
  url: string;
  status?: number;
  statusText?: string;
  ok?: boolean;
  bytes?: number;
  error?: string;
  elapsedMs: number;
};

function extractedFields(partial: SourcePartial): Record<string, number | boolean> {
  return Object.fromEntries(Object.entries(partial)
    .filter(([, value]) => Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== '')
    .map(([key, value]) => [key, Array.isArray(value) ? value.length : true]));
}

const nativeFetch = globalThis.fetch.bind(globalThis);
let activeHttp: HttpRow[] | null = null;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const started = performance.now();
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  try {
    const response = await nativeFetch(input, init);
    let bytes: number | undefined;
    try { bytes = (await response.clone().arrayBuffer()).byteLength; } catch { /* response remains usable */ }
    activeHttp?.push({
      url,
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      bytes,
      elapsedMs: Math.round(performance.now() - started),
    });
    return response;
  } catch (error) {
    activeHttp?.push({
      url,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      elapsedMs: Math.round(performance.now() - started),
    });
    throw error;
  }
}) as typeof fetch;

const rows: Array<Record<string, unknown>> = [];
const ctx: EnrichmentContext & { unsplashAccessKey?: string; pixabayApiKey?: string } = {
  sourceLang,
  targetLang,
  sentence: '',
  timeoutMs,
  // Preserve real credential behavior: only use explicitly supplied probe keys.
  unsplashAccessKey: process.env.UNSPLASH_ACCESS_KEY || '',
  pixabayApiKey: process.env.PIXABAY_API_KEY || '',
};

for (const source of sources) {
  const http: HttpRow[] = [];
  activeHttp = http;
  const started = performance.now();
  try {
    const partial = await source.enrich(token, ctx);
    rows.push({
      provider: source.id,
      label: source.label,
      elapsedMs: Math.round(performance.now() - started),
      http,
      totalBytes: http.reduce((sum, item) => sum + (item.bytes || 0), 0),
      extracted: extractedFields(partial),
      hasData: Object.keys(extractedFields(partial)).length > 0,
    });
  } catch (error) {
    rows.push({
      provider: source.id,
      label: source.label,
      elapsedMs: Math.round(performance.now() - started),
      http,
      totalBytes: http.reduce((sum, item) => sum + (item.bytes || 0), 0),
      extracted: {},
      hasData: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  } finally {
    activeHttp = null;
  }
}

globalThis.fetch = nativeFetch;
await window.close();

const report = {
  generatedAt: new Date().toISOString(),
  mode: 'real source modules under Node/happy-dom; no Chrome/UI automation',
  request: { token, sourceLang, targetLang, timeoutMs, includeAi: false },
  note: 'Bundled and Yomitan are local stores, not HTTP providers, and are covered by their dedicated tests. BYOK providers run only when their existing credentials are supplied via environment variables.',
  providers: rows,
};
mkdirSync('docs/reports/runtime', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = `docs/reports/runtime/all-enrichment-providers-${token}-${stamp}.json`;
writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, providers: rows }, null, 2));
