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
  ImageCandidate,
  SenseRelationGroup,
  SourcePartial,
} from './types';
import { gateSources } from './permissions-gate';

import { freeDictionarySource } from './sources/free-dictionary';
import { datamuseSource } from './sources/datamuse';
import { wiktionarySource } from './sources/wiktionary';
import { wiktionaryHtmlSource } from './sources/wiktionary-html';
import { wiktionaryApiSource } from './sources/wiktionary-api';
import { wiktApiSource } from './sources/wiktapi';
import { britannicaDictionarySource } from './sources/britannica-dictionary';
import { wordHippoSource } from './sources/wordhippo';
import { theIdiomsSource } from './sources/the-idioms';
import { mobyThesaurusSource } from './sources/moby-thesaurus';
import { thesaurusComSource } from './sources/thesaurus-com';
import { bundledSource } from './sources/bundled';
import { yomitanPacksSource } from './sources/yomitan-packs';
import { mergeFields } from './merge';
import { cambridgeSource } from './sources/cambridge';
import { oxfordLearnersSource } from './sources/oxford-learners';
import { longmanSource } from './sources/longman';
import { dictionaryComSource } from './sources/dictionary-com';
import { merriamWebsterSource } from './sources/merriam-webster';
import { merriamWebsterThesaurusSource } from './sources/mw-thesaurus';
import { ozdicSource } from './sources/ozdic';
import { ponsSource } from './sources/pons';
import { bablaSource } from './sources/babla';
import { dictCcSource } from './sources/dictcc';
import { reversoSource } from './sources/reverso-context';
import { lingueeSource } from './sources/linguee';
import { promtContextSource } from './sources/promt-context';
import { wordReferenceSource } from './sources/wordreference';
import { spanishDictSource } from './sources/spanishdict';
import { tatoebaSource } from './sources/tatoeba';
import { forvoSource } from './sources/forvo';
import { linguaLibreSource } from './sources/lingua-libre';
import { googleTtsSource } from './sources/google-tts';
import { unsplashSource } from './sources/unsplash';
import { pixabaySource } from './sources/pixabay';
import { bingImagesSource } from './sources/bing-images';
import { openverseSource } from './sources/openverse';
import { wikimediaCommonsSource } from './sources/wikimedia-commons';
import { duckduckgoImagesSource } from './sources/duckduckgo-images';
import { youglishSource } from './sources/youglish';
import { etymonlineSource } from './sources/etymonline';
import { wordnetSource } from './sources/wordnet';
import { sourceGate } from './source-tiers';
import {
  clearMemEnrichmentCache,
  getEnrichmentCacheStats,
  readEnrichmentCache,
  writeEnrichmentCache,
  DEFAULT_VIP_CACHE_TTL_DAYS,
} from './cache';

// Re-exported so cache-admin.ts and the SW keep importing the cache surface
// from the orchestrator: a split must not ripple through every call site.
export {
  clearMemEnrichmentCache,
  getEnrichmentCacheStats,
  readEnrichmentCache,
  writeEnrichmentCache,
};
// The merger lives in merge.ts now; this re-export keeps the orchestrator's
// surface stable for whoever reached it through here before the split.
export { mergeFields } from './merge';

export { clearEnrichmentCache } from './cache';
import { translateText } from '../translate';

/**
 * Standard tier: always queried regardless of the VIP master switch.
 * Sources here are public/free APIs, open datasets, or public fallbacks;
 * editorial dictionary scraping belongs in VIP. Each source can still be
 * `VipSettings` flag — we just consult the toggle so the user can
 * silence one without flipping the master.
 *
 * Reclassified 2026-05-23 from VIP → Standard:
 *   - etymonline (etymology, public website with no commercial dict)
 *   - bingImages, openverse, wikimediaCommons, duckduckgoImages
 *     (image search APIs, no token)
 *   - tatoeba (CC-BY parallel sentences API)
 *   - linguaLibre (Wikimedia file-search API for native pronunciations)
 *   - youglish (URL-only, no fetch)
 *   - googleTtsFallback (synthetic TTS fallback)
 *
 * VIP tier (the remaining 11) keeps the scrapes of commercial
 * dictionaries (Cambridge / Oxford / Longman / Dictionary.com / Merriam-Webster
 * / Reverso / Linguee / WordReference / SpanishDict / Forvo / Ozdic) +
 * BYOK image APIs (Unsplash, Pixabay).
 */
