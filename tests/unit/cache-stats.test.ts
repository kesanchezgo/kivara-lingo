/**
 * `getEnrichmentCacheStats` — the byte estimate the cache panel prints — and
 * the `clearEnrichmentCache` count it prints alongside.
 *
 * The keys are part of what the extension stores too, and dropping them from
 * the estimate made the panel under-report a table whose keys are about as long
 * as their payloads. There is no IndexedDB under happy-dom, so `getDB()` is
 * driven here through a stub table; that is the whole point of counting the key
 * length.
 */
import { describe, it, expect, vi } from 'vitest';

/**
 * Each test installs its stub BEFORE the module is imported: `cache.ts` reads
 * `getDB()` per call, so the module must be re-imported to pick the stub up.
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

  it('the clear path counts and then clears the table', async () => {
    let cleared = false;
    vi.resetModules();
    installTable({
      count: async () => 3,
      clear: async () => {
        cleared = true;
      },
      toArray: async () => [],
    });
    const { clearEnrichmentCache: clear } = await import('../../src/background/enrichment/cache');
    // The count is what the panel prints; clear() is what actually empties it.
    expect(await clear()).toBe(3);
    expect(cleared).toBe(true);
  });

  it('reports 0 when nothing needs clearing', async () => {
    vi.resetModules();
    installTable({ count: async () => 0, toArray: async () => [] });
    const { clearEnrichmentCache: clear } = await import('../../src/background/enrichment/cache');
    expect(await clear()).toBe(0);
  });
});
