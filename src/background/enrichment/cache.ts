/**
 * The enrichment cache: a hot in-memory LRU over a persistent IndexedDB table.
 *
 * Extracted from the orchestrator so the layer — and its two rules, the one
 * that refuses to store a still-held-back payload and the one that refuses to
 * serve one — can be tested and reasoned about on its own. Both rules exist for
 * the same reason: the cache key does NOT include the granted origins, so an
 * answer taken while some dictionary hosts were still ungranted would hide
 * those sources from every later lookup until it expired — and the user would
 * grant the permission, hover the SAME word again, and conclude the grant did
 * nothing.
 *
 * Kept in one file with the orchestrator's `runEnrichment` pre-grant lookups:
 * the key derivation (`makeCacheKey`) stays where the lookup context lives.
 */
import { getDB } from '../../shared/db';
import type { EnrichmentResult } from './types';

interface CacheRow {
  key: string;
  payload: EnrichmentResult;
  storedAt: number;
}

/**
 * The hot in-memory layer.
 *
 * Lifecycle note: the service worker tears this whole module down whenever it
 * goes idle, so it is a per-SW-generation cache — the persistent layer is what
 * survives. The TTL is enforced on read, so a stale hot entry never outlives
 * the configured cache window.
 */
/* ─── In-memory (hot) layer ────────────────────────────────────────────── */

const MEM_CACHE_MAX = 300;
const memCache = new Map<string, CacheRow>();

function memGet(key: string, ttlDays: number): EnrichmentResult | null {
  const row = memCache.get(key);
  if (!row) return null;
  const ageMs = Date.now() - (row.storedAt ?? 0);
  if (ageMs > ttlDays * 24 * 3600 * 1000) {
    memCache.delete(key);
    return null;
  }
  // Same rule as the IndexedDB branch: a payload written while sources were
  // still waiting for access must not satisfy a lookup after the grant lands.
  if (isHeldBack(row.payload)) {
    memCache.delete(key);
    return null;
  }
  // LRU bump: re-insert so it moves to the end (most-recently-used).
  memCache.delete(key);
  memCache.set(key, row);
  return row.payload;
}

function memSet(key: string, payload: EnrichmentResult): void {
  if (memCache.has(key)) memCache.delete(key);
  memCache.set(key, { key, payload, storedAt: Date.now() });
  if (memCache.size > MEM_CACHE_MAX) {
    const oldest = memCache.keys().next().value;
    if (oldest !== undefined) memCache.delete(oldest);
  }
}

/** Clear the in-memory layer — called when the user wipes the cache so a
 *  freshly-emptied cache isn't shadowed by hot SW memory, and when a grant
 *  lands (`chrome.permissions.onAdded`). */
export function clearMemEnrichmentCache(): void {
  memCache.clear();
}

/* ─── Persistent (IndexedDB) layer ─────────────────────────────────────── */

async function readCache(key: string, ttlDays: number): Promise<EnrichmentResult | null> {
  // 1. Hot layer first — instant, no await, no IndexedDB hop.
  const hot = memGet(key, ttlDays);
  if (hot) return hot;
  // 2. Persistent layer.
  try {
    const db = getDB();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = (await (db as any).vip_cache?.get(key)) as CacheRow | undefined;
    if (!row) return null;
    const ageMs = Date.now() - (row.storedAt ?? 0);
    if (ageMs > ttlDays * 24 * 3600 * 1000) return null;
    // A cached answer that still lists sources waiting for access is treated
    // as a miss: the grant may have arrived since the row was written, and the
    // payload would keep reporting them missing for the whole TTL.
    if (isHeldBack(row.payload)) {
      await clearCachedEntry(key);
      return null;
    }
    // Warm the in-memory layer so the next re-hover is instant.
    memSet(key, row.payload);
    return row.payload;
  } catch {
    return null;
  }
}

async function clearCachedEntry(key: string): Promise<void> {
  try {
    const db = getDB();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).vip_cache?.delete(key);
  } catch {
    // ignore — a stale row is recoverable
  }
}

async function writeCache(key: string, payload: EnrichmentResult): Promise<void> {
  // An answer that still has sources waiting for access must NOT be cached in
  // either layer: the key does not include the granted origins, so a stored
  // row would keep hiding those sources AFTER the user grants them — for the
  // whole TTL in IndexedDB, and for the rest of the SW's life in the hot
  // layer. Early return BEFORE memSet is what makes it hold.
  if (isHeldBack(payload)) return;
  // Populate the hot layer synchronously so an immediate re-hover hits it.
  memSet(key, payload);
  try {
    const db = getDB();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).vip_cache?.put({ key, payload, storedAt: Date.now() });
    void pruneVipCache();
  } catch {
    // ignore — cache misses are recoverable.
  }
}

/** True when a payload is waiting for optional host permissions. */
function isHeldBack(payload: EnrichmentResult | null | undefined): boolean {
  return !!payload?.needsAccess && payload.needsAccess.length > 0;
}

/* ─── Housekeeping ─────────────────────────────────────────────────────── */

