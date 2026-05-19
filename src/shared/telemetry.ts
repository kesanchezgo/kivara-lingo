/**
 * Local-only telemetry for dictionary-pack coverage.
 *
 * The single source of truth is the `pack_stats` Dexie table (see
 * `db.ts`). Each row tracks one `packId` and:
 *  - `hits`        — how often the pack resolved a lookup
 *  - `lastUsedAt`  — most recent successful hit (ms epoch)
 *  - `createdAt`   — when the row was first written
 *
 * Three pseudo-pack ids extend the namespace beyond real packs:
 *  - `bundle`  → the shipped `en.json` dictionary served a hit
 *  - `remote`  → the remote translator chain served a hit
 *  - `miss`    → nothing resolved the token (full miss)
 *
 * Nothing leaves the device. The `enabled` switch in `useKivaraStore` short-
 * circuits every record path; readers still work so the user can inspect any
 * stats accumulated before they toggled it off.
 */
import { getDB, type PackStatsRow } from './db';

export const BUNDLE_PACK_ID = 'bundle';
export const REMOTE_PACK_ID = 'remote';
export const MISS_PACK_ID = 'miss';

/**
 * The store is the source of truth for the master switch, but `telemetry.ts`
 * is consumed from contexts that can't import the React-coupled store cheaply
 * (e.g. the service worker). Callers set this once at startup and `record*`
 * helpers consult it without a round-trip through chrome.storage.
 *
 * Default `true` mirrors the store default — if no one calls `setTelemetryEnabled`
 * we still record stats, matching the "telemetry on" default UX.
 */
let _telemetryEnabled = true;

/** Update the cached toggle. Called by the store subscriber + initial hydrate. */
export function setTelemetryEnabled(enabled: boolean): void {
  _telemetryEnabled = enabled;
}

/** Inspect the cached toggle. Mostly useful for tests. */
export function isTelemetryEnabled(): boolean {
  return _telemetryEnabled;
}

async function bump(packId: string, delta = 1): Promise<void> {
  if (!_telemetryEnabled) return;
  try {
    const db = getDB();
    const now = Date.now();
    const existing = await db.pack_stats.get(packId);
    if (existing) {
      await db.pack_stats.put({
        ...existing,
        hits: existing.hits + delta,
        lastUsedAt: now,
      });
    } else {
      await db.pack_stats.put({
        packId,
        hits: delta,
        lastUsedAt: now,
        createdAt: now,
      });
    }
  } catch (err) {
    // IndexedDB might be unavailable (e.g. private mode, vitest without
    // happy-dom). Telemetry is best-effort — never throw.
    console.warn('[Kivara Lingo] telemetry bump failed', err);
  }
}

/**
 * Record that a Yomitan-style pack was installed (covers gallery, URL,
 * .zip, CSV, StarDict). Idempotent — re-installing the same pack just
 * refreshes `createdAt` if no row exists yet.
 */
export async function recordPackInstall(packId: string, _title?: string): Promise<void> {
  if (!_telemetryEnabled) return;
  try {
    const db = getDB();
    const now = Date.now();
    const existing = await db.pack_stats.get(packId);
    if (existing) return;
    await db.pack_stats.put({
      packId,
      hits: 0,
      lastUsedAt: now,
      createdAt: now,
    });
  } catch (err) {
    console.warn('[Kivara Lingo] telemetry install failed', err);
  }
}

/** Record a successful lookup served by a pack (or one of the pseudo-packs). */
export async function recordLookupHit(packId: string): Promise<void> {
  await bump(packId);
}

/** Record a token that nothing resolved. */
export async function recordMiss(packId: string = MISS_PACK_ID): Promise<void> {
  await bump(packId);
}

/** Drop a pack's stats row (called when the user deletes the pack itself). */
export async function deletePackStats(packId: string): Promise<void> {
  try {
    await getDB().pack_stats.delete(packId);
  } catch (err) {
    console.warn('[Kivara Lingo] telemetry delete failed', err);
  }
}

/** Read all rows. Used by the DictPacks coverage widget. */
export async function readPackStats(): Promise<PackStatsRow[]> {
  try {
    return await getDB().pack_stats.toArray();
  } catch (err) {
    console.warn('[Kivara Lingo] telemetry read failed', err);
    return [];
  }
}

export interface CoverageTotals {
  bundleHits: number;
  packHits: number;
  remoteHits: number;
  misses: number;
  total: number;
  /**
   * Hit ratio across local sources (bundle + packs) vs. total resolutions.
   * 0 when there have been no lookups yet so the UI can render a placeholder.
   */
  localCoverage: number;
}

