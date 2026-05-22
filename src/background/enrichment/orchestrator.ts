/**
 * Enrichment orchestrator.
 *
 * Fans out the request to every enabled source in parallel, waits on
 * each one with its own per-source timeout, and merges the partial
 * results into a single `EnrichmentResult`.
 *
 * Design:
 *
 *  1. Each source is independent. A failure in source A never blocks
 *     sources B/C — we use `Promise.allSettled` so the merger sees
 *     partial results regardless.
 *  2. Sources are toggled by `VipSettings`. The orchestrator skips
 *     disabled sources entirely (no network call, no allocation).
 *  3. The merger preferentially picks higher-quality data when
 *     duplicates exist — Cambridge IPA wins over Free Dictionary,
 *     Forvo audio wins over Google TTS fallback, etc.
 *  4. Results are cached in IndexedDB by `(sourceLang, targetLang,
 *     token)`. Cache TTL is per-source (most VIP sources change
 *     rarely so we default to 14 days).
 */

import type {
  DictionaryEntry,
  VipEnrichment,
  VipSettings,
} from '../../shared/types';
import type {
  EnrichmentContext,
  EnrichmentResult,
  EnrichmentSource,
  SourcePartial,
} from './types';

import { freeDictionarySource } from './sources/free-dictionary';
import { datamuseSource } from './sources/datamuse';
import { cambridgeSource } from './sources/cambridge';
import { oxfordLearnersSource } from './sources/oxford-learners';
import { longmanSource } from './sources/longman';
import { collinsSource } from './sources/collins';
import { merriamWebsterSource } from './sources/merriam-webster';
import { ozdicSource } from './sources/ozdic';
import { reversoSource } from './sources/reverso-context';
import { lingueeSource } from './sources/linguee';
import { wordReferenceSource } from './sources/wordreference';
import { spanishDictSource } from './sources/spanishdict';
import { tatoebaSource } from './sources/tatoeba';
import { forvoSource } from './sources/forvo';
import { linguaLibreSource } from './sources/lingua-libre';
import { googleTtsSource } from './sources/google-tts';
import { unsplashSource } from './sources/unsplash';
import { pixabaySource } from './sources/pixabay';
import { wikimediaCommonsSource } from './sources/wikimedia-commons';
import { duckduckgoImagesSource } from './sources/duckduckgo-images';
import { youglishSource } from './sources/youglish';
import { etymonlineSource } from './sources/etymonline';
import { getDB } from '../../shared/db';

/**
 * Standard-tier sources — always queried, even with VIP off. These are
 * the ones with no rate limit, no scraping, no licence concerns.
 */
const STANDARD_SOURCES: EnrichmentSource[] = [
  freeDictionarySource,
  datamuseSource,
];

/**
 * VIP-tier sources, keyed by their `VipSettings` flag. The
 * orchestrator runs only the ones whose flag is `true`.
 */
const VIP_SOURCES: Record<keyof VipSettings, EnrichmentSource | null> = {
  enabled: null,
  perSourceTimeoutMs: null,
  cacheTtlDays: null,

  cambridge: cambridgeSource,
  oxfordLearners: oxfordLearnersSource,
  longman: longmanSource,
  collins: collinsSource,
  merriamWebster: merriamWebsterSource,
  oxfordCollocations: null, // pack-based, handled separately
  ozdic: ozdicSource,
  reverso: reversoSource,
  linguee: lingueeSource,
  wordReference: wordReferenceSource,
  spanishDict: spanishDictSource,
  tatoeba: tatoebaSource,
  cambridgeAudio: null, // audio extracted by `cambridgeSource`
  oxfordAudio: null, // audio extracted by `oxfordLearnersSource`
  forvo: forvoSource,
  linguaLibre: linguaLibreSource,
  googleTtsFallback: googleTtsSource,
  unsplash: unsplashSource,
  pixabay: pixabaySource,
  wikimediaCommons: wikimediaCommonsSource,
  duckduckgoImages: duckduckgoImagesSource,
  youglish: youglishSource,
};

interface RunOptions {
  /** Source language (BCP-47 primary). */
  sourceLang: string;
  /** Native (target) language. */
  targetLang: string;
  /** Optional sentence the token appears in. */
  sentence?: string;
  /** VIP settings to honor. */
  vip: VipSettings;
  /** AbortSignal so the caller can cancel. */
  signal?: AbortSignal;
  /** When `true`, skip cache lookup (force refresh). */
  bypassCache?: boolean;
}

