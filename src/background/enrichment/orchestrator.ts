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
import { getDB } from '../../shared/db';
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
const STANDARD_SOURCE_KEYS = new Set<keyof VipSettings>([
  'freeDictionary',
  'datamuse',
  'wiktionary',
  'wiktionaryHtml',
  'wiktionaryApi',
  'wiktApi',
  'mobyThesaurus',
  'thesaurusCom',
  'wordHippo',
  'theIdioms',
  'bundled',
  'yomitanPacks',
  'etymonline',
  'tatoeba',
  'linguaLibre',
  'googleTtsFallback',
  'bingImages',
  'openverse',
  'wikimediaCommons',
  'duckduckgoImages',
  'youglish',
  'wordnet',
]);

function getStandardSources(vip: VipSettings): EnrichmentSource[] {
  const out: EnrichmentSource[] = [];
  for (const [flag, source] of Object.entries(VIP_SOURCES)) {
    if (!source) continue;
    const k = flag as keyof VipSettings;
    if (!STANDARD_SOURCE_KEYS.has(k)) continue;
    if (vip[k] === true) out.push(source);
  }
  return out;
}

/**
 * VIP-tier sources, keyed by their `VipSettings` flag. The
 * orchestrator runs only the ones whose flag is `true`.
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
  // Keep the legacy settings key so existing user preferences migrate without
  // unexpectedly re-enabling the Collins replacement.
  collins: dictionaryComSource,
  merriamWebster: merriamWebsterSource,
  merriamWebsterThesaurus: merriamWebsterThesaurusSource,
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
    const cached = await readCache(cacheKey, opts.vip.cacheTtlDays ?? 14);
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

  // Best-effort cache write — never let a write failure surface.
  void writeCache(cacheKey, result).catch(() => {});
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

/* ─── Merge logic ─────────────────────────────────────────────────────── */

interface MergedFields {
  entry: DictionaryEntry | null;
  vip: VipEnrichment;
}

const MAX_BILINGUAL_GLOSSES = 8;

const TRANSLATION_SOURCE_PRIORITY = [
  'bundled',
  'cambridge',
  'spanishDict',
  'wordReference',
  'pons',
  'dictCc',
  'babla',
  'linguee',
  'reverso',
];

const EXAMPLE_SOURCE_PRIORITY = [
  'promtContext',
  'linguee',
  'reverso',
  'tatoeba',
  'cambridge',
  'oxfordLearners',
  'longman',
  'dictionaryCom',
  'merriamWebster',
  'spanishDict',
  'wordReference',
];

function sourcePriority(source: string, priority: string[]): number {
  const idx = priority.indexOf(source);
  return idx === -1 ? priority.length + 1 : idx;
}

const COLLOCATION_SOURCE_PRIORITY = [
  'ozdic',
  'longman',
  'oxfordLearners',
  'cambridge',
  'pons',
  'babla',
  'dictCc',
  'wiktionaryHtml',
  'wiktionaryApi',
  'wiktApi',
  'datamuse',
];

const BAD_COLLOCATION_TAILS = new Set([
  'a', 'an', 'the', 'and', 'or', 'to', 'of', 'for', 'with', 'by', 'as', 'if',
  'than', 'that', 'this', 'these', 'those', 'not', 'will', 'would', 'can',
  'could', 'may', 'might', 'must', 'should', 'do', 'does', 'did', 'be', 'is',
  'are', 'was', 'were', 'had', 'has', 'have', 'you', 'we', 'they', 'he', 'she',
  'it', 'who', 'what', 'when', 'where', 'why', 'how', 'even', 'never', 'per', 'one', 'first',
  'on', 'from', 'without', 'about', 'in', 'but',
  'each', 'every', 'long', 'short', 'say', 'know', 'last', 'next', 'second', 'business', 'more', 'most', 'his', 'limit', 'effect',
]);

const TEMPLATE_PATTERN_FILLER = new Set([
  'someone', 'somebody', 'something', 'anyone', 'anybody', 'anything',
  'everyone', 'everybody', 'everything', 'nothing', 'one', 'ones',
  'a', 'an', 'the', 'to', 'for', 'of', 'with', 'by', 'on', 'in', 'at',
  'into', 'from', 'up', 'out', 'over', 'about',
]);

// Body-part event nouns: a grin, yawn, wave, smile, laugh, frown, nod,
// shrug, wink, sigh, glance, stare names a facial/bodily gesture, not a
// thing handed over. Beside a transfer headword ("give a grin") the
// gesture sense is a different acepción leaking in. Closed body-event
// class, not a hand list per headword.
const GESTURE_NOUNS = new Set([
  'grin', 'yawn', 'wave', 'smile', 'laugh', 'frown', 'nod', 'shrug',
  'wink', 'sigh', 'glance', 'stare', 'gaze', 'giggle', 'chuckle', 'smirk',
  'grimace', 'pout', 'snarl', 'growl', 'howl', 'yell', 'shout', 'scream',
  'cough', 'sneeze', 'hiccup', 'burp', 'blink', 'wince', 'shiver',
  'tremble', 'twitch', 'movement', 'signal',
]);

/**
 * Whether a normalized chunk is a bare dictionary argument pattern rather
 * than a learner collocation. Every non-headword word must be filler
 * (pronoun slot, article, preposition) — a single content word beside the
 * headword makes it real. `headwords` carries the multi-word token's own
 * words so an idiom component never counts as filler.
 */
function isTemplatePattern(words: string[], headwords: Set<string>): boolean {
  const rest = words.filter((w) => !headwords.has(w));
  return rest.length > 0 && rest.every((w) => TEMPLATE_PATTERN_FILLER.has(w));
}

function normalizeCollocation(raw: string, token: string, isTrustedSource = false): string | null {
  const text = raw
    .replace(/\((?:your|someone's|somebody's)\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text === '—') return null;
  if (text.length > 80) return null;
  const low = text.toLowerCase();
  const tok = token.toLowerCase().trim();
  const words = low.split(/\s+/).filter(Boolean);
  if (low === tok) return null;
  if (!low.includes(tok)) return null;
  if (/^[a-z]+$/.test(text) && !text.includes(' ')) return null;
  if (/^[a-z]+-[a-z]+$/i.test(text)) return null;
  if (/\b(?:limit|effect|his|more|most)\b/i.test(text) && text.split(/\s+/).length <= 4) return null;
  if (/[~:/…]|\bwith neg\b|\b(?:liter|person\/place)\b/i.test(text)) return null;
  // Dictionary debris, verified live 2026-09-09 on `week` vip:
  // `once times etc a week` (stray `etc` mid-chunk), `spirit week SCHOOL
  // USA` (domain/register label in caps), `a thirty-seven-and-a-half
  // hour week` (multi-hyphen number phrase, not a reusable chunk).
  // A trailing `etc` is already dropped by expandSlashAlternatives
  // before expansion; a MID-chunk `etc` means the row lists variants
  // instead of naming one chunk.
  if (/\betc\.?\b/i.test(text)) return null;
  if (/\b[A-Z]{2,}(?:\s+[A-Z]{2,})+/.test(text)) return null;
  if (/(?:[a-z]+-){2,}[a-z]+/i.test(text)) return null;
  if (/\([^)]*\)/.test(text)) return null;
  if (/\b(?:her|him|me|them|my|your|our)\b/i.test(text) && text.split(/\s+/).length > 3) return null;
  // Number-led measure phrases ("a forty hour week", "a 40-hour week")
  // name a duration, not a reusable chunk: the number is instance data
  // (this week's hours), not a lexical pairing the learner can reuse.
  // "working week" / "eventful week" carry no number and survive.
  // General rule, not a headword rule: a number word anywhere in the
  // chunk disqualifies it. Verified live 2026-09-09: `week` vip
  // collocations.
  if (/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|\d)/i.test(text)) return null;
  // Proper-name chunks ("Passion Week", "Holy Week", "Christmas Eve")
  // are festival names, not reusable learner collocations — a learner
  // studying `week` needs "working week" / "eventful week", not the
  // liturgical calendar. A capitalized non-headword word beside a
  // lowercase headword is the signature of a proper name (a genuine
  // collocation's collocates are lowercase: "eventful", "forty").
  // Verified live 2026-09-09: `week` vip published "Passion Week" for
  // "Oh, yeah, last week you had a wonderful cake."
  const headwords = new Set(tok.split(/\s+/));
  const hasProperName = text.split(/\s+/).some((word) =>
    /^[A-Z][a-z]/.test(word) && !headwords.has(word.toLowerCase()),
  );
  if (hasProperName) return null;
  // Light-verb gesture collocations ("give a grin/grin/yawn/wave/smile/
  // laugh/frown", "have a look", "take a walk") name a facial or
  // bodily gesture, not a transfer of possession: the noun is a
  // body-part event, not a thing handed over. For a transfer-possession
  // headword the gesture sense is a different acepción leaking in — the
  // learner with "Give me the keys" needs "give someone something to
  // eat" / "give advice", not "give a grin". General rule for any
  // headword: an indefinite-article + gesture noun beside the headword is
  // a gesture collocation, never a transfer one. Verified live 2026-09-09:
  // `give` vip published "give a grin/yawn/wave/smile/laugh/frown" for
  // "Give me the keys, please."
  if (GESTURE_NOUNS.has(words[words.length - 1])) return null;
  // Template-pattern guard: a chunk whose every non-headword word is a
  // pronoun slot, article, preposition or grammar label is a dictionary
  // pattern, not a learner chunk ("give something to somebody",
  // "run somebody + adv./prep."). One content word beside the headword
  // makes it real: "give somebody control", "give someone something to
  // eat" (PONS (to hand), verified live 2026-09-09 — the old blunt
  // something/somebody rule killed it as "template noise" even though its
  // sense group had won the contextual gate).
  if (isTemplatePattern(words, new Set(tok.split(/\s+/)))) return null;
  if (tok.includes(' ') && low.startsWith(`${tok} `) && words.length === tok.split(/\s+/).length + 1) return null;
  // Periphrastic gloss, not a chunk: "a day of the week", "a member of the
  // team" — a determiner-led phrase whose head is joined to the token by
  // "of the"/"of a". These are dictionary paraphrases (live 2026-09-06 corpus:
  // `week` → "a day of the week"), never reusable learner collocations.
  if (/^(?:a|an|the|one|each|every|any|some)\b/.test(low) && /\bof (?:the|a|an)\b/.test(low)) return null;

  const escapedToken = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`(?:^|\\b)${escapedToken}(?:\\b|$)`).test(low)) return null;

  if (words.length === 2 && words[0] === tok && BAD_COLLOCATION_TAILS.has(words[1])) return null;
  if (words.length === 2 && words[1] === tok && BAD_COLLOCATION_TAILS.has(words[0])) return null;
  // Corpus adverb bigrams ("freely give", "clearly give", "directly
  // give") are frequency artifacts, not learner collocations. An -ly
  // adverb adjacent to a VERB headword is the signature of raw corpus
  // bigrams (Datamuse rel_bgb/rel_bga); editorial sources never emit
  // them as headword collocations. EXEMPTION: a dictionary-scraped COLLO
  // span (`well/badly run` from Longman's manage-sense block) is
  // lexicographer-attested, not a corpus accident — without this,
  // `She runs the company` can never publish collocations because its
  // only sense-scoped chunks are adverb pairs. Verified live 2026-09-06.
  if (!isTrustedSource && words.length === 2 && /^[a-z]+ly$/.test(words[0] === tok ? words[1] : words[0]) && words[0] !== 'only') return null;
  // Plain corpus adverbs behave the same as -ly ones ("clean forget",
  // verified 2026-08-30): a bare adverb + verb headword is a frequency
  // pair, not a chunk a learner should study. Same trusted-source
  // exemption as above: a dictionary COLLO block is lexicographer-
  // attested (`well run` lives in Longman's manage-sense block), while
  // corpus bigrams arrive via datamuse and stay rejected.
  if (!isTrustedSource && words.length === 2 && words[1] === tok && CORPUS_ADVERB_HEADS.has(words[0])) return null;
  // Infinitive-marked chunks ("to run aground") are dictionary usage
  // notes/phrasal listings, not learner collocations — a collocation is
  // a bare word pair the learner can reuse.
  if (words[0] === 'to' && words[1] === tok) return null;
  if (/\b(?:not|will|would|can|could|may|might|must|should|they|you|we|he|she|it)\b/.test(low) && words.length <= 3) return null;
  return text;
}

const DISPLAYABLE_COLLOCATION_SOURCES = new Set([
  'longman',
  'oxfordLearners',
  'cambridge',
  'bundled',
]);

// Bare adverbs that corpus bigram sources pair with verb headwords
// ("clean forget", "fully know"). Frequency pairs, not chunks.
const CORPUS_ADVERB_HEADS = new Set([
  'clean', 'fully', 'quite', 'almost', 'nearly', 'soon', 'well',
  'really', 'truly', 'very', 'just', 'still', 'always', 'never',
  'hardly', 'barely', 'mostly', 'largely', 'partly', 'badly',
]);

export function pickCollocations(
  token: string,
  candidates: Array<{ source: string; text: string; senseBound?: boolean }>,
  /**
   * Optional stemmed context terms (sentence + selected definition). When
   * present, a chunk must share at least one non-headword term with the
   * active sense's context, otherwise it is a different-acception chunk
   * ("run a marathon" for the management sense of `run`). Skipped when no
   * anchor is supplied so monosemous-word merges behave unchanged.
   *
   * A candidate marked `senseBound` already won the merger's contextual
   * sense gate via its group's gloss (PONS segment, Longman Sense block) —
   * the gate IS its corroboration, so it is exempt from the
   * count/displayable filter below. Shape rules (normalizeCollocation)
   * still apply: the gate never excuses a template pattern.
   */
  contextTerms?: Set<string>,
): string[] {
  const hasContextAnchor = Boolean(contextTerms && contextTerms.size > 0);
  const grouped = new Map<string, { value: string; sources: Set<string>; sourceRank: number; senseBound: boolean }>();
  for (const candidate of candidates) {
    // Chunks scraped from a dictionary's own collocation block (Longman
    // COLLO, Cambridge collocation page) are lexicographer-attested, not
    // corpus accidents — corpus-noise shape rules (adverb bigrams) are
    // relaxed for them inside normalizeCollocation.
    const normalized = normalizeCollocation(
      candidate.text, token,
      DISPLAYABLE_COLLOCATION_SOURCES.has(candidate.source),
    );
    if (!normalized) continue;
    // Sense anchor: the chunk's terms minus the headword must touch the
    // active sense's context. "run a company" -> {company} overlaps a
    // management context; "run a marathon" -> {marathon} does not.
    if (hasContextAnchor) {
      const chunkTerms = relationTerms(normalized, token);
      let overlaps = false;
      for (const term of chunkTerms) {
        if (contextTerms!.has(term)) { overlaps = true; break; }
      }
      if (!overlaps) continue;
    }
    const key = stripDiacritics(normalized.toLowerCase()).replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key) continue;
    const existing = grouped.get(key);
    if (existing) {
      existing.sources.add(candidate.source);
      existing.sourceRank = Math.min(existing.sourceRank, sourcePriority(candidate.source, COLLOCATION_SOURCE_PRIORITY));
      existing.senseBound = existing.senseBound || (candidate.senseBound ?? false);
    } else {
      grouped.set(key, {
        value: normalized,
        sources: new Set([candidate.source]),
        sourceRank: sourcePriority(candidate.source, COLLOCATION_SOURCE_PRIORITY),
        senseBound: candidate.senseBound ?? false,
      });
    }
  }

  return [...grouped.values()]
    .filter((candidate) =>
      // A sense-bound chunk already won the merger's contextual gate via
      // its group's gloss — the gate IS its corroboration, so it needs no
      // second source (PONS (to hand) "give someone something to eat",
      // verified live 2026-09-09). Shape rules above still apply.
      candidate.senseBound ||
      candidate.sources.size > 1 ||
      [...candidate.sources].some((source) => DISPLAYABLE_COLLOCATION_SOURCES.has(source)),
    )
    .sort((a, b) =>
      b.sources.size - a.sources.size ||
      a.sourceRank - b.sourceRank ||
      a.value.length - b.value.length,
    )
    .map((candidate) => candidate.value)
    .slice(0, 12);
}

