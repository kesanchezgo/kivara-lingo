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
import { collinsSource } from './sources/collins';
import { merriamWebsterSource } from './sources/merriam-webster';
import { ozdicSource } from './sources/ozdic';
import { ponsSource } from './sources/pons';
import { bablaSource } from './sources/babla';
import { dictCcSource } from './sources/dictcc';
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
import { bingImagesSource } from './sources/bing-images';
import { openverseSource } from './sources/openverse';
import { wikimediaCommonsSource } from './sources/wikimedia-commons';
import { duckduckgoImagesSource } from './sources/duckduckgo-images';
import { youglishSource } from './sources/youglish';
import { etymonlineSource } from './sources/etymonline';
import { getDB } from '../../shared/db';

/**
 * Standard tier: always queried regardless of the VIP master switch.
 * All sources here are FREE APIs (no token, no scraping of paid
 * dictionaries). Each can still be disabled individually from its
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
 * dictionaries (Cambridge / Oxford / Longman / Collins / Merriam-Webster
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
  'britannicaDictionary',
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
  britannicaDictionary: britannicaDictionarySource,
  mobyThesaurus: mobyThesaurusSource,
  thesaurusCom: thesaurusComSource,
  wordHippo: wordHippoSource,
  theIdioms: theIdiomsSource,
  bundled: bundledSource,
  yomitanPacks: yomitanPacksSource,

  cambridge: cambridgeSource,
  oxfordLearners: oxfordLearnersSource,
  longman: longmanSource,
  collins: collinsSource,
  merriamWebster: merriamWebsterSource,
  oxfordCollocations: null, // pack-based, handled separately
  ozdic: ozdicSource,
  pons: ponsSource,
  babla: bablaSource,
  dictCc: dictCcSource,
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
  bingImages: bingImagesSource,
  openverse: openverseSource,
  wikimediaCommons: wikimediaCommonsSource,
  duckduckgoImages: duckduckgoImagesSource,
  youglish: youglishSource,
  etymonline: etymonlineSource,
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

  const cacheKey = makeCacheKey(token, ctx, opts.vip.enabled, purpose);
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

  const merged = mergeFields(token, partials, ctx);
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

const MAX_BILINGUAL_GLOSSES = 8;

const TRANSLATION_SOURCE_PRIORITY = [
  'pons',
  'babla',
  'cambridge',
  'spanishDict',
  'wordReference',
  'dictCc',
  'linguee',
  'reverso',
];

function sourcePriority(source: string, priority: string[]): number {
  const idx = priority.indexOf(source);
  return idx === -1 ? priority.length + 1 : idx;
}

const COLLOCATION_SOURCE_PRIORITY = [
  'ozdic',
  'pons',
  'babla',
  'longman',
  'oxfordLearners',
  'cambridge',
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
  'each', 'every', 'long', 'short', 'say', 'know', 'last', 'next', 'second', 'business', 'more', 'most', 'his', 'limit', 'effect',
]);

function normalizeCollocation(raw: string, token: string): string | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || text === '—') return null;
  if (text.length > 80) return null;
  const low = text.toLowerCase();
  const tok = token.toLowerCase().trim();
  if (low === tok) return null;
  if (!low.includes(tok)) return null;
  if (/^[a-z]+$/.test(text) && !text.includes(' ')) return null;
  if (/^[a-z]+-[a-z]+$/i.test(text)) return null;
  if (/\b(?:limit|effect|his|more|most)\b/i.test(text) && text.split(/\s+/).length <= 4) return null;

  const escapedToken = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`(?:^|\\b)${escapedToken}(?:\\b|$)`).test(low)) return null;
  const words = low.split(/\s+/).filter(Boolean);
  const allowedPreModifiers = new Set(['last', 'next', 'this', 'every', 'each', 'per', 'previous', 'following']);
  if (!tok.includes(' ') && words.at(-1) === tok && !allowedPreModifiers.has(words[0])) return null;
  if (words.length === 2 && words[0] === tok && BAD_COLLOCATION_TAILS.has(words[1])) return null;
  if (words.length === 2 && words[1] === tok && BAD_COLLOCATION_TAILS.has(words[0])) return null;
  if (/\b(?:not|will|would|can|could|may|might|must|should|they|you|we|he|she|it)\b/.test(low) && words.length <= 3) return null;
  return text;
}

function pickCollocations(
  token: string,
  candidates: Array<{ source: string; text: string }>,
): string[] {
  const seen = new Set<string>();
  return [...candidates]
    .map((c) => ({ ...c, normalized: normalizeCollocation(c.text, token) }))
    .filter((c): c is { source: string; text: string; normalized: string } => !!c.normalized)
    .sort((a, b) =>
      sourcePriority(a.source, COLLOCATION_SOURCE_PRIORITY) - sourcePriority(b.source, COLLOCATION_SOURCE_PRIORITY) ||
      a.normalized.length - b.normalized.length,
    )
    .map((c) => c.normalized)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

function cleanLexicalTranslation(raw: string, token: string): string[] {
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
      if (lower === tokenNorm) return false;
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
  return /\b(?:not|no|never|nobody|no one|nothing|without|hardly|barely|n't)\b/i.test(sentence);
}


function contextTranslationScore(candidate: string, token: string, sentence?: string): number {
  const c = candidate.toLowerCase().trim();
  const t = token.toLowerCase().trim();
  const s = sentence?.toLowerCase() ?? '';
  let score = 0;

  // Generic learner-quality penalties: keep valid alternates, but rank noisy
  // phrase translations behind compact core meanings.
  const words = c.split(/\s+/).filter(Boolean);
  if (words.length > 3) score += 2;
  if (/\b(algo más|alguien más|cada semana|en una semana)\b/i.test(c)) score += 1;

  if (t === 'give') {
    if (/\bgive\s+(?:me|him|her|us|them|you)\b/.test(s)) {
      if (c === 'dar') score -= 14;
      if (/^(regalar|obsequiar)$/.test(c)) score -= 4;
    }
    if (/\b(present|gift|christmas|birthday)\b/.test(s)) {
      if (/^(regalar|obsequiar)$/.test(c)) score -= 12;
      if (c === 'dar') score -= 6;
    }
    if (/^(dar|ofrecer|proporcionar|entregar|conceder|regalar|obsequiar|donar|prestar)$/.test(c)) score -= 3;
    if (/^(claudicar|rendirse|resignarse)$/.test(c)) score += 8;
  }

  if (t === 'wonderful') {
    if (/^(maravilloso|maravilloso\/a|maravilloso\/osa|estupendo|fantástico|fantastico|extraordinario)$/.test(c)) score -= 10;
    if (c === 'admirable') score += 5;
    if (/maravilla/.test(c)) score += 4;
  }

  if (t === 'anything') {
    const negative = hasNegativePolarity(s);
    if (negative) {
      if (c === 'nada') score -= 12;
      if (c === 'algo') score += 2;
    } else {
      if (c === 'algo') score -= 12;
      if (c === 'cualquier cosa') score -= 5;
      if (c === 'nada') score += 8;
    }
    if (/anything else/.test(s) && c === 'algo más') score -= 8;
  }

  if (t === 'anybody' || t === 'anyone') {
    const negative = hasNegativePolarity(s);
    if (negative) {
      if (c === 'nadie') score -= 12;
      if (c === 'alguien') score += 2;
    } else {
      if (c === 'alguien') score -= 12;
      if (c === 'nadie' || c.startsWith('ninguno')) score += 8;
    }
  }

  if (t === 'know') {
    if (/\b(don't|do not|didn't|did not|not)\s+know\b|\bknow\s+(?:that|what|how|why|where|when)\b/.test(s)) {
      if (c === 'saber') score -= 12;
      if (c === 'conocer') score += 3;
    }
    if (/\bknow\s+(?:him|her|them|you|me|your|my|his|their|[A-Z][a-z]+)\b/i.test(sentence ?? '')) {
      if (c === 'conocer') score -= 12;
      if (c === 'saber') score += 2;
    }
    if (/^(saber|conocer)$/.test(c)) score -= 4;
  }

  if (t === 'run') {
    if (/\brun\s+(?:every|morning|fast|quickly|home|away)|\bi\s+run\b/.test(s)) {
      if (c === 'correr') score -= 12;
    }
    if (/\brun\s+(?:a|the)?\s*(?:company|business|team|project)|\brun\s+it\b/.test(s)) {
      if (/^(dirigir|gestionar|administrar)$/.test(c)) score -= 12;
    }
    if (/\b(machine|computer|program|engine)\b.*\brun|\brun\s+(?:smoothly|well)\b/.test(s)) {
      if (/^(funcionar|andar)$/.test(c)) score -= 12;
    }
  }

  if (t === 'week') {
    if (c === 'semana') score -= 12;
  }

  if (t === 'break up') {
    if (/\b(with|relationship|couple|girlfriend|boyfriend|marriage|after college)\b/.test(s)) {
      if (/^(separarse|terminar|romper|acabar)$/.test(c)) score -= 12;
      if (/^(desguazar|descomponer|deshacer|dividir)$/.test(c)) score += 10;
    }
  }

  if (t === 'piece of cake') {
    if (/^(pan comido|fácil|facil|facilísimo|facilisimo|muy fácil|muy facil)$/.test(c)) score -= 14;
    if (/^(tartaleta|pastel|pedazo de pastel)$/.test(c)) score += 15;
  }

  return score;
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
  const explicit = values.find((v) => /\/(?:a|o|as|os|osa|esa)/i.test(v));
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

function pickLexicalTranslations(
  token: string,
  translations: Array<{ source: string; text: string }>,
  ctx: EnrichmentContext,
): string[] {
  const seen = new Set<string>();
  const rankedCandidates: Array<{ value: string; source: string; score: number; sourceRank: number }> = [];
  for (const item of translations) {
    for (const candidate of cleanLexicalTranslation(item.text, token)) {
      const key = candidate.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rankedCandidates.push({
        value: candidate,
        source: item.source,
        score: contextTranslationScore(candidate, token, ctx.sentence),
        sourceRank: sourcePriority(item.source, TRANSLATION_SOURCE_PRIORITY),
      });
    }
  }
  rankedCandidates.sort((a, b) => a.score - b.score || a.sourceRank - b.sourceRank || a.value.length - b.value.length);
  const grouped = groupEquivalentGlossVariants(rankedCandidates.map((c) => c.value));
  return grouped.slice(0, MAX_BILINGUAL_GLOSSES);
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
  const synonyms = new Set<string>();
  const antonyms = new Set<string>();
  const collocationCandidates: Array<{ source: string; text: string }> = [];
  const audio: NonNullable<DictionaryEntry['audio']> = [];
  const videoLinks: Array<{ url: string; source: string }> = [];

  // We render entry.phonetic from the FIRST source that has it, ranked
  // by preference. Translations are selected after all partials are collected
  // so we can discard example sentences / grammar labels and prefer premium
  // learner dictionaries (Cambridge / SpanishDict / WordReference) without
  // letting noisy snippets like "Nos regaló..." leak into the main card.
  const phoneticPriority = [
    'cambridge', 'oxfordLearners', 'longman', 'collins', 'merriamWebster',
    'freeDictionary',
  ];

  // Accumulate everything first, then pick winners.
  for (const { source, partial } of partials) {
    if (partial.synonyms) for (const s of partial.synonyms) synonyms.add(s);
    if (partial.antonyms) for (const a of partial.antonyms) antonyms.add(a);
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

  // Pick clean lexical translations from all source-attributed candidates.
  const lexicalTranslations = pickLexicalTranslations(token, allTrans, ctx);
  if (lexicalTranslations.length) {
    // `translation` remains the best/current-context primary gloss, while
    // `bilingual` intentionally keeps a wider learner-facing list. Subtitle
    // context can disambiguate the first item, but learners benefit from
    // seeing the main alternate senses too.
    entry.translation = lexicalTranslations[0];
    entry.bilingual = lexicalTranslations.slice(0, MAX_BILINGUAL_GLOSSES).join(' · ');
  }

  // Synonyms / antonyms / collocations / audio go on entry directly so
  // the popover and the Anki mapper don't have to dig into vip.*
  if (synonyms.size) entry.synonyms = Array.from(synonyms).slice(0, 12);
  if (antonyms.size) entry.antonyms = Array.from(antonyms).slice(0, 8);
  const rankedCollocations = pickCollocations(token, collocationCandidates);
  if (rankedCollocations.length) entry.collocations = rankedCollocations;
  // Multi-word fallback: for idioms / phrasals / MWEs, when no
  // collocations were found, promote multi-word synonyms (which are
  // themselves fixed phrases like "easy as pie", "child's play") into
  // the collocations slot. Single-word synonyms are skipped — they
  // wouldn't match the "collocation" semantics. This closes the gap
  // for entries like "piece of cake" which have rich synonym lists
  // but no separate "Related terms" section in Wiktionary.
  if (!entry.collocations && token.includes(' ') && synonyms.size) {
    const mwe = Array.from(synonyms).filter((s) => s.includes(' '));
    if (mwe.length) entry.collocations = mwe.slice(0, 12);
  }
  if (audio.length) entry.audio = audio.slice(0, 8);

  // VIP block surfaces full source-attributed lists.
  if (allDefs.length) vip.definitions = allDefs.slice(0, 12);
  if (allTrans.length) vip.translations = allTrans.slice(0, 12);
  if (allExamples.length) vip.examples = allExamples.slice(0, 12);
  if (videoLinks.length) vip.videoLinks = videoLinks;

  // Pick a primary monolingual definition and primary examples for the
  // popover top fold, prefer Longman / Cambridge over the rest.
  const monoPriority = ['longman', 'cambridge', 'oxfordLearners', 'collins', 'merriamWebster', 'britannicaDictionary', 'wiktApi', 'wiktionaryApi', 'wiktionary', 'freeDictionary', 'bundled'];
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
  vipEnabled: boolean,
  purpose: 'popover' | 'card',
): string {
  // Tier is part of the key: a word looked up in Standard mode must NOT
  // satisfy a later VIP lookup (the VIP result is a superset). Without
  // this, flipping the VIP switch ON would keep serving the stale
  // Standard-only payload from cache until the TTL expired.
  // Purpose is also part of the key: the popover payload omits images, so
  // it must not satisfy a card lookup (which needs them) and vice-versa.
  const tier = vipEnabled ? 'vip' : 'std';
  return `${purpose}|${tier}|${ctx.sourceLang}|${ctx.targetLang}|${token.trim().toLowerCase()}`;
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