// STANDARD_SOURCE_KEYS is derived below, after VIP_SOURCES: tier membership lives in source-tiers.ts.

function getStandardSources(vip: VipSettings): EnrichmentSource[] {
  const out: EnrichmentSource[] = [];
  for (const [flag, source] of Object.entries(VIP_SOURCES)) {
    if (!source) continue;
    const k = flag as keyof VipSettings;
    if (vip[k] === true) out.push(source);
  }
  return out.filter((source) => sourceGate(source.id) === 'standard');
}

/**
 * VIP-tier sources, keyed by their `VipSettings` flag. The orchestrator runs
 * only the ones whose flag is `true`. Which permission group each source needs
 * lives in `permissions-gate.ts` next to the gate that applies it.
 */
const VIP_SOURCES: Record<keyof VipSettings, EnrichmentSource | null> = {
  enabled: null,
  perSourceTimeoutMs: null,
  cacheTtlDays: null,
  unsplashAccessKey: null,
  pixabayApiKey: null,

  // Standard tier — runs regardless of `enabled`, but each source is
  // still individually togglable from the UI.
  freeDictionary: freeDictionarySource,
  datamuse: datamuseSource,
  wiktionary: wiktionarySource,
  wiktionaryHtml: wiktionaryHtmlSource,
  wiktionaryApi: wiktionaryApiSource,
  wiktApi: wiktApiSource,
  mobyThesaurus: mobyThesaurusSource,
  thesaurusCom: thesaurusComSource,
  wordHippo: wordHippoSource,
  theIdioms: theIdiomsSource,
  bundled: bundledSource,
  yomitanPacks: yomitanPacksSource,

  britannicaDictionary: britannicaDictionarySource,
  cambridge: cambridgeSource,
  oxfordLearners: oxfordLearnersSource,
  longman: longmanSource,
  // Legacy `collins` toggle now serves Dictionary.com: Collins pages are
  // Cloudflare-gated from MV3 workers, Dictionary.com ships comparable
  // editorial definitions/IPA/audio. The key name is kept so existing
  // user preferences migrate without unexpectedly re-enabling anything.
  collins: dictionaryComSource,
  merriamWebster: merriamWebsterSource,
  merriamWebsterThesaurus: merriamWebsterThesaurusSource,
  // `oxfordCollocations` is a local-pack slot, not a network source:
  // the real OCD data arrives via the `ozdic` mirror above. Null keeps
  // the settings key (and its default-on) without running a phantom source.
  oxfordCollocations: null, // pack-based, handled separately
  ozdic: ozdicSource,
  pons: ponsSource,
  babla: bablaSource,
  dictCc: dictCcSource,
  reverso: reversoSource,
  linguee: lingueeSource,
  promtContext: promtContextSource,
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
  bingImages: bingImagesSource,
  openverse: openverseSource,
  wikimediaCommons: wikimediaCommonsSource,
  duckduckgoImages: duckduckgoImagesSource,
  youglish: youglishSource,
  etymonline: etymonlineSource,
  wordnet: wordnetSource,
};

/**
 * Which flags run with the VIP master switch OFF. Derived from VIP_SOURCES +
 * the GATE axis of source-tiers.ts — not the tier axis: 74a5a10 derived it
 * from the tier and shipped Forvo/Unsplash/Pixabay/Promt running with the
 * master off. The set matches the previous hand-kept literal exactly (the
 * source-tiers test pins it), so this is still not a behavior change — it is
 * the same list, kept against drift by construction instead of by hand.
 *
 * Eager, not lazy: it sits after the source table it reads.
 */
const STANDARD_SOURCE_KEYS: Set<keyof VipSettings> = new Set(
  (Object.entries(VIP_SOURCES) as Array<[keyof VipSettings, EnrichmentSource | null]>)
    .filter(([, source]) => source !== null && sourceGate(source.id) === 'standard')
    .map(([flag]) => flag),
);

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
  /**
   * What the enrichment is for:
   *  - 'popover' (default): the on-hover card. Skips the image sources
   *    (the slowest, ~2-4.5 s each, and least essential when hovering) and
   *    uses a tighter per-source timeout so the card resolves fast. The
   *    image is fetched lazily / at save-time instead.
   *  - 'card': building an Anki note. Runs every enabled source including
   *    images, with the full per-source timeout, because the user has
   *    committed to the card and wants the richest possible result.
   */
  purpose?: 'popover' | 'card';
}

