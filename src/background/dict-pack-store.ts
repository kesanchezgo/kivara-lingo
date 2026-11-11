/**
 * Persistence side of a dictionary-pack import.
 *
 * Runs only in the service worker. The panel (content script) parses the
 * chosen file into plain `DictPackRow` / `DictTermRow` batches and sends them
 * over `DICT_PACK_IMPORT_*`; this module validates the shapes and writes them
 * to the extension's IndexedDB (`kivara-lingo`) — the database a content
 * script cannot reach, because in a content script `IndexedDB` resolves to the
 * host site's origin (issue #32).
 *
 * The import is replace-on-same-id: `BEGIN` clears the previous rows, `TERMS`
 * appends the new ones, `COMMIT` publishes the pack row. A torn import (tab
 * closed mid-way) leaves rows without a pack row, which no surface reads and
 * the next import of the same id clears.
 */
import { getDB } from '../shared/db';
import type { DictPackRow, DictTermRow } from '../shared/dict-types';
import { recordPackInstall } from '../shared/telemetry';

/** Rows per `bulkAdd`. IndexedDB throws on single batches that get too big. */
const TERM_CHUNK = 5000;

/** Upper bound on a single `TERMS` message; the client sends 2000. */
const MAX_TERMS_PER_MESSAGE = 20_000;

/** Pack ids are generated locally (`pack-…`, `pack-sd-…`, `pack-csv-…`). */
const PACK_ID_RE = /^[A-Za-z0-9._-]{1,80}$/;

/** True when a message's `packId` is a plausible locally-generated id. */
export function isDictPackId(value: unknown): value is string {
  return typeof value === 'string' && PACK_ID_RE.test(value);
}

function text(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

/**
 * Validate an incoming pack row. Returns null when the shape cannot be
 * trusted — the message comes from a content script, so it is untrusted input
 * even when our own panel is the only sender today.
 */
export function sanitizePackRow(raw: unknown): DictPackRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = text(r.id, 80);
  const title = text(r.title, 200);
  if (!id || !PACK_ID_RE.test(id) || !title) return null;

  const format = typeof r.format === 'number' && Number.isFinite(r.format) ? r.format : 3;
  const termCount =
    typeof r.termCount === 'number' && Number.isFinite(r.termCount) && r.termCount >= 0
      ? Math.floor(r.termCount)
      : 0;
  const createdAt =
    typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : Date.now();

  return {
    id,
    title,
    revision: text(r.revision, 120) ?? '',
    format,
    sourceLang: text(r.sourceLang, 20) ?? 'en',
    targetLang: text(r.targetLang, 20) ?? 'es',
    termCount,
    enabled: r.enabled !== false,
    author: text(r.author, 200),
    description: text(r.description, 500),
    createdAt,
  };
}

/**
 * Validate one incoming term row and pin it to `packId` (a row can never
 * claim another pack, and the Dexie auto-increment `id` is always reassigned).
 */
function sanitizeTermRow(raw: unknown, packId: string): DictTermRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const expression = text(r.expression, 400);
  if (!expression) return null;
  const popularity =
    typeof r.popularity === 'number' && Number.isFinite(r.popularity) ? r.popularity : 0;
  return {
    packId,
    expression: expression.toLowerCase(),
    reading: text(r.reading, 400),
    definitions: Array.isArray(r.definitions) ? r.definitions : [],
    popularity,
    definitionTags: text(r.definitionTags, 200),
    termTags: text(r.termTags, 200),
  };
}

/** Drop the previous rows for this pack id. */
export async function beginDictPackImport(packId: string): Promise<void> {
  const db = getDB();
  await db.dict_terms.where('packId').equals(packId).delete();
}

/** Append one validated batch of rows; returns how many rows landed. */
export async function appendDictPackTerms(
  packId: string,
  rawTerms: unknown,
): Promise<number> {
  if (!Array.isArray(rawTerms)) throw new Error('terms must be an array');
  if (rawTerms.length > MAX_TERMS_PER_MESSAGE) {
    throw new Error(`too many terms in one message (${rawTerms.length} > ${MAX_TERMS_PER_MESSAGE})`);
  }
  const rows: DictTermRow[] = [];
  for (const raw of rawTerms) {
    const row = sanitizeTermRow(raw, packId);
    if (row) rows.push(row);
  }
  if (rows.length === 0) return 0;

  const db = getDB();
  for (let i = 0; i < rows.length; i += TERM_CHUNK) {
    await db.dict_terms.bulkAdd(rows.slice(i, i + TERM_CHUNK));
  }
  return rows.length;
}

/**
 * Publish the pack row, mark the install in local telemetry and report how
 * many rows this pack currently owns. Anything left over from a previous
 * install was deleted by `BEGIN`.
 *
 * `termCount` is rewritten from the rows that actually landed, not trusted
 * from the message: `TERMS` may have dropped a malformed row, and the panel
 * renders this number.
 */
export async function commitDictPackImport(pack: DictPackRow): Promise<number> {
  const db = getDB();
  const written = await db.dict_terms.where('packId').equals(pack.id).count();
  if (written === 0) throw new Error('No rows were written for this pack');
  await db.dict_packs.put({ ...pack, termCount: written });
  void recordPackInstall(pack.id, pack.title);
  return written;
}

/** Best-effort cleanup after a failed step so no orphan rows are left behind. */
export async function abortDictPackImport(packId: string): Promise<void> {
  const db = getDB();
  await db.dict_terms.where('packId').equals(packId).delete();
}