/**
 * Run the enrichment chain for `token`. Always returns a result,
 * even when every source failed — fields just stay empty.
 */
export async function runEnrichment(
  token: string,
  opts: RunOptions,
): Promise<EnrichmentResult> {
  const ctx: EnrichmentContext = {
    sourceLang: opts.sourceLang,
    targetLang: opts.targetLang,
    sentence: opts.sentence,
    timeoutMs: opts.vip.perSourceTimeoutMs ?? 4000,
    signal: opts.signal,
  };

  const cacheKey = makeCacheKey(token, ctx);
  if (!opts.bypassCache) {
    const cached = await readCache(cacheKey, opts.vip.cacheTtlDays ?? 14);
    if (cached) return cached;
  }

  // Build the active source list.
  const active: EnrichmentSource[] = [...STANDARD_SOURCES];
  if (opts.vip.enabled) {
    for (const [flag, source] of Object.entries(VIP_SOURCES)) {
      if (!source) continue;
      const k = flag as keyof VipSettings;
      if (opts.vip[k] === true) active.push(source);
    }
  }

  // Fan out.
  const settled = await Promise.allSettled(
    active.map((s) => s.enrich(token, ctx).then((p) => ({ source: s, partial: p }))),
  );

  // Merge.
  const successfulSources: string[] = [];
  const failedSources: Array<{ source: string; error: string }> = [];
  const partials: Array<{ source: EnrichmentSource; partial: SourcePartial }> = [];
  for (let i = 0; i < settled.length; i += 1) {
    const r = settled[i];
    const src = active[i];
    if (r.status === 'fulfilled') {
      const p = r.value.partial;
      const has = Object.values(p).some((v) =>
        Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null,
      );
      if (has) {
        successfulSources.push(src.id);
        partials.push({ source: src, partial: p });
      }
    } else {
      const msg =
        r.reason instanceof Error ? r.reason.message : String(r.reason);
      failedSources.push({ source: src.id, error: msg });
    }
  }

  const merged = mergeFields(token, partials);
  const result: EnrichmentResult = {
    entry: merged.entry,
    vip: merged.vip,
    successfulSources,
    failedSources,
  };

  // Best-effort cache write — never let a write failure surface.
  void writeCache(cacheKey, result).catch(() => {});
  return result;
}

/* ─── Merge logic ─────────────────────────────────────────────────────── */

interface MergedFields {
  entry: DictionaryEntry | null;
  vip: VipEnrichment;
}

