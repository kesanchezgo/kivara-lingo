/**
 * The cache-admin surface over the WHOLE bucket set.
 *
 * `getCacheStats` must report every cache the extension keeps — the F7
 * `explain_cache` was invisible here (no stats row, no clear target) while
 * quietly growing in IndexedDB, so the panel under-counted and "clear all"
 * left it full. `clearCaches` must clear exactly the bucket it is asked for,
 * and "all" must never reach the user-data tables (`saved_notes` is the Anki
 * dedup ledger, `dict_*` are installed packs — wiping those loses state the
 * user cannot get back from a cache).
 *
 * There is no IndexedDB under happy-dom, so `getDB()` is driven by stub
 * tables installed BEFORE each import — `cache-admin.ts` reads it per call,
 * so every case is a fresh resetModules + import.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface StubRow {
  [field: string]: unknown;
}

interface StubTable {
  rows: StubRow[];
  cleared: boolean;
  toArray(): Promise<StubRow[]>;
  count(): Promise<number>;
  clear(): Promise<void>;
}

type TableShape = Partial<
  Record<
    | 'vip_cache'
    | 'translation_cache'
    | 'ai_cache'
    | 'explain_cache'
    | 'media_cache'
    | 'saved_notes',
    StubRow[]
  >
>;

function makeTable(name: string, rows: StubRow[], clearedTables: string[]): StubTable {
  const table: StubTable = {
    rows,
    cleared: false,
    toArray: async () => rows,
    count: async () => rows.length,
    clear: async () => {
      rows.length = 0;
      table.cleared = true;
      clearedTables.push(name);
    },
  };
  return table;
}

function install(tables: TableShape): { clearedTables: string[]; stubs: Record<string, StubTable> } {
  const clearedTables: string[] = [];
  const stubs: Record<string, StubTable> = {};
  for (const [name, rows] of Object.entries(tables)) {
    stubs[name] = makeTable(name, rows ?? [], clearedTables);
  }
  vi.doMock('../../src/shared/db', () => ({ getDB: () => stubs }));
  // The orchestrator pulls ~50 modules; cache-admin only wants this one name.
  vi.doMock('../../src/background/enrichment/orchestrator', () => ({
    clearMemEnrichmentCache: () => {},
  }));
  return { clearedTables, stubs };
}

const stats = async () => {
  const mod = await import('../../src/background/cache-admin');
  return mod.getCacheStats();
};

const clear = async (
  which: 'all' | 'enrichment' | 'translation' | 'ai' | 'explain' | 'media',
) => {
  const mod = await import('../../src/background/cache-admin');
  return mod.clearCaches(which);
};

const EXPLAIN_ROW: StubRow = {
  key: 'a'.repeat(40),
  provider: 'openai',
  model: 'gpt-4o-mini',
  lang: 'en',
  uiLang: 'es',
  nativeLang: 'es',
  line: 'Where were you last night?',
  data: { meaning: 'Pregunta dónde estuvo.', grammar: '', expressions: [], sound: [] },
  expiresAt: Date.now() + 86_400_000,
  createdAt: Date.now(),
};

/** One row in every cache table, plus one user-ledger row. */
function shapeWithRows(): TableShape {
  return {
    vip_cache: [{ key: 'v1' }],
    translation_cache: [{ key: 't1' }],
    ai_cache: [{ key: 'a1' }],
    explain_cache: [{ key: 'e1' }, { key: 'e2' }],
    media_cache: [{ hash: 'm1' }],
    saved_notes: [{ token: 'run', ankiNoteId: 123 }],
  };
}

describe('getCacheStats', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.doUnmock('../../src/shared/db');
    vi.doUnmock('../../src/background/enrichment/orchestrator');
  });

  it('reports explain alongside the other buckets, with the same byte estimate', async () => {
    install({
      vip_cache: [{ key: 'v1' }, { key: 'v2' }],
      translation_cache: [{ key: 't1' }],
      ai_cache: [{ key: 'a1' }],
      explain_cache: [EXPLAIN_ROW],
      media_cache: [{ hash: 'm1' }],
    });
    const result = await stats();
    expect(result.buckets.map((b) => b.id)).toEqual([
      'enrichment',
      'translation',
      'ai',
      'explain',
      'media',
    ]);
    const explain = result.buckets.find((b) => b.id === 'explain');
    expect(explain).toBeDefined();
    expect(explain?.count).toBe(1);
    // Same estimator as every other bucket: the serialized row length.
    expect(explain?.bytes).toBe(JSON.stringify(EXPLAIN_ROW).length);
    expect(explain?.label).toBeTruthy();
    expect(result.totalCount).toBe(6);
    expect(result.totalBytes).toBe(result.buckets.reduce((acc, b) => acc + b.bytes, 0));
  });

  it('reports a zero explain bucket when the table is empty or missing', async () => {
    install({ vip_cache: [] });
    const result = await stats();
    const explain = result.buckets.find((b) => b.id === 'explain');
    expect(explain).toMatchObject({ count: 0, bytes: 0 });
    expect(result.totalCount).toBe(0);
  });
});

describe('clearCaches', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.doUnmock('../../src/shared/db');
    vi.doUnmock('../../src/background/enrichment/orchestrator');
  });

  it('clears only the explain bucket', async () => {
    const { clearedTables, stubs } = install(shapeWithRows());
    const removed = await clear('explain');
    expect(removed).toBe(2);
    expect(clearedTables).toEqual(['explain_cache']);
    expect(stubs.explain_cache.cleared).toBe(true);
    // Every other cache keeps its rows.
    expect(stubs.vip_cache.rows).toHaveLength(1);
    expect(stubs.translation_cache.rows).toHaveLength(1);
    expect(stubs.ai_cache.rows).toHaveLength(1);
    expect(stubs.media_cache.rows).toHaveLength(1);
  });

  it('clears every cache bucket on "all" and never the user ledger', async () => {
    const { clearedTables, stubs } = install(shapeWithRows());
    const removed = await clear('all');
    expect(removed).toBe(6);
    expect(clearedTables).toEqual([
      'vip_cache',
      'translation_cache',
      'ai_cache',
      'explain_cache',
      'media_cache',
    ]);
    // The dedup ledger is user data — a wiped ledger would re-create cards.
    expect(stubs.saved_notes.cleared).toBe(false);
    expect(stubs.saved_notes.rows).toHaveLength(1);
  });

  it('returns the explain row count it removed', async () => {
    install({ explain_cache: [{ key: 'e1' }, { key: 'e2' }, { key: 'e3' }] });
    expect(await clear('explain')).toBe(3);
  });
});
