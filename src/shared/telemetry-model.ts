/**
 * Pure model for the dictionary-pack coverage widget.
 *
 * Split out of `telemetry.ts` so the in-page panel can render the coverage
 * section without importing the module that opens IndexedDB: in a content
 * script, `IndexedDB` is the streaming site's database (issue #32). Everything
 * here is arithmetic over `PackStatsRow[]` — no storage, no chrome.*, no React.
 *
 * `telemetry.ts` re-exports these symbols, so worker and page callers keep
 * importing from the same place they always did.
 */
import type { PackStatsRow } from './dict-types';

export const BUNDLE_PACK_ID = 'bundle';
export const REMOTE_PACK_ID = 'remote';
export const MISS_PACK_ID = 'miss';

/**
 * Totals across local sources (bundle + packs) vs. total resolutions.
 */
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

const SYNTHETIC_PACK_IDS = new Set([BUNDLE_PACK_ID, REMOTE_PACK_ID, MISS_PACK_ID]);

export const DEFAULT_IDLE_THRESHOLD_MS = 30 * 86_400_000;

/**
 * Rank user-installed packs by lookup hits, descending. Synthetic buckets
 * (`bundle`, `remote`, `miss`) are excluded — the ranking is meant to surface
 * which real packs the user actually relies on. Ties are broken by
 * `lastUsedAt` (more recently-used pack wins). Packs with zero hits are
 * dropped so the UI doesn't show "unused" entries here — that's what the
 * idle list is for.
 */
export function topPacksByHits(rows: PackStatsRow[], limit = 10): PackStatsRow[] {
  return rows
    .filter((r) => !SYNTHETIC_PACK_IDS.has(r.packId) && r.hits > 0)
    .slice()
    .sort((a, b) => {
      if (b.hits !== a.hits) return b.hits - a.hits;
      return b.lastUsedAt - a.lastUsedAt;
    })
    .slice(0, Math.max(0, limit));
}

/**
 * Return user-installed packs that the user did try at least once but hasn't
 * touched within `thresholdMs` (default 30d). The "tried at least once" gate
 * (`hits > 0`) avoids flagging packs that were just installed and never used —
 * those are tracked by the install row itself. Synthetic ids are excluded.
 *
 * `now` is parameterised so tests can pin time without monkey-patching
 * `Date.now`.
 */
export function idlePacks(
  rows: PackStatsRow[],
  thresholdMs: number = DEFAULT_IDLE_THRESHOLD_MS,
  now: number = Date.now(),
): PackStatsRow[] {
  if (thresholdMs < 0) return [];
  const cutoff = now - thresholdMs;
  return rows
    .filter(
      (r) => !SYNTHETIC_PACK_IDS.has(r.packId) && r.hits > 0 && r.lastUsedAt < cutoff,
    )
    .slice()
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
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

export type ImportMode = 'merge' | 'replace';

export interface ImportResult {
  added: number;
  merged: number;
  replaced: number;
}
