/**
 * Wire format for the dictionary-pack surfaces of the in-page panel.
 *
 * Why a hand-off at all: the settings panel is rendered inside the content
 * script, where `IndexedDB` is the streaming site's database, not the
 * extension's. A pack imported there used to land in the site's origin — the
 * site could read it and the service worker never saw it (issue #32). The
 * panel now parses the file locally (the parsers are plain JS, no DOM) and
 * ships plain rows to the worker, which owns every write.
 *
 * Three import messages instead of one because a Yomitan pack can carry
 * hundreds of thousands of rows: chunking keeps each `sendMessage` payload
 * well under the messaging size ceiling instead of serializing the whole pack
 * at once.
 *
 *   BEGIN  → drop the previous install of this pack id (replace semantics)
 *   TERMS  → append one batch of rows
 *   COMMIT → write the pack row, record telemetry, tell every tab
 *   (ABORT → drop the partial rows when a later chunk fails)
 *
 * The coverage widget speaks the same `chrome.runtime` channel:
 *
 *   GET_PACK_STATS    → all `pack_stats` rows
 *   RESET_PACK_STATS  → drop every row
 *   IMPORT_PACK_STATS → validate + merge/replace a coverage snapshot
 *   EXPORT_PACK_STATS → build a snapshot envelope from the current rows
 *
 * The worker keeps no state between messages (it can be torn down at any
 * point), so every message carries everything it needs.
 */
import type { DictPackRow, DictTermRow, PackStatsRow } from './dict-types';
import type { CoverageSnapshot, ImportMode } from './telemetry-model';

export const DICT_PACK_IMPORT_BEGIN = 'DICT_PACK_IMPORT_BEGIN';
export const DICT_PACK_IMPORT_TERMS = 'DICT_PACK_IMPORT_TERMS';
export const DICT_PACK_IMPORT_COMMIT = 'DICT_PACK_IMPORT_COMMIT';
export const DICT_PACK_IMPORT_ABORT = 'DICT_PACK_IMPORT_ABORT';

export const GET_PACK_STATS = 'GET_PACK_STATS';
export const RESET_PACK_STATS = 'RESET_PACK_STATS';
export const IMPORT_PACK_STATS = 'IMPORT_PACK_STATS';
export const EXPORT_PACK_STATS = 'EXPORT_PACK_STATS';

/**
 * Rows per `DICT_PACK_IMPORT_TERMS` message. Smaller than the worker's DB
 * bulk chunk on purpose: each row carries its definitions payload, and the
 * message is JSON-serialized, so a few thousand rows keeps the payload in the
 * low megabytes.
 */
export const DICT_IMPORT_CHUNK_SIZE = 2000;

/*
 * Atomic installs stage the pack under `tmp-<finalId>` until COMMIT. The
 * staging helpers live in `shared/db.ts` next to the tables they write, so
 * the content-script dictionary module can see them without pulling the wire
 * protocol into its chunk.
 */

export interface DictPackImportBeginMessage {
  type: typeof DICT_PACK_IMPORT_BEGIN;
  pack: DictPackRow;
}

export interface DictPackImportTermsMessage {
  type: typeof DICT_PACK_IMPORT_TERMS;
  packId: string;
  terms: DictTermRow[];
}

export interface DictPackImportCommitMessage {
  type: typeof DICT_PACK_IMPORT_COMMIT;
  pack: DictPackRow;
}

export interface DictPackImportAbortMessage {
  type: typeof DICT_PACK_IMPORT_ABORT;
  packId: string;
}

export type DictPackImportMessage =
  | DictPackImportBeginMessage
  | DictPackImportTermsMessage
  | DictPackImportCommitMessage
  | DictPackImportAbortMessage;

/** Reply shape shared by every import step. */
export interface DictPackImportReply {
  ok: boolean;
  error?: string;
  /** Rows written by this call (TERMS) or owned by the pack (COMMIT). */
  added?: number;
  /** Total rows the pack row points at, answered by COMMIT. */
  termsImported?: number;
}

/* ── Coverage widget: pack_stats ─────────────────────────────────────────── */

export interface GetPackStatsMessage {
  type: typeof GET_PACK_STATS;
}

export interface ResetPackStatsMessage {
  type: typeof RESET_PACK_STATS;
}

export interface ImportPackStatsMessage {
  type: typeof IMPORT_PACK_STATS;
  /** Parsed JSON from the user's snapshot file — validated by the worker. */
  raw: unknown;
  mode: ImportMode;
}

export interface ExportPackStatsMessage {
  type: typeof EXPORT_PACK_STATS;
  /** Optional label stored in the snapshot envelope (`source`). */
  source?: string;
}

export type PackStatsMessage =
  | GetPackStatsMessage
  | ResetPackStatsMessage
  | ImportPackStatsMessage
  | ExportPackStatsMessage;

/** Reply shape shared by every pack_stats step. */
export interface PackStatsReply {
  ok: boolean;
  error?: string;
  /** GET_PACK_STATS only. */
  rows?: PackStatsRow[];
  /** EXPORT_PACK_STATS only. */
  snapshot?: CoverageSnapshot;
  /** IMPORT_PACK_STATS only. */
  added?: number;
  merged?: number;
  replaced?: number;
}

/** Every message the panel may send over the dictionary-pack channel. */
export type DictPackPanelMessage =
  | DictPackImportMessage
  | PackStatsMessage;
