/**
 * `getEnrichmentCacheStats` — the byte estimate the cache panel prints.
 *
 * The keys are part of what the extension stores too, and dropping them from
 * the estimate made the panel under-report a table whose keys are about as
 * long as their payloads. There is no IndexedDB under happy-dom, so `getDB()`
 * is driven here through a stub table; that is the whole point of counting the
 * key length.
 */
import { describe, it, expect, vi } from 'vitest';
import { getEnrichmentCacheStats } from '../../src/background/enrichment/cache';

function installTable(rows: Array<{ key: string; payload: unknown; storedAt: number }>): void {
  vi.doMock('../../src/shared/db', () => ({
    getDB: () => ({
      vip_cache: {
        toArray: async () => rows,
      },
    }),
  }));
}

describe('getEnrichmentCacheStats', () => {
  it('counts keys as well as payload bytes', async () => {
    vi.resetModules();
    installTable([
      { key: 'popover|vip|en|es|k|run|', payload: { entry: {} }, storedAt: Date.now() },
      { key: 'popover|vip|en|es|k|walk|', payload: { entry: {} }, storedAt: Date.now() },
    ]);
    const { getEnrichmentCacheStats: stats } = await import(
      '../../src/background/enrichment/cache'
    );
    const result = await stats();
    expect(result.count).toBe(2);
    // Keys alone are 50 bytes; the two JSON payloads ~23. An estimate that
    // omits the keys lands at ~23, so 70 separates the two honestly.
    expect(result.bytes).toBeGreaterThan(70);
  });

  it('reports zeroes with no rows or no table', async () => {
    vi.resetModules();
    installTable([]);
    const { getEnrichmentCacheStats: stats } = await import(
      '../../src/background/enrichment/cache'
    );
    expect(await stats()).toEqual({ count: 0, bytes: 0 });
  });
});
