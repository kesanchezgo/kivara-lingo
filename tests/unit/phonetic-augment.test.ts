/**
 * Unit tests for the phonetic-fallback augmenter.
 *
 * The augmenter is a pure-ish module on top of `fetch` + `chrome.storage.local`.
 * We replace both with deterministic stand-ins so the tests stay synchronous
 * and don't hit the real Wiktionary API.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetInflightForTests,
  extractIpa,
  getMissingPhonetic,
  isExpired,
  normalizeToken,
} from '../../src/background/phonetic-augment';

interface ChromeStorageLocal {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

function mountStatefulStorage(): ChromeStorageLocal {
  const store = new Map<string, unknown>();
  const local: ChromeStorageLocal = {
    get: vi.fn(async (key: string) => {
      const value = store.get(key);
      return value === undefined ? {} : { [key]: value };
    }),
    set: vi.fn(async (entry: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(entry)) store.set(k, v);
    }),
    remove: vi.fn(async () => undefined),
  };
  const chrome = (globalThis as { chrome?: { storage?: { local?: ChromeStorageLocal } } }).chrome;
  if (chrome?.storage) chrome.storage.local = local;
  return local;
}

interface FetchOk {
  ok: true;
  payload: unknown;
}
interface FetchNotOk {
  ok: false;
  status: number;
}
type FetchPlan = FetchOk | FetchNotOk | { throws: Error };

function mountFetch(plans: FetchPlan[]): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    calls.push(typeof input === 'string' ? input : input.toString());
    const plan = plans[i] ?? plans[plans.length - 1];
    i += 1;
    if ('throws' in plan) throw plan.throws;
    if (!plan.ok) {
      return { ok: false, status: plan.status, json: async () => undefined } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => plan.payload,
    } as Response;
  }) as unknown as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

describe('normalizeToken', () => {
  it('lowercases and trims valid English single-word tokens', () => {
    expect(normalizeToken('Hello', 'en')).toBe('hello');
    expect(normalizeToken('  WORLD  ', 'en')).toBe('world');
    expect(normalizeToken("don't", 'en')).toBe("don't");
    expect(normalizeToken('mother-in-law', 'en')).toBe('mother-in-law');
  });

  it('rejects non-English languages outright', () => {
    expect(normalizeToken('hola', 'es')).toBeNull();
    expect(normalizeToken('hello', 'de')).toBeNull();
    expect(normalizeToken('hello', '')).toBeNull();
  });

  it('rejects tokens with digits, spaces, or non-Latin glyphs', () => {
    expect(normalizeToken('test123', 'en')).toBeNull();
    expect(normalizeToken('two words', 'en')).toBeNull();
    expect(normalizeToken('café', 'en')).toBeNull();
    expect(normalizeToken('日本語', 'en')).toBeNull();
  });

  it('rejects empty strings and absurdly long tokens', () => {
    expect(normalizeToken('', 'en')).toBeNull();
    expect(normalizeToken('   ', 'en')).toBeNull();
    expect(normalizeToken('a'.repeat(31), 'en')).toBeNull();
  });
});

describe('extractIpa', () => {
  it('returns the top-level phonetic field when present', () => {
    expect(
      extractIpa([
        {
          phonetic: '/həˈloʊ/',
          phonetics: [{ text: '/different/' }],
        },
      ]),
    ).toBe('/həˈloʊ/');
  });

  it('falls back to the first phonetics array entry with text', () => {
    expect(
      extractIpa([
        {
          phonetic: '   ',
          phonetics: [{ audio: 'https://example/a.mp3' }, { text: '/wɜːrld/' }],
        },
      ]),
    ).toBe('/wɜːrld/');
  });

  it('returns null when neither field carries a usable string', () => {
    expect(extractIpa([{}])).toBeNull();
    expect(extractIpa([{ phonetic: '', phonetics: [{}] }])).toBeNull();
    expect(extractIpa(null)).toBeNull();
    expect(extractIpa('not an array')).toBeNull();
  });
});

describe('isExpired', () => {
  const NOW = 100 * 86_400_000; // day 100 in epoch-ms

  it('keeps fresh hits valid for 30 days', () => {
    expect(isExpired({ ipa: '/x/', ts: NOW - 29 * 86_400_000 }, NOW)).toBe(false);
    expect(isExpired({ ipa: '/x/', ts: NOW - 31 * 86_400_000 }, NOW)).toBe(true);
  });

  it('expires misses after 1 day so transient API failures retry', () => {
    expect(isExpired({ ipa: null, ts: NOW - 12 * 60 * 60 * 1_000 }, NOW)).toBe(false);
    expect(isExpired({ ipa: null, ts: NOW - 25 * 60 * 60 * 1_000 }, NOW)).toBe(true);
  });
});

describe('getMissingPhonetic', () => {
  beforeEach(() => {
    _resetInflightForTests();
    mountStatefulStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the IPA from the API on a fresh lookup', async () => {
    const { restore, calls } = mountFetch([
      {
        ok: true,
        payload: [{ phonetic: '/həˈloʊ/' }],
      },
    ]);
    try {
      const ipa = await getMissingPhonetic('hello', 'en');
      expect(ipa).toBe('/həˈloʊ/');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain('/api/v2/entries/en/hello');
    } finally {
      restore();
    }
  });

  it('serves the second call from cache without re-fetching', async () => {
    const { restore, calls } = mountFetch([
      { ok: true, payload: [{ phonetic: '/wɜːrld/' }] },
    ]);
    try {
      await getMissingPhonetic('world', 'en');
      const second = await getMissingPhonetic('world', 'en');
      expect(second).toBe('/wɜːrld/');
      expect(calls).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('caches misses to avoid hammering the API', async () => {
    const { restore, calls } = mountFetch([{ ok: false, status: 404 }]);
    try {
      const first = await getMissingPhonetic('xyzzyabc', 'en');
      const second = await getMissingPhonetic('xyzzyabc', 'en');
      expect(first).toBeNull();
      expect(second).toBeNull();
      expect(calls).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('skips the network entirely for non-EN tokens', async () => {
    const { restore, calls } = mountFetch([{ ok: true, payload: [] }]);
    try {
      const ipa = await getMissingPhonetic('hola', 'es');
      expect(ipa).toBeNull();
      expect(calls).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it('skips MWEs and tokens with unsupported characters', async () => {
    const { restore, calls } = mountFetch([{ ok: true, payload: [] }]);
    try {
      expect(await getMissingPhonetic('two words', 'en')).toBeNull();
      expect(await getMissingPhonetic('test123', 'en')).toBeNull();
      expect(calls).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it('returns null and caches a miss when fetch throws', async () => {
    const { restore, calls } = mountFetch([
      { throws: new TypeError('network unreachable') },
      { ok: true, payload: [{ phonetic: '/never-called/' }] },
    ]);
    try {
      const first = await getMissingPhonetic('lookup', 'en');
      const second = await getMissingPhonetic('lookup', 'en');
      expect(first).toBeNull();
      // Cached miss → second call does not hit the network.
      expect(second).toBeNull();
      expect(calls).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('coalesces simultaneous calls for the same token', async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const fetchPromise = new Promise<Response>((r) => {
      resolveFetch = r;
    });
    const original = globalThis.fetch;
    const fetchSpy = vi.fn(() => fetchPromise);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const a = getMissingPhonetic('coalesce', 'en');
      const b = getMissingPhonetic('coalesce', 'en');
      const c = getMissingPhonetic('coalesce', 'en');
      resolveFetch({
        ok: true,
        status: 200,
        json: async () => [{ phonetic: '/koʊ/' }],
      } as Response);
      const [ra, rb, rc] = await Promise.all([a, b, c]);
      expect(ra).toBe('/koʊ/');
      expect(rb).toBe('/koʊ/');
      expect(rc).toBe('/koʊ/');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});
