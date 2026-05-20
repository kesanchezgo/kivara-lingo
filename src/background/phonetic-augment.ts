/**
 * Phonetic-fallback augmenter.
 *
 * Some packs (notably the bundled CEFR dictionary and the Wiktionary EN→ES
 * pack) bring translations and definitions but no IPA. The user ends up with
 * Anki cards whose `phonetic` field is empty even though they specifically
 * mapped one. This module fills that gap on the save path by hitting the free
 * Wiktionary-derived `api.dictionaryapi.dev` endpoint, extracting an IPA
 * string, and caching the result aggressively in `chrome.storage.local` so
 * the same word never triggers a second network call.
 *
 * Design choices:
 *   - Save-path only — running this on every hover would amplify network use
 *     for the popover UX where the existing IPA-or-nothing behaviour is
 *     already acceptable.
 *   - Opt-out is implicit: tokens that don't match the EN-word filter
 *     (lowercase ASCII letters, length 1-30) skip the call entirely. Proper
 *     nouns, MWEs, numbers, and hyphenated compounds like `state-of-the-art`
 *     are excluded so we never spend a request on a token the public API
 *     can't resolve.
 *   - Cache shape: `{ ipa: string; ts: number }` for hits, `{ ipa: null;
 *     ts: number }` for misses. Both keyed under the same prefix so a single
 *     `storage.get` reads either. Hits live 30d, misses 1d.
 *   - Two-level dedup: an in-memory map coalesces simultaneous requests for
 *     the same token; the persistent cache survives SW restarts.
 *   - Graceful degradation: any error (network, timeout, malformed response,
 *     storage unavailable) returns null and is logged at warn-level. Anki
 *     card creation never fails because of this module.
 */

const ENDPOINT_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en';
const REQUEST_TIMEOUT_MS = 1_500;
const HIT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MISS_TTL_MS = 1 * 24 * 60 * 60 * 1_000;
const CACHE_KEY_PREFIX = 'phonetic-augment:';

interface CacheEntry {
  /** The IPA string we successfully extracted, or `null` for cached misses. */
  ipa: string | null;
  /** Timestamp the entry was written, ms epoch. Used to apply TTLs. */
  ts: number;
}

/**
 * In-flight requests keyed by storage key. Multiple saves of the same word
 * fired in quick succession (e.g. a fast learner queuing several cards)
 * collapse to a single network call.
 */
const inflight = new Map<string, Promise<string | null>>();

/**
 * Public API used by the capture orchestrator. Returns the cached or freshly
 * fetched IPA for `token`, or `null` if we couldn't get one for any reason.
 */
export async function getMissingPhonetic(
  token: string,
  lang: string,
  now: number = Date.now(),
): Promise<string | null> {
  const normalized = normalizeToken(token, lang);
  if (!normalized) return null;
  const key = cacheKey(normalized);
  const cached = await readCache(key);
  if (cached && !isExpired(cached, now)) return cached.ipa;
  const inflightPromise = inflight.get(key);
  if (inflightPromise) return inflightPromise;
  const work = fetchAndCache(normalized, key, now);
  inflight.set(key, work);
  try {
    return await work;
  } finally {
    inflight.delete(key);
  }
}

/**
 * Pure validator + lowercaser. Exposed for tests.
 *
 * Returns the canonical token (lowercased, trimmed) when it's a viable EN
 * single-word lookup, or `null` to signal "skip the network call".
 */
export function normalizeToken(token: string, lang: string): string | null {
  if (lang !== 'en') return null;
  const trimmed = token.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 30) return null;
  if (!/^[a-z'’-]+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Pure extractor that walks the dictionaryapi.dev response shape and pulls
 * out the first non-empty IPA string. Exposed for tests.
 *
 * The response is an array of "entry" objects, each carrying a `phonetic`
 * (single string) and a `phonetics` array (objects with `text` and optional
 * `audio` URLs). We try `phonetic` first, then the first `phonetics[].text`,
 * and finally bail.
 */
export function extractIpa(payload: unknown): string | null {
  if (!Array.isArray(payload)) return null;
  for (const entry of payload) {
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as Record<string, unknown>;
    const direct = typeof obj.phonetic === 'string' ? obj.phonetic.trim() : '';
    if (direct) return direct;
    if (Array.isArray(obj.phonetics)) {
      for (const ph of obj.phonetics) {
        if (!ph || typeof ph !== 'object') continue;
        const text = (ph as Record<string, unknown>).text;
        if (typeof text === 'string' && text.trim()) return text.trim();
      }
    }
  }
  return null;
}

/**
 * Apply the appropriate TTL based on whether the cache entry was a hit
 * (`ipa !== null`) or a miss. Exposed for tests.
 */
export function isExpired(entry: CacheEntry, now: number): boolean {
  const ttl = entry.ipa === null ? MISS_TTL_MS : HIT_TTL_MS;
  return now - entry.ts > ttl;
}

function cacheKey(normalized: string): string {
  return `${CACHE_KEY_PREFIX}${normalized}`;
}

async function readCache(key: string): Promise<CacheEntry | null> {
  try {
    const got = await chrome.storage.local.get(key);
    const entry = got[key];
    if (entry && typeof entry === 'object' && typeof (entry as CacheEntry).ts === 'number') {
      return entry as CacheEntry;
    }
  } catch (err) {
    console.warn('[Kivara phonetic-augment] storage read failed', err);
  }
  return null;
}

async function writeCache(key: string, entry: CacheEntry): Promise<void> {
  try {
    await chrome.storage.local.set({ [key]: entry });
  } catch (err) {
    console.warn('[Kivara phonetic-augment] storage write failed', err);
  }
}

async function fetchAndCache(
  normalized: string,
  key: string,
  now: number,
): Promise<string | null> {
  const ipa = await fetchIpa(normalized);
  await writeCache(key, { ipa, ts: now });
  return ipa;
}

async function fetchIpa(normalized: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = `${ENDPOINT_BASE}/${encodeURIComponent(normalized)}`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    return extractIpa(payload);
  } catch (err) {
    if ((err as { name?: string })?.name !== 'AbortError') {
      console.warn('[Kivara phonetic-augment] fetch failed', err);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Test-only helper that drops the in-memory inflight map. Production code
 * never calls this — the map is naturally cleared as promises settle.
 */
export function _resetInflightForTests(): void {
  inflight.clear();
}
