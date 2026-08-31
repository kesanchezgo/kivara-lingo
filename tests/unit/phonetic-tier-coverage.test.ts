import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression tests for the 2026-08-31 IPA gap: `phoneticPriority` only
 * consulted the six editorial VIP sources, so a Standard-tier word whose
 * IPA lives in wiktApi/wiktionaryApi/wiktionary published NO phonetic —
 * even though the Standard source had returned one (verified live:
 * `apple` and `tensor` had wiktApi phonetic in the source logs but an
 * empty field on the card).
 */

// Mock the Standard-tier source that carries the IPA. Following the same
// pattern as enrichment-orchestrator.test.ts — no real network here.
const enrichWiktApi = vi.fn(async () => ({
  phonetic: '/ˈæp.əl/',
  definitions: ['a round fruit with firm white flesh'],
}));
vi.mock('../../src/background/enrichment/sources/wiktapi', () => ({
  wiktApiSource: { id: 'wiktApi', label: 'WiktApi', enrich: enrichWiktApi },
}));

const enrichFreeDictionary = vi.fn(async () => ({
  definitions: ['a round fruit'],
}));
vi.mock('../../src/background/enrichment/sources/free-dictionary', () => ({
  freeDictionarySource: { id: 'freeDictionary', label: 'Free Dictionary', enrich: enrichFreeDictionary },
}));

vi.mock('../../src/shared/db', () => ({ getDB: () => ({}) }));

const {
  clearMemEnrichmentCache,
  runEnrichment,
} = await import('../../src/background/enrichment/orchestrator');
const { DEFAULT_VIP } = await import('../../src/shared/store');

function withSources(overrides: Record<string, boolean>) {
  return {
    ...Object.fromEntries(
      Object.entries(DEFAULT_VIP).map(([key, value]) => [key, typeof value === 'boolean' ? false : value]),
    ),
    ...overrides,
  } as never;
}

describe('phonetic coverage across tiers', () => {
  beforeEach(() => {
    clearMemEnrichmentCache();
    enrichWiktApi.mockClear();
    enrichFreeDictionary.mockClear();
  });

  it('uses a Standard source IPA when no editorial source provides one', async () => {
    // wiktApi (Standard) is the ONLY source with a phonetic; freeDictionary
    // carries none. Before the fix, phoneticPriority ignored wiktApi and
    // the card shipped with an empty IPA.
    const result = await runEnrichment('apple', {
      sourceLang: 'en',
      targetLang: 'es',
      sentence: 'She ate a ripe apple.',
      vip: withSources({ wiktApi: true, freeDictionary: true, enabled: false }),
      bypassCache: true,
    });

    expect(result.entry?.phonetic).toBe('/ˈæp.əl/');
  });

  it('keeps preferring the editorial source when both tiers have an IPA', async () => {
    enrichFreeDictionary.mockResolvedValueOnce({
      phonetic: '/ˈæp.əl/ (editorial)',
      definitions: ['a round fruit'],
    });

    const result = await runEnrichment('apple', {
      sourceLang: 'en',
      targetLang: 'es',
      sentence: 'She ate a ripe apple.',
      vip: withSources({ wiktApi: true, freeDictionary: true, enabled: false }),
      bypassCache: true,
    });

    // freeDictionary ranks before wiktApi in the priority list — the
    // editorial-shape IPA wins.
    expect(result.entry?.phonetic).toBe('/ˈæp.əl/ (editorial)');
  });

  it('leaves the IPA empty for multi-word tokens unless the phonetic spans the phrase', async () => {
    // "break up" with a single-word IPA is the WRONG entry's phonetic —
    // the whole-phrase guard must keep the field empty.
    enrichWiktApi.mockResolvedValueOnce({
      phonetic: '/breɪk/',
      definitions: [],
    });

    const result = await runEnrichment('break up', {
      sourceLang: 'en',
      targetLang: 'es',
      sentence: 'They decided to break up after college.',
      vip: withSources({ wiktApi: true, freeDictionary: true, enabled: false }),
      bypassCache: true,
    });

    expect(result.entry?.phonetic ?? '').toEqual('');
  });
});
