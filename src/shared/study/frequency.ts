/**
 * Subtitle frequency list, loaded lazily (docs/REDESIGN-V2.md §3 H8, §5.3).
 *
 * The committed list (src/assets/frequency/en-rank.json) is 21,731 lemmas and
 * ~345 KB of JSON. Importing it would put it in the content-script bundle on
 * every streaming page for a feature the user may never open, so it is fetched
 * at runtime from the extension origin (`chrome.runtime.getURL`) once per
 * language and cached in memory. The manifest's `web_accessible_resources`
 * publishes the folder.
 *
 * Parsing and caching are pure: `createFrequencyCache(load)` takes the loader,
 * so a test can drive it without a browser or a `chrome` object. `frequency`
 * is the module-level cache wired to the real loader.
 */

export interface FrequencyRanks {
  /** Number of lemmas with a rank. */
  readonly size: number;
  /** 1-based rank of a lemma (most frequent = 1), or null when the list has no entry. */
  rankOf(lemma: string): number | null;
}

/** Ranks are keyed on the citation form; typographic apostrophes fold to ASCII. */
const normalize = (s: string): string => s.replace(/[\u2018\u2019\u02BC]/g, "'").trim().toLowerCase();

/**
 * Turn the committed shape (`{ _meta, "<lemma>": <rank> }`) into a lookup.
 * Ragged values are dropped rather than coerced: a string rank would poison
 * every `Math.log` downstream.
 */
export function parseFrequency(raw: unknown): FrequencyRanks {
  const ranks = new Map<string, number>();
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (key === '_meta') continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) continue;
      const lemma = normalize(key);
      if (lemma) ranks.set(lemma, value);
    }
  }
  return {
    size: ranks.size,
    rankOf: (lemma) => ranks.get(normalize(lemma)) ?? null,
  };
}

export interface FrequencyCache {
  /** Parsed list if the language was already loaded, else null. */
  peek(lang: string): FrequencyRanks | null;
  /** Load (once) and return the parsed list; null when the language has no list or the fetch failed. */
  get(lang: string): Promise<FrequencyRanks | null>;
  /** Forget everything (tests, language switch debugging). */
  reset(): void;
}

/**
 * Cache the parsed list per language. Concurrent callers share one promise, a
 * failed load is not cached as a failure (the next call retries), and a
 * language with no shipped list resolves to null without a request.
 */
export function createFrequencyCache(load: (lang: string) => Promise<unknown>): FrequencyCache {
  const done = new Map<string, FrequencyRanks>();
  const pending = new Map<string, Promise<FrequencyRanks | null>>();
  return {
    peek: (lang) => done.get(lang) ?? null,
    get(lang) {
      const cached = done.get(lang);
      if (cached) return Promise.resolve(cached);
      const inFlight = pending.get(lang);
      if (inFlight) return inFlight;
      const promise = (async () => {
        try {
          const parsed = parseFrequency(await load(lang));
          done.set(lang, parsed);
          return parsed;
        } catch {
          return null;
        } finally {
          pending.delete(lang);
        }
      })();
      pending.set(lang, promise);
      return promise;
    },
    reset() {
      done.clear();
      pending.clear();
    },
  };
}

/** Shipped lists, by language being learned. Others fall back to the model's prior. */
const FILES: Record<string, string> = {
  en: 'src/assets/frequency/en-rank.json',
};

/** Does a language have a shipped list? Shared by the UI to say what it can measure. */
export function hasFrequencyList(lang: string): boolean {
  return lang in FILES;
}

function assetUrl(file: string): string {
  try {
    const runtime = (globalThis as { chrome?: { runtime?: { getURL?: (p: string) => string } } }).chrome?.runtime;
    if (runtime?.getURL) return runtime.getURL(file);
  } catch {
    /* no extension runtime — fall through to the document-relative path */
  }
  return `/${file}`;
}

async function fetchFrequency(lang: string): Promise<unknown> {
  const file = FILES[lang];
  if (!file) return null;
  if (typeof fetch !== 'function') return null;
  const response = await fetch(assetUrl(file));
  if (!response.ok) throw new Error(`frequency ${lang}: HTTP ${response.status}`);
  return response.json();
}

/** The process-wide cache the app reads. */
export const frequency: FrequencyCache = createFrequencyCache(fetchFrequency);
