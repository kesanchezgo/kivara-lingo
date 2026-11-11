/**
 * Coverage widget, content-script side: a thin client over the worker's
 * `pack_stats` messages.
 *
 * `DictPacksSection` is rendered inside the side panel, which lives in the
 * content script — the same realm whose `IndexedDB` is the STREAMING SITE's
 * database. Reading or writing coverage there would put the user's stats in the
 * site's origin (issue #32), so the panel only sends messages; the worker runs
 * `readPackStats` / `resetCoverage` / `exportCoverage` / `importCoverage`
 * against the extension's own database.
 *
 * Pure model helpers (`aggregateCoverage`, `idlePacks`, `topPacksByHits`, the
 * pseudo-pack ids) are in `telemetry-model.ts` — no message needed for
 * arithmetic the panel can do itself.
 *
 * No `shared/db` and no `i18n` here: failures come back as codes and the panel
 * owns the copy.
 */
import type { PackStatsRow } from './dict-types';
import {
  EXPORT_PACK_STATS,
  GET_PACK_STATS,
  IMPORT_PACK_STATS,
  RESET_PACK_STATS,
} from './dict-import-protocol';
import { sendRuntimeMessage, type RuntimeMessageOutcome } from './runtime-message';
import type { CoverageSnapshot, ImportMode } from './telemetry-model';

/** Why a coverage operation did not complete. */
export type PackStatsFailure =
  | { ok: false; code: 'worker-unavailable' }
  | { ok: false; code: 'failed'; error: string };

export type PackStatsReadOutcome = { ok: true; rows: PackStatsRow[] } | PackStatsFailure;
export type PackStatsWriteOutcome = { ok: true } | PackStatsFailure;
export type PackStatsImportOutcome =
  | { ok: true; added: number; merged: number; replaced: number }
  | PackStatsFailure;
export type PackStatsExportOutcome = { ok: true; snapshot: CoverageSnapshot } | PackStatsFailure;

/** Map a transport failure onto the code the panel knows how to phrase. */
function transportFailure(outcome: RuntimeMessageOutcome<unknown>): PackStatsFailure {
  if (outcome.ok) return { ok: false, code: 'failed', error: 'unexpected reply' };
  return outcome.unavailable
    ? { ok: false, code: 'worker-unavailable' }
    : { ok: false, code: 'failed', error: outcome.error };
}

/** Reply that arrived but says `ok: false` — the worker refused the request. */
function workerRefusal(error?: string): PackStatsFailure {
  return { ok: false, code: 'failed', error: error ?? 'pack_stats request failed' };
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** All `pack_stats` rows, read by the worker. */
export async function readPackStatsViaWorker(): Promise<PackStatsReadOutcome> {
  const outcome = await sendRuntimeMessage<{ ok: boolean; rows?: unknown; error?: string }>({
    type: GET_PACK_STATS,
  });
  if (!outcome.ok) return transportFailure(outcome);
  if (!outcome.reply.ok) return workerRefusal(outcome.reply.error);
  if (!Array.isArray(outcome.reply.rows)) {
    return { ok: false, code: 'failed', error: 'malformed pack_stats reply' };
  }
  return { ok: true, rows: outcome.reply.rows as PackStatsRow[] };
}

/** Drop every coverage row. */
export async function resetPackStatsViaWorker(): Promise<PackStatsWriteOutcome> {
  const outcome = await sendRuntimeMessage<{ ok: boolean; error?: string }>({
    type: RESET_PACK_STATS,
  });
  if (!outcome.ok) return transportFailure(outcome);
  if (!outcome.reply.ok) return workerRefusal(outcome.reply.error);
  return { ok: true };
}

/**
 * Install a coverage snapshot. `raw` is the parsed JSON file as-is — the worker
 * validates every field before it touches the table.
 */
export async function importPackStatsViaWorker(
  raw: unknown,
  mode: ImportMode = 'merge',
): Promise<PackStatsImportOutcome> {
  const outcome = await sendRuntimeMessage<{
    ok: boolean;
    error?: string;
    added?: unknown;
    merged?: unknown;
    replaced?: unknown;
  }>({ type: IMPORT_PACK_STATS, raw, mode });
  if (!outcome.ok) return transportFailure(outcome);
  if (!outcome.reply.ok) return workerRefusal(outcome.reply.error);

  const added = finite(outcome.reply.added);
  const merged = finite(outcome.reply.merged);
  const replaced = finite(outcome.reply.replaced);
  if (added === null || merged === null || replaced === null) {
    return { ok: false, code: 'failed', error: 'malformed import reply' };
  }
  return { ok: true, added, merged, replaced };
}

/** Build a snapshot envelope (version, timestamp, source, rows) in the worker. */
export async function exportPackStatsViaWorker(
  source?: string,
): Promise<PackStatsExportOutcome> {
  const outcome = await sendRuntimeMessage<{
    ok: boolean;
    error?: string;
    snapshot?: unknown;
  }>({ type: EXPORT_PACK_STATS, source });
  if (!outcome.ok) return transportFailure(outcome);
  if (!outcome.reply.ok) return workerRefusal(outcome.reply.error);
  const snapshot = outcome.reply.snapshot;
  if (!snapshot || typeof snapshot !== 'object') {
    return { ok: false, code: 'failed', error: 'malformed snapshot reply' };
  }
  return { ok: true, snapshot: snapshot as CoverageSnapshot };
}