/**
 * Image source keys — these are the slowest in the fan-out (Wikimedia
 * Commons / DuckDuckGo / Bing / Openverse do 1-2 round trips each and
 * routinely take 2-4.5 s). They're excluded from the popover path so the
 * card resolves on the fastest text sources, and run only when building
 * an Anki note (or a lazy image fetch).
 */
const IMAGE_SOURCE_KEYS = new Set<keyof VipSettings>([
  'bingImages',
  'openverse',
  'wikimediaCommons',
  'duckduckgoImages',
  'unsplash',
  'pixabay',
]);

/* ─── Cache key (module scope: the identity of an entry is decided once here,
 *  not rebuilt — and now testable — on every lookup) ───────────────────── */
/**
 * Schema version of the cached enrichment payload. It is a PREFIX of every
 * cache key, so it MUST be bumped on ANY behavior change of the merge: a
 * stale payload written by an older build looks structurally valid but holds
 * the old rules' output (rankings, caps, dedup), and would be served until
 * the TTL expired. The version, not time, is what invalidates it.
 */
export const ENRICHMENT_CACHE_VERSION = 3;

export function makeCacheKey(
  token: string,
  ctx: EnrichmentContext,
  vip: VipSettings,
  purpose: 'popover' | 'card',
): string {
  // Tier is part of the key: a word looked up in Standard mode must NOT
  // satisfy a later VIP lookup (the VIP result is a superset). Without
  // this, flipping the VIP switch ON would keep serving the stale
  // Standard-only payload from cache until the TTL expired.
  // Purpose is also part of the key: the popover payload omits images, so
  // it must not satisfy a card lookup (which needs them) and vice-versa.
  const tier = vip.enabled ? 'vip' : 'std';
  const sentence = (ctx.sentence ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `v${ENRICHMENT_CACHE_VERSION}|${purpose}|${tier}|${activeSourceSignature(vip)}|${ctx.sourceLang}|${ctx.targetLang}|${token.trim().toLowerCase()}|${sentence}`;
}

/**
 * Include the source selection in the cache identity. Previously the key
 * carried only the master tier, so toggling an individual provider still
 * served a result made with the old provider set until the TTL expired.
 * Keep credentials out of the key; only their presence affects which
 * public endpoint can answer.
 */
export function activeSourceSignature(vip: VipSettings): string {
  const enabled = Object.entries(VIP_SOURCES)
    .filter(([flag, source]) => {
      if (!source) return false;
      const key = flag as keyof VipSettings;
      return STANDARD_SOURCE_KEYS.has(key)
        ? vip[key] === true
        : vip.enabled && vip[key] === true;
    })
    .map(([flag]) => flag);
  enabled.push(`cambridgeAudio:${vip.cambridgeAudio ? '1' : '0'}`);
  enabled.push(`oxfordAudio:${vip.oxfordAudio ? '1' : '0'}`);
  enabled.push(`timeout:${vip.perSourceTimeoutMs}`);
  enabled.push(`unsplashKey:${vip.unsplashAccessKey ? '1' : '0'}`);
  enabled.push(`pixabayKey:${vip.pixabayApiKey ? '1' : '0'}`);
  return enabled.join(',');
}
/**
 * Run the enrichment chain for `token`. Always returns a result,
 * even when every source failed — fields just stay empty.
 */
export async function runEnrichment(
  token: string,
  opts: RunOptions,
): Promise<EnrichmentResult> {
  const purpose = opts.purpose ?? 'popover';
  const ctx: EnrichmentContext = {
    sourceLang: opts.sourceLang,
    targetLang: opts.targetLang,
    sentence: opts.sentence,
    // The popover uses a tighter per-source timeout so one slow scrape
    // can't hold the whole card hostage; the card flow keeps the full
    // budget since the user has committed and wants the richest result.
    timeoutMs:
      purpose === 'popover'
        ? Math.min(opts.vip.perSourceTimeoutMs ?? 4000, 2500)
        : opts.vip.perSourceTimeoutMs ?? 4000,
    signal: opts.signal,
  };



  // Pass BYOK image-source credentials through the ctx — sources read
  // them off the ctx via type cast (see unsplash.ts / pixabay.ts).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ctx as any).unsplashAccessKey = opts.vip.unsplashAccessKey;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ctx as any).pixabayApiKey = opts.vip.pixabayApiKey;

  // Images are excluded from the popover fan-out (they're the slowest
  // sources and least essential while hovering); they run for the card.
  const skipImages = purpose === 'popover';

  const cacheKey = makeCacheKey(token, ctx, opts.vip, purpose);
  if (!opts.bypassCache) {
    // One TTL, shared with the pruner in cache.ts: the reader and the housekeeper
  // answer the same question (how long is a payload current?) and used to answer
  // it with two different literals.
  const cached = await readEnrichmentCache(
    cacheKey,
    opts.vip.cacheTtlDays ?? DEFAULT_VIP_CACHE_TTL_DAYS,
  );
    if (cached) return cached;
  }

  // Build the active source list.
  // Standard tier always runs (gated only by per-source toggles, not
  // the VIP master switch).
  let active: EnrichmentSource[] = [...getStandardSources(opts.vip)];
  // VIP tier runs only when the master switch is on.
  if (opts.vip.enabled) {
    for (const [flag, source] of Object.entries(VIP_SOURCES)) {
      if (!source) continue;
      const k = flag as keyof VipSettings;
      // Skip Standard sources here — they were already added above.
      if (STANDARD_SOURCE_KEYS.has(k)) continue;
      if (opts.vip[k] === true) active.push(source);
    }
  }
  if (skipImages) {
    active = active.filter((s) => !IMAGE_SOURCE_KEYS.has(s.id as keyof VipSettings));
  }

  // OPTIONAL HOST PERMISSIONS — see permissions-gate.ts, which owns the listing
  // (one per lookup, not one per source), the match-pattern comparison and the
  // report the popover turns into its grant CTA.
  const gate = await gateSources(active);
  active = gate.reachable;
  const permissionBlocked = gate.needsAccess;

  // Fan out.
  const settled = await Promise.allSettled(
    active.map(async (s) => {
      const partial = await s.enrich(token, ctx);
      // Cambridge and Oxford expose their pronunciation files together
      // with the dictionary payload. Honour the dedicated UI toggles by
      // removing only that field, while retaining their definitions and
      // examples.
      if (
        (s.id === 'cambridge' && !opts.vip.cambridgeAudio) ||
        (s.id === 'oxfordLearners' && !opts.vip.oxfordAudio)
      ) {
        const { audio: _audio, ...withoutAudio } = partial;
        return { source: s, partial: withoutAudio };
      }
      return { source: s, partial };
    }),
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
      const fields = Object.entries(p)
        .filter(([, value]) =>
          Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null,
        )
        .map(([field]) => field);
      const has = fields.length > 0;
      console.info('[kivara:enrichment:source]', {
        source: src.id,
        token,
        hasData: has,
        fields,
      });
      if (has) {
        successfulSources.push(src.id);
        partials.push({ source: src, partial: p });
      }
    } else {
      const msg =
        r.reason instanceof Error ? r.reason.message : String(r.reason);
      console.info('[kivara:enrichment:source]', {
        source: src.id,
        token,
        hasData: false,
        error: msg,
      });
      failedSources.push({ source: src.id, error: msg });
    }
  }

  const merged = mergeFields(token, partials, ctx);

  // Backfill native-language translations on examples that came from
  // monolingual sources. Runs before the cache write so the cached payload
  // is already complete; the translator's own IndexedDB cache keeps this
  // from re-hitting provider quotas for a sentence we've seen before.
  await fillMissingExampleTranslations(merged.vip.examples, ctx, token);
  // Re-render the card's top-4 example lines so the newly filled
  // translations show as `text — translation` (mergeFields built these from
  // the pre-backfill data).
  if (merged.entry && merged.vip.examples && merged.vip.examples.length) {
    merged.entry.examples = merged.vip.examples
      .slice(0, 4)
      .map((example) =>
        example.translation ? `${example.text} — ${example.translation}` : example.text,
      );
  }

  const result: EnrichmentResult = {
    entry: merged.entry,
    vip: merged.vip,
    successfulSources,
    failedSources,
  };
  if (permissionBlocked.length > 0) {
    result.needsAccess = permissionBlocked;
  }

  // Best-effort cache write — never let a write failure surface.
  void writeEnrichmentCache(cacheKey, result).catch(() => {});
  return result;
}

