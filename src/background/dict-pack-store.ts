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
 * The import is atomic: `BEGIN` creates the pack row and every `TERMS` batch
 * under a staging id (`tmp-<finalId>`), and `COMMIT` swaps the staged rows to
 * the final id in one IndexedDB transaction together with the pack row. A
 * torn import (worker killed mid-way) leaves only a staging pack, which
 * `cleanupDictPackOrphans()` removes on the next worker start; a failed import
 * never shows up as an installed pack.
 */
import { getDB, TEMP_DICT_PACK_PREFIX, tempDictPackId } from '../shared/db';
import { t } from '../shared/i18n/sw';
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

/**
 * Start an import: drop any previous staging rows for this pack and write the
 * pack metadata under its staging id. Nothing is visible as an installed pack
 * until `commitDictPackImport` runs.
 */
export async function beginDictPackImport(pack: DictPackRow): Promise<void> {
  await settleOrphanCleanup();
  const db = getDB();
  const stagingId = tempDictPackId(pack.id);
  await db.transaction('rw', db.dict_packs, db.dict_terms, async () => {
    await db.dict_terms.where('packId').equals(stagingId).delete();
    await db.dict_packs.put({ ...pack, id: stagingId, termCount: 0 });
  });
}

/** Append one validated batch of rows to the staging pack; returns how many landed. */
export async function appendDictPackTerms(
  packId: string,
  rawTerms: unknown,
): Promise<number> {
  await settleOrphanCleanup();
  if (!Array.isArray(rawTerms)) throw new Error(t('dictpack.termsNotArray'));
  if (rawTerms.length > MAX_TERMS_PER_MESSAGE) {
    throw new Error(t('dictpack.tooManyTerms', { count: rawTerms.length, max: MAX_TERMS_PER_MESSAGE }));
  }
  const stagingId = tempDictPackId(packId);
  const rows: DictTermRow[] = [];
  for (const raw of rawTerms) {
    const row = sanitizeTermRow(raw, stagingId);
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
 * Publish the staged pack: one transaction drops the previous install of the
 * final id, moves every staged row to it, deletes the staging pack row and
 * writes the final pack row. A failure at any point rolls the whole swap back
 * and the staging rows are cleaned by the next start-up pass.
 *
 * `termCount` is rewritten from the rows that actually landed, not trusted
 * from the message: `TERMS` may have dropped a malformed row, and the panel
 * renders this number.
 */
export async function commitDictPackImport(pack: DictPackRow): Promise<number> {
  await settleOrphanCleanup();
  const db = getDB();
  const stagingId = tempDictPackId(pack.id);

  const written = await db.transaction('rw', db.dict_packs, db.dict_terms, async () => {
    const staged = await db.dict_terms.where('packId').equals(stagingId).count();
    if (staged === 0) throw new Error(t('dictpack.noRowsWritten'));

    // Replace semantics: the old install only disappears with the swap, so a
    // failed commit leaves the previous pack intact.
    await db.dict_terms.where('packId').equals(pack.id).delete();
    await db.dict_terms.where('packId').equals(stagingId).modify({ packId: pack.id });
    await db.dict_packs.delete(stagingId);
    await db.dict_packs.put({ ...pack, termCount: staged });
    return staged;
  });
  void recordPackInstall(pack.id, pack.title);
  return written;
}

/** Best-effort cleanup after a failed step so no staging rows are left behind. */
export async function abortDictPackImport(packId: string): Promise<void> {
  const db = getDB();
  const stagingId = tempDictPackId(packId);
  await db.transaction('rw', db.dict_packs, db.dict_terms, async () => {
    await db.dict_terms.where('packId').equals(stagingId).delete();
    await db.dict_packs.delete(stagingId);
  });
}

export interface DictOrphanCleanup {
  /** Staging packs removed. */
  packs: number;
  /** Term rows removed (staging + orphaned). */
  terms: number;
}

/**
 * Start-up sweep: remove every staging pack left by a torn import and every
 * term row whose pack id has no pack row. Committed packs are untouched.
 * Runs once per service-worker start; import steps await `beginOrphanCleanup`
 * so a cold start cannot delete a staging pack that is being written.
 */
export async function cleanupDictPackOrphans(): Promise<DictOrphanCleanup> {
  const db = getDB();
  const packIds = (await db.dict_packs.toCollection().primaryKeys()) as string[];
  const knownPacks = new Set(packIds);
  const stagingPacks = packIds.filter(
    (id) => typeof id === 'string' && id.startsWith(TEMP_DICT_PACK_PREFIX),
  );
  const termPackIds = (await db.dict_terms.orderBy('packId').uniqueKeys()) as unknown as string[];
  const orphanTermPacks = termPackIds.filter(
    (id) => typeof id === 'string' && !knownPacks.has(id),
  );
  if (stagingPacks.length === 0 && orphanTermPacks.length === 0) {
    return { packs: 0, terms: 0 };
  }

  let terms = 0;
  await db.transaction('rw', db.dict_packs, db.dict_terms, async () => {
    for (const id of new Set([...stagingPacks, ...orphanTermPacks])) {
      terms += await db.dict_terms.where('packId').equals(id).count();
      await db.dict_terms.where('packId').equals(id).delete();
    }
    for (const id of stagingPacks) await db.dict_packs.delete(id);
  });
  return { packs: stagingPacks.length, terms };
}

/**
 * Barrier for the start-up sweep. The service worker calls this once at
 * module load; every import step awaits the returned promise so the sweep and
 * a fresh BEGIN cannot interleave. A failed sweep must not block imports.
 */
let orphanCleanup: Promise<void> | null = null;

export function beginDictPackOrphanCleanup(): Promise<void> {
  if (!orphanCleanup) {
    orphanCleanup = cleanupDictPackOrphans()
      .then(() => undefined)
      .catch(() => undefined);
  }
  return orphanCleanup;
}

async function settleOrphanCleanup(): Promise<void> {
  if (orphanCleanup) await orphanCleanup;
}