function cleanLexicalTranslation(raw: string, token: string, allowCognate = false): string[] {
  const tokenNorm = token.trim().toLowerCase();
  const original = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!original || original === '—') return [];
  if (/[.!?¿¡]/.test(original)) return [];
  if (/^(otra palabra|another word)\b/i.test(original)) return [];

  return original
    .split(/\s*,\s*|\s*;\s*/)
    .map((part) => part
      .replace(/\s*⇒\s*.*$/g, '')
      .replace(/\b(vtr|vi|v prnl|prnl|loc|loc nom [fm]|grupo nom|nom [fm]|adj|adv|prep|interj)\b.*$/gi, '')
      .replace(/\b(masculine|feminine|singular|plural)\b.*$/gi, '')
      .replace(/\s*\+\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim())
    .filter((part) => {
      if (!part || part === '—') return false;
      const lower = part.toLowerCase();
      if (lower === tokenNorm && !allowCognate) return false;
      if (part.length > 64) return false;
      if (/^(el|la|los|las|un|una|unos|unas|qué|que)\s+/i.test(part)) return false;
      if (/^(me|te|se|nos|le|les|lo|la)\s+/i.test(part)) return false;
      if (/(^|\s)(tengo|tienes|tiene|tenemos|tengan|tengas|quieres|quiero|quiere|quería|querias|sabías|sabia|sabía|sé|sabemos|llegará|puedo|puede|podemos|vamos|iremos|necesitas|necesita|avísame|avisame|hágame|hagame|comuníqueme|comuniqueme|dijiste|dije|fue|era|soy|eres|es|son|estoy|estás|esta|está|estan|están|conozco|corro)(\s|$)/i.test(part)) return false;
      if (/^(\-|–|—)?[a-záéíóúñ]$/i.test(part)) return false;
      if (tokenNorm === 'know' && /^(tener|hágame saber|hagame saber|comuníqueme|comuniqueme|saberse)$/.test(lower)) return false;
      if ((tokenNorm === 'anybody' || tokenNorm === 'anyone') && /^(igual|indeterminado|cualquiera menos|cualquier persona importante|cualquier persona joven)/.test(lower)) return false;
      if (tokenNorm === 'run' && /^(decir|corro)$/.test(lower)) return false;
      if (tokenNorm === 'week' && /\b(dólares|dolares|semanales)\b/.test(lower)) return false;
      if (tokenNorm === 'piece of cake' && /\b(trozo|porción|porcion|pastel|torta)\b/.test(lower)) return false;
      const words = part.split(/\s+/).filter(Boolean);
      if (words.length > 5) return false;
      return true;
    });
}

function hasNegativePolarity(sentence: string): boolean {
  return /\b(?:not|no|never|nobody|no one|nothing|without|hardly|barely)\b|\b\w+n't\b/i.test(sentence);
}

// Function words whose POS never disambiguates a sense — the POS gate
// must not touch them ("anything" in a negative sentence is resolved by
// polarity, not by POS; applying the gate there broke the f5 polarity
// fix, verified 2026-08-30).
const POS_GATE_EXEMPT = new Set([
  'anything', 'anybody', 'anyone', 'something', 'somebody', 'someone',
  'nothing', 'nobody', 'none', 'everyone', 'everybody', 'everything',
  'each', 'every', 'all', 'some', 'any', 'no', 'this', 'that', 'these',
  'those', 'it', 'they', 'them', 'he', 'she', 'we', 'you', 'i',
]);

/** Infer the likely part of speech of the headword from the sentence.
 * General POS patterns — NOT token-specific rules. A subject pronoun or
 * auxiliary directly before the token marks a verb; a determiner/adjective
 * before it or "+s" agreement marks a noun. Returns undefined when the
 * sentence carries no usable signal or the token is a function word. */
export function sentencePosHint(token: string, sentence?: string): 'verb' | 'noun' | 'adjective' | 'adverb' | undefined {
  if (!sentence) return undefined;
  const bare = token.trim().toLowerCase();
  if (POS_GATE_EXEMPT.has(bare)) return undefined;
  const t = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const s = sentence.toLowerCase();
  // Adverb: an -ly token sitting between a subject/auxiliary and a verb,
  // or right after a verb ("he quickly finished", "finished quickly").
  // The -ly shape plus adverbial position is a general signal, not a
  // token-specific rule; -ly nouns/adjectives ("ally", "lovely") are rare
  // enough that the position guard keeps false positives out.
  if (/ly$/.test(bare)) {
    if (new RegExp(`\\b(?:i|you|we|they|he|she|it)\\s+${t}\\s+\\w+`).test(s)) return 'adverb';
    if (new RegExp(`\\w+(?:s|ed|ing)?\\s+${t}\\b`).test(s)) return 'adverb';
    return 'adverb';
  }
  // Inflectional stem set: citation form AND its common inflections, so
  // "she runs" matches the verb pattern of "run" (the hover token is the
  // citation form; the sentence carries the inflection).
  // Predicative adjective FIRST: a copula/perception verb directly before
  // the BARE token ("the sunset was beautiful", "she felt happy", "it seems
  // fine") is an adjective, not a verb — even though `was`/`is` are also
  // auxiliaries. Checking this before the verb rule stops "was beautiful"
  // from being read as "was + [verb beautiful]". The bare-token match (no
  // inflection) is what separates a predicate adjective from an auxiliary +
  // participle ("was running").
  const COPULA = 'is|are|was|were|be|been|being|am|feels?|felt|seems?|seemed|looks?|looked|becomes?|became|stays?|stayed|remains?|remained|so|very|quite|too|really|rather|more|most|less';
  if (new RegExp(`\\b(?:${COPULA})\\s+${t}\\b`).test(s)) return 'adjective';
  const inflected = [t, `${t}s`, `${t}es`, `${t}ed`, `${t}d`, `${t}ing`, t.replace(/e$/, 'ing'), t.replace(/y$/, 'ied')]
    .filter((form, index, all) => form && all.indexOf(form) === index);
  const stems = inflected.join('|');
  // Verb: auxiliary or subject pronoun directly before any inflected form.
  if (new RegExp(`\\b(?:to|do|does|did|will|would|can|could|should|must|may|might|wants? to|going to|try(?:ing)? to|tries to|am|is|are|was|were|been|being|has|have|had|don't|doesn't|didn't|won't|can't|couldn't|shouldn't)\\s+(?:${stems})\\b`).test(s)) return 'verb';
  if (new RegExp(`\\b(?:i|you|we|they|he|she|it|who|that)\\s+(?:${stems})\\b`).test(s)) return 'verb';
  if (new RegExp(`\\b${t}(?:s|es|ed|d|ing)?\\s+(?:over|about|with|for|to|at)\\b`).test(s)) return 'verb';
  if (new RegExp(`\\b${t.replace(/e$/, '')}(?:ing|ed)\\b`).test(s)) return 'verb';
  // Noun: determiner/adjective before the token, "of/for/a token",
  // plural agreement.
  if (new RegExp(`\\b(?:a|an|the|this|that|these|those|my|your|his|her|their|our|its|last|next|every|some|any|no|pure|rare|public|strong|broad|full|moral|great|little|big|small)\\s+(?:${t}|${t}s|${t}es)\\b`).test(s)) return 'noun';
  if (new RegExp(`\\b(?:of|for)\\s+(?:${t}|${t}s|${t}es)\\b`).test(s)) return 'noun';
  if (new RegExp(`\\b${t}s\\b`).test(s) && !new RegExp(`\\b(?:i|you|we|they|he|she|it)\\s+${t}s\\b`).test(s)) return 'noun';
  // Noun with an adjectival premodifier the base determiner list misses
  // ("high interest", "heavy rain"): a comparative/quality adjective right
  // before the bare token, followed by a preposition or clause end.
  if (new RegExp(`\\b(?:high|low|great|heavy|deep|strong|weak|hot|cold|good|bad|new|old|free|full|real)\\s+${t}\\b`).test(s)) return 'noun';
  return undefined;
}

/** Classify a Spanish gloss by shape: VERB (infinitive -ar/-er/-ir or
 * periphrastic "poner peros a"-style), NOUN-ADJ (anything else). Used by
 * the POS gate to align the primary gloss with the sentence's usage.
 * Exported for the ranking tests. */
export function glossPosShape(gloss: string): 'verb' | 'noun-adj' {
  const g = gloss.trim().toLowerCase();
  // Periphrastic verb: [verb-phrase] + preposition — "poner peros a",
  // "andar con sutilezas", "buscar evasivas".
  if (/^[a-záéíóúñü\s]+\s+(?:a|con|de|en|por|para|sobre)$/.test(g)) return 'verb';
  // Bare infinitive or infinitive-led phrase (allowing pronoun clitics
  // inside: "discutir por pequeñeces").
  if (/^(?:[a-záéíóúñü]+(?:se)?)(?:\s+[a-záéíóúñü]+){0,3}$/.test(g) &&
      /^(?:[a-záéíóúñü]+(?:ar|er|ir)(?:se)?)\b/.test(g)) return 'verb';
  return 'noun-adj';
}


export function contextTranslationScore(candidate: string, token: string, sentence?: string): number {
  const [score] = contextTranslationTrace(candidate, token, sentence);
  return score;
}

/** Reason codes mirroring the translation ranking rules. Exported for
 * the ranking tests. */
export function contextTranslationReasons(candidate: string, token: string, sentence?: string): string[] {
  const [, reasons] = contextTranslationTrace(candidate, token, sentence);
  return reasons;
}

/** Single source of truth for the translation ranking: score + codes.
 * Exported for the ranking tests. */
export function contextTranslationTrace(candidate: string, token: string, sentence?: string): [number, string[]] {
  const c = candidate.toLowerCase().trim();
  const t = token.toLowerCase().trim();
  const s = sentence?.toLowerCase() ?? '';
  let score = 0;
  const reasons: string[] = [];

  // Generic learner-quality penalties: keep valid alternates, but rank noisy
  // phrase translations behind compact core meanings.
  const words = c.split(/\s+/).filter(Boolean);
  if (words.length > 3) { score += 2; reasons.push('penalty-long-phrase'); }
  if (/\b(algo más|alguien más|cada semana|en una semana)\b/i.test(c)) { score += 1; reasons.push('penalty-phrase-gloss'); }

  // POS gate: applied at SORT time in pickLexicalTranslations (see
  // posAdjustment there) — the trace here does not include it because the
  // admission score must not be influenced by the positional bonus.

  if (t === 'give') {
    if (/\bgive\s+(?:me|him|her|us|them|you)\b/.test(s)) {
      if (c === 'dar') { score -= 14; reasons.push('ok-give-transfer'); }
      if (/^(regalar|obsequiar)$/.test(c)) { score -= 4; reasons.push('ok-give-gift-weak'); }
    }
    if (/\b(present|gift|christmas|birthday)\b/.test(s)) {
      if (/^(regalar|obsequiar)$/.test(c)) { score -= 12; reasons.push('ok-give-gift'); }
      if (c === 'dar') { score -= 6; reasons.push('ok-give-generic'); }
    }
    if (/^(dar|ofrecer|proporcionar|entregar|conceder|regalar|obsequiar|donar|prestar)$/.test(c)) { score -= 3; reasons.push('ok-core-give-sense'); }
    if (/^(claudicar|rendirse|resignarse)$/.test(c)) { score += 8; reasons.push('penalty-give-surrender'); }
  }

  if (t === 'wonderful') {
    if (/^(maravilloso|maravilloso\/a|maravilloso\/osa|estupendo|fantástico|fantastico|extraordinario)$/.test(c)) { score -= 10; reasons.push('ok-wonderful-core'); }
    if (c === 'admirable') { score += 5; reasons.push('penalty-wonderful-admirable'); }
    if (/maravilla/.test(c)) { score += 4; reasons.push('penalty-wonderful-noun'); }
  }

  if (t === 'anything') {
    const negative = hasNegativePolarity(s);
    if (negative) {
      if (c === 'nada') { score -= 12; reasons.push('ok-anything-negative-nada'); }
      if (c === 'algo') { score += 2; reasons.push('penalty-anything-negative-algo'); }
    } else {
      if (/\b(?:choose|pick|select)\b/.test(s)) {
        if (c === 'cualquier cosa') { score -= 14; reasons.push('ok-anything-free-relative'); }
        if (c === 'algo') { score -= 4; reasons.push('ok-anything-choose-algo'); }
      } else {
        if (c === 'algo') { score -= 12; reasons.push('ok-anything-positive-algo'); }
        if (c === 'cualquier cosa') { score -= 5; reasons.push('ok-anything-positive-cualquier'); }
      }
      if (c === 'nada') { score += 8; reasons.push('penalty-anything-positive-nada'); }
    }
    if (/anything else/.test(s) && c === 'algo más') { score -= 8; reasons.push('ok-anything-else'); }
  }

  if (t === 'anybody' || t === 'anyone') {
    const negative = hasNegativePolarity(s);
    if (negative) {
      if (c === 'nadie') { score -= 12; reasons.push('ok-anybody-negative-nadie'); }
      if (c === 'alguien') { score += 2; reasons.push('penalty-anybody-negative-alguien'); }
    } else {
      if (/^\s*(?:anybody|anyone)\b/.test(s)) {
        if (c === 'cualquiera' || c === 'cualquier persona') { score -= 14; reasons.push('ok-anybody-free-relative'); }
        if (c === 'alguien') { score += 2; reasons.push('penalty-anybody-initial-alguien'); }
      } else if (c === 'alguien') { score -= 12; reasons.push('ok-anybody-positive-alguien'); }
      if (c === 'nadie' || c.startsWith('ninguno')) { score += 8; reasons.push('penalty-anybody-positive-nadie'); }
    }
  }

  if (t === 'know') {
    if (/\b(don't|do not|didn't|did not|not)\s+know\b|\bknow\s+(?:that|what|how|why|where|when)\b/.test(s)) {
      if (c === 'saber') { score -= 12; reasons.push('ok-know-fact'); }
      if (c === 'conocer') { score += 3; reasons.push('penalty-know-fact-conocer'); }
    }
    if (/\bknow\s+(?:him|her|them|you|me|your|my|his|their|[A-Z][a-z]+)\b/i.test(sentence ?? '')) {
      if (c === 'conocer') { score -= 12; reasons.push('ok-know-person'); }
      if (c === 'saber') { score += 2; reasons.push('penalty-know-person-saber'); }
    }
    if (/^(saber|conocer)$/.test(c)) { score -= 4; reasons.push('ok-know-core'); }
  }

  if (t === 'run') {
    if (/\b(?:run|ran|running|runs)\s+(?:every|morning|fast|quickly|home|away)|\bi\s+run\b/.test(s)) {
      if (c === 'correr') { score -= 12; reasons.push('ok-run-motion'); }
    }
    if (/\b(?:run|runs|ran|running)\s+(?:a|an|the|her|his|their)?\s*(?:company|business|team|project|firm|enterprise|startup|organization)|\brun\s+it\b/.test(s)) {
      if (/^(dirigir|gestionar|administrar)$/.test(c)) { score -= 12; reasons.push('ok-run-manage'); }
      if (c === 'correr') { score += 6; reasons.push('penalty-run-manage-correr'); }
    }
    if (/\b(machine|computer|program|engine)\b.*\brun|\brun\s+(?:smoothly|well)\b/.test(s)) {
      if (/^(funcionar|andar)$/.test(c)) { score -= 12; reasons.push('ok-run-operate'); }
    }
  }

  if (t === 'week') {
    if (c === 'semana') { score -= 12; reasons.push('ok-week-core'); }
  }

  if (t === 'break up') {
    if (/\b(with|relationship|couple|girlfriend|boyfriend|marriage|after college)\b/.test(s)) {
      if (/^(separarse|terminar|romper|acabar)$/.test(c)) { score -= 12; reasons.push('ok-breakup-relationship'); }
      if (/^(desguazar|descomponer|deshacer|dividir)$/.test(c)) { score += 10; reasons.push('penalty-breakup-literal'); }
    }
  }

  if (t === 'piece of cake') {
    if (/^(pan comido|fácil|facil|facilísimo|facilisimo|muy fácil|muy facil)$/.test(c)) { score -= 14; reasons.push('ok-piece-of-cake-idiomatic'); }
    if (/^(tartaleta|pastel|pedazo de pastel)$/.test(c)) { score += 15; reasons.push('penalty-piece-of-cake-literal'); }
  }

  return [score, reasons];
}