/* ─── Example translation backfill ────────────────────────────────────── */

/**
 * Sources whose per-example `translation` we trust verbatim. These are
 * editorial/parallel corpora that pair sentences deliberately (professional
 * lexicographers or aligned corpora), so we never second-guess their pairs.
 */
const TRUSTED_TRANSLATION_SOURCES = new Set([
  'promtContext', 'linguee', 'reverso', 'cambridge', 'oxfordLearners',
  'longman', 'dictionaryCom', 'merriamWebster', 'spanishDict', 'wordReference',
  'pons', 'dictCc', 'babla',
]);

/**
 * Sources whose per-example `translation` is community-contributed and can be
 * flat-out wrong (a volunteer mistranslating the sentence). Tatoeba is the
 * canonical case: "I love apples!" once paired with "¡Me encantan las
 * naranjas!". We keep their (excellent) native *sentences* but treat their
 * translation as a hint we may override when it looks suspect.
 */
const REVIEWABLE_TRANSLATION_SOURCES = new Set(['tatoeba']);

/**
 * Strip a Spanish/English word down to a comparable stem: lowercase, drop
 * surrounding punctuation, and collapse a trailing plural `-s`/`-es`. Crude
 * on purpose — it only needs to make "manzana"/"manzanas" and
 * "naranja"/"naranjas" compare equal, not to be a real lemmatizer.
 */
