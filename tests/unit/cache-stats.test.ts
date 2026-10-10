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

/**
 * Loaded dynamically per test: the stub table has to be installed BEFORE the
 * module reads `getDB`, so every case is a fresh resetModules + import.
 */
function installTable(
  tables: Partial<Record<'toArray' | 'count' | 'clear' | 'bulkDelete', () => Promise<unknown>>>,
): void {
  vi.doMock('../../src/shared/db', () => ({
    getDB: () => ({
      vip_cache: {
        toArray: tables.toArray ?? (async () => []),
        count: tables.count ?? (async () => 0),
        clear: tables.clear ?? (async () => {}),
        bulkDelete: tables.bulkDelete ?? (async () => {}),
      },
    }),
  }));
}

/** A DB with no `vip_cache` at all — a first install, or a schema mismatch. */
function installNoTable(): void {
  vi.doMock('../../src/shared/db', () => ({ getDB: () => ({}) }));
}

describe('getEnrichmentCacheStats', () => {
  it('counts keys as well as payload bytes', async () => {
    vi.resetModules();
    installTable({
      toArray: async () => [
        { key: 'popover|vip|en|es|k|run|', payload: { entry: {} }, storedAt: Date.now() },
        { key: 'popover|vip|en|es|k|walk|', payload: { entry: {} }, storedAt: Date.now() },
      ],
    });
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
    installTable({ toArray: async () => [] });
    const { getEnrichmentCacheStats: stats } = await import('../../src/background/enrichment/cache');
    expect(await stats()).toEqual({ count: 0, bytes: 0 });

    // No table at all (a first install, or a DB without the schema version).
    vi.resetModules();
    installNoTable();
    const { getEnrichmentCacheStats: noTable } = await import(
      '../../src/background/enrichment/cache'
    );
    expect(await noTable()).toEqual({ count: 0, bytes: 0 });
  });

  it('the stats path reads rows keyed by the column the cache writes', async () => {
    // The mock must address the exact table name cache.ts queries, or the
    // empty-answer branch above would make every assertion pass by accident.
    vi.resetModules();
    installTable({ toArray: async () => [{ key: 'k', payload: {}, storedAt: 1 }] });
    const { getEnrichmentCacheStats: stats } = await import('../../src/background/enrichment/cache');
    expect((await stats()).count).toBe(1);
  });
});