const MAX_VIP_CACHE_ROWS = 2000;
const PRUNE_INTERVAL_MS = 5 * 60 * 1000;
/**
 * The housekeeping TTL AND the orchestrator's read TTL, one number for both.
 * They used to be two literals — 14 in the reader, 30 here — so a payload
 * could go stale at 14 d and then occupy a row the pruner kept for 30, or
 * something older than 14 d sit served meanwhile; both were the same
 * question ("how long is a payload current?") answered differently in two
 * files.
 */
export const DEFAULT_VIP_CACHE_TTL_DAYS = 14;
let lastVipPruneAt = 0;

/**
 * Keep `vip_cache` bounded.
 *
 * The table is a word→enrichment cache keyed by lookup key, so it grows for as
 * long as the user browses: every `TOKEN|langs|flags` combination gets a row
 * that never expires on its own. Readers treat rows past the TTL as a miss, so
 * the obvious cost was silently paying for entries nobody would ever read
 * again — a slow memory leak in the extension's own database.
 *
 * Two index passes (expired, then everything past the ceiling) plus ONE scan:
 *
 *   1. rows written before `storedAt` was introduced are invisible to the
 *      index, so they would accumulate for ever AND inflate the row count that
 *      the ceiling is measured against. They are swept here.
 *   2. everything past the TTL is dropped through the `storedAt` index.
 *   3. if the table is still above MAX_VIP_CACHE_ROWS, the oldest recent rows
 *      are dropped until it is not.
 *
 * The scan is the necessary price for rows the index cannot reach; it runs at
 * most every PRUNE_INTERVAL_MS and over a table that rarely exceeds a few
 * hundred rows.
 */
async function pruneVipCache(): Promise<void> {
  const now = Date.now();
  if (now - lastVipPruneAt < PRUNE_INTERVAL_MS) return;
  lastVipPruneAt = now;
  try {
    const db = getDB();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const table = ((db as any).vip_cache ?? null) as
      | {
          where(index: string): { below(threshold: number): { delete(): Promise<number> } };
          orderBy(index: string): {
            reverse(): { offset(n: number): { primaryKeys(): Promise<string[]> } };
          };
          count(): Promise<number>;
          bulkDelete(keys: string[]): Promise<void>;
          toArray(): Promise<CacheRow[]>;
        }
      | null;
    if (!table) return;

    const rows = await table.toArray().catch(() => [] as CacheRow[]);
    const orphans = rows.filter((r) => !r.storedAt).map((r) => r.key);
    if (orphans.length > 0) await table.bulkDelete(orphans);

    const ttlMs = DEFAULT_VIP_CACHE_TTL_DAYS * 24 * 3600 * 1000;
    await table.where('storedAt').below(now - ttlMs).delete();

    // Count AFTER the orphans and the expired rows are gone, so the ceiling
    // describes real rows.
    const remaining = await table.count().catch(() => 0);
    if (remaining > MAX_VIP_CACHE_ROWS) {
      const staleKeys = await table
        .orderBy('storedAt')
        .reverse()
        .offset(MAX_VIP_CACHE_ROWS)
        .primaryKeys();
      if (staleKeys.length > 0) await table.bulkDelete(staleKeys);
    }
  } catch {
    // A cache that will not prune is still a cache; never fail the hover on it.
  }
}

/**
 * Wipe both layers (panel "limpiar cache" + the grant invalidation path).
 *
 * Kept returning the number of rows dropped: the panel shows "N entradas
 * eliminadas", and the count is the only feedback the user has that a wipe did
 * anything. Memory is cleared too — its hot layer outlived the table wipe, so
 * a re-hover served the very rows the panel just reported as deleted.
 */
export async function clearEnrichmentCache(): Promise<number> {
  clearMemEnrichmentCache();
  try {
    const db = getDB();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const table = (db as any).vip_cache;
    if (!table) return 0;
    // count-then-clear on purpose: reading every payload just to know how many
    // rows there were was a full table scan for a number the index can answer.
    const rows = await table.count();
    if (rows > 0) await table.clear();
    return rows;
  } catch {
    return 0;
  }
}

/**
 * Count of cached enrichment rows + an approximate byte size. Cheap enough to
 * call on panel open (one full-table scan of a table that rarely exceeds a few
 * hundred rows).
 */
export async function getEnrichmentCacheStats(): Promise<{ count: number; bytes: number }> {
  try {
    const db = getDB();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await (db as any).vip_cache?.toArray()) as CacheRow[] | undefined;
    if (!rows || !rows.length) return { count: 0, bytes: 0 };
    let bytes = 0;
    for (const row of rows) {
      try {
        // The key is part of what the extension stores too; dropping it made
        // the panel under-report a table whose keys are as long as their
        // payloads.
        bytes += row.key.length + JSON.stringify(row.payload).length;
      } catch {
        // A circular cache payload is worth a skipped byte estimate, not a crash.
      }
    }
    return { count: rows.length, bytes };
  } catch {
    return { count: 0, bytes: 0 };
  }
}

export { readCache as readEnrichmentCache, writeCache as writeEnrichmentCache };