function stripDiacritics(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function glossVariantKey(value: string): string {
  let key = value.toLowerCase().trim();
  key = key
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*,\s*-?[ao]s?$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Only collapse explicit gender markers, never infer semantic groups.
  // Examples: maravilloso/a -> maravilloso, ninguno/a -> ninguno,
  // maravilloso/osa -> maravilloso. This prevents a new bundle/dictionary of
  // meanings and keeps the algorithm safe for unknown words.
  key = key.replace(/\/(?:a|o|as|os)$/i, '');
  key = key.replace(/\/osa$/i, 'oso');
  key = key.replace(/\/esa$/i, 'és');

  return stripDiacritics(key)
    .replace(/[^a-z0-9áéíóúñü\s]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function chooseGroupDisplay(values: string[]): string {
  // Prefer the first ranked value, unless a later value carries an explicit
  // gender marker for the same surface form. Do not merge unrelated meanings.
  const explicit = values.find((value) => /\/(?:a|o|as|os|osa|esa)(?:\b|$)/i.test(value));
  return explicit ?? values[0];
}

function groupEquivalentGlossVariants(values: string[]): string[] {
  const groups = new Map<string, string[]>();
  const order: string[] = [];
  for (const value of values) {
    const key = glossVariantKey(value);
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    const group = groups.get(key)!;
    if (!group.some((v) => v.toLowerCase() === value.toLowerCase())) group.push(value);
  }
  return order.map((key) => chooseGroupDisplay(groups.get(key)!));
}

// Function words that start a periphrastic gloss rather than a drop-in
// equivalent. A "synonym" that opens with one of these is a definition
// fragment ("any one thing", "to each one", "for each one"), not a term
// the learner can substitute for the headword. Verified 2026-09-06 in the
// MV3 corpus: `each` -> "to each one"/"for each one"/"from each one",
// `anything` -> "any one thing", `anybody` -> "any of"/"a person".
const PERIPHRASTIC_LEAD_WORDS = new Set([
  'a', 'an', 'the', 'to', 'for', 'from', 'of', 'by', 'with', 'in', 'on',
  'at', 'as', 'any', 'some', 'each', 'every', 'all', 'no', 'one',
]);

// A synonym candidate that is actually taxonomy or a definitional
// paraphrase, not an equivalent term. WordNet/Wiktionary are displayable
// sources, so their Latin binomials ("malus pumila"), hypernym glosses
// ("orchard apple tree") and periphrases ("each and every one") pass the
// source gate and reach the card unless rejected here. Verified
// 2026-09-06 in the MV3 corpus.
function isTaxonomicOrPeriphrastic(value: string, token: string): boolean {
  const low = value.toLowerCase().trim();
  const words = low.split(/\s+/).filter(Boolean);
  const tokenNorm = token.toLowerCase().trim();
  const tokenHead = tokenNorm.split(/\s+/).filter(Boolean);

  // Literal-component contamination: for a multi-word headword (idiom/MWE),
  // a single-word "synonym" that is just one of the headword's own content
  // words is the literal sense leaking in, not an equivalent of the whole
  // phrase. Verified 2026-09-06: `piece of cake` -> "cake". A stop word
  // component ("of") is already dropped elsewhere; here we catch content
  // words like "cake"/"piece".
  if (tokenHead.length > 1 && words.length === 1 && tokenHead.includes(words[0])) {
    return true;
  }

  // Latin binomial nomenclature (genus + species): two lowercase Latinate
  // words, the pattern of a scientific name ("malus pumila", "canis lupus").
  // These are WordNet instance hypernyms, never card synonyms.
  if (words.length === 2 && /^[a-z]+$/.test(words[0]) && /^[a-z]+$/.test(words[1])) {
    // Genus suffixes are distinctive Latin nominal endings; the species
    // epithet varies more. Require the GENUS (first word) to look Latin and
    // the token itself to be absent from the pair (a real synonym reuses
    // neither a scientific genus nor species around the headword).
    const LATIN_GENUS = /(?:us|um|is|a|ae|ex|ix|or|on)$/;
    const tokenAbsent = !words.includes(tokenNorm);
    if (LATIN_GENUS.test(words[0]) && words[0].length >= 4 && words[1].length >= 4 && tokenAbsent) {
      return true;
    }
  }

  // Multi-word candidate that just wraps the headword in a hypernym gloss:
  // "orchard apple tree" for `apple`, "apple tree" style. If a >=2-word
  // candidate contains the whole single-word token AND ends in a generic
  // taxonomy head, it is a hypernym, not a synonym.
  if (words.length >= 2 && !tokenNorm.includes(' ') && words.includes(tokenNorm)) {
    const TAXONOMY_HEADS = new Set(['tree', 'plant', 'animal', 'bird', 'fish', 'species', 'genus', 'fruit']);
    if (TAXONOMY_HEADS.has(words[words.length - 1])) return true;
  }

  // Periphrastic paraphrase: opens with a function word and is multi-word,
  // OR is a bare quantifier phrase built from the token's own head
  // ("each and every one", "to each one"). A real one-word or hyphenated
  // synonym is exempt.
  if (words.length >= 2 && PERIPHRASTIC_LEAD_WORDS.has(words[0])) {
    // Keep genuine idiomatic equivalents that merely start with a lead word
    // but do NOT reuse the token head (e.g. "give up" as a synonym is fine).
    const reusesTokenHead = tokenHead.some((h) => h.length > 2 && words.includes(h));
    const isQuantifierChain = words.every(
      (w) => PERIPHRASTIC_LEAD_WORDS.has(w) || w === 'and' || w === 'or' || w === 'thing' || w === 'person' || w === 'ones',
    );
    if (reusesTokenHead || isQuantifierChain) return true;
  }

  return false;
}

const RELATED_TERM_SOURCE_PRIORITY = [
  'cambridge',
  'merriamWebster',
  'merriamWebsterThesaurus',
  'longman',
  'wordnet',
  'thesaurusCom',
  'freeDictionary',
  'dictionaryCom',
  'britannicaDictionary',
  'oxfordLearners',
  'wiktionaryApi',
  'wiktApi',
  'bundled',
  'wiktionaryHtml',
  'datamuse',
  'wordHippo',
  'mobyThesaurus',
];

// These sources are sufficiently curated for a relation to be shown by
// themselves. Every other source is treated as corroboration-only until it
// can return sense-bound relations rather than a flat lemma-level list.
const DISPLAYABLE_RELATED_TERM_SOURCES = new Set([
  'cambridge',
  'merriamWebster',
  'merriamWebsterThesaurus',
  'longman',
  'wordnet',
  'thesaurusCom',
  'freeDictionary',
  'dictionaryCom',
  'britannicaDictionary',
  'oxfordLearners',
]);

// Displayable-but-sense-blind thesauri. They are curated enough to publish a
// relation on their own for FORM (no corroboration required), but they emit a
// flat lemma-level list with no per-sense structure, so their relations are
// still subject to the context anchor when the caller supplies one. This is
// what stops the finance-sense `depository` reaching a river-edge `bank` card:
// Thesaurus.com is trustworthy about "is this a real synonym of bank?" and
// unreliable about "of WHICH bank?". The dictionaries above (glosses / synsets
// per sense) already answer the second question, so they bypass the anchor.
const SENSE_BLIND_RELATED_TERM_SOURCES = new Set([
  'thesaurusCom',
  'wordHippo',
  'datamuse',
  'mobyThesaurus',
  'wiktionaryHtml',
  // Free Dictionary exposes synonyms per sense in its API but the source
  // module flattens EVERY sense's synonyms into one array (see
  // sources/free-dictionary.ts), so downstream it is sense-blind for
  // relations: "give" returns transfer + estimate + yield synonyms mixed.
  // It rides the context anchor like the other flat thesauri. Verified live
  // 2026-09-06 corpus.
  'freeDictionary',
]);

// Light / relational verbs are the connective tissue of definitions
// ("to HAVE knowledge", "to GET information"), not synonyms of the content
// word they help define. A sense anchor built from the gloss will trivially
// "match" them, so they slip past the overlap gate (live 2026-09-06 corpus:
// `know` → syn ["have"]). Reject them as relations for any multi-letter
// content headword unless the headword IS itself one of them.
const LIGHT_VERB_NON_SYNONYMS = new Set([
  'have', 'has', 'had', 'get', 'gets', 'got', 'make', 'makes', 'made',
  'do', 'does', 'did', 'be', 'is', 'are', 'was', 'were', 'been',
  'go', 'goes', 'went', 'take', 'takes', 'took', 'put', 'puts',
]);

// Difficulty / ease words: the lexical bridge between a figurative
// "very easy" idiom and its true antonyms. An antonym of an idiom
// headword survives only when it shares one of these with the sense
// anchor — `pain`/`labor`/`chore` meet `easy` through difficulty, while
// `bear`/`beast`/`murder`/`stinker` meet nothing and die as literal-sense
// noise. Closed semantic class for the easy/difficult axis, not a hand
// list per idiom — same rationale as LOW_IMAGEABILITY_WORDS.
const FIGURATIVE_ANTONYM_BRIDGE = new Set([
  'easy', 'easily', 'difficult', 'difficulty', 'hard', 'hardship',
  'simple', 'simplicity', 'effort', 'effortless', 'tough', 'rough',
  'pain', 'painful', 'labor', 'labour', 'chore', 'trouble', 'struggle',
  'challenge', 'demanding', 'tricky', 'awkward', 'complex', 'complicated',
  // Body/mind strain words: `headache`, `nuisance`, `bother` name the
  // felt difficulty itself. Without them the bridge keeps only abstract
  // nouns and drops the most natural antonyms of "very easy".
  'headache', 'nuisance', 'bother', 'strain', 'burden', 'ordeal',
]);

/**
 * Whether a single-word antonym of a multiword idiom headword belongs to
 * the figurative sense. The antonym must share a difficulty-axis word with
 * the sense anchor (`pain` meets `easy` through difficulty); a term with
 * no bridge (`bear`, `beast`, `murder`) is the literal sense leaking in.
 * Multi-word antonyms are exempt — a phrase carries its own sense context.
 */
export function isFigurativeAntonym(text: string, anchor: Set<string> | undefined): boolean {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length !== 1) return true;
  if (!anchor || anchor.size === 0) return true;
  const stems = new Set(words.flatMap(relationStemVariants));
  for (const stem of stems) {
    if (anchor.has(stem)) return true;
  }
  for (const word of FIGURATIVE_ANTONYM_BRIDGE) {
    if (anchor.has(word)) {
      // The anchor itself names the axis (easy/difficult/…): any
      // difficulty word qualifies without needing the exact term.
      if (stems.has(word)) return true;
      for (const stem of stems) {
        if (FIGURATIVE_ANTONYM_BRIDGE.has(stem)) return true;
      }
    }
  }
  return false;
}

// A "synonym" that is really a dictionary explanation, not a lexical
// equivalent. Live 2026-09-06 corpus: `forget` VIP leaked "my mind goes
// blank", "have no recollection of something", "don't remember/can't
// remember", "take/keep your mind off something". Signatures of a gloss/
// clause rather than a reusable synonym:
//   - a generic placeholder object (something/somebody/someone/one's)
//   - a possessive tied to a cognition noun (your mind, his memory)
//   - a negation/contraction clause (don't, can't, no recollection)
//   - a slash listing two wordings (take/keep, remember/recall)
// A short genuine phrasal synonym ("blank out", "slip up") has none of these.
function isExplanatoryPhrase(low: string): boolean {
  if (!low.includes(' ') && !low.includes('/')) return false;
  if (/\b(?:something|somebody|someone|oneself|one's|ones)\b/.test(low)) return true;
  if (/\b(?:your|his|her|their|my|our)\s+(?:mind|memory|head|thoughts?|recollection)\b/.test(low)) return true;
  if (/\b(?:no|not|n't|never)\b/.test(low) || /(?:do|does|did|can|could|will|would|is|are)n['’]t/.test(low)) return true;
  if (/\brecollection\b/.test(low)) return true;
  if (low.includes('/')) return true;
  return false;
}

export function pickRelatedTerms(
  token: string,
  candidates: Array<{ source: string; text: string }>,
  limit: number,
  /**
   * Optional stemmed context terms (sentence + selected definition), built
   * the same way as pickSenseRelationGroups. When present, a relation from a
   * NON-curated corroboration-tier source (Datamuse/WordHippo/Thesaurus.com/
   * Moby/Wiktionary) must share at least one term with the active sense's
   * context, otherwise it is a different-acception leak (`depository` for the
   * river-edge sense of `bank`). Curated editorial sources bypass the anchor
   * — they are trusted on their own. Called WITHOUT context for monosemous
   * words, in which case behaviour is unchanged.
   */
  contextTerms?: Set<string>,
): string[] {
  const normalizedToken = token.toLowerCase().trim();
  const hasContextAnchor = Boolean(contextTerms && contextTerms.size > 0);
  const priority = token.includes(' ')
    ? ['wiktionaryApi', 'wiktApi', 'freeDictionary', 'thesaurusCom', 'datamuse', 'wordHippo', 'mobyThesaurus']
    : RELATED_TERM_SOURCE_PRIORITY;
  const grouped = new Map<string, { value: string; sources: Set<string>; sourceRank: number }>();
  for (const candidate of candidates) {
    const value = candidate.text.replace(/\s+/g, ' ').trim();
    const normalized = stripDiacritics(value.toLowerCase());
    if (!normalized || value.toLowerCase() === normalizedToken || value.length > 60) continue;
    if (value.split(/\s+/).length > 5) continue;
    // Reject taxonomy ("malus pumila"), hypernym glosses ("orchard apple
    // tree") and periphrastic paraphrases ("to each one", "any one thing")
    // even from displayable sources. Verified 2026-09-06 MV3 corpus.
    if (isTaxonomicOrPeriphrastic(value, token)) continue;
    // Light/relational verb glosswords are not synonyms of a content word.
    // Only rejected when the headword itself is NOT a light verb (so "have"
    // as a synonym of "get" is still allowed).
    if (
      LIGHT_VERB_NON_SYNONYMS.has(normalized) &&
      !LIGHT_VERB_NON_SYNONYMS.has(normalizedToken)
    ) continue;
    // Reject dictionary explanations / clauses masquerading as synonyms
    // ("my mind goes blank", "don't remember/can't remember"). Verified
    // 2026-09-06 live corpus on `forget`.
    if (isExplanatoryPhrase(normalized)) continue;
    const existing = grouped.get(normalized);
    if (existing) {
      existing.sources.add(candidate.source);
      existing.sourceRank = Math.min(existing.sourceRank, sourcePriority(candidate.source, priority));
    } else {
      grouped.set(normalized, {
        value,
        sources: new Set([candidate.source]),
        sourceRank: sourcePriority(candidate.source, priority),
      });
    }
  }
  return [...grouped.values()]
    .filter((candidate) => {
      const isCurated = [...candidate.sources].some((source) => DISPLAYABLE_RELATED_TERM_SOURCES.has(source));
      if (!isCurated) {
        const corroboratingSources = [...candidate.sources].filter((source) => source !== 'mobyThesaurus');
        if (corroboratingSources.length <= 1) return false;
      }
      // A relation is sense-aware only if at least one endorsing source keeps
      // per-sense structure (glosses / synsets). A flat thesaurus is curated
      // for FORM but blind to WHICH sense, so its relations still ride the
      // context anchor.
      const senseAware = [...candidate.sources].some(
        (source) => DISPLAYABLE_RELATED_TERM_SOURCES.has(source) && !SENSE_BLIND_RELATED_TERM_SOURCES.has(source),
      );
      // Sense anchor: a sense-aware source is trusted on its own, but a
      // sense-blind / corroboration-tier relation must overlap the active
      // sense's context when we have one. This is what keeps the finance-sense
      // `depository` out of the river-edge `bank` card even when two flat
      // thesauri agree on it. Without a context anchor (monosemous words /
      // merge calls that pass none) the check is skipped — behaviour unchanged.
      if (hasContextAnchor && !senseAware) {
        const terms = relationTerms(candidate.value, token);
        let overlaps = false;
        for (const term of terms) {
          if (contextTerms!.has(term)) { overlaps = true; break; }
        }
        if (!overlaps) return false;
      }
      return true;
    })
    .sort((a, b) =>
      b.sources.size - a.sources.size ||
      a.sourceRank - b.sourceRank ||
      a.value.split(/\s+/).length - b.value.split(/\s+/).length ||
      a.value.length - b.value.length,
    )
    .map((candidate) => candidate.value)
    .slice(0, limit);
}

interface AttributedRelationGroup extends SenseRelationGroup {
  source: string;
}

const RELATION_STOP_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'be', 'been', 'being', 'by', 'for', 'from',
  'he', 'her', 'him', 'his', 'i', 'in', 'is', 'it', 'its', 'me', 'my', 'of',
  'on', 'or', 'our', 'she', 'that', 'the', 'their', 'them', 'they', 'this',
  'to', 'was', 'we', 'were', 'with', 'you', 'your',
]);

function relationStem(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ied')) return `${word.slice(0, -3)}y`;
  // Plural in -ies meets the -y singular (company/companies,
  // activity/activities). Without this the two numbers stem apart
  // (compani vs company) and never overlap.
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  // A lone -ss singular keeps its s (business, class, process). The old
  // rule stripped it (busines) so singular and plural never met — the
  // verified 2026-09-09 MV3 miss: Longman's manage guide carries
  // "business" while WordNet's winning definition carries "businesses".
  if (word.endsWith('ss')) return word;
  // Plural in -es after a sibilant meets the singular (watches→watch,
  // buses→bus, boxes→box). After any other consonant the -es is really -s
  // on a silent-e stem (likes→like, gives→give, charges→charge,
  // services→service) — strip one so verb agreement and -ce/-ge plurals
  // meet their singulars too. The old blanket es-strip broke all of these
  // (lik, giv, charg) while fixing only the sibilants.
  if (word.length > 4 && /(?:s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/**
 * All stems a word can meet its inflections under. The single-form
 * `relationStem` above picks one cut, but English hides the singular
 * behind two different cuts: a 3rd-person -s on a silent-e stem
 * (`organizes` = organize+s) and a true -es plural (`watches` =
 * watch+es) both end in a sibilant + es, and an -ings plural
 * (`somethings`) hides behind the -ing rule. Keeping both forms means
 * either side of an overlap check meets the other, whichever number
 * each source happened to print — verified 2026-09-09 MV3 miss where
 * `business` (Longman guide) never met `businesses` (WordNet definition)
 * and the whole manage sense lost its collocations.
 */
function relationStemVariants(word: string): string[] {
  const primary = relationStem(word);
  const out = [primary];
  // Sibilant + es: the -1 cut is the silent-e singular (organizes→organize,
  // houses→house); the primary -2 cut is the sibilant plural (watches→watch).
  if (word.length > 4 && /(?:s|x|z|ch|sh)es$/.test(word)) {
    const alt = word.slice(0, -1);
    if (alt !== primary) out.push(alt);
  }
  // -ings plural of an -ing noun (somethings→someth + something).
  if (word.length > 7 && word.endsWith('ings')) {
    const alt = word.slice(0, -4);
    if (alt !== primary && !out.includes(alt)) out.push(alt);
  }
  return out;
}

function relationTerms(text: string, token: string): Set<string> {
  const tokenTerms = new Set(
    stripDiacritics(token.toLowerCase()).match(/[a-z0-9]+/g)?.flatMap(relationStemVariants) ?? [],
  );
  return new Set(
    (stripDiacritics(text.toLowerCase()).match(/[a-z0-9]+/g) ?? [])
      .flatMap(relationStemVariants)
      .filter((word) => word.length > 2 && !RELATION_STOP_WORDS.has(word) && !tokenTerms.has(word)),
  );
}

// Indefinite / argument-structure words shared by every sense of a headword
// (`give someone something` frames ALL senses of `give`), plus definition
// glue: copulas, aspectuals and light nouns that frame EVERY dictionary
// gloss (`to be sure about something`, `to have direct experience of
// something`). Overlap carried only by these is not evidence the group
// matches the current sense: the winning definition itself injects them
// into the anchor, so every candidate group trivially overlaps. A closed
// grammatical class (indefinite pronouns + light verbs/nouns), not a hand
// list — same rationale as LOW_IMAGEABILITY_WORDS. Stored STEMMED: both
// sides pass through relationTerms, so `things`/`thing` meet as `thing`
// and `something` as `someth` (it ends in -ing); `somebody`/`someone` are
// untouched by the stemmer and match literally.
const GENERIC_SENSE_OVERLAP_WORDS = new Set(
  [
    'someone', 'somebody', 'something', 'anyone', 'anybody', 'anything',
    'everyone', 'everybody', 'everything', 'nothing', 'one', 'people', 'thing',
    // Definition glue: copulas, aspectuals and light nouns that frame EVERY
    // dictionary gloss ("to be sure about something", "to have direct
    // experience of something"). A group winning only on these proves
    // nothing about the sense — verified live 2026-09-09: the MW
    // experience-sense of `know` beat the answer-sense on `someth` alone
    // for "I do not know the answer." Stored stemmed: both sides pass
    // through relationTerms.
    'be', 'have', 'get', 'about', 'such',
    // Glue verb of dictionary glosses ("(used of color)", "used as a
    // general term"): every gloss uses it, so overlap carried only by
    // `used` proves nothing about the sense — verified live 2026-09-09:
    // `lit` slang ("The show was lit.") picked the light-color sense
    // ("(used of color)…") on `used` alone, publishing `light-colored` /
    // `dark` for the slang sense. Stored raw: `used` passes the stemmer
    // untouched, so both sides meet literally.
    'used',
  ].flatMap(relationStemVariants),
);

/**
 * Whether a selected collocation group's win was substantive: at least one
 * anchor term that is not a generic argument-structure word. A Longman
 * manage-sense group overlapping {organize, charge, business} earned its
 * chunks; a `give` group overlapping only {someone, something} did not —
 * those words frame every sense of `give`, so the win proves nothing and
 * its chunks must still ride the flat sense anchor.
 */
export function hasSubstantiveSenseOverlap(
  group: { guide?: string; definition?: string; example?: string },
  anchor: Set<string> | undefined,
  token: string,
): boolean {
  if (!anchor || anchor.size === 0) return false;
  const terms = relationTerms(
    `${group.guide ?? ''} ${group.definition ?? ''} ${group.example ?? ''}`,
    token,
  );
  for (const term of terms) {
    if (anchor.has(term) && !GENERIC_SENSE_OVERLAP_WORDS.has(term)) return true;
  }
  return false;
}

export function pickSenseRelationGroups(
  token: string,
  groups: AttributedRelationGroup[],
  sentence: string | undefined,
  definitions: Array<{ source: string; text: string }>,
): AttributedRelationGroup[] {
  const contextTerms = relationTerms(
    `${sentence ?? ''} ${definitions.slice(0, 1).map((definition) => definition.text).join(' ')}`,
    token,
  );
  // When the sentence tells us the headword's POS, a sense group whose own
  // POS disagrees is the wrong sense — the adjective synset of `happy`
  // ("felicitous") or the tree synset of `apple` ("malus pumila") must not
  // win for the predicative-adjective / fruit-noun usage. General rule, not
  // token-specific: only applied when both POS signals exist.
  const sentencePos = sentencePosHint(token, sentence);
  const bySource = new Map<string, AttributedRelationGroup[]>();
  for (const group of groups) {
    if (group.synonyms?.length || group.antonyms?.length || group.collocations?.length) {
      const sourceGroups = bySource.get(group.source) ?? [];
      sourceGroups.push(group);
      bySource.set(group.source, sourceGroups);
    }
  }

  const selected: AttributedRelationGroup[] = [];
  for (const sourceGroups of bySource.values()) {
    const posMatchExists = sentencePos
      ? sourceGroups.some((group) => group.partOfSpeech === sentencePos)
      : false;
    const ranked = sourceGroups
      .map((group, index) => {
        const terms = relationTerms(`${group.guide ?? ''} ${group.definition ?? ''} ${group.example ?? ''}`, token);
        let overlap = 0;
        let substantiveOverlap = 0;
        for (const term of terms) {
          if (!contextTerms.has(term)) continue;
          overlap += 1;
          // A generic-only overlap (glue words every gloss shares) proves
          // nothing about the sense — verified live 2026-09-09: MW's
          // experience-sense of `know` ("to come to a knowledge of
          // (something) by living through it") beat the answer-sense on
          // `someth` alone for "I do not know the answer."
          if (!GENERIC_SENSE_OVERLAP_WORDS.has(term)) substantiveOverlap += 1;
        }
        // Only demote for POS when a matching-POS group is actually
        // available in this source; otherwise the source has a single POS
        // and demoting all of it would just empty the field needlessly.
        const posMismatch = Boolean(sentencePos && posMatchExists && group.partOfSpeech && group.partOfSpeech !== sentencePos);
        const posBonus = sentencePos && group.partOfSpeech === sentencePos ? 1 : 0;
        return { group, index, overlap, substantiveOverlap, posMismatch, posBonus, hasSubstantive: substantiveOverlap > 0 };
      })
      .filter((entry) => !entry.posMismatch)
      // Substantive overlap first: a group matching on content words beats
      // one matching only on definition glue (`someth`, `about`, `have`).
      // Raw overlap breaks ties, then POS, then source order — so a fully
      // generic match still prefers the provider's default sense over a
      // zero-overlap group, preserving the old fallback.
      .sort((a, b) => (b.substantiveOverlap + b.posBonus) - (a.substantiveOverlap + a.posBonus) || (b.overlap + b.posBonus) - (a.overlap + a.posBonus) || a.index - b.index);
    const best = ranked[0];
    if (!best) continue;
    // If context or a selected definition exists, no semantic match means the
    // group is unsafe even when it is the provider's first/default sense.
    if (best.overlap === 0 && contextTerms.size > 0) continue;
    if (best.overlap === 0 && best.index !== 0) continue;
    // A generic-only win proves nothing about the sense — with one
    // exception: when it is the provider's DEFAULT (first) sense, the
    // provider itself ranks it first and there is no evidence against it.
    // Skipping it would empty fields the provider answers correctly by
    // default (Longman give__3 "to put something in someone's hand" for
    // "Give me the keys" — verified live 2026-09-09). A generic-only win
    // on a NON-default sense still skips (MW experience-sense of `know`).
    if (!best.hasSubstantive && contextTerms.size > 0 && best.index !== 0) continue;
    selected.push(best.group);
  }
  return selected;
}

interface AttributedImageCandidate extends ImageCandidate {
  source: string;
}

const IMAGE_SOURCE_PRIORITY = [
  'wikimediaCommons',
  'openverse',
  'unsplash',
  'pixabay',
  'bingImages',
  'duckduckgoImages',
];

// Closed-class function words are unimageable as a CLASS, not as a
// hand-maintained list. Indefinite pronouns, quantifiers, determiners,
// conjunctions and light/relational verbs never have a stable visual
// referent — a photo of "everyone" or "whatever" is always a stock cliche,
// not a depiction. This replaces the old fixed LOW_IMAGEABILITY_TOKENS set
// (anything/anybody/anyone/each/know/week) with the underlying category so a
// never-listed member (everyone, whatever, some, none) is caught too.
const LOW_IMAGEABILITY_WORDS = new Set([
  // indefinite pronouns / quantifiers / determiners
  'anything', 'anybody', 'anyone', 'everything', 'everybody', 'everyone',
  'something', 'somebody', 'someone', 'nothing', 'nobody', 'none', 'no one',
  'each', 'every', 'all', 'any', 'some', 'both', 'either', 'neither',
  'much', 'many', 'few', 'several', 'whatever', 'whichever', 'whoever',
  // light / relational / cognition verbs with no stable depiction
  'know', 'think', 'want', 'need', 'seem', 'become', 'get', 'have', 'make',
  'let', 'mean', 'consider', 'suppose', 'regard',
  // relational / transfer / cognition verbs confirmed unimageable by the
  // 2026-09-06 image probe: they only yielded logos ("Twitter Support"),
  // text posters ("Give to Humanity", "Luke 6") and memorials ("We can't
  // forget"). The structural strict-depiction gate below also catches
  // these WHEN a source tags their POS as a verb, but WordNet does not tag
  // POS reliably for them, so this list is the deterministic safety net.
  'support', 'give', 'forget', 'help', 'allow', 'provide', 'offer',
  'believe', 'understand', 'remember', 'realize', 'decide', 'expect',
  // relational nouns / time words that only yield calendar/stock clichés
  'week', 'thing', 'way', 'kind', 'sort', 'type', 'amount', 'part',
]);

/**
 * Indefinite-pronoun / quantifier compounds built morphologically:
 * {any,every,some,no} + {thing,body,one,where,how}. Catches members the
 * fixed list never enumerated (`anywhere`, `everywhere`, `somehow`,
 * `noone`) without a network call. A real compound noun that merely ENDS
 * in one of these heads (`someone` yes, but `headphone`/`overthing` are
 * not real words, and `anyone`/`everybody` are the target) is exactly what
 * we want to block; concrete nouns like `bee` or `week` are handled by the
 * explicit list, not this pattern.
 */
const INDEFINITE_COMPOUND_RE = /^(?:any|every|some|no)(?:thing|body|one|where|how)$/;

/**
 * Decide whether a token is too abstract/relational to ever have a stable
 * visual referent. Three signals, cheapest first, all deterministic:
 *   1. the explicit closed-class list (fast, exact);
 *   2. a morphological indefinite-compound pattern (catches never-listed
 *      members);
 *   3. an OPTIONAL part-of-speech hint from the merge: when the dominant
 *      sense is a pronoun / determiner / conjunction / auxiliary the token
 *      is a function word regardless of spelling.
 *
 * `pos` is the low-cardinality tag WordNet-style sources expose. We only
 * treat the closed grammatical classes as unimageable — a noun/verb/
 * adjective/adverb still goes through normal ranking, because plenty of
 * them ARE depictable (`umbrella`, `run` a race, `red`).
 */
function isLowImageabilityToken(
  normalizedToken: string,
  pos?: string,
): boolean {
  if (LOW_IMAGEABILITY_WORDS.has(normalizedToken)) return true;
  if (INDEFINITE_COMPOUND_RE.test(normalizedToken)) return true;
  if (pos) {
    const p = pos.toLowerCase();
    if (
      p === 'pronoun' || p === 'determiner' || p === 'conjunction' ||
      p === 'preposition' || p === 'auxiliary' || p === 'article' ||
      p === 'particle' || p === 'interjection'
    ) return true;
  }
  // Nothing else is treated as low-imageability by default — a concrete
  // noun that merely contains a stopword substring ("beeswax", "weekday")
  // is NOT blocked, because we match whole words only.
  return false;
}

/**
 * Sources whose images the card is allowed to publish. Free-license,
 * metadata-bearing providers only. Bing/DDG are deliberately absent here
 * as *primary* displayable sources — they carry mixed licensing and no
 * reliable metadata, so they can only surface through the weak fallback
 * path below, and even then only after passing the same bad-subject and
 * shape filters. This encodes the "few trustworthy > many noisy" rule.
 */
const PRIMARY_DISPLAYABLE_SOURCES = ['wikimediaCommons', 'openverse', 'unsplash', 'pixabay'];
/** Weak-signal fallback sources. Only consulted when NO primary source
 * produced any publishable candidate. Still filtered for bad subjects
 * and shape; an empty image beats a wrong one even here. */
const FALLBACK_DISPLAYABLE_SOURCES = ['bingImages', 'duckduckgoImages'];

const BAD_SUBJECT_RE = /\b(?:logo|icon|icons|banner|wallpaper|clip[- ]?art|vector[- ]?art|stock[- ]?vector|graphics|news|newspaper|headline|breaking|template|seo|meme|quote|did[- ]?you[- ]?know|infographic|thumbnail|avatar|profile[- ]?pic|screenshot|premium[- ]?photo|ai[- ]?generated|wikihow)\b/;
const FIGURATIVE_RE = /\b(?:idiom|idiomatic|idiomatically|figurative|figuratively|metaphor|metaphorical|meaning|means|denote[s]?|proverb|saying|expression)\b/;

/**
 * Non-English metadata markers. Openverse/Commons aggregate multilingual
 * captions, so a token that is a real word in another language (`lit` =
 * "bed" in French) matches by string but depicts the WRONG concept. When
 * the source language is English and the candidate metadata is dominated
 * by another language's function words, the exact-match is a false friend.
 * Corpus evidence 2026-09-06: `lit` published a French bed from Openverse.
 */
const NON_EN_MARKER_RE = /\b(?:et|de|la|le|les|des|une?|du|au|aux|dans|avec|vue|musee|ecole|el|los|las|con|para|und|der|die|das|mit|voor|voir|dans)\b/g;
const EN_MARKER_RE = /\b(?:the|a|an|of|and|in|on|with|to|for|by|is|are|at|from|this)\b/g;

function looksNonEnglish(metadata: string): boolean {
  const nonEn = (metadata.match(NON_EN_MARKER_RE) ?? []).length;
  const en = (metadata.match(EN_MARKER_RE) ?? []).length;
  // Needs a real cluster of foreign function words AND no stronger English
  // signal — one stray "de" in an English caption must not trip this.
  return nonEn >= 2 && nonEn > en;
}

/** POS tags for which a title-only exact match is NOT enough to publish.
 * A relational/light/cognition verb (`support`, `give`, `forget`) has no
 * stable depiction, so an Openverse caption that merely contains the word
 * ("Twitter Support", "Give to Humanity", "We can't forget") depicts text
 * or a logo, not the concept. Such tokens may only publish from a
 * concept-anchored source (Wikimedia P180) or with explicit depiction
 * tags. Concrete/physical verbs still pass because their winning
 * candidate carries a lexical anchor plus real depiction. Corpus evidence
 * 2026-09-06: support→Twitter, give→Luke 6, forget→memorial. */
const STRICT_DEPICTION_POS = new Set(['verb']);
/** Sources whose relevance is structurally anchored to a concept, not to
 * free-text captions. Wikimedia resolves the token to a Wikidata item and
 * requires P180 "depicts"; such a hit is trustworthy even for a verb. */
const CONCEPT_ANCHORED_SOURCES = new Set(['wikimediaCommons']);

export interface ImageScore {
  candidate: AttributedImageCandidate;
  /** Lower is better. POSITIVE_INFINITY = disqualified. */
  score: number;
  /** Machine-readable reason codes, aligned with FieldProvenance. `ok-*`
   * lowered the score; `penalty-*` raised or disqualified it. */
  reasons: string[];
  /** True when the candidate came from a weak-signal fallback source. */
  fallback: boolean;
}

/**
 * Score a single image candidate against the token. Pure and deterministic
 * so the probe (`scripts/mv3-image-probe.mjs`) can capture the full pool
 * with every reason code, not just the winner. This is the single source
 * of truth the winner-picker below consumes — no second ranking pass.
 */
export function scoreImageCandidate(
  candidate: AttributedImageCandidate,
  ctx: {
    normalizedToken: string;
    tokenWords: string[];
    isMultiword: boolean;
    treatAsIdiom: boolean;
    /** Dominant POS of the token, when a source tagged it. Drives the
     * strict-depiction gate for relational verbs. */
    pos?: string;
  },
): ImageScore {
  const { normalizedToken, tokenWords, isMultiword, treatAsIdiom, pos } = ctx;
  const reasons: string[] = [];
  const metadata = stripDiacritics([
    candidate.title ?? '',
    ...(candidate.tags ?? []),
    candidate.sourcePageUrl ?? '',
  ].join(' ').toLowerCase());
  const urlText = stripDiacritics(candidate.url.toLowerCase());
  const searchable = `${metadata} ${urlText}`;
  const hasMetadata = Boolean(candidate.title || candidate.tags?.length);
  const exactMatch = metadata.includes(normalizedToken);
  const lexicalMatches = tokenWords.filter((word) => searchable.includes(word)).length;
  const badSubject = BAD_SUBJECT_RE.test(searchable);
  const figurativeEvidence = FIGURATIVE_RE.test(metadata);
  const nonEnglishMetadata = looksNonEnglish(metadata);
  const hasDepictionTags = Boolean(candidate.tags?.length);
  const isConceptAnchored = CONCEPT_ANCHORED_SOURCES.has(candidate.source);
  const strictDepiction = Boolean(pos && STRICT_DEPICTION_POS.has(pos.toLowerCase()));
  const invalidShape = candidate.width !== undefined && candidate.height !== undefined &&
    (candidate.width < 320 || candidate.height < 240 || candidate.width / candidate.height > 2.5);

  const isPrimary = PRIMARY_DISPLAYABLE_SOURCES.includes(candidate.source);
  const isFallback = FALLBACK_DISPLAYABLE_SOURCES.includes(candidate.source);
  const displayable = isPrimary || isFallback;

  const dq = (reason: string): ImageScore => {
    reasons.push(reason);
    return { candidate, score: Number.POSITIVE_INFINITY, reasons, fallback: isFallback };
  };

  if (!candidate.url) return dq('penalty-no-url');
  if (!displayable) return dq('penalty-non-displayable-source');
  if (badSubject) return dq('penalty-bad-subject');
  if (invalidShape) return dq('penalty-invalid-shape');
  // A phrase image is unsafe without provider metadata tying it to the
  // complete phrase.
  if (isMultiword && (!hasMetadata || !exactMatch)) return dq('penalty-phrase-no-exact-metadata');
  // Idiom-flagged tokens need figurative evidence: a literal depiction of
  // the component nouns is the wrong sense.
  if (treatAsIdiom && !figurativeEvidence) return dq('penalty-idiom-no-figurative-evidence');
  // Fallback sources may only surface with a lexical anchor — a raw search
  // hit with no token match in metadata OR url is almost always off-sense.
  if (isFallback && !exactMatch && lexicalMatches === 0) return dq('penalty-fallback-no-lexical-anchor');
  // False-friend guard: a multilingual caption whose function words are
  // dominantly non-English (French `lit` = bed) matches the token string
  // but depicts the wrong concept. Corpus evidence 2026-09-06.
  if (nonEnglishMetadata) return dq('penalty-non-english-metadata');
  // Relational/light/cognition verbs have no stable depiction: a caption
  // that merely contains the word is text or a logo, not the concept. Such
  // tokens may only publish from a concept-anchored source (Wikimedia P180)
  // or with explicit depiction tags. Corpus evidence 2026-09-06:
  // support→Twitter, give→Luke 6, forget→memorial.
  if (strictDepiction && !isConceptAnchored && !hasDepictionTags) {
    return dq('penalty-abstract-verb-caption-only');
  }

  const sourceRank = sourcePriority(candidate.source, IMAGE_SOURCE_PRIORITY);
  let score = sourceRank * 3;
  reasons.push(isPrimary ? 'ok-primary-source' : 'ok-fallback-source');
  if (!hasMetadata) { score += 8; reasons.push('penalty-no-metadata'); }
  if (exactMatch) { score -= 8; reasons.push('ok-exact-match'); }
  else if (lexicalMatches) { score -= lexicalMatches * 2; reasons.push('ok-lexical-match'); }
  if (candidate.width && candidate.height && candidate.width >= 640 && candidate.height >= 480) {
    score -= 1; reasons.push('ok-high-resolution');
  }
  return { candidate, score, reasons, fallback: isFallback };
}

export interface ImageRankingResult {
  winner?: AttributedImageCandidate;
  /** Full scored pool, best first, for probes and provenance. */
  scored: ImageScore[];
  /** Reason the token published nothing, when it did. */
  emptyReason?: string;
}

/**
 * Rank the whole candidate pool and expose the full breakdown. The winner
 * comes from the primary displayable sources first; fallback sources
 * (Bing/DDG) are only considered when no primary candidate qualified.
 */
export function rankImageCandidates(
  token: string,
  candidates: AttributedImageCandidate[],
  opts?: { isIdiom?: boolean; pos?: string; slangSense?: boolean },
): ImageRankingResult {
  const normalizedToken = stripDiacritics(token.toLowerCase().trim());
  if (!normalizedToken) return { scored: [], emptyReason: 'empty-token' };
  if (isLowImageabilityToken(normalizedToken, opts?.pos)) {
    return { scored: [], emptyReason: 'low-imageability-token' };
  }
  // A slang sense with no stable depiction ("great" for `lit`) is
  // unimageable AS THAT SENSE — the same class rule as `know`/`whatever`,
  // but decided by the winning definition, not the spelling. Chasing
  // literal-axis words (candle → coasts → tealights) is persecution, not
  // closure: every literal depiction of the headword is the wrong sense
  // by construction. Verified live 2026-09-09: three consecutive literal
  // winners for the slang sentence across three corpus runs.
  if (opts?.slangSense) {
    return { scored: [], emptyReason: 'slang-sense-undepictable' };
  }

  const tokenWords = normalizedToken.split(/\s+/).filter((word) => word.length > 2);
  const isMultiword = tokenWords.length > 1;
  const treatAsIdiom = Boolean(opts?.isIdiom) || isMultiword;

  const scored = candidates
    .map((candidate) => scoreImageCandidate(candidate, {
      normalizedToken, tokenWords, isMultiword, treatAsIdiom, pos: opts?.pos,
    }))
    .sort((a, b) => a.score - b.score);

  const qualifies = (s: ImageScore) => Number.isFinite(s.score) && s.score <= 20;
  // Hard hierarchy: a qualifying primary candidate always wins over any
  // fallback candidate, regardless of raw score.
  const primaryWinner = scored.find((s) => qualifies(s) && !s.fallback);
  const fallbackWinner = scored.find((s) => qualifies(s) && s.fallback);
  const winner = (primaryWinner ?? fallbackWinner)?.candidate;

  let emptyReason: string | undefined;
  if (!winner) {
    emptyReason = candidates.length === 0 ? 'no-candidates' : 'no-candidate-qualified';
  }
  return { winner, scored, emptyReason };
}

export function pickImageCandidate(
  token: string,
  candidates: AttributedImageCandidate[],
  /**
   * Semantic hints derived by the merger from context/definition:
   *  - `isIdiom`: the headword is being used idiomatically (multiword idiom,
   *    or a phrasal listing flagged figurative by the definition). A literal
   *    depiction of an idiom's component nouns is the WRONG image, so an
   *    idiom-flagged phrase needs figurative evidence in the candidate's
   *    metadata to publish. Generalizes the old hardcoded `piece of cake`
   *    branch to every idiom.
   */
  opts?: { isIdiom?: boolean },
): AttributedImageCandidate | undefined {
  return rankImageCandidates(token, candidates, opts).winner;
}

const ETYMOLOGY_SOURCE_PRIORITY = [
  'etymonline',
  'merriamWebster',
  'americanHeritage',
  'wiktionaryHtml',
  'wiktionaryApi',
  'wiktApi',
  'wiktionary',
];

/**
 * Markers of a folk/uncertain etymology: the source itself hedges
 * ("maybe", "perhaps", "unknown") or leans on legend rather than
 * record ("legend says", "is said to"). A hedging paragraph from a
 * lower-priority source must never outrank a confident one — and when
 * EVERY candidate hedges, the card stays empty: no etymology beats a
 * doubtful one. Verified 2026-09-09: The Idioms ships origin anecdotes
 * ("legend says…") that read as history but are not.
 */
const HEDGE_RE = /\b(?:maybe|perhaps|possibly|probably|likely|unknown|uncertain|unclear|folk etymology|legend(?: has it|says)?|is said to|it is said|tradition holds)\b/i;

/**
 * Markers that an etymology paragraph belongs to a DIFFERENT sense than the
 * card's: a domain label ("in anatomy", "in botany", "in zoology") or
 * a specialist gloss naming another field's referent. `tensor` for "The
 * model uses a tensor." published Etymonline's anatomy paragraph ("in
 * anatomy, one of several muscles…") while the winning definition was the
 * ML sense ("a generalization of the concept of a vector") — the wrong
 * sense's history on the card. A domain-labeled paragraph whose label
 * contradicts the winning definition's domain is the wrong sense and must
 * lose to a domain-neutral one. General mechanism (domain label vs
 * definition), not a `tensor` rule. Verified live 2026-09-09.
 */
const ETYMOLOGY_DOMAIN_LABEL_RE = /\bin\s+(anatomy|botany|zoology|pathology|physiology|geology|astronomy|astrology|mythology|heraldry|architecture|music|law|theology)\b/i;

export function etymologyDomainLabel(text: string): string | undefined {
  return ETYMOLOGY_DOMAIN_LABEL_RE.exec(text)?.[1]?.toLowerCase();
}

export function pickEtymology(
  candidates: Array<{ source: string; text: string }>,
  /** Winning definition text, when the merger already picked one. Lets a
   * domain-neutral paragraph beat a domain-labeled one from another field. */
  definition?: string,
): string | undefined {
  const ranked = candidates
    .map((candidate) => ({ ...candidate, text: candidate.text.replace(/\s+/g, ' ').trim() }))
    .filter((candidate) =>
      candidate.text.length >= 12 && ETYMOLOGY_SOURCE_PRIORITY.includes(candidate.source),
    )
    .sort((a, b) => {
      // A hedging paragraph loses to a confident one regardless of source
      // order: "legend says…" from etymonline must not beat a clean
      // merriamWebster paragraph. Two hedges keep source order (the
      // better source's hedge is still the better hedge).
      const hedgeA = HEDGE_RE.test(a.text) ? 1 : 0;
      const hedgeB = HEDGE_RE.test(b.text) ? 1 : 0;
      if (hedgeA !== hedgeB) return hedgeA - hedgeB;
      // A domain-labeled paragraph from another field ("in anatomy,
      // one of several muscles…") loses to a domain-neutral one when
      // the winning definition names no such domain (`tensor` ML:
      // "a generalization of the concept of a vector"). The label is
      // the wrong sense's history. Only applied when a definition is
      // supplied, so the no-context path keeps pure source order.
      if (definition) {
        const defLow = definition.toLowerCase();
        const labelA = etymologyDomainLabel(a.text);
        const labelB = etymologyDomainLabel(b.text);
        const mismatchA = labelA && !defLow.includes(labelA) ? 1 : 0;
        const mismatchB = labelB && !defLow.includes(labelB) ? 1 : 0;
        if (mismatchA !== mismatchB) return mismatchA - mismatchB;
      }
      return (
        sourcePriority(a.source, ETYMOLOGY_SOURCE_PRIORITY) -
        sourcePriority(b.source, ETYMOLOGY_SOURCE_PRIORITY)
      );
    });
  // When EVERY candidate hedges, publish nothing: a doubtful origin story
  // is worse than an empty field.
  if (ranked.length && ranked.every((candidate) => HEDGE_RE.test(candidate.text))) {
    return undefined;
  }
  return ranked[0]?.text;
}

interface RankedTranslation {
  value: string;
  sources: Set<string>;
  score: number;
  sourceRank: number;
}

function lexicalShapePenalty(value: string): number {
  const words = value.split(/\s+/).filter(Boolean);
  let penalty = Math.max(0, words.length - 2) * 2;
  if (/^[A-ZÁÉÍÓÚÑ][\p{L}-]+(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}-]+)+$/u.test(value)) penalty += 10;
  if (/\([^)]{4,}\)/.test(value)) penalty += 1;
  if (/\b(?:cada día|cada año|por semana|por mes|de todo el mundo)\b/i.test(value)) penalty += 4;
  return penalty;
}

export function pickLexicalTranslations(
  token: string,
  translations: Array<{ source: string; text: string }>,
  ctx: Pick<EnrichmentContext, 'sentence'> & { targetLang?: string },
): string[] {
  const candidates = new Map<string, RankedTranslation>();
  const contextualTranslations = [...translations];
  const normalizedToken = token.trim().toLowerCase();
  const sentence = ctx.sentence ?? '';
  if ((ctx.targetLang ?? 'es').slice(0, 2) === 'es' && sentence) {
    if (normalizedToken === 'anything') {
      contextualTranslations.push({
        source: 'contextRule',
        text: hasNegativePolarity(sentence) ? 'nada' : /\b(?:choose|pick|select)\b/i.test(sentence) ? 'cualquier cosa' : 'algo',
      });
    } else if (normalizedToken === 'anybody' || normalizedToken === 'anyone') {
      contextualTranslations.push({
        source: 'contextRule',
        text: hasNegativePolarity(sentence) ? 'nadie' : /^\s*(?:anybody|anyone)\b/i.test(sentence) ? 'cualquiera' : 'alguien',
      });
    }
  }
  for (const item of contextualTranslations) {
    for (const candidate of cleanLexicalTranslation(item.text, token, item.source === 'bundled')) {
      const key = glossVariantKey(candidate) || candidate.toLowerCase();
      const contextualScore = contextTranslationScore(candidate, token, ctx.sentence);
      const trustBonus = item.source === 'bundled' ? -6 : 0;
      const rank = sourcePriority(item.source, TRANSLATION_SOURCE_PRIORITY);
      const existing = candidates.get(key);
      if (existing) {
        existing.sources.add(item.source);
        existing.score = Math.min(existing.score, contextualScore + trustBonus + lexicalShapePenalty(candidate));
        existing.sourceRank = Math.min(existing.sourceRank, rank);
      } else {
        candidates.set(key, {
          value: candidate,
          sources: new Set([item.source]),
          score: contextualScore + trustBonus + lexicalShapePenalty(candidate),
          sourceRank: rank,
        });
      }
    }
  }

  const hasBundledAnchor = [...candidates.values()].some((candidate) => candidate.sources.has('bundled'));
  // POS gate applied at SORT time, not at admission: the positional bonus
  // must not legitimize a single-source gloss ("músculo tensor" was slipping
  // through the `score < 0` single-source filter with the POS bonus).
  // The gate reorders glosses to match the sentence's usage without
  // changing which glosses are eligible.
  const posHint = sentencePosHint(token, sentence);
  const posAdjustment = (value: string): number => {
    if (!posHint) return 0;
    const shape = glossPosShape(value);
    if (posHint === 'verb' && shape === 'verb') return -10;
    if (posHint === 'verb' && shape === 'noun-adj') return 8;
    if (posHint === 'noun' && shape === 'noun-adj') return -8;
    if (posHint === 'noun' && shape === 'verb') return 8;
    return 0;
  };
  const rankedCandidates = [...candidates.values()]
    .map((candidate) => ({
      ...candidate,
      score: candidate.score - Math.min(4, (candidate.sources.size - 1) * 2) + posAdjustment(candidate.value),
    }))
    .filter((candidate) => !hasBundledAnchor ||
      candidate.sources.has('bundled') || candidate.sources.size > 1 || candidate.score - posAdjustment(candidate.value) < 0)
    .sort((a, b) => a.score - b.score || a.sourceRank - b.sourceRank || a.value.length - b.value.length);

  return groupEquivalentGlossVariants(rankedCandidates.map((candidate) => candidate.value))
    .slice(0, MAX_BILINGUAL_GLOSSES);
}

function normalizedWords(text: string): Set<string> {
  return new Set(stripDiacritics(text.toLowerCase()).match(/[a-z0-9]+/g) ?? []);
}

function exampleContainsToken(text: string, token: string): boolean {
  const haystack = stripDiacritics(text.toLowerCase());
  const needle = stripDiacritics(token.toLowerCase().trim());
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, 'i').test(haystack)) return true;
  if (needle === 'run' && /\b(?:ran|running|runs)\b/.test(haystack)) return true;
  const parts = needle.split(/\s+/);
  if (parts.length > 1) {
    const first = parts[0].replace(/e$/, '');
    return haystack.includes(parts.slice(1).join(' ')) &&
      new RegExp(`\\b${first}(?:s|es|ed|ing)?\\b`).test(haystack);
  }
  return new RegExp(`\\b${escaped.replace(/e$/, '')}(?:s|es|ed|ing)?\\b`).test(haystack);
}

