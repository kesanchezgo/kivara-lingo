import type { EnrichmentSource, EnrichmentContext } from '../src/background/enrichment/types';
import { freeDictionarySource } from '../src/background/enrichment/sources/free-dictionary';
import { datamuseSource } from '../src/background/enrichment/sources/datamuse';
import { wiktionarySource } from '../src/background/enrichment/sources/wiktionary';
import { wiktionaryHtmlSource } from '../src/background/enrichment/sources/wiktionary-html';
import { wiktionaryApiSource } from '../src/background/enrichment/sources/wiktionary-api';
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
import { collinsSource } from '../src/background/enrichment/sources/collins';
import { merriamWebsterSource } from '../src/background/enrichment/sources/merriam-webster';
import { ozdicSource } from '../src/background/enrichment/sources/ozdic';
import { reversoSource } from '../src/background/enrichment/sources/reverso-context';
import { lingueeSource } from '../src/background/enrichment/sources/linguee';
import { wordReferenceSource } from '../src/background/enrichment/sources/wordreference';
import { spanishDictSource } from '../src/background/enrichment/sources/spanishdict';
import { forvoSource } from '../src/background/enrichment/sources/forvo';
import { mkdirSync, writeFileSync } from 'node:fs';

const standard: EnrichmentSource[] = [
  freeDictionarySource, datamuseSource, wiktionarySource, wiktionaryHtmlSource, wiktionaryApiSource,
  mobyThesaurusSource, thesaurusComSource, wordHippoSource, theIdiomsSource, etymonlineSource,
  tatoebaSource, linguaLibreSource, googleTtsSource, youglishSource, bingImagesSource, openverseSource,
  wikimediaCommonsSource, duckduckgoImagesSource,
];
const vip: EnrichmentSource[] = [
  cambridgeSource, oxfordLearnersSource, longmanSource, collinsSource, merriamWebsterSource,
  ozdicSource, reversoSource, lingueeSource, wordReferenceSource, spanishDictSource, forvoSource,
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

async function runOne(source: EnrichmentSource, token: string, sentence: string) {
  const ctx: EnrichmentContext = { sourceLang: 'en', targetLang: 'es', sentence, timeoutMs: 8000 };
  const started = Date.now();
  try {
    const partial = await source.enrich(token, ctx);
    return { ok: true, ms: Date.now() - started, partial, shape: shape(partial as Record<string, unknown>) };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
}

const report: any = { generatedAt: new Date().toISOString(), words, tiers: { standard: [], vip: [] }, results: [] };
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
  console.log(`AUDITED ${item.token}: ${settled.filter((r: any) => r.ok && Object.keys(r.partial ?? {}).length).length}/${settled.length} sources with data`);
}
mkdirSync('docs/reports', { recursive: true });
const file = `docs/reports/enrichment-source-audit-${new Date().toISOString().slice(0, 10)}.json`;
writeFileSync(file, JSON.stringify(report, null, 2));
console.log(`WROTE ${file}`);
