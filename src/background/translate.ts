/// <reference types="chrome" />

import { lookupDictionary } from '../content/nlp/dictionary';
import type {
  DictionaryEntry,
  TranslateProvider,
  TranslateRequest,
  TranslateResponse,
  TranslateSettings,
} from '../shared/types';
import { DEFAULT_TRANSLATE } from '../shared/store';
import { callChain, callChainRaced, callOne } from './translate-providers';
import type { ChainStep } from './translate-providers';
import { getDB, translationCacheKey } from '../shared/db';
import { decryptSecret } from '../shared/secret-store';

const STORE_KEY = 'kivara-lingo-state';

let lastCallAt = 0;
const DEBOUNCE_MS = 200;

/**
 * Strip TMX/XLIFF placeholder tags (`<g id="…">…</g>`) and any other stray
 * HTML/XML markup from a translation string. Some providers — most notably
 * MyMemory and LibreTranslate when the source contains markup — return their
 * internal placeholders as part of the translated payload. We sanitize at
 * the cache boundary so those tags never reach the popover or the bilingual
 * subtitle line.
 */
function sanitizeTranslation(value: string): string {
  if (!value || (!value.includes('<') && !value.includes('>'))) return value;
  const stripped = value
    .replaceAll('<', ' ')
    .replaceAll('>', ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return stripped || value;
}

/**
 * Read the persisted Zustand store from chrome.storage.sync, then merge with
 * the defaults so older snapshots (missing the chain-mode fields) keep
 * working without a re-onboard.
 */
async function loadSettings(): Promise<TranslateSettings> {
  try {
    const raw = await chrome.storage.sync.get(STORE_KEY);
    const value = raw[STORE_KEY];
    if (typeof value !== 'string') return DEFAULT_TRANSLATE;
    const parsed = JSON.parse(value);
    const t = parsed?.state?.translate ?? parsed?.translate;
    if (t && typeof t === 'object') {
      const merged: TranslateSettings = { ...DEFAULT_TRANSLATE, ...t };
      // tiersEnabled is a nested object — JSON merge needs to be explicit so we
      // don't lose the `free`/`premium` keys when the persisted value omits
      // them.
      merged.tiersEnabled = {
        ...DEFAULT_TRANSLATE.tiersEnabled,
        ...(t.tiersEnabled ?? {}),
      };
      if (!Array.isArray(merged.freeChain)) merged.freeChain = DEFAULT_TRANSLATE.freeChain;
      if (!Array.isArray(merged.premiumChain))
        merged.premiumChain = DEFAULT_TRANSLATE.premiumChain;

      // Transparent decryption of premium provider tokens. Cleartext
      // values are passed through unchanged so legacy installs and
      // self-hosted LibreTranslate without a key keep working.
      if (merged.deeplToken) merged.deeplToken = await decryptSecret(merged.deeplToken);
      if (merged.googleToken) merged.googleToken = await decryptSecret(merged.googleToken);
      if (merged.libreTranslateToken) {
        merged.libreTranslateToken = await decryptSecret(merged.libreTranslateToken);
      }
      return merged;
    }
  } catch (err) {
    console.warn('[Kivara Lingo] could not read translate settings', err);
  }
  return DEFAULT_TRANSLATE;
}

/**
 * Phase 1 surface: returns a DictionaryEntry-ish blob assembled either from
 * the bundled dictionary or from the live translation provider chain.
 *
 * If the bundled dictionary has the word but is missing phonetic/monolingual,
 * we still call the remote provider and merge the remote translation into the
 * local entry so the Anki card gets populated fields.
 */
export async function translateToken(
  token: string,
  lang = 'en',
): Promise<DictionaryEntry | null> {
  // Always try the local dictionary first — it has phonetics and definitions.
  const entry = lookupDictionary(token, lang);

  // Even when the local entry is complete, still ask the configured MT
  // chain for the short bilingual gloss. The bundled dictionary is fast and
  // good for IPA/definitions, but some lexical translations are too literal
  // or POS-skewed for learners (e.g. adjective "wonderful" → noun
  // "maravilla"). Save/hover quality is better when the MT chain can
  // replace the bundled Spanish gloss while we keep the local IPA/examples.

  // Fall back to the configured provider(s) for unknown tokens OR to
  // supplement a local entry that is missing/weak translation fields.
  const settings = await loadSettings();
  if (settings.mode === 'single' && settings.provider === 'offline') return entry ?? null;

  const remote = await translateText({
    text: token,
    sourceLang: lang,
    targetLang: settings.targetLanguage,
  });

  if (!remote.ok || !remote.translatedText) return entry ?? null;

  // If we had a local entry, let the configured translator own the bilingual
  // gloss while preserving local IPA, monolingual definitions and examples.
  if (entry) {
    return {
      ...entry,
      translation: remote.translatedText || entry.translation,
      bilingual: remote.translatedText || entry.bilingual || entry.translation,
      // phonetic and monolingual stay as-is if the local dict has them
    };
  }

  return {
    token,
    type: token.includes(' ') ? 'phrase' : 'word',
    translation: remote.translatedText,
    bilingual: remote.translatedText,
  };
}

/**
 * Build the ordered provider list for chain mode. Tier order is fixed
 * (offline → free → premium) but inside each tier the user can reorder.
 *
 * Offline is *not* in the returned list because it's handled separately
 * (cache + bundled dictionary, both in-process, before we even attempt
 * networked providers).
 */
function buildChain(settings: TranslateSettings): TranslateProvider[] {
  const chain: TranslateProvider[] = [];
  if (settings.tiersEnabled.free) {
    for (const p of settings.freeChain) {
      if (p !== 'offline' && !chain.includes(p)) chain.push(p);
    }
  }
  if (settings.tiersEnabled.premium) {
    for (const p of settings.premiumChain) {
      if (p === 'offline' || chain.includes(p)) continue;
      // Drop premium providers that the user hasn't credentialed yet so chain
      // mode doesn't waste a round-trip producing a `*-token-missing` error.
      if (p === 'deepl' && !settings.deeplToken) continue;
      if (p === 'google' && !settings.googleToken) continue;
      // LibreTranslate allows anonymous public-instance calls so we keep it
      // even when the API key is empty.
      chain.push(p);
    }
  }
  return chain;
}

/**
 * Translate arbitrary text. Used both internally (translateToken fallback)
 * and by the popup/options panel to translate the full sentence.
 *
 * Caches results in IndexedDB so repeated lookups for the same word/phrase
 * don't hit DeepL/Google quotas.
 */
export async function translateText(req: TranslateRequest): Promise<TranslateResponse> {
  const text = req.text.trim();
  if (!text) return { ok: true, translatedText: '', provider: 'offline', cached: false };

  const settings = await loadSettings();
  const target = req.targetLang || settings.targetLanguage;

  // 1. In-process cache lookup. We key on a synthetic 'chain'/'single' provider
  // string so switching modes doesn't collide with old per-provider entries.
  const cacheProvider: string =
    settings.mode === 'chain' ? 'chain' : settings.provider;
  const cacheKey = translationCacheKey(cacheProvider, req.sourceLang, target, text);
  try {
    const cached = await getDB().translation_cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        ok: true,
        // Older cached entries may predate the sanitizer — clean on read so
        // existing users don't have to nuke IndexedDB.
        translatedText: sanitizeTranslation(cached.translatedText),
        provider: cacheProvider,
        cached: true,
      };
    }
  } catch (err) {
    console.warn('[Kivara Lingo] translation cache read failed', err);
  }

  // 2. Debounce: at most one outbound call every DEBOUNCE_MS to respect
  // free-tier quotas (especially MyMemory's 5000 chars/day anonymous cap).
  const sinceLast = Date.now() - lastCallAt;
  if (sinceLast < DEBOUNCE_MS) {
    await new Promise((r) => setTimeout(r, DEBOUNCE_MS - sinceLast));
  }
  lastCallAt = Date.now();

  // 3. Decide which mode we're in and execute.
  let result:
    | { ok: true; translatedText: string; provider: TranslateProvider; attempted?: ChainStep[] }
    | { ok: false; error: string; provider: TranslateProvider; attempted?: ChainStep[] };
  if (settings.mode === 'single') {
    if (settings.provider === 'offline') {
      return {
        ok: false,
        error: 'Translation provider is set to offline.',
        provider: 'offline',
      };
    }
    const r = await callOne(settings.provider, text, req.sourceLang, target, settings);
    result = r.ok
      ? { ok: true, translatedText: r.translatedText, provider: r.provider }
      : { ok: false, error: r.error, provider: r.provider };
  } else {
    const chain = buildChain(settings);
    if (chain.length === 0) {
      return {
        ok: false,
        error:
          'No translation providers enabled in chain mode. Enable free or premium tier in Settings.',
        provider: 'offline',
      };
    }
    // Split the chain into FREE (raced concurrently — fastest wins) and
    // PREMIUM (tried sequentially after, to honour the user's preference
    // order and avoid burning paid quota in parallel). This turns the
    // common free-tier path's latency from "MyMemory THEN Lingva" into
    // "fastest of {MyMemory, Lingva}" without changing which answer we
    // keep when both succeed.
    const FREE_SET = new Set<TranslateProvider>(['mymemory', 'lingva']);
    const freeChain = chain.filter((p) => FREE_SET.has(p));
    const premiumChain = chain.filter((p) => !FREE_SET.has(p));

    let r = await callChainRaced(freeChain, text, req.sourceLang, target, settings);
    // If the free race produced nothing, fall through to the premium
    // providers in their configured order.
    if (!r.ok && premiumChain.length > 0) {
      const pr = await callChain(premiumChain, text, req.sourceLang, target, settings);
      // Merge attempted lists for telemetry/debugging.
      if (pr.ok) {
        r = { ...pr, attempted: [...r.attempted, ...pr.attempted] };
      } else {
        r = { ok: false, error: pr.error, attempted: [...r.attempted, ...pr.attempted] };
      }
    }
    result = r.ok
      ? {
          ok: true,
          translatedText: r.translatedText,
          provider: r.provider,
          attempted: r.attempted,
        }
      : {
          ok: false,
          error: r.error,
          provider: 'offline',
          attempted: r.attempted,
        };
  }

  // 4. Cache successful results.
  if (result.ok) {
    // Defensive: scrub provider markup before caching. Once it lands in the
    // cache the same string is re-served forever, so this is the right
    // single chokepoint to clean translations.
    const cleanedText = sanitizeTranslation(result.translatedText);
    const ttl = (settings.cacheTtlDays || 30) * 24 * 60 * 60 * 1000;
    try {
      await getDB().translation_cache.put({
        key: cacheKey,
        provider: cacheProvider,
        sourceLang: req.sourceLang,
        targetLang: target,
        sourceText: text,
        translatedText: cleanedText,
        expiresAt: Date.now() + ttl,
        createdAt: Date.now(),
      });
    } catch (err) {
      console.warn('[Kivara Lingo] translation cache write failed', err);
    }
    return {
      ok: true,
      translatedText: cleanedText,
      provider: result.provider,
      cached: false,
    };
  }

  return { ok: false, error: result.error, provider: result.provider };
}