function mergeFields(
  token: string,
  partials: Array<{ source: EnrichmentSource; partial: SourcePartial }>,
): MergedFields {
  const entry: DictionaryEntry = {
    token,
    type: token.includes(' ') ? 'phrase' : 'word',
    translation: '—',
  };

  const vip: VipEnrichment = {};
  const allDefs: Array<{ source: string; text: string }> = [];
  const allTrans: Array<{ source: string; text: string }> = [];
  const allExamples: Array<{ source: string; text: string; translation?: string }> = [];
  const synonyms = new Set<string>();
  const antonyms = new Set<string>();
  const collocations = new Set<string>();
  const audio: NonNullable<DictionaryEntry['audio']> = [];
  const videoLinks: Array<{ url: string; source: string }> = [];

  // We render entry.phonetic / entry.translation from the FIRST source
  // that has them, ranked by preference. The order of `partials` is
  // preserved (Standard before VIP), but within VIP we want Cambridge
  // / Oxford to win over Datamuse-derived noise.
  const phoneticPriority = [
    'cambridge', 'oxfordLearners', 'longman', 'collins', 'merriamWebster',
    'freeDictionary',
  ];
  const translationPriority = [
    'reverso', 'wordReference', 'spanishDict', 'cambridge', 'linguee',
  ];

  // Accumulate everything first, then pick winners.
  for (const { source, partial } of partials) {
    if (partial.synonyms) for (const s of partial.synonyms) synonyms.add(s);
    if (partial.antonyms) for (const a of partial.antonyms) antonyms.add(a);
    if (partial.collocations) for (const c of partial.collocations) collocations.add(c);
    if (partial.audio) {
      for (const a of partial.audio) {
        if (!audio.some((x) => x.url === a.url)) {
          audio.push({ url: a.url, accent: a.accent, source: source.id });
        }
      }
    }
    for (const d of partial.definitions ?? []) allDefs.push({ source: source.id, text: d });
    for (const t of partial.translations ?? []) allTrans.push({ source: source.id, text: t });
    for (const e of partial.examples ?? []) {
      allExamples.push({ source: source.id, text: e.text, translation: e.translation });
    }
    if (partial.imageUrl && !vip.imageUrl) vip.imageUrl = partial.imageUrl;
    if (partial.videoLinks) {
      for (const v of partial.videoLinks) videoLinks.push({ url: v.url, source: source.id });
    }
    if (partial.etymology && !vip.etymology) vip.etymology = partial.etymology;
    if (partial.mnemonic && !vip.mnemonic) vip.mnemonic = partial.mnemonic;
    if (partial.frequencyRank && !entry.frequencyRank) {
      entry.frequencyRank = partial.frequencyRank;
    }
  }

  // Pick phonetic from the highest-priority source that has one.
  for (const id of phoneticPriority) {
    const hit = partials.find((p) => p.source.id === id && p.partial.phonetic);
    if (hit?.partial.phonetic) {
      entry.phonetic = hit.partial.phonetic;
      break;
    }
  }

  // Pick translation similarly.
  for (const id of translationPriority) {
    const hit = partials.find((p) => p.source.id === id && p.partial.translations?.length);
    if (hit?.partial.translations?.length) {
      entry.translation = hit.partial.translations[0];
      // Fallback bilingual: first 3 translations from the source.
      if (hit.partial.translations.length > 1) {
        entry.bilingual = hit.partial.translations.slice(0, 4).join(' · ');
      }
      break;
    }
  }

  // Synonyms / antonyms / collocations / audio go on entry directly so
  // the popover and the Anki mapper don't have to dig into vip.*
  if (synonyms.size) entry.synonyms = Array.from(synonyms).slice(0, 12);
  if (antonyms.size) entry.antonyms = Array.from(antonyms).slice(0, 8);
  if (collocations.size) entry.collocations = Array.from(collocations).slice(0, 12);
  if (audio.length) entry.audio = audio.slice(0, 8);

  // VIP block surfaces full source-attributed lists.
  if (allDefs.length) vip.definitions = allDefs.slice(0, 12);
  if (allTrans.length) vip.translations = allTrans.slice(0, 12);
  if (allExamples.length) vip.examples = allExamples.slice(0, 12);
  if (videoLinks.length) vip.videoLinks = videoLinks;

  // Pick a primary monolingual definition and primary examples for the
  // popover top fold, prefer Longman / Cambridge over the rest.
  const monoPriority = ['longman', 'cambridge', 'oxfordLearners', 'collins', 'merriamWebster', 'freeDictionary'];
  for (const id of monoPriority) {
    const hit = partials.find((p) => p.source.id === id && (p.partial.definitions?.length ?? 0) > 0);
    if (hit?.partial.definitions?.length) {
      entry.monolingual = hit.partial.definitions[0];
      break;
    }
  }
  if (allExamples.length) {
    entry.examples = allExamples.slice(0, 4).map((e) =>
      e.translation ? `${e.text} — ${e.translation}` : e.text,
    );
  }

  entry.vip = vip;
  return { entry, vip };
}

/* ─── Cache (IndexedDB via Dexie) ─────────────────────────────────────── */

interface CacheRow {
  key: string;
  payload: EnrichmentResult;
  storedAt: number;
}

function makeCacheKey(token: string, ctx: EnrichmentContext): string {
  return `${ctx.sourceLang}|${ctx.targetLang}|${token.trim().toLowerCase()}`;
}

async function readCache(key: string, ttlDays: number): Promise<EnrichmentResult | null> {
  try {
    const db = getDB();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = (await (db as any).vip_cache?.get(key)) as CacheRow | undefined;
    if (!row) return null;
    const ageMs = Date.now() - (row.storedAt ?? 0);
    if (ageMs > ttlDays * 24 * 3600 * 1000) return null;
    return row.payload;
  } catch {
    return null;
  }
}

async function writeCache(key: string, payload: EnrichmentResult): Promise<void> {
  try {
    const db = getDB();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).vip_cache?.put({ key, payload, storedAt: Date.now() });
  } catch {
    // ignore — cache misses are recoverable.
  }
}