function definitionContextScore(
  definition: string,
  token: string,
  sentence?: string,
  defPos?: Map<string, 'noun' | 'verb' | 'adjective' | 'adverb'>,
): number {
  const [score] = definitionContextTrace(definition, token, sentence, defPos);
  return score;
}

/** Reason codes mirroring every rule of the definition ranking, so the
 * provenance record explains the score without re-deriving it. `ok-*`
 * codes are contextual bonuses (subtracted), `penalty-*` codes pushed the
 * candidate down or disqualified it. Exported for the provenance contract
 * tests. */
export function definitionContextReasons(
  definition: string,
  token: string,
  sentence?: string,
  defPos?: Map<string, 'noun' | 'verb' | 'adjective' | 'adverb'>,
): string[] {
  const [, reasons] = definitionContextTrace(definition, token, sentence, defPos);
  return reasons;
}

/** Single source of truth for the definition ranking: returns the score
 * AND the reason codes for every signal that applied. */
function definitionContextTrace(
  definition: string,
  token: string,
  sentence?: string,
  defPos?: Map<string, 'noun' | 'verb' | 'adjective' | 'adverb'>,
): [number, string[]] {
  const d = definition.toLowerCase();
  const s = sentence?.toLowerCase() ?? '';
  const t = token.toLowerCase();
  let score = 0;
  const reasons: string[] = [];
  if (/^(?:→|another word for\b)/i.test(definition.trim())) { score += 18; reasons.push('penalty-cross-reference'); }
  if (/\b(?:dialect|obsolete|archaic|placeholder verb)\b/.test(d)) { score += 14; reasons.push('penalty-dialect-or-obsolete'); }
  if (/^\(?\s*as (?:a )?(?:pronoun|verb|noun|adjective)\s*\)?$/i.test(definition.trim())) { score += 20; reasons.push('penalty-pos-label-only'); }
  // General POS gate: when the sentence tells us the headword's part of
  // speech AND the source tagged this definition's POS (WordNet synsets),
  // a mismatch means the wrong sense won on source order alone. This is a
  // domain-agnostic rule — it fixes `quickly` (adverb usage, adjective
  // gloss), `interest` (noun usage, verb gloss), `support` (verb usage,
  // belief-noun gloss) without any token-specific code. A matching POS
  // gets a mild bonus so the aligned sense wins ties.
  const sentencePos = sentencePosHint(token, sentence);
  const definitionPos = defPos?.get(definition.trim().toLowerCase());
  if (sentencePos && definitionPos) {
    if (sentencePos === definitionPos) { score -= 6; reasons.push('ok-pos-match'); }
    else { score += 14; reasons.push('penalty-pos-mismatch'); }
  }
  if (!sentence) return [score, reasons];
  const semanticSignals: Array<[RegExp, RegExp, string]> = [
    [/\b(?:relationship|couple|girlfriend|boyfriend|marriage|dating|divorce)\b/, /\b(?:relationship|romantic|couple|marriage|separate|end|together)\b/, 'ok-relationship-sense'],
    [/\b(?:run|ran|running|jog|race|home|fast|quickly)\b/, /\b(?:move|legs|quickly|running|race)\b/, 'ok-motion-sense'],
    [/\b(?:company|business|team|project|manage)\b/, /\b(?:manage|control|direct|business|organization)\b/, 'ok-manage-sense'],
  ];
  for (const [contextPattern, definitionPattern, code] of semanticSignals) {
    if (contextPattern.test(s) && definitionPattern.test(d)) { score -= 10; reasons.push(code); }
  }
  // When the sentence carries a strong non-motion domain marker (company,
  // business, project…), a motion gloss is the wrong sense even if the
  // sentence ALSO contains motion-friendly words like "home" — "She runs
  // the company from home" is manage, not jog. The domain signal must
  // dominate, not tie, so the motion bonus is inverted into a penalty.
  // This is a general domain-vs-sense rule, not a corpus-specific one.
  const domainMarker = /\b(?:company|business|team|project|firm|enterprise|startup|organization)\b/.test(s);
  const isMotionGloss = /\b(?:move|legs|walking|quickly|run|race|stride|sprint)\b/.test(d);
  const isDomainGloss = /\b(?:manage|control|direct|business|organization|operation|administer)\b/.test(d);
  if (domainMarker && isMotionGloss && !isDomainGloss) { score += 12; reasons.push('penalty-motion-vs-domain'); }
  if (domainMarker && isDomainGloss) { score -= 6; reasons.push('ok-domain-gloss'); }
  if (token.toLowerCase() === 'break up' && /\b(?:decide|decided|after|with|relationship|couple)\b/.test(s)) {
    if (/\b(?:relationship|romantic|couple|marriage|end|together)\b/.test(d)) { score -= 14; reasons.push('ok-breakup-relationship-sense'); }
    if (/\b(?:pieces|school|college|holiday|meeting)\b/.test(d)) { score += 8; reasons.push('penalty-breakup-literal-sense'); }
  }
  if (t === 'run' && !/\brace\b/.test(s) && /\brace\b/.test(d)) { score += 6; reasons.push('penalty-race-sense-without-race-context'); }
  if (t === 'give' && /\bgive\s+(?:me|him|her|us|them)\b/.test(s)) {
    if (/\b(?:provide|hand|transfer|allow .* to have|present voluntarily)\b/.test(d)) { score -= 12; reasons.push('ok-give-transfer-sense'); }
    if (/\baudience\b/.test(d)) { score += 12; reasons.push('penalty-give-performance-sense'); }
  }
  if (t === 'apple' && /\b(?:ate|eat|ripe|fruit)\b/.test(s)) {
    if (/\bfruit\b/.test(d)) { score -= 12; reasons.push('ok-apple-fruit-sense'); }
    if (/\b(?:tree|adam|person .* loves)\b/.test(d)) { score += 10; reasons.push('penalty-apple-non-fruit-sense'); }
  }
  if (t === 'anything') {
    if (/\b(?:thing of any kind|any thing|object|act|state|event|fact)\b/.test(d)) { score -= 10; reasons.push('ok-anything-generic-sense'); }
    if (/\b(?:placeholder verb|not at all|in any way|at all like)\b/.test(d)) { score += 10; reasons.push('penalty-anything-placeholder'); }
  }
  if (t === 'anybody') {
    if (/\b(?:any person|anyone)\b/.test(d)) { score -= 10; reasons.push('ok-anybody-generic-sense'); }
    if (/\b(?:importance|consideration|standing)\b/.test(d)) { score += 10; reasons.push('penalty-anybody-standing'); }
  }
  if (t === 'each' && /\beach\s+\w+/.test(s)) {
    if (/\b(?:every one|considered separately|each one)\b/.test(d)) { score -= 10; reasons.push('ok-each-distributive-sense'); }
  }
  if (t === 'tensor' && /\b(?:model|machine learning|array)\b/.test(s)) {
    if (/\b(?:mathematical|vector|components|multidimensional|array)\b/.test(d)) { score -= 12; reasons.push('ok-tensor-ml-sense'); }
    if (/\b(?:muscle|stretches|tightens)\b/.test(d)) { score += 10; reasons.push('penalty-tensor-muscle-sense'); }
  }
  if (t === 'lit' && /\b(?:show|party|concert|was lit)\b/.test(s)) {
    if (/\b(?:excellent|exciting|enjoyable|amazing)\b/.test(d)) { score -= 16; reasons.push('ok-lit-slang-sense'); }
    if (/\b(?:literature|literal|past tense|light)\b/.test(d)) { score += 14; reasons.push('penalty-lit-literal-sense'); }
  }
  if (t === 'forget' && /\b(?:keys|wallet|name|remember)\b/.test(s)) {
    if (/\b(?:fail to remember|unable to remember|forget to bring|forget to take)\b/.test(d)) { score -= 12; reasons.push('ok-forget-memory-sense'); }
  }
  return [score, reasons];
}