function contentStem(word: string): string {
  const w = word.toLowerCase().replace(/[^\p{L}]/gu, '');
  if (w.length <= 3) return w;
  if (w.endsWith('es')) return w.slice(0, -2);
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}

// Function words we ignore when checking whether a translation "mentions" the
// expected gloss — they carry no semantic signal.
const STOPWORD_STEMS = new Set([
  'el', 'la', 'lo', 'lu', 'un', 'una', 'de', 'del', 'a', 'al', 'en', 'con',
  'por', 'para', 'que', 'se', 'me', 'te', 'le', 'les', 'no', 'si', 'y', 'o',
  'su', 'mi', 'tu', 'e',
]);

function contentStems(phrase: string): Set<string> {
  const out = new Set<string>();
  for (const raw of phrase.split(/\s+/)) {
    const stem = contentStem(raw);
    if (stem && stem.length >= 2 && !STOPWORD_STEMS.has(stem)) out.add(stem);
  }
  return out;
}

/**
 * Resolve the expected native gloss for the head token (e.g. apple → manzana)
 * using the same translator the card already trusts. Returns the set of
 * content stems in that gloss, or `null` when unavailable (offline, no dict,
 * provider miss) — in which case the caller must NOT flag anything suspect.
 *
 * We translate the token straight into the TARGET language via `translateText`
 * (cached, provider-chain). `translateToken(token, sourceLang)` is the wrong
 * tool here: it returns a source-language dictionary entry whose `translation`
 * field is not guaranteed to be the target-language gloss (a monolingual EN
 * entry for "apple" carries an English definition, not "manzana").
 */
async function resolveExpectedGlossStems(
  token: string,
  ctx: EnrichmentContext,
): Promise<Set<string> | null> {
  try {
    const res = await translateText({
      text: token,
      sourceLang: ctx.sourceLang,
      targetLang: ctx.targetLang,
    });
    if (!res.ok || !res.translatedText || !res.translatedText.trim()) return null;
    const gloss = res.translatedText.trim();
    // A provider echoing the token back verbatim tells us nothing.
    if (gloss.toLowerCase() === token.trim().toLowerCase()) return null;
    const stems = contentStems(gloss);
    return stems.size ? stems : null;
  } catch {
    return null;
  }
}

/**
 * Decide whether a reviewable source's translation is suspect enough to
 * override. Conservative by design (favours keeping data): flags ONLY when
 *  - we actually know the expected gloss (stems non-null), AND
 *  - the English text really contains the head token, AND
 *  - the translation shares NO content stem with the expected gloss.
 * Any of those failing ⇒ we keep the original translation.
 */
