/**
 * The enrichment caches read and write their Dexie tables through TYPES
 * (debt D3).
 *
 * Every access used to go through `(db as any).vip_cache`, which erased the
 * row type: a row whose `payload` was anything at all came back as an
 * `EnrichmentResult` and was handed to the panel. The tables are declared on
 * the DB now, `payload` is `unknown` until a shallow validator accepts it, and
 * an unreadable row is a MISS (and gets cleared) instead of a poisoned hit.
 *
 * This file is also the compile-time gate for the BYOK keys on the context:
 * `EnrichmentContext` did not declare `unsplashAccessKey` / `pixabayApiKey`,
 * so a source could only read them through `(ctx as any)`.
 */
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { EnrichmentContext, EnrichmentSource } from '../../src/background/enrichment/types';
import { getDB } from '../../src/shared/db';
import {
  clearEnrichmentCache,
  getEnrichmentCacheStats,
  readEnrichmentCache,
  writeEnrichmentCache,
} from '../../src/background/enrichment/cache';
import type { EnrichmentResult } from '../../src/background/enrichment/types';

const RESULT: EnrichmentResult = {
  entry: null,
  vip: { definitions: ['a sense'] },
} as unknown as EnrichmentResult;

afterEach(async () => {
  await getDB().vip_cache.clear();
});

describe('vip_cache through the typed table', () => {
  it('round-trips a cached answer', async () => {
    await writeEnrichmentCache('key-a', RESULT, 30);
    const hit = await readEnrichmentCache('key-a', 30);
    expect(hit).toMatchObject({ vip: { definitions: ['a sense'] } });
  });

  it('treats a row this build cannot read as a miss AND clears it', async () => {
    // A row written by some other build (or corrupted): payload is not an
    // object. Before the narrowing this came back as a hit and the panel read
    // `undefined` fields out of a string.
    await getDB().vip_cache.put({ key: 'garbage', payload: 'not-an-object', storedAt: Date.now() });
    const hit = await readEnrichmentCache('garbage', 30);
    expect(hit).toBeNull();
    expect(await getDB().vip_cache.get('garbage')).toBeUndefined();
  });

  it('counts the rows it can see', async () => {
    await writeEnrichmentCache('key-b', RESULT, 30);
    const stats = await getEnrichmentCacheStats();
    expect(stats.count).toBeGreaterThanOrEqual(1);
  });

  it('clears every row and reports the count', async () => {
    await writeEnrichmentCache('key-c', RESULT, 30);
    const cleared = await clearEnrichmentCache();
    expect(cleared).toBeGreaterThanOrEqual(1);
    expect(await getDB().vip_cache.count()).toBe(0);
  });
});

describe('EnrichmentContext declares the BYOK image keys', () => {
  it('lets a source read the credentials without a cast', async () => {
    const ctx: EnrichmentContext = {
      sourceLang: 'en',
      targetLang: 'es',
      timeoutMs: 1000,
      unsplashAccessKey: 'unsplash-key',
      pixabayApiKey: 'pixabay-key',
    };
    // The source signature is the real one: no `as any` anywhere in this file.
    const source: EnrichmentSource = {
      id: 'fake',
      label: 'Fake',
      enrich: async (_token, context) => ({
        imageUrl: `https://example.test/${context.unsplashAccessKey}/${context.pixabayApiKey}`,
      }),
    };
    const partial = await source.enrich('word', ctx);
    expect(partial.imageUrl).toBe('https://example.test/unsplash-key/pixabay-key');
  });
});