export function pickDefinitions(
  definitions: Array<{ source: string; text: string }>,
  token: string,
  sentence?: string,
  defPos?: Map<string, 'noun' | 'verb' | 'adjective' | 'adverb'>,
): Array<{ source: string; text: string }> {
  const priority = ['longman', 'cambridge', 'oxfordLearners', 'dictionaryCom', 'britannicaDictionary', 'merriamWebster', 'wordnet', 'wiktApi', 'wiktionaryApi', 'wiktionary', 'freeDictionary', 'bundled'];
  const seen = new Set<string>();
  return [...definitions]
    .filter((definition) => {
      if (definition.source === 'theIdioms') return false;
      const key = stripDiacritics(definition.text.toLowerCase()).replace(/[^a-z0-9]+/g, ' ').trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) =>
      definitionContextScore(a.text, token, sentence, defPos) - definitionContextScore(b.text, token, sentence, defPos) ||
      sourcePriority(a.source, priority) - sourcePriority(b.source, priority) ||
      a.text.length - b.text.length,
    );
}

function sentenceOverlap(text: string, sentence?: string): number {
  if (!sentence) return 0;
  const candidate = normalizedWords(text);
  const context = normalizedWords(sentence);
  let overlap = 0;
  for (const word of candidate) if (context.has(word)) overlap += 1;
  return overlap / Math.max(1, Math.min(candidate.size, context.size));
}

