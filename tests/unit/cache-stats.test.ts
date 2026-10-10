/**
 * The two cache numbers the panel prints.
 *
 * `getEnrichmentCacheStats` reports rows and a byte estimate, and the keys are
 * part of what the extension stores too — dropping them from the estimate is
 * what made the panel under-report a table whose keys are about as long as its
 * payloads. `clearEnrichmentCache` returns the row count it removed, and must
 * clear the hot layer as well or the table looks empty while the service worker
 * keeps serving the rows it just reported as deleted.
 *
 * There is no IndexedDB under happy-dom, so `getDB()` is driven by a stub table
 * installed BEFORE each import — `cache.ts` reads it per call, so every case is
 * a fresh resetModules + import.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Tables = Partial<{
  rows: Array<{ key: string; payload: unknown; storedAt: number }>;
  rowCount: number;
  cleared: () => void;
}>;

function install(tables: Tables): void {
  vi.doMock('../../src/shared/db', () => ({
    getDB: () => ({
      vip_cache: {
        toArray: async () => tables.rows ?? [],
        count: async () => tables.rowCount ?? (tables.rows?.length ?? 0),
        clear: async () => tables.cleared?.(),
      },
    }),
  }));
}

/** A DB with no `vip_cache` at all: a first install, or a schema mismatch. */
function installNoTable(): void {
  vi.doMock('../../src/shared/db', () => ({ getDB: () => ({}) }));
}

const stats = async () => {
  const mod = await import('../../src/background/enrichment/cache');
  return mod.getEnrichmentCacheStats();
};

const clear = async () => {
  const mod = await import('../../src/background/enrichment/cache');
  return mod.clearEnrichmentCache();
};

describe('getEnrichmentCacheStats', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock('../../src/shared/db'));

  it('counts keys as well as payload bytes', async () => {
    install({
      rows: [
        { key: 'popover|vip|en|es|k|run|', payload: { entry: {} }, storedAt: Date.now() },
        { key: 'popover|vip|en|es|k|walk|', payload: { entry: {} }, storedAt: Date.now() },
      ],
    });
    const result = await stats();
    expect(result.count).toBe(2);
    // Keys alone are 50 bytes, the two JSON payloads ~23. An estimate that
    // omits the keys lands at ~23, so 70 separates the two honestly.
    expect(result.bytes).toBeGreaterThan(70);
  });

  it('reports zeroes with no rows', async () => {
    install({ rows: [] });
    expect(await stats()).toEqual({ count: 0, bytes: 0 });
  });

  it('reports zeroes with no table at all', async () => {
    installNoTable();
    expect(await stats()).toEqual({ count: 0, bytes: 0 });
  });
});

describe('clearEnrichmentCache', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock('../../src/shared/db'));

  it('counts the rows it removed and clears the table', async () => {
    let cleared = false;
    install({
      rowCount: 3,
      cleared: () => {
        cleared = true;
      },
    });
    // The count is what the panel prints; clear() is what empties the table.
    expect(await clear()).toBe(3);
    expect(cleared).toBe(true);
  });

  it('leaves an empty table alone', async () => {
    let cleared = false;
    install({
      rowCount: 0,
      cleared: () => {
        cleared = true;
      },
    });
    expect(await clear()).toBe(0);
    expect(cleared).toBe(false);
  });

  it('returns 0 when there is no table to clear', async () => {
    installNoTable();
    expect(await clear()).toBe(0);
  });
});