/** Sum a `PackStatsRow[]` into the per-bucket totals used by the UI widget. */
export function aggregateCoverage(rows: PackStatsRow[]): CoverageTotals {
  let bundleHits = 0;
  let remoteHits = 0;
  let misses = 0;
  let packHits = 0;
  for (const row of rows) {
    if (row.packId === BUNDLE_PACK_ID) bundleHits = row.hits;
    else if (row.packId === REMOTE_PACK_ID) remoteHits = row.hits;
    else if (row.packId === MISS_PACK_ID) misses = row.hits;
    else packHits += row.hits;
  }
  const total = bundleHits + packHits + remoteHits + misses;
  const local = bundleHits + packHits;
  return {
    bundleHits,
    packHits,
    remoteHits,
    misses,
    total,
    localCoverage: total > 0 ? local / total : 0,
  };
}

/**
 * Drop every stats row. Wired to the "Reiniciar cobertura" button in the
 * dict-packs section so users can start fresh after, say, installing a new
 * pack.
 */
export async function resetCoverage(): Promise<void> {
  try {
    await getDB().pack_stats.clear();
  } catch (err) {
    console.warn('[Kivara Lingo] telemetry reset failed', err);
  }
}

/**
 * Snapshot wire format for coverage export/import. Versioned so future
 * additions (e.g. daily history, per-language breakdown) can extend it
 * without breaking older snapshots.
 */
export interface CoverageSnapshot {
  /** Format version. Bump when shape changes incompatibly. */
  version: 1;
  /** ISO timestamp the snapshot was produced. */
  exportedAt: string;
  /** Best-effort label for the source (extension version, user-supplied). */
  source?: string;
  /** Raw rows, in their on-disk shape. */
  rows: PackStatsRow[];
}

const CURRENT_SNAPSHOT_VERSION = 1 as const;

/**
 * Build an in-memory snapshot of the current `pack_stats` rows. Callers
 * serialise this to JSON and offer it as a download — nothing is uploaded.
 */
export async function exportCoverage(source?: string): Promise<CoverageSnapshot> {
  const rows = await readPackStats();
  return {
    version: CURRENT_SNAPSHOT_VERSION,
    exportedAt: new Date().toISOString(),
    source,
    rows,
  };
}

export type ImportMode = 'merge' | 'replace';

export interface ImportResult {
  added: number;
  merged: number;
  replaced: number;
}

/**
 * Validate and load a previously-exported snapshot. `mode`:
 *  - `merge`   → keep existing rows; for each imported row, take the max of
 *                `hits` and the latest `lastUsedAt`. Safe to re-run.
 *  - `replace` → drop existing rows first, then write the imported ones.
 *                Use when restoring after a fresh install.
 *
 * Throws on shape errors so the UI can show a clear message.
 */
export async function importCoverage(
  raw: unknown,
  mode: ImportMode = 'merge',
): Promise<ImportResult> {
  const snap = parseSnapshot(raw);
  const db = getDB();
  if (mode === 'replace') {
    await db.pack_stats.clear();
  }
  let added = 0;
  let merged = 0;
  for (const row of snap.rows) {
    const existing = mode === 'merge' ? await db.pack_stats.get(row.packId) : undefined;
    if (existing) {
      await db.pack_stats.put({
        packId: row.packId,
        hits: Math.max(existing.hits, row.hits),
        lastUsedAt: Math.max(existing.lastUsedAt, row.lastUsedAt),
        createdAt: Math.min(existing.createdAt, row.createdAt),
      });
      merged += 1;
    } else {
      await db.pack_stats.put(row);
      added += 1;
    }
  }
  return {
    added,
    merged,
    replaced: mode === 'replace' ? snap.rows.length : 0,
  };
}

function parseSnapshot(raw: unknown): CoverageSnapshot {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Snapshot inválido: el archivo no es un objeto JSON.');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version !== CURRENT_SNAPSHOT_VERSION) {
    throw new Error(
      `Versión de snapshot no soportada: ${String(obj.version)} (esperaba ${CURRENT_SNAPSHOT_VERSION}).`,
    );
  }
  if (!Array.isArray(obj.rows)) {
    throw new Error('Snapshot inválido: falta el array `rows`.');
  }
  const rows: PackStatsRow[] = [];
  for (const r of obj.rows) {
    if (!r || typeof r !== 'object') continue;
    const row = r as Record<string, unknown>;
    if (
      typeof row.packId !== 'string' ||
      typeof row.hits !== 'number' ||
      typeof row.lastUsedAt !== 'number' ||
      typeof row.createdAt !== 'number' ||
      !Number.isFinite(row.hits) ||
      row.hits < 0
    ) {
      throw new Error('Snapshot inválido: una fila tiene campos faltantes o con tipo incorrecto.');
    }
    rows.push({
      packId: row.packId,
      hits: row.hits,
      lastUsedAt: row.lastUsedAt,
      createdAt: row.createdAt,
    });
  }
  return {
    version: CURRENT_SNAPSHOT_VERSION,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
    source: typeof obj.source === 'string' ? obj.source : undefined,
    rows,
  };
}