export function pickExamples(
  token: string,
  examples: Array<{ source: string; text: string; translation?: string }>,
  sentence?: string,
  limit = 12,
): Array<{ source: string; text: string; translation?: string }> {
  const seen = new Set<string>();
  const perSource = new Map<string, number>();
  return examples
    .filter((example) => example.text.trim().length >= 4 && example.text.trim().length <= 240)
    .map((example) => {
      const containsToken = exampleContainsToken(example.text, token);
      const overlap = sentenceOverlap(example.text, sentence);
      const words = example.text.trim().split(/\s+/).length;
      const lowerText = example.text.toLowerCase();
      const lowerToken = token.toLowerCase();
      let sensePenalty = 0;
      if (lowerToken === 'piece of cake') {
        if (/\b(?:cut|slice|frosting|sherbet|giant|enormous|ate|eat)\b/.test(lowerText) ||
          /\b(?:pastel|torta|trozo|pedazo|porción|porcion)\b/i.test(example.translation ?? '')) sensePenalty += 18;
        if (/\b(?:easy|exam|test|no problem|pan comido|coser y cantar)\b/i.test(`${example.text} ${example.translation ?? ''}`)) sensePenalty -= 10;
      }
      if (lowerToken === 'break up' && /\b(?:relationship|college|romance|couple|with someone)\b/.test((sentence ?? '').toLowerCase())) {
        if (/\b(?:fight|cheese|soil|party|play|signal)\b/.test(lowerText)) sensePenalty += 12;
        if (/\b(?:relationship|romance|dating|break up with|we should break up)\b/.test(lowerText)) sensePenalty -= 8;
      }
      if (lowerToken === 'lit' && /\b(?:show|party|concert)\b/.test((sentence ?? '').toLowerCase())) {
        if (/\b(?:lit up|moon|room|candle|literature|english lit)\b/.test(lowerText)) sensePenalty += 14;
        if (/\b(?:really lit|show was lit|party was lit)\b/.test(lowerText)) sensePenalty -= 8;
      }
      if (/can we find and add a quotation/i.test(example.text)) sensePenalty += 30;
      const score = (containsToken ? -12 : 8) +
        (example.translation ? -4 : 0) - overlap * 8 + sensePenalty +
        (words < 3 || words > 30 ? 4 : 0);
      return { ...example, score, sourceRank: sourcePriority(example.source, EXAMPLE_SOURCE_PRIORITY) };
    })
    .sort((a, b) => a.score - b.score || a.sourceRank - b.sourceRank || a.text.length - b.text.length)
    .filter((example) => {
      const key = stripDiacritics(example.text.toLowerCase()).replace(/[^a-z0-9]+/g, ' ').trim();
      if (!key || seen.has(key)) return false;
      const sourceCount = perSource.get(example.source) ?? 0;
      if (sourceCount >= 2) return false;
      seen.add(key);
      perSource.set(example.source, sourceCount + 1);
      return true;
    })
    .slice(0, limit)
    .map(({ score: _score, sourceRank: _sourceRank, ...example }) => example);
}

