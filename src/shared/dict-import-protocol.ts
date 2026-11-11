/**
 * Wire format for dictionary-pack imports from the in-page panel.
 *
 * Why a hand-off at all: the settings panel is rendered inside the content
 * script, where `IndexedDB` is the streaming site's database, not the
 * extension's. A pack imported there used to land in the site's origin — the
 * site could read it and the service worker never saw it (issue #32). The
 * panel now parses the file locally (the parsers are plain JS, no DOM) and
 * ships plain rows to the worker, which owns every write.
 *
 * Three messages instead of one because a Yomitan pack can carry hundreds of
 * thousands of rows: chunking keeps each `sendMessage` payload well under the
 * messaging size ceiling instead of serializing the whole pack at once.
 *
 *   BEGIN  → drop the previous install of this pack id (replace semantics)
 *   TERMS  → append one batch of rows
 *   COMMIT → write the pack row, record telemetry, tell every tab
 *   (ABORT → drop the partial rows when a later chunk fails)
 *
 * The worker keeps no state between messages (it can be torn down at any
 * point), so every message carries everything it needs.
 */
import type { DictPackRow, DictTermRow } from './dict-types';

export const DICT_PACK_IMPORT_BEGIN = 'DICT_PACK_IMPORT_BEGIN';
export const DICT_PACK_IMPORT_TERMS = 'DICT_PACK_IMPORT_TERMS';
export const DICT_PACK_IMPORT_COMMIT = 'DICT_PACK_IMPORT_COMMIT';
export const DICT_PACK_IMPORT_ABORT = 'DICT_PACK_IMPORT_ABORT';

/**
 * Rows per `DICT_PACK_IMPORT_TERMS` message. Smaller than the worker's DB
 * bulk chunk on purpose: each row carries its definitions payload, and the
 * message is JSON-serialized, so a few thousand rows keeps the payload in the
 * low megabytes.
 */
export const DICT_IMPORT_CHUNK_SIZE = 2000;

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