function isSuspectTranslation(
  token: string,
  text: string,
  translation: string,
  glossStems: Set<string> | null,
): boolean {
  if (!glossStems || glossStems.size === 0) return false;
  const tok = token.toLowerCase().trim();
  if (!tok) return false;
  // Only judge sentences that genuinely feature the head word — otherwise the
  // gloss legitimately may not appear.
  if (!text.toLowerCase().includes(tok)) return false;
  const transStems = contentStems(translation);
  if (transStems.size === 0) return false;
  for (const stem of glossStems) {
    if (transStems.has(stem)) return false; // gloss present ⇒ trustworthy
  }
  return true; // token present in EN, but its native gloss is nowhere in ES
}

/**
 * Backfill (and, for reviewable sources, repair) `translation` fields on
 * merged examples.
 *
 * Two jobs, one pass:
 *  1. FILL — monolingual dictionaries (Cambridge, Britannica, Wiktionary,
 *     bundled, …) return English-only `text`. We fill the missing native line
 *     via `translateText`.
 *  2. REPAIR — community corpora (tatoeba) ship their own translation, which
 *     is occasionally a volunteer's mistranslation. When such a translation
 *     is suspect (see `isSuspectTranslation`) we override it with our own
 *     provider-chain translation. Editorial/parallel sources
 *     (`TRUSTED_TRANSLATION_SOURCES`) are never second-guessed.
 *
 * Rather than scrape more bilingual sites (fragile) or hand-edit report
 * dumps (a mirror, not the source), we reuse the translator the extension
 * already ships — `translateText` — cached in IndexedDB, debounced, and
 * falling through the user's configured provider chain. The cache means a
 * given sentence is only ever translated once across the whole corpus.
 *
 * Contract:
 *  - Mutates the passed examples in place.
 *  - Never throws: a provider miss (incl. offline mode) leaves the example
 *    untouched, exactly as before.
 *  - Repair is fail-safe: if the expected gloss can't be resolved, NOTHING is
 *    flagged suspect, so we never destroy a good translation on a guess.
 *  - Runs all lookups concurrently; the translator's own debounce + cache
 *    keep quota use sane.
 */
async function fillMissingExampleTranslations(
  examples: Array<{ source: string; text: string; translation?: string }> | undefined,
  ctx: EnrichmentContext,
  token: string,
): Promise<void> {
  if (!examples || examples.length === 0) return;
  // Same source and target language ⇒ nothing to translate.
  if (ctx.sourceLang.slice(0, 2) === ctx.targetLang.slice(0, 2)) return;

  // Does any reviewable-source example need judging? Only then do we pay for
  // the head-token gloss lookup.
  const hasReviewable = examples.some(
    (ex) => REVIEWABLE_TRANSLATION_SOURCES.has(ex.source) && ex.translation && ex.text,
  );
  const glossStems = hasReviewable
    ? await resolveExpectedGlossStems(token, ctx)
    : null;

  const pending = examples.filter((ex) => {
    if (!ex.text || ex.text.trim().length === 0) return false;
    if (!ex.translation) return true; // FILL: missing translation
    // REPAIR: reviewable source with a suspect translation.
    if (
      REVIEWABLE_TRANSLATION_SOURCES.has(ex.source) &&
      !TRUSTED_TRANSLATION_SOURCES.has(ex.source) &&
      isSuspectTranslation(token, ex.text, ex.translation, glossStems)
    ) {
      return true;
    }
    return false;
  });
  if (pending.length === 0) return;

  await Promise.all(
    pending.map(async (ex) => {
      try {
        const res = await translateText({
          text: ex.text,
          sourceLang: ctx.sourceLang,
          targetLang: ctx.targetLang,
        });
        if (res.ok && res.translatedText && res.translatedText.trim()) {
          // Guard against a provider echoing the source back verbatim.
          if (res.translatedText.trim().toLowerCase() !== ex.text.trim().toLowerCase()) {
            ex.translation = res.translatedText.trim();
          }
        }
      } catch {
        // Best-effort: leave this example as-is on failure.
      }
    }),
  );
}