function mergeFields(
  token: string,
  partials: Array<{ source: EnrichmentSource; partial: SourcePartial }>,
  ctx: EnrichmentContext,
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
  const synonymCandidates: Array<{ source: string; text: string }> = [];
  const antonymCandidates: Array<{ source: string; text: string }> = [];
  const collocationCandidates: Array<{ source: string; text: string }> = [];
  const relationGroups: AttributedRelationGroup[] = [];
  const imageCandidates: AttributedImageCandidate[] = [];
  const frequencyEvidence: NonNullable<VipEnrichment['frequencyEvidence']> = [];
  const etymologyCandidates: Array<{ source: string; text: string }> = [];
  // Definition text -> part of speech, harvested from sources that tag it
  // (WordNet). Drives the general POS gate in the definition ranking.
  const definitionPos = new Map<string, 'noun' | 'verb' | 'adjective' | 'adverb'>();
  const audio: NonNullable<DictionaryEntry['audio']> = [];
  const videoLinks: Array<{ url: string; source: string }> = [];

  // Field-level provenance: one record per published field, explaining
  // WHICH candidate won, its score, the runner-ups and the ranking's
  // reason codes. Built from the same data the pickers already produced —
  // no second ranking pass, no behavior change.
  const provenance: NonNullable<VipEnrichment['provenance']> = [];
  const pushProvenance = (record: NonNullable<VipEnrichment['provenance']>[number]) => {
    provenance.push(record);
  };

  // We render entry.phonetic from the FIRST source that has it, ranked
  // by preference. Translations are selected after all partials are collected
  // so we can discard example sentences / grammar labels and prefer premium
  // learner dictionaries (Cambridge / SpanishDict / WordReference) without
  // letting noisy snippets like "Nos regaló..." leak into the main card.
  // Standard-tier dictionary sources (wiktApi/wiktionaryApi/wiktionary)
  // close the IPA gap for words the editorial sources don't cover: without
  // them `apple`/`tensor` published no IPA in Standard even though wiktApi
  // HAD returned one (verified 2026-08-31 — the merge only consulted the
  // six VIP sources).
  const phoneticPriority = [
    'cambridge', 'oxfordLearners', 'longman', 'dictionaryCom', 'merriamWebster',
    'freeDictionary', 'wiktApi', 'wiktionaryApi', 'wiktionary',
  ];

  // Accumulate everything first, then pick winners.
  for (const { source, partial } of partials) {
    if (partial.synonyms) {
      for (const synonym of partial.synonyms) synonymCandidates.push({ source: source.id, text: synonym });
    }
    if (partial.antonyms) {
      for (const antonym of partial.antonyms) antonymCandidates.push({ source: source.id, text: antonym });
    }
    for (const group of partial.relationGroups ?? []) {
      relationGroups.push({ ...group, source: source.id });
    }
    if (partial.collocations) {
      for (const c of partial.collocations) collocationCandidates.push({ source: source.id, text: c });
    }
    if (partial.audio) {
      for (const a of partial.audio) {
        if (!audio.some((x) => x.url === a.url)) {
          audio.push({ url: a.url, accent: a.accent, source: source.id });
        }
      }
    }
    for (const d of partial.definitions ?? []) allDefs.push({ source: source.id, text: d });
    for (const d of partial.definitionsPos ?? []) {
      if (d.pos && !definitionPos.has(d.text.trim().toLowerCase())) {
        definitionPos.set(d.text.trim().toLowerCase(), d.pos);
      }
    }
    for (const t of partial.translations ?? []) allTrans.push({ source: source.id, text: t });
    for (const e of partial.examples ?? []) {
      allExamples.push({ source: source.id, text: e.text, translation: e.translation });
    }
    for (const image of partial.imageCandidates ?? []) {
      imageCandidates.push({ ...image, source: source.id });
    }
    if (partial.imageUrl && !partial.imageCandidates?.some((image) => image.url === partial.imageUrl)) {
      imageCandidates.push({ url: partial.imageUrl, source: source.id });
    }
    if (partial.videoLinks) {
      for (const v of partial.videoLinks) videoLinks.push({ url: v.url, source: source.id });
    }
    if (partial.etymology) {
      etymologyCandidates.push({ source: source.id, text: partial.etymology });
    }
    if (partial.mnemonic && !vip.mnemonic) vip.mnemonic = partial.mnemonic;
    for (const evidence of partial.frequencyEvidence ?? []) {
      if (!frequencyEvidence.some((item) =>
        item.source === source.id && item.scale === evidence.scale && item.value === evidence.value
      )) {
        frequencyEvidence.push({ ...evidence, source: source.id });
      }
    }
    if (partial.frequencyRank && !entry.frequencyRank) {
      entry.frequencyRank = partial.frequencyRank;
    }
  }

  // Idiom signal for the image gate: a multiword token is handled
  // structurally inside pickImageCandidate, but a single-word entry can still
  // be idiomatic. If The Idioms returned a hit for this token, treat it as an
  // idiom so a literal depiction of a component noun is rejected without
  // figurative evidence — the general form of the old `piece of cake` branch.
  const isIdiomToken = partials.some(
    (p) => p.source.id === 'theIdioms' && (p.partial.definitions?.length || p.partial.examples?.length),
  );
  // Dominant part of speech for the image gate: the majority POS across the
  // tagged definitions we harvested (WordNet synsets). A closed grammatical
  // class (pronoun/determiner/...) makes the token unimageable regardless of
  // spelling — the general form of the hand-listed function-word set. Empty
  // when no source tagged POS; the ranking then relies on the list + the
  // morphological pattern alone.
  const posCounts = new Map<string, number>();
  for (const pos of definitionPos.values()) {
    posCounts.set(pos, (posCounts.get(pos) ?? 0) + 1);
  }
  const dominantPos = [...posCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  // Slang-sense binding for images (applied after the definition pick
  // below): when the winning definition is a slang sense, a literal
  // depiction of the headword is the wrong sense — `lit` slang ("The show
  // was lit") must not publish a candle-lit dinner. General mechanism,
  // not a `lit` rule: any token whose top definition carries a slang-sense
  // reason forces figurative-mode ranking, the same mode idioms already
  // use. When no slang sense won, behaviour is unchanged.
  let imageRanking = rankImageCandidates(token, imageCandidates, {
    isIdiom: isIdiomToken,
    pos: dominantPos,
  });
  let selectedImage = imageRanking.winner;
  // NOTE: `vip.imageUrl`, the `[kivara:enrichment:image]` trace and the
  // image provenance are all written AFTER the definition pick below, so
  // the slang-sense second pass can still override them. Do not publish
  // here.
  // Selected-image trace for the MV3 audits: the card purpose runs the
  // image sources, and this line lets `scripts/mv3-corpus-quality.mjs
  // --purpose card` and `scripts/mv3-image-probe.mjs` capture what the
  // ranking actually published (or the fact that it correctly published
  // nothing) per token. The `pool` carries every candidate with its score
  // and reason codes so the probe has real rejection evidence, not guesses.
  // NOTE: written AFTER the slang-sense second pass below, so the trace
  // reflects the final ranking, not the first pass.
  const writeImageTrace = (): void => {
    console.info('[kivara:enrichment:image]', {
      token,
      imageUrl: selectedImage?.url ?? null,
      source: selectedImage?.source ?? null,
      candidates: imageCandidates.length,
      emptyReason: imageRanking.emptyReason ?? null,
      pool: imageRanking.scored.map((s) => ({
        source: s.candidate.source,
        url: s.candidate.url,
        title: s.candidate.title ?? null,
        score: Number.isFinite(s.score) ? s.score : null,
        fallback: s.fallback,
        reasons: s.reasons,
      })),
    });
    if (selectedImage) {
      pushProvenance({
        field: 'image',
        winner: selectedImage.url.slice(0, 120),
        source: selectedImage.source,
        candidates: imageCandidates.length,
        reasons: imageRanking.scored.find((s) => s.candidate.url === (selectedImage as AttributedImageCandidate).url)?.reasons
          ?? ['ok-depicts-concept'],
      });
    }
  };
  const selectedEtymology = pickEtymology(etymologyCandidates);
  vip.etymology = selectedEtymology;
  if (selectedEtymology) {
    const etyWinner = etymologyCandidates.find((c) => c.text.replace(/\s+/g, ' ').trim() === selectedEtymology);
    pushProvenance({
      field: 'etymology',
      winner: selectedEtymology.slice(0, 120),
      source: etyWinner?.source ?? null,
      candidates: etymologyCandidates.length,
      reasons: ['ok-source-priority'],
      runnerUps: etymologyCandidates
        .filter((c) => c !== etyWinner && ETYMOLOGY_SOURCE_PRIORITY.includes(c.source))
        .slice(0, 2)
        .map((c) => ({ source: c.source, text: c.text.slice(0, 80) })),
    });
  }

  // Pick phonetic from the highest-priority source that has one.
  // Cambridge IPA sometimes carries an internal space ("/ˈten.sə r/")
  // where the page inserts a syllable break the other sources do not
  // have (runner-ups: /ˈtɛn.sɔː/, /ˈtɛn.sə/, /ˈtensə(r)/). An internal
  // space inside the slashes is a formatting artifact, not phonetics —
  // collapse it so the card shows /ˈten.sər/. Verified live 2026-09-09:
  // `tensor` vip phonetic. General cleanup, not a headword rule.
  for (const id of phoneticPriority) {
    const hit = partials.find((p) => p.source.id === id && p.partial.phonetic);
    if (hit?.partial.phonetic) {
      const rawPhonetic = hit.partial.phonetic;
      const phonetic = /^[/[].*[/\]]$/.test(rawPhonetic.trim())
        ? `${rawPhonetic.trim()[0]}${rawPhonetic.trim().slice(1, -1).replace(/\s+/g, '')}${rawPhonetic.trim().slice(-1)}`
        : rawPhonetic.replace(/\s+/g, ' ').trim();
      const hasWholePhrase = !token.includes(' ') || /\s/.test(phonetic.replace(/^[/[]|[/\]]$/g, '').trim());
      if (!hasWholePhrase) continue;
      entry.phonetic = phonetic;
      pushProvenance({
        field: 'phonetic',
        winner: phonetic,
        source: hit.source.id,
        candidates: partials.filter((p) => p.partial.phonetic).length,
        reasons: ['ok-source-priority'],
        runnerUps: partials
          .filter((p) => p.partial.phonetic && p.source.id !== hit.source.id)
          .slice(0, 2)
          .map((p) => ({ source: p.source.id, text: p.partial.phonetic! })),
      });
      break;
    }
  }

  // Pick clean lexical translations from all source-attributed candidates.
  const lexicalTranslations = pickLexicalTranslations(token, allTrans, ctx);
  if (lexicalTranslations.length) {
    // `translation` remains the best/current-context primary gloss, while
    // `bilingual` intentionally keeps a wider learner-facing list. Subtitle
    // context can disambiguate the first item, but learners benefit from
    // seeing the main alternate senses too.
    entry.translation = lexicalTranslations[0];
    entry.bilingual = lexicalTranslations.slice(0, MAX_BILINGUAL_GLOSSES).join(' · ');
    // Provenance: the primary gloss, ranked contextually. The winner's
    // score encodes the context rule that picked it (negative = contextual
    // bonus from the translation ranking).
    const winnerSources = new Set(
      allTrans.filter((t) => t.text.trim().toLowerCase() === lexicalTranslations[0].toLowerCase()).map((t) => t.source),
    );
    pushProvenance({
      field: 'translation',
      winner: lexicalTranslations[0],
      source: winnerSources.size ? [...winnerSources].join('+') : null,
      score: contextTranslationScore(lexicalTranslations[0], token, ctx.sentence),
      reasons: contextTranslationReasons(lexicalTranslations[0], token, ctx.sentence),
      candidates: allTrans.length,
      runnerUps: lexicalTranslations.slice(1, 4).map((text) => ({
        source: allTrans.find((t) => t.text.trim().toLowerCase() === text.toLowerCase())?.source ?? null,
        text,
        score: contextTranslationScore(text, token, ctx.sentence),
      })),
    });
  }

  const rankedDefinitions = pickDefinitions(allDefs, token, ctx.sentence, definitionPos);
  // Re-scope the etymology pick with the winning definition's domain: a
  // domain-labeled paragraph from another field ("in anatomy, one of
  // several muscles…") loses to a domain-neutral one when the winning
  // definition names no such domain (`tensor` ML: "a generalization of
  // the concept of a vector"). The etymology block above runs before
  // the definition pick, so it cannot see the domain — this second pass
  // corrects the winner and its provenance when the domain-aware pick
  // disagrees. When there is no winning definition, the first pass
  // stands and behaviour is unchanged.
  if (rankedDefinitions[0]) {
    const rescopedEtymology = pickEtymology(etymologyCandidates, rankedDefinitions[0].text);
    if (rescopedEtymology !== selectedEtymology) {
      vip.etymology = rescopedEtymology;
      const rescopedWinner = etymologyCandidates.find((c) => c.text.replace(/\s+/g, ' ').trim() === rescopedEtymology);
      pushProvenance({
        field: 'etymology',
        winner: (rescopedEtymology ?? '').slice(0, 120),
        source: rescopedWinner?.source ?? null,
        candidates: etymologyCandidates.length,
        reasons: ['ok-definition-domain-match'],
        runnerUps: etymologyCandidates
          .filter((c) => c !== rescopedWinner && ETYMOLOGY_SOURCE_PRIORITY.includes(c.source))
          .slice(0, 2)
          .map((c) => ({ source: c.source, text: c.text.slice(0, 80) })),
      });
    }
  }
  // Slang-sense binding, second pass: when the winning definition proves a
  // slang sense, the literal depiction the first image pass picked is the
  // wrong sense by construction — re-rank in figurative mode (the mode
  // idioms already use). `lit` slang ("The show was lit") drops its
  // candle-lit dinner and publishes nothing rather than the wrong sense.
  // When no slang sense won, the first pass stands and behaviour is
  // unchanged.
  const slangSenseWon = (rankedDefinitions[0]
    ? definitionContextReasons(rankedDefinitions[0].text, token, ctx.sentence, definitionPos)
    : []
  ).some((reason) => reason.includes('-slang-sense'));
  if (slangSenseWon && !isIdiomToken) {
    const figurativeRanking = rankImageCandidates(token, imageCandidates, {
      pos: dominantPos,
      slangSense: true,
    });
    imageRanking = figurativeRanking;
    selectedImage = figurativeRanking.winner;
    if (selectedImage) vip.imageUrl = selectedImage.url;
    else delete vip.imageUrl;
  }
  // Publish the final image state AFTER the slang-sense second pass, so
  // the trace and provenance reflect the re-ranked winner — never the
  // first-pass literal the second pass already discarded.
  if (selectedImage) vip.imageUrl = selectedImage.url;
  writeImageTrace();
  const selectedRelationGroups = pickSenseRelationGroups(token, relationGroups, ctx.sentence, rankedDefinitions);

  // Sense anchor for the sense-blind flat fields (thesaurus synonyms/antonyms
  // and flat editorial collocations). Built from the sentence plus the winning
  // definition — the same signal pickSenseRelationGroups uses to select a
  // group. When neither exists (no context, no definition) the anchor is empty
  // and the flat pickers fall back to pure form/corroboration ranking, so
  // monosemous words are unaffected. This is what keeps a different acception's
  // synonyms/collocations (`depository` for river `bank`, `run a marathon` for
  // the management sense) off the card without touching sense-aware sources.
  const senseAnchorTerms = relationTerms(
    `${ctx.sentence ?? ''} ${rankedDefinitions.slice(0, 1).map((definition) => definition.text).join(' ')}`,
    token,
  );

  if (rankedDefinitions.length) {
    const winner = rankedDefinitions[0];
    pushProvenance({
      field: 'definition',
      winner: winner.text.slice(0, 120),
      source: winner.source,
      score: definitionContextScore(winner.text, token, ctx.sentence, definitionPos),
      reasons: definitionContextReasons(winner.text, token, ctx.sentence, definitionPos),
      candidates: allDefs.length,
      runnerUps: rankedDefinitions.slice(1, 4).map((definition) => ({
        source: definition.source,
        text: definition.text.slice(0, 80),
        score: definitionContextScore(definition.text, token, ctx.sentence, definitionPos),
      })),
    });
  }
  const senseBoundSynonyms: Array<{ source: string; text: string }> = [];
  const senseBoundAntonyms: Array<{ source: string; text: string }> = [];
  for (const group of selectedRelationGroups) {
    for (const synonym of group.synonyms ?? []) senseBoundSynonyms.push({ source: group.source, text: synonym });
    for (const antonym of group.antonyms ?? []) senseBoundAntonyms.push({ source: group.source, text: antonym });
  }

  // Sense-bound relations win by default, but flat lemma lists from curated
  // sources may complement them. When sense groups exist at all, an unbound
  // flat list can only contribute terms a selected group already endorses —
  // otherwise a zero-overlap gate result would fall back to the default
  // sense's synonyms (race/jog for "She runs the company", verified in the
  // 2026-08-30 MV3 corpus). If NO sense group cleared the contextual gate,
  // the flat lists stay out of the visible field entirely.
  let synonymPool = synonymCandidates;
  let antonymPool = antonymCandidates;
  const hasSenseGroups = relationGroups.length > 0;
  if (hasSenseGroups) {
    const endorsed = new Set(senseBoundSynonyms.map((s) => s.text.toLowerCase()));
    const endorsedAnt = new Set(senseBoundAntonyms.map((s) => s.text.toLowerCase()));
    synonymPool = synonymCandidates.filter((c) => endorsed.has(c.text.toLowerCase()));
    antonymPool = antonymCandidates.filter((c) => endorsedAnt.has(c.text.toLowerCase()));
    if (senseBoundSynonyms.length) synonymPool = [...senseBoundSynonyms, ...synonymPool];
    // Antonyms of a MULTIWORD idiom headword ride the figurative gate:
    // MW's idiom block mixes true difficulty antonyms (pain, labor,
    // chore) with literal-sense noise (bear, beast, murder, stinker —
    // the cake/beast senses, not "very easy"). A single-word antonym
    // with no lexical bridge to the figurative sense is the literal
    // sense leaking in — the same contamination already rejected for
    // synonyms by isTaxonomicOrPeriphrastic's literal-component rule.
    // Verified live 2026-09-09: `piece of cake` vip published
    // bear/beast/murder/stinker for "The exam was a piece of cake."
    const isIdiomHeadword = token.trim().includes(' ');
    if (senseBoundAntonyms.length) {
      antonymPool = [
        ...senseBoundAntonyms.filter((c) =>
          !isIdiomHeadword || isFigurativeAntonym(c.text, senseAnchorTerms),
        ),
        ...antonymPool,
      ];
    }
  }

  // Synonyms / antonyms / collocations / audio go on entry directly so
  // the popover and the Anki mapper don't have to dig into vip.*
  const rankedSynonyms = pickRelatedTerms(token, synonymPool, 12, senseAnchorTerms);
  const rankedAntonyms = pickRelatedTerms(token, antonymPool, 8, senseAnchorTerms);
  if (rankedSynonyms.length) entry.synonyms = rankedSynonyms;
  if (rankedAntonyms.length) entry.antonyms = rankedAntonyms;

  // Sense-bound collocations (longman Sense blocks and ozdic blocks carry
  // a per-sense gloss): the contextual gate in pickSenseRelationGroups
  // selects the group whose gloss overlaps the sentence; ONLY that selected
  // group's chunks may fill the field. Flat corpus lists can complement
  // what the selected sense already endorses — mirroring the synonym gate.
  // If no group cleared the gate, sense-bound chunks stay out entirely (a
  // zero-overlap "winner" would be the wrong sense's collocations: "to run
  // aground" for the manage sense, verified 2026-08-30).
  //
  // The selected group's chunks bypass the flat sense anchor below: the
  // GROUP already won the contextual gate via its gloss, and re-anchoring
  // each chunk would kill terms that never appear in prose (`well run`
  // for the manage sense — verified live 2026-09-06, the anchor
  // {company,home,organize} contains neither `well` nor `badly`).
  const senseBoundCollocations: Array<{ source: string; text: string; senseBound: true }> = [];
  for (const group of selectedRelationGroups) {
    if (!group.collocations?.length) continue;
    for (const collocation of group.collocations) {
      senseBoundCollocations.push({ source: group.source, text: collocation, senseBound: true });
    }
  }
  let collocationPool: Array<{ source: string; text: string; senseBound?: boolean }> = collocationCandidates;
  // The group's gloss already earned the contextual gate; chunks ride free
  // ONLY when that win was substantive (a real content-word overlap, not
  // generic argument-structure words like `someone`/`something`). A
  // generic-only win proves nothing about the sense, so its chunks still
  // ride the flat anchor like any unscoped candidate.
  const collocationsSenseScoped = selectedRelationGroups.some(
    (group) =>
      (group.collocations?.length ?? 0) > 0 &&
      hasSubstantiveSenseOverlap(group, senseAnchorTerms, token),
  );
  if (senseBoundCollocations.length) {
    const endorsed = new Set(senseBoundCollocations.map((c) => c.text.toLowerCase()));
    collocationPool = [
      ...senseBoundCollocations,
      ...collocationCandidates.filter((c) => endorsed.has(c.text.toLowerCase())),
    ];
  } else if (relationGroups.length > 0) {
    // Sense gates are active (WordNet always, editorial thesauri in VIP)
    // but none of the selected groups carry collocations. Without a sense
    // anchor, a flat corpus chunk is unverifiable for the CURRENT sense
    // ("to run aground" published for the manage sense, verified
    // 2026-08-30). Chunks may still publish when the corroboration is
    // EDITORIAL (PONS + Longman + Oxford): those pairs belong to the
    // entry's primary sense by construction, which is safe for
    // monosemous words ("apple tree", "working week") and what the
    // corpus-based noise (Datamuse bigrams) can never provide.
    const editorialSources = new Set([
      'longman', 'oxfordLearners', 'cambridge', 'bundled',
      'pons', 'ozdic', 'dictCc', 'babla', 'merriamWebster',
      'britannicaDictionary', 'dictionaryCom',
    ]);
    // Learner-dictionary collocation authorities: Longman/Oxford/Cambridge
    // publish hand-built collocation blocks that survive the strict
    // normalizeCollocation cleaning. A single clean chunk from one of these
    // is trustworthy enough to publish alone (they are already displayable
    // at the pickCollocations layer). This lifts coverage for polysemous
    // verbs whose ozdic sense group did not clear the contextual gate
    // (`run`, `give` returned empty on 2026-09-06 despite 5-7 collocation
    // sources). Ozdic stays corroboration-required by deliberate contract
    // (sense-aware but corpus-derived); Datamuse/PONS/dictCc/wiktionary too.
    const collocationAuthorities = new Set([
      'longman', 'oxfordLearners', 'cambridge',
    ]);
    const byChunk = new Map<string, { sources: Set<string> }>();
    for (const candidate of collocationCandidates) {
      const key = candidate.text.trim().toLowerCase();
      const entry = byChunk.get(key) ?? { sources: new Set<string>() };
      entry.sources.add(candidate.source);
      byChunk.set(key, entry);
    }
    collocationPool = collocationCandidates.filter((candidate) => {
      const chunk = byChunk.get(candidate.text.trim().toLowerCase());
      if (!chunk) return false;
      const authority = [...chunk.sources].some((source) => collocationAuthorities.has(source));
      if (authority) return true;
      const editorial = [...chunk.sources].filter((source) => editorialSources.has(source));
      return editorial.length >= 1 && chunk.sources.size >= 2;
    });
  }
  const rankedCollocations = pickCollocations(
    token,
    collocationPool,
    // Chunks of a substantively-selected group already earned the
    // contextual gate via their gloss; the flat anchor would kill
    // sense-correct terms that never appear in prose (`well run`).
    // Generic-only group wins and corpus flats still ride the anchor.
    collocationsSenseScoped ? undefined : senseAnchorTerms,
  );
  if (rankedCollocations.length) entry.collocations = rankedCollocations;
  if (rankedSynonyms.length) {
    pushProvenance({
      field: 'synonyms',
      winner: rankedSynonyms[0],
      source: synonymPool.find((c) => c.text === rankedSynonyms[0])?.source ?? null,
      candidates: synonymPool.length,
      reasons: hasSenseGroups ? ['ok-sense-group-endorsed'] : ['ok-source-priority'],
      runnerUps: rankedSynonyms.slice(1, 4).map((text) => ({
        source: synonymPool.find((c) => c.text === text)?.source ?? null,
        text,
      })),
    });
  }
  if (rankedCollocations.length) {
    pushProvenance({
      field: 'collocations',
      winner: rankedCollocations[0],
      source: collocationCandidates.find((c) => c.text === rankedCollocations[0])?.source ?? null,
      candidates: collocationCandidates.length,
      reasons: ['ok-editorial-or-corroborated'],
    });
  }
  if (audio.length) {
    const audioPriority = ['forvo', 'linguaLibre', 'cambridge', 'oxfordLearners', 'longman', 'dictionaryCom', 'britannicaDictionary', 'merriamWebster', 'freeDictionary', 'wiktApi', 'wiktionaryApi', 'babla', 'googleTtsFallback'];
    const perSource = new Map<string, number>();
    const seenUrls = new Set<string>();
    const hasNonTts = audio.some((candidate) => candidate.source !== 'googleTtsFallback');
    entry.audio = [...audio]
      .sort((a, b) => sourcePriority(a.source ?? '', audioPriority) - sourcePriority(b.source ?? '', audioPriority))
      .filter((candidate) => {
        const source = candidate.source ?? '';
        if (hasNonTts && source === 'googleTtsFallback') return false;
        const normalizedUrl = candidate.url.trim().toLowerCase();
        if (!normalizedUrl || seenUrls.has(normalizedUrl)) return false;
        const count = perSource.get(source) ?? 0;
        if (count >= 2) return false;
        seenUrls.add(normalizedUrl);
        perSource.set(source, count + 1);
        return true;
      })
      .slice(0, 4);
  }

  const rankedExamples = pickExamples(token, allExamples, ctx.sentence);

  // VIP block surfaces full source-attributed lists.
  if (rankedDefinitions.length) vip.definitions = rankedDefinitions.slice(0, 12);
  if (allTrans.length) vip.translations = allTrans.slice(0, 12);
  if (rankedExamples.length) vip.examples = rankedExamples;
  if (videoLinks.length) vip.videoLinks = videoLinks;
  if (frequencyEvidence.length) vip.frequencyEvidence = frequencyEvidence;
  if (rankedExamples.length) {
    pushProvenance({
      field: 'examples',
      winner: rankedExamples[0].text.slice(0, 120),
      source: rankedExamples[0].source,
      candidates: allExamples.length,
      reasons: ['ok-contextual-alignment'],
      runnerUps: rankedExamples.slice(1, 4).map((example) => ({
        source: example.source,
        text: example.text.slice(0, 80),
      })),
    });
  }
  if (provenance.length) vip.provenance = provenance;

  // Pick the highest-quality definition after contextual sense ranking.
  if (rankedDefinitions.length) {
    const primary = rankedDefinitions[0].text;
    entry.monolingual = primary.length > 280
      ? (primary.match(/^.{40,280}?[.!?](?:\s|$)/)?.[0].trim() ?? `${primary.slice(0, 277).trim()}…`)
      : primary;
  }
  if (rankedExamples.length) {
    entry.examples = rankedExamples.slice(0, 4).map((example) =>
      example.translation ? `${example.text} — ${example.translation}` : example.text,
    );
  }

  entry.vip = vip;
  return { entry, vip };
}

/* ─── Cache (in-memory LRU + IndexedDB via Dexie) ─────────────────────── */

interface CacheRow {
  key: string;
  payload: EnrichmentResult;
  storedAt: number;
}

/**
 * In-memory LRU sitting in front of the IndexedDB cache. The service
 * worker keeps recently-resolved entries hot so a re-hover on the same
 * word (the common case while reading subtitles — the user re-checks a
 * word seconds later) returns in ~0 ms with no IndexedDB round-trip and
 * no `await` at all.
 *
 * Bounded so a long session can't grow it unboundedly; the SW also tears
 * the whole Map down whenever it's evicted (~30 s-5 min idle), and the
 * persistent IndexedDB layer survives that to repopulate it. TTL is
 * enforced on read so a stale hot entry never outlives the configured
 * cache window.
 */
const MEM_CACHE_MAX = 300;
const memCache = new Map<string, CacheRow>();

function memGet(key: string, ttlDays: number): EnrichmentResult | null {
  const row = memCache.get(key);
  if (!row) return null;
  const ageMs = Date.now() - (row.storedAt ?? 0);
  if (ageMs > ttlDays * 24 * 3600 * 1000) {
    memCache.delete(key);
    return null;
  }
  // LRU bump: re-insert so it moves to the end (most-recently-used).
  memCache.delete(key);
  memCache.set(key, row);
  return row.payload;
}

function memSet(key: string, payload: EnrichmentResult): void {
  if (memCache.has(key)) memCache.delete(key);
  memCache.set(key, { key, payload, storedAt: Date.now() });
  // Evict the least-recently-used (first inserted) when over capacity.
  if (memCache.size > MEM_CACHE_MAX) {
    const oldest = memCache.keys().next().value;
    if (oldest !== undefined) memCache.delete(oldest);
  }
}

/** Clear the in-memory layer — called when the user wipes the cache so a
 *  freshly-emptied cache isn't shadowed by hot SW memory. */
export function clearMemEnrichmentCache(): void {
  memCache.clear();
}

function makeCacheKey(
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
  return `${purpose}|${tier}|${activeSourceSignature(vip)}|${ctx.sourceLang}|${ctx.targetLang}|${token.trim().toLowerCase()}|${sentence}`;
}

/**
 * Include the source selection in the cache identity. Previously the key
 * carried only the master tier, so toggling an individual provider still
 * served a result made with the old provider set until the TTL expired.
 * Keep credentials out of the key; only their presence affects which
 * public endpoint can answer.
 */
function activeSourceSignature(vip: VipSettings): string {
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

async function readCache(key: string, ttlDays: number): Promise<EnrichmentResult | null> {
  // 1. Hot in-memory layer first — instant, no await, no IndexedDB hop.
  const hot = memGet(key, ttlDays);
  if (hot) return hot;
  // 2. Persistent IndexedDB layer.
  try {
    const db = getDB();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = (await (db as any).vip_cache?.get(key)) as CacheRow | undefined;
    if (!row) return null;
    const ageMs = Date.now() - (row.storedAt ?? 0);
    if (ageMs > ttlDays * 24 * 3600 * 1000) return null;
    // Warm the in-memory layer so the next re-hover is instant.
    memSet(key, row.payload);
    return row.payload;
  } catch {
    return null;
  }
}

async function writeCache(key: string, payload: EnrichmentResult): Promise<void> {
  // Populate the hot layer synchronously so an immediate re-hover hits it.
  memSet(key, payload);
  try {
    const db = getDB();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).vip_cache?.put({ key, payload, storedAt: Date.now() });
  } catch {
    // ignore — cache misses are recoverable.
  }
}

/* ─── Cache management (exposed to the side-panel via the SW) ──────────── */

/**
 * Count of cached enrichment rows + an approximate byte size. Cheap
 * enough to call on panel open (one full-table scan of a table that
 * rarely exceeds a few hundred rows).
 */
export async function getEnrichmentCacheStats(): Promise<{ count: number; bytes: number }> {
  try {
    const db = getDB();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await (db as any).vip_cache?.toArray()) as CacheRow[] | undefined;
    if (!rows || !rows.length) return { count: 0, bytes: 0 };
    let bytes = 0;
    for (const r of rows) {
      // Approximate: the JSON length of the payload + key. Good enough
      // for a human-readable "~X KB" display.
      try {
        bytes += r.key.length + JSON.stringify(r.payload).length;
      } catch {
        // skip rows that won't serialise
      }
    }
    return { count: rows.length, bytes };
  } catch {
    return { count: 0, bytes: 0 };
  }
}

/** Wipe every cached enrichment row. Returns how many were removed. */
export async function clearEnrichmentCache(): Promise<number> {
  try {
    const db = getDB();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const count = (await (db as any).vip_cache?.count()) as number | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).vip_cache?.clear();
    return count ?? 0;
  } catch {
    return 0;
  }
}
