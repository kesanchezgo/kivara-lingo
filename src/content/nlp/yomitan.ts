/**
 * Yomitan-compatible dictionary pack importer + lookup.
 *
 * A Yomitan pack is a ZIP file with this layout:
 *
 *   index.json                        — metadata (title, revision, format, …)
 *   term_bank_1.json                  — array of 8-tuples, see below
 *   term_bank_2.json                  — …
 *   …
 *   term_meta_bank_1.json             — optional frequency / pitch data
 *   kanji_bank_1.json                 — optional (JP only)
 *
 * Each term_bank entry is the 8-tuple:
 *   [ expression, reading, definitionTags, deinflectionRules,
 *     popularity, definitions, sequence, termTags ]
 *
 * `definitions` is either:
 *   • an array of plain strings (older "format: 1" packs), or
 *   • an array of structured "content" objects (format >= 3, with
 *     {type: "structured-content", content: [...]} entries).
 *
 * We store each entry as a `DictTermRow` and surface lookups via
 * `lookupYomitanTerm()` which returns the highest-popularity hit across all
 * enabled packs.
 *
 * Reference: https://github.com/yomidevs/yomitan/blob/master/docs/dictionaries.md
 */
import { unzipSync, strFromU8, Unzip, UnzipInflate } from 'fflate';
import { getDB } from '../../shared/db';
import type { DictPackRow, DictTermRow } from '../../shared/db';
import type { DictionaryEntry } from '../../shared/types';
import { lemmaCandidates } from './lemma';
import { deletePackStats, recordPackInstall } from '../../shared/telemetry';

/** Yomitan term_bank entry tuple. */
export type YomitanTermTuple = [
  expression: string,
  reading: string,
  definitionTags: string | null,
  deinflectionRules: string,
  popularity: number,
  definitions: unknown[],
  sequence: number,
  termTags: string | null,
];

export interface YomitanIndex {
  title?: string;
  revision?: string;
  format?: number;
  version?: number;
  author?: string;
  description?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
}

export interface ImportResult {
  ok: true;
  pack: DictPackRow;
  termsImported: number;
}

export interface ImportError {
  ok: false;
  error: string;
}

/** Cheap deterministic id derived from title + revision. */
function packId(title: string, revision: string): string {
  const input = `${title}|${revision}`;
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return `pack-${(hash >>> 0).toString(16)}`;
}

/**
 * Parse a `.zip` Yomitan pack and write its entries into IndexedDB.
 *
 * Importing the same (title, revision) twice will overwrite the previous
 * entries (the pack id is deterministic, so we delete-then-insert the term
 * rows atomically in a transaction).
 */
export async function importYomitanPack(
  zipBytes: ArrayBuffer | Uint8Array,
): Promise<ImportResult | ImportError> {
  let files: Record<string, Uint8Array>;
  try {
    const bytes = zipBytes instanceof Uint8Array ? zipBytes : new Uint8Array(zipBytes);
    files = unzipSync(bytes);
  } catch (err) {
    return { ok: false, error: `Could not unzip pack: ${(err as Error).message}` };
  }

  // index.json may live at the root OR inside a folder (some packs ship as
  // "pack-name/index.json"). Find whichever path ends with "index.json".
  const indexEntry = Object.entries(files).find(([name]) => name.endsWith('index.json'));
  if (!indexEntry) {
    return { ok: false, error: 'Missing index.json in pack' };
  }
  const indexPrefix = indexEntry[0].replace(/index\.json$/, '');
  let index: YomitanIndex;
  try {
    index = JSON.parse(strFromU8(indexEntry[1])) as YomitanIndex;
  } catch (err) {
    return { ok: false, error: `Bad index.json: ${(err as Error).message}` };
  }

  const title = (index.title || '').trim();
  const revision = (index.revision || '').trim();
  if (!title) return { ok: false, error: 'index.json missing "title"' };
  if (!revision) return { ok: false, error: 'index.json missing "revision"' };
  const format = Number(index.format ?? index.version ?? 1);
  const sourceLang = index.sourceLanguage || 'en';
  const targetLang = index.targetLanguage || 'es';
  const id = packId(title, revision);

  // Parse every term_bank_*.json file under the same prefix.
  const termBankFiles = Object.entries(files)
    .filter(([name]) => name.startsWith(indexPrefix) && /term_bank_\d+\.json$/.test(name))
    .sort();

  // Some packs (e.g. IPA/pronunciation packs) only ship term_meta_bank files
  // with reading/phonetic data and no term_bank files. We handle both paths.
  const metaBankFiles = Object.entries(files)
    .filter(([name]) => name.startsWith(indexPrefix) && /term_meta_bank_\d+\.json$/.test(name))
    .sort();

  if (termBankFiles.length === 0 && metaBankFiles.length === 0) {
    return { ok: false, error: 'No se encontraron archivos term_bank ni term_meta_bank en el pack' };
  }

  const termRows: DictTermRow[] = [];

  // Standard term_bank entries (definitions, translations, etc.)
  for (const [name, bytes] of termBankFiles) {
    try {
      const arr = JSON.parse(strFromU8(bytes)) as YomitanTermTuple[];
      for (const t of arr) {
        if (!Array.isArray(t) || t.length < 6) continue;
        const expression = String(t[0] ?? '')
          .trim()
          .toLowerCase();
        if (!expression) continue;
        const reading = String(t[1] ?? '').trim();
        const definitionTags = (t[2] as string | null) ?? undefined;
        const popularity = Number(t[4] ?? 0) || 0;
        const definitions = Array.isArray(t[5]) ? t[5] : [];
        const termTags = (t[7] as string | null) ?? undefined;
        termRows.push({
          packId: id,
          expression,
          reading: reading || undefined,
          definitions,
          popularity,
          definitionTags: definitionTags || undefined,
          termTags: termTags || undefined,
        });
      }
    } catch (err) {
      return { ok: false, error: `No se pudo parsear ${name}: ${(err as Error).message}` };
    }
  }

  // IPA / pronunciation meta entries — stored as DictTermRow with empty
  // definitions so lookupYomitanTerm can overlay the reading onto hits from
  // other packs that lack phonetic data.
  for (const [name, bytes] of metaBankFiles) {
    try {
      const arr = JSON.parse(strFromU8(bytes)) as unknown[];
      for (const entry of arr) {
        if (!Array.isArray(entry) || entry.length < 3) continue;
        const expression = String(entry[0] ?? '').trim().toLowerCase();
        const mode = String(entry[1] ?? '');
        if (!expression || mode !== 'ipa') continue;
        const meta = entry[2];
        const ipa = extractFirstIpa(meta);
        if (!ipa) continue;
        termRows.push({
          packId: id,
          expression,
          reading: ipa,
          definitions: [],
          popularity: 0,
          termTags: 'ipa',
        });
      }
    } catch (err) {
      return { ok: false, error: `No se pudo parsear ${name}: ${(err as Error).message}` };
    }
  }

  if (termRows.length === 0) {
    return { ok: false, error: 'Pack contains zero usable terms' };
  }

  const pack: DictPackRow = {
    id,
    title,
    revision,
    format,
    sourceLang,
    targetLang,
    termCount: termRows.length,
    enabled: true,
    author: index.author,
    description: index.description,
    createdAt: Date.now(),
  };

  const db = getDB();
  // Atomic replace: delete any existing terms for this pack id, then insert
  // the fresh batch in one transaction so we never have a half-imported pack.
  await db.transaction('rw', db.dict_packs, db.dict_terms, async () => {
    await db.dict_terms.where('packId').equals(id).delete();
    // Chunk inserts — IndexedDB throws when single-batch bulks are too large
    // (~30 MB), and big Yomitan packs (Jitendex etc.) can ship 500k+ terms.
    const CHUNK = 5000;
    for (let i = 0; i < termRows.length; i += CHUNK) {
      await db.dict_terms.bulkAdd(termRows.slice(i, i + CHUNK));
    }
    await db.dict_packs.put(pack);
  });

  void recordPackInstall(id, pack.title);

  return { ok: true, pack, termsImported: termRows.length };
}

/**
 * Streaming variant of `importYomitanPack` for very large archives (the
 * EN→EN Wiktionary pack decompresses to ~700 MB of JSON; loading the whole
 * thing in memory crashes the renderer / occasionally the SW too).
 *
 * Uses fflate's `Unzip` + `UnzipInflate` API to walk the ZIP one file at a
 * time. We collect each file's raw bytes, parse + insert it, and drop the
 * buffer before moving on, so peak memory stays bounded by the largest
 * single `term_bank_*.json` (typically 5–15 MB) instead of the whole
 * uncompressed archive.
 *
 * The caller passes the compressed ZIP as a `Uint8Array` and we feed it
 * to the streaming decoder in 4 MB chunks. This is the only way to import
 * the bigger Wiktionary packs without OOM-killing the host process.
 *
 * @param zipBytes  Compressed ZIP bytes (as fetched from the CDN).
 * @param onProgress Optional callback with stage info — useful so the UI
 *                   can render "Descomprimiendo · 12 de 64 archivos" while
 *                   we churn through the term banks.
 */
export async function importYomitanPackStreaming(
  zipBytes: Uint8Array,
  onProgress?: (info: {
    stage: 'unzipping' | 'parsing' | 'writing' | 'done';
    fileName?: string;
    filesDone: number;
    /** Total file count is unknown until index.json is found. */
    filesTotal?: number;
    termsParsed: number;
  }) => void,
): Promise<ImportResult | ImportError> {
  // Phase 1: walk the central directory by streaming the bytes through
  // `Unzip`. fflate emits one `UnzipFile` per archive entry; we collect
  // file metadata first, then pull each file's bytes via `start()`.
  interface PendingFile {
    name: string;
    bytes: Uint8Array | null;
    /** Resolved when ondata signals `final = true`. */
    done: Promise<void>;
    resolve: () => void;
    reject: (err: Error) => void;
  }
  const pending: PendingFile[] = [];

  const unzipper = new Unzip((file) => {
    // Resolve the buffer for this file as fflate streams it.
    const chunks: Uint8Array[] = [];
    const slot: PendingFile = {
      name: file.name,
      bytes: null,
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      resolve: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      reject: () => {},
      done: null as unknown as Promise<void>,
    };
    slot.done = new Promise<void>((res, rej) => {
      slot.resolve = res;
      slot.reject = rej;
    });
    file.ondata = (err, data, final) => {
      if (err) {
        slot.reject(err as unknown as Error);
        return;
      }
      if (data && data.length > 0) chunks.push(data);
      if (final) {
        // Concatenate the chunks into a single Uint8Array.
        let total = 0;
        for (const c of chunks) total += c.length;
        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
          out.set(c, off);
          off += c.length;
        }
        slot.bytes = out;
        chunks.length = 0;
        slot.resolve();
      }
    };
    file.start();
    pending.push(slot);
  });
  unzipper.register(UnzipInflate);

  // Push the ZIP bytes into the streaming decoder in moderate chunks.
  // Larger chunks are slightly faster but produce bigger intermediate
  // allocations; 4 MB is a healthy compromise for the EN→EN pack.
  const PUSH_CHUNK = 4 * 1024 * 1024;
  for (let i = 0; i < zipBytes.length; i += PUSH_CHUNK) {
    const end = Math.min(i + PUSH_CHUNK, zipBytes.length);
    const isFinal = end === zipBytes.length;
    unzipper.push(zipBytes.subarray(i, end), isFinal);
    // Yield to the event loop so the SW stays responsive (and so other
    // listeners can fire status pings).
    if (!isFinal) await Promise.resolve();
  }

  if (pending.length === 0) {
    return { ok: false, error: 'El ZIP no contiene archivos.' };
  }

  // Find index.json — same lookup as the non-streaming path. Wait only
  // for files whose names match "index.json" so we don't block on the
  // huge term banks for the index.
  const indexSlot = pending.find((f) => f.name.endsWith('index.json'));
  if (!indexSlot) {
    return { ok: false, error: 'Missing index.json in pack' };
  }
  await indexSlot.done;
  if (!indexSlot.bytes) {
    return { ok: false, error: 'index.json tiene cero bytes' };
  }
  let index: YomitanIndex;
  try {
    index = JSON.parse(strFromU8(indexSlot.bytes)) as YomitanIndex;
  } catch (err) {
    return { ok: false, error: `Bad index.json: ${(err as Error).message}` };
  }
  const indexPrefix = indexSlot.name.replace(/index\.json$/, '');

  const title = (index.title || '').trim();
  const revision = (index.revision || '').trim();
  if (!title) return { ok: false, error: 'index.json missing "title"' };
  if (!revision) return { ok: false, error: 'index.json missing "revision"' };
  const format = Number(index.format ?? index.version ?? 1);
  const sourceLang = index.sourceLanguage || 'en';
  const targetLang = index.targetLanguage || 'es';
  const id = packId(title, revision);

  // Free the index slot's bytes — we've already parsed it.
  indexSlot.bytes = null;

  const termBankSlots = pending
    .filter((f) => f.name.startsWith(indexPrefix) && /term_bank_\d+\.json$/.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const metaBankSlots = pending
    .filter((f) => f.name.startsWith(indexPrefix) && /term_meta_bank_\d+\.json$/.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (termBankSlots.length === 0 && metaBankSlots.length === 0) {
    return { ok: false, error: 'No se encontraron archivos term_bank ni term_meta_bank en el pack' };
  }

  const filesTotal = termBankSlots.length + metaBankSlots.length;
  let filesDone = 0;
  let termsParsed = 0;
  const db = getDB();

  // Atomic replace: clear any prior install of this pack id BEFORE we
  // start streaming inserts so a partial import never coexists with a
  // previous full one.
  await db.transaction('rw', db.dict_packs, db.dict_terms, async () => {
    await db.dict_terms.where('packId').equals(id).delete();
  });

  const CHUNK = 5000;
  /** Insert and free `rows` so the GC can reclaim them between bank files. */
  async function flushRows(rows: DictTermRow[]): Promise<void> {
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db.dict_terms.bulkAdd(rows.slice(i, i + CHUNK));
    }
  }

  // Phase 2: parse each term_bank_*.json one at a time and insert before
  // moving to the next file. This keeps peak memory bounded by ONE bank
  // file's parsed array, which is typically 50–200 k rows (~10–40 MB).
  for (const slot of termBankSlots) {
    onProgress?.({
      stage: 'parsing',
      fileName: slot.name,
      filesDone,
      filesTotal,
      termsParsed,
    });
    await slot.done;
    if (!slot.bytes) {
      filesDone += 1;
      continue;
    }
    let arr: YomitanTermTuple[];
    try {
      arr = JSON.parse(strFromU8(slot.bytes)) as YomitanTermTuple[];
    } catch (err) {
      return { ok: false, error: `No se pudo parsear ${slot.name}: ${(err as Error).message}` };
    }
    // Free the raw bytes immediately — they're already parsed into arr.
    slot.bytes = null;

    const rows: DictTermRow[] = [];
    for (const t of arr) {
      if (!Array.isArray(t) || t.length < 6) continue;
      const expression = String(t[0] ?? '').trim().toLowerCase();
      if (!expression) continue;
      const reading = String(t[1] ?? '').trim();
      const definitionTags = (t[2] as string | null) ?? undefined;
      const popularity = Number(t[4] ?? 0) || 0;
      const definitions = Array.isArray(t[5]) ? t[5] : [];
      const termTags = (t[7] as string | null) ?? undefined;
      rows.push({
        packId: id,
        expression,
        reading: reading || undefined,
        definitions,
        popularity,
        definitionTags: definitionTags || undefined,
        termTags: termTags || undefined,
      });
    }
    // Free the parsed JSON array now that we've extracted what we need.
    arr.length = 0;

    onProgress?.({
      stage: 'writing',
      fileName: slot.name,
      filesDone,
      filesTotal,
      termsParsed: termsParsed + rows.length,
    });
    await flushRows(rows);
    termsParsed += rows.length;
    rows.length = 0;
    filesDone += 1;
  }

  // Phase 3: same loop for term_meta_bank_*.json (IPA / pronunciation).
  for (const slot of metaBankSlots) {
    onProgress?.({
      stage: 'parsing',
      fileName: slot.name,
      filesDone,
      filesTotal,
      termsParsed,
    });
    await slot.done;
    if (!slot.bytes) {
      filesDone += 1;
      continue;
    }
    let arr: unknown[];
    try {
      arr = JSON.parse(strFromU8(slot.bytes)) as unknown[];
    } catch (err) {
      return { ok: false, error: `No se pudo parsear ${slot.name}: ${(err as Error).message}` };
    }
    slot.bytes = null;

    const rows: DictTermRow[] = [];
    for (const entry of arr) {
      if (!Array.isArray(entry) || entry.length < 3) continue;
      const expression = String(entry[0] ?? '').trim().toLowerCase();
      const mode = String(entry[1] ?? '');
      if (!expression || mode !== 'ipa') continue;
      const meta = entry[2];
      const ipa = extractFirstIpa(meta);
      if (!ipa) continue;
      rows.push({
        packId: id,
        expression,
        reading: ipa,
        definitions: [],
        popularity: 0,
        termTags: 'ipa',
      });
    }
    arr.length = 0;

    onProgress?.({
      stage: 'writing',
      fileName: slot.name,
      filesDone,
      filesTotal,
      termsParsed: termsParsed + rows.length,
    });
    await flushRows(rows);
    termsParsed += rows.length;
    rows.length = 0;
    filesDone += 1;
  }

  if (termsParsed === 0) {
    // Nothing made it through — roll back the empty pack row so the user
    // doesn't see a phantom 0-term install in the gallery.
    await db.dict_packs.delete(id);
    return { ok: false, error: 'Pack contains zero usable terms' };
  }

  const pack: DictPackRow = {
    id,
    title,
    revision,
    format,
    sourceLang,
    targetLang,
    termCount: termsParsed,
    enabled: true,
    author: index.author,
    description: index.description,
    createdAt: Date.now(),
  };
  await db.dict_packs.put(pack);

  void recordPackInstall(id, pack.title);
  onProgress?.({
    stage: 'done',
    filesDone,
    filesTotal,
    termsParsed,
  });

  return { ok: true, pack, termsImported: termsParsed };
}

/**
 * Convenience wrapper that fetches a pack ZIP from `url` and imports it.
 *
 * The fetch is delegated to the background service worker (which has the
 * extension's host permissions) when `chrome.runtime.sendMessage` is
 * available — that keeps Cloudflare R2 / GitHub Pages / generic CORS-allowed
 * hosts working from any side-panel context, regardless of the page origin.
 * In non-extension contexts (e.g. vitest, the side-by-side prototype) we
 * fall back to a direct `fetch()`.
 */
export async function importYomitanPackFromUrl(
  url: string,
  onProgress?: (received: number, total: number) => void,
): Promise<ImportResult | ImportError> {
  let bytes: ArrayBuffer;
  try {
    bytes = await fetchPackBytes(url, onProgress);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `No se pudo descargar el pack: ${message}` };
  }
  return importYomitanPack(bytes);
}

/**
 * Fetch raw bytes for a dictionary pack with automatic retries and timeout.
 *
 * Tries the extension context first (direct fetch with host_permissions).
 * Falls back to the SW proxy only if the direct fetch fails due to CORS
 * (shouldn't happen for URLs in host_permissions, but kept as safety net).
 *
 * Retries up to 3 times with exponential backoff (1s → 3s → 9s).
 * Per-attempt timeout: 120s for large packs, 60s for normal ones.
 * Stale connection detection: aborts if no bytes arrive for 15s.
 */
async function fetchPackBytes(
  url: string,
  onProgress?: (received: number, total: number) => void,
): Promise<ArrayBuffer> {
  const { fetchWithRetry } = await import('../../shared/resilient-fetch');
  return fetchWithRetry(url, {
    maxRetries: 3,
    timeoutMs: 120_000,
    staleTimeoutMs: 15_000,
    onProgress,
  });
}

/** Delete a pack and all of its term rows. */
export async function deleteYomitanPack(id: string): Promise<void> {
  const db = getDB();
  await db.transaction('rw', db.dict_packs, db.dict_terms, async () => {
    await db.dict_terms.where('packId').equals(id).delete();
    await db.dict_packs.delete(id);
  });
  // Drop any telemetry row so the coverage widget doesn't keep showing the
  // pack as a phantom "0 hits" row. Best-effort.
  void deletePackStats(id);
}

/** Toggle a pack's `enabled` flag without touching its terms. */
export async function setPackEnabled(id: string, enabled: boolean): Promise<void> {
  await getDB().dict_packs.update(id, { enabled });
}

/** List installed packs (in install order). */
export async function listYomitanPacks(): Promise<DictPackRow[]> {
  return getDB().dict_packs.orderBy('createdAt').toArray();
}

/**
 * Return every headword (lowercased) covered by the user's currently
 * ENABLED packs, for the given source language. Used by the content-script
 * tokenizer so words like `excuse`, `pee`, `pants`, `seventh`, `grade`
 * — which are NOT in the bundled `en.json` but ARE in the Wiktionary
 * EN→ES pack — are correctly classified as `known` instead of `unknown`.
 *
 * The full set for a 1.8M-row Wiktionary EN→EN pack is ~1.5M unique
 * lowercased strings. Each string is roughly 8 bytes of overhead in V8,
 * so the in-memory Set is ~12-15 MB on the heap. That's a one-time
 * cost shared across the whole tab; the tokenizer reads from it via
 * `O(1)` Set.has() per token.
 */
export async function getYomitanHeadwords(lang = 'en'): Promise<string[]> {
  const db = getDB();
  // Same caveat as `lookupYomitanTerm` — IndexedDB doesn't index booleans
  // reliably, so we scan and filter in JS. The `dict_packs` table is tiny.
  const allPacks = await db.dict_packs.toArray();
  const packs = allPacks.filter(
    (p) =>
      p.enabled &&
      (p.sourceLang === lang || p.sourceLang.startsWith(lang)),
  );
  if (packs.length === 0) return [];
  const packIds = new Set(packs.map((p) => p.id));

  // Pull every distinct headword from the enabled packs in one pass.
  // Using `dict_terms.where('packId').equals(id).uniqueKeys()` would scan
  // the `packId` index but return its own keys (the auto-incrementing
  // primary id), which is useless to us. We want the `expression`
  // strings, so we go through `[packId+expression]` compound index keys
  // and drop the prefix.
  const out = new Set<string>();
  for (const id of packIds) {
    const compoundKeys = (await db.dict_terms
      .where('[packId+expression]')
      .between([id, ''], [id, '\uffff'], true, true)
      .uniqueKeys()) as Array<[string, string]>;
    for (const k of compoundKeys) {
      if (Array.isArray(k) && typeof k[1] === 'string' && k[1]) {
        out.add(k[1]);
      }
    }
  }
  return Array.from(out);
}

/**
 * Look up a term across all *enabled* packs in the given source language.
 *
 * Returns the highest-popularity match (ties broken by pack install order).
 * Lemma-aware: if the literal token has no hit, we walk lemma candidates and
 * return the first match so "running" can find "run".
 */
export async function lookupYomitanTerm(
  token: string,
  lang = 'en',
): Promise<{ entry: DictionaryEntry; pack: DictPackRow } | undefined> {
  const db = getDB();
  // 1. List enabled packs for the right source language.
  //    IndexedDB does NOT index boolean values — depending on the
  //    Chrome version the `where('enabled').equals(1)` query either
  //    throws (caught below) or silently returns an empty cursor. We
  //    can't rely on the index, so we always scan and filter in JS.
  //    The `dict_packs` table is small (a handful of rows even for
  //    power users) so the scan is essentially free.
  const allPacks = await db.dict_packs.toArray();
  const packs = allPacks.filter(
    (p) =>
      p.enabled &&
      (p.sourceLang === lang || p.sourceLang.startsWith(lang)),
  );
  if (packs.length === 0) return undefined;
  const packIds = new Set(packs.map((p) => p.id));
  // Convenience map for kind lookup. A pack is *bilingual* when its
  // source ≠ target (EN→ES) and *monolingual* when source == target
  // (EN→EN). The popover renders the translation from the bilingual
  // hit and the long-form definition from the monolingual hit.
  const packKind = new Map<string, 'bilingual' | 'monolingual'>();
  for (const p of packs) {
    const src = (p.sourceLang || '').slice(0, 2).toLowerCase();
    const tgt = (p.targetLang || '').slice(0, 2).toLowerCase();
    packKind.set(p.id, src === tgt ? 'monolingual' : 'bilingual');
  }

  // 2. Try literal then lemma candidates.
  const candidates = lang === 'en' ? lemmaCandidates(token) : [token.trim().toLowerCase()];
  for (let i = 0; i < candidates.length; i += 1) {
    const exp = candidates[i];
    if (!exp) continue;
    const rows = await db.dict_terms.where('expression').equals(exp).toArray();
    const filtered = rows.filter((r) => packIds.has(r.packId));
    if (filtered.length === 0) continue;
    // Prefer bilingual rows over monolingual ones — the popover's
    // primary line is the *translation*, which only the bilingual pack
    // can provide. Within each kind, sort by popularity and install
    // order. We pick the first bilingual hit when one exists, and
    // otherwise the best monolingual hit.
    const sorted = [...filtered].sort((a, b) => {
      const ka = packKind.get(a.packId) === 'bilingual' ? 0 : 1;
      const kb = packKind.get(b.packId) === 'bilingual' ? 0 : 1;
      if (ka !== kb) return ka - kb;
      if (a.popularity !== b.popularity) return b.popularity - a.popularity;
      const pa = packs.findIndex((p) => p.id === a.packId);
      const pb = packs.findIndex((p) => p.id === b.packId);
      return pa - pb;
    });
    const hit = sorted[0];
    const pack = packs.find((p) => p.id === hit.packId)!;
    const hitKind = packKind.get(hit.packId) ?? 'bilingual';
    const entry = dictTermToEntry(token, hit, hitKind, i > 0 ? exp : undefined);

    // Overlay a monolingual definition from the EN→EN pack when the
    // primary hit came from a bilingual pack. Same idea as the IPA
    // overlay below: lets the user read the long-form English
    // explanation under the Spanish translation, all in one popover.
    if (hitKind === 'bilingual' && !entry.monolingual) {
      const monoRow = sorted.find(
        (r) => packKind.get(r.packId) === 'monolingual' && r.definitions.length > 0,
      );
      if (monoRow) {
        const monoEntry = dictTermToEntry(token, monoRow, 'monolingual');
        if (monoEntry.monolingual) entry.monolingual = monoEntry.monolingual;
        // Pick up examples from the monolingual pack too if the
        // bilingual one didn't ship any.
        if ((!entry.examples || entry.examples.length === 0) && monoEntry.examples) {
          entry.examples = monoEntry.examples;
        }
      }
    }

    // Overlay IPA from a pronunciation-only pack (e.g. kty-en-ipa) when the
    // primary hit doesn't carry phonetic data. We look for any row with the
    // same expression that has a non-empty reading and empty definitions
    // (the signature of an IPA meta-pack import).
    if (!entry.phonetic) {
      const ipaRow = sorted.find((r) => r.reading && r.definitions.length === 0)
        ?? rows.find((r) => r.reading && r.definitions.length === 0);
      if (ipaRow?.reading) {
        const cleaned = cleanIpa(ipaRow.reading);
        if (cleaned) entry.phonetic = cleaned;
      }
    }

    return { pack, entry };
  }
  return undefined;
}

/**
 * Extract the first usable IPA string from a term_meta_bank entry's data
 * object. The shape is `{ reading: string, transcriptions: [{ ipa, tags }] }`.
 * We prefer transcriptions tagged with US/General American, then fall back to
 * the first non-empty IPA.
 */
/**
 * Validate and clean an IPA string. Some packs contain Wiktionary template
 * artifacts like `/Template:IPAchar"},"params":{"1":{"wt":"/wʊd/`. We try
 * to extract the real IPA from inside the garbage first, and only reject
 * if nothing usable can be salvaged.
 *
 * Valid IPA strings start with `/`, `[`, or `\` and contain only IPA
 * characters (Unicode phonetic extensions, combining marks, basic Latin).
 */
function cleanIpa(raw: string): string | null {
  // Try to extract a /.../ or [...] pattern from inside the string
  const slashMatch = raw.match(/\/[^/"{}\n]{1,60}\//);
  if (slashMatch) return slashMatch[0];
  const bracketMatch = raw.match(/\[[^\]"{}\n]{1,60}\]/);
  if (bracketMatch) return bracketMatch[0];
  // Try backslash notation (some packs use \...\)
  const backslashMatch = raw.match(/\\[^\\"{}\n]{1,60}\\/);
  if (backslashMatch) return backslashMatch[0];
  // If the raw string itself looks clean, use it directly
  if (raw.length <= 80 && !raw.includes('Template:') && !raw.includes('"') && !raw.includes('{')) {
    if (/^[/\[\\]/.test(raw)) return raw;
  }
  return null;
}

function extractFirstIpa(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null;
  const obj = meta as { transcriptions?: unknown[] };
  if (!Array.isArray(obj.transcriptions)) return null;
  let fallback: string | null = null;
  for (const t of obj.transcriptions) {
    if (!t || typeof t !== 'object') continue;
    const entry = t as { ipa?: string; tags?: string[] };
    const raw = typeof entry.ipa === 'string' ? entry.ipa.trim() : '';
    if (!raw) continue;
    const ipa = cleanIpa(raw);
    if (!ipa) continue;
    if (!fallback) fallback = ipa;
    const tags = Array.isArray(entry.tags) ? entry.tags : [];
    const isGenAm = tags.some(
      (tag) => /US|General.?American|🇺🇸/i.test(typeof tag === 'string' ? tag : ''),
    );
    if (isGenAm) return ipa;
  }
  return fallback;
}

/**
 * Flatten a Yomitan term row into our internal `DictionaryEntry` shape so the
 * popover doesn't need to know about Yomitan internals.
 *
 * Yomitan definitions can be:
 *   • plain strings (legacy format 1)                   → joined with " · "
 *   • structured-content objects (format 3)             → text extracted recursively
 *   • {type:"text", text:"…"} singletons                → text used directly
 *   • {type:"image", …}                                 → ignored
 *
 * We surface the first sense as `monolingual` and the rest as `bilingual` so
 * the popover renders meaningfully even when the pack doesn't ship explicit
 * fields.
 *
 * Examples buried inside `details-entry-examples` / `example-sentence`
 * structured-content nodes are extracted into `entry.examples` and stripped
 * from the definition text so the `monolingual` / `bilingual` fields don't
 * leak the source-language sentence into the Spanish gloss.
 */
function dictTermToEntry(
  surfaceToken: string,
  row: DictTermRow,
  kind: 'bilingual' | 'monolingual' = 'bilingual',
  lemmaOf?: string,
): DictionaryEntry {
  const senses: string[] = [];
  const exampleAccum: string[] = [];
  for (const def of row.definitions) {
    const parts = extractDefinitionParts(def);
    if (parts.text) senses.push(parts.text);
    for (const ex of parts.examples) {
      if (!exampleAccum.includes(ex)) exampleAccum.push(ex);
    }
  }
  // For a *bilingual* pack (EN→ES, EN→FR…), `senses[0]` is the
  // primary translation. The remaining senses are alternative
  // translations and we expose them in the `bilingual` field as
  // a "·"-separated short list so the popover can render them
  // under the headline.
  // For a *monolingual* pack (EN→EN), `senses[0]` is a definition
  // in the source language — it goes into `monolingual` and the
  // `translation` slot is left empty so the bilingual hit (if any)
  // can supply it via overlay later.
  if (kind === 'monolingual') {
    return {
      token: surfaceToken,
      type: 'word',
      phonetic: row.reading ? (cleanIpa(row.reading) ?? undefined) : undefined,
      translation: '—',
      monolingual: senses[0],
      examples: exampleAccum.length > 0 ? exampleAccum.slice(0, 5) : undefined,
      lemmaOf,
    };
  }
  const translation = senses[0] ?? '—';
  const bilingual = senses.length > 1 ? senses.slice(1, 4).join(' · ') : undefined;
  return {
    token: surfaceToken,
    type: 'word',
    phonetic: row.reading ? (cleanIpa(row.reading) ?? undefined) : undefined,
    translation,
    bilingual,
    examples: exampleAccum.length > 0 ? exampleAccum.slice(0, 5) : undefined,
    lemmaOf,
  };
}

/**
 * Walk a Yomitan structured-content node and split it into:
 *  - `text`     — the natural-language definition with example wrappers
 *                 and inline grammatical tags removed
 *  - `examples` — the source-language example sentences (and their
 *                 translations when present) found anywhere under the node
 *
 * The two known kaikki-to-yomitan / wiktionary-to-yomitan example shapes are
 * recognised:
 *
 *  - `{ tag: "div", data: { content: "example-sentence" }, content: [...] }`
 *    contains paired children:
 *      `{ data: { content: "example-sentence-a" }, content: "<source>" }`
 *      `{ data: { content: "example-sentence-b" }, content: "<translation>" }`
 *    rendered as `<source> — <translation>` so the Anki card surfaces both.
 *
 *  - `{ tag: "details", data: { content: "details-entry-examples" }, ... }`
 *    wraps one or more `example-sentence` nodes plus a `summary-entry`
 *    label like "1 ejemplo" we want to drop from the definition text.
 *
 * Inline grammatical tags (`{ data: { content: "tags" }, ... }`, e.g. the
 * `obs` / `col` Wiktionary markers) are also stripped from the definition
 * text — they were polluting the `monolingual` field with abbreviations
 * the learner doesn't care about.
 *
 * Exported for tests so we can pin the contract against real-world entries.
 */
export function extractDefinitionParts(d: unknown): {
  text: string;
  examples: string[];
} {
  const examples: string[] = [];
  const text = walkForText(d, examples).trim().replace(/\s+/g, ' ');
  return { text, examples };
}

function walkForText(d: unknown, examples: string[]): string {
  if (typeof d === 'string') return d;
  if (!d || typeof d !== 'object') return '';
  if (Array.isArray(d)) {
    return (d as unknown[]).map((c) => walkForText(c, examples)).join(' ');
  }
  const obj = d as {
    type?: string;
    text?: string;
    tag?: string;
    content?: unknown;
    structuredContent?: unknown;
    data?: { content?: string };
  };
  const dataContent = obj.data?.content;

  // 1. Dedicated example-sentence container — collect, do not contribute text.
  if (dataContent === 'example-sentence') {
    const example = collectExampleSentence(obj.content);
    if (example) examples.push(example);
    return '';
  }
  // 2. Wrapper around one or more example sentences plus a summary like
  //    "2 ejemplos" — recurse into the children but emit no text of our own.
  if (
    dataContent === 'details-entry-examples' ||
    dataContent === 'extra-info' ||
    dataContent === 'summary-entry'
  ) {
    if (obj.content !== undefined) walkForText(obj.content, examples);
    return '';
  }
  // 3. Inline grammatical-tag wrapper — drop entirely. The `obs`, `col`
  //    badges read as noise inside the `monolingual` field.
  if (dataContent === 'tags' || dataContent === 'tag') {
    return '';
  }

  // Plain text leaf or text-typed node.
  if (obj.type === 'text' && typeof obj.text === 'string') return obj.text;
  if (typeof obj.text === 'string') return obj.text;

  // structured-content wrappers.
  if (obj.type === 'structured-content' && obj.content !== undefined) {
    return walkForText(obj.content, examples);
  }
  if (obj.structuredContent !== undefined) {
    return walkForText(obj.structuredContent, examples);
  }
  if (obj.content !== undefined) return walkForText(obj.content, examples);
  return '';
}

/**
 * Render a single `example-sentence` node into a `"source — translation"`
 * string. When only the source is present, return it alone. When neither is
 * present, return the empty string so the caller skips the entry.
 */
function collectExampleSentence(content: unknown): string {
  let source = '';
  let translation = '';
  const visit = (node: unknown): void => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const c of node) visit(c);
      return;
    }
    if (typeof node !== 'object') return;
    const obj = node as {
      content?: unknown;
      data?: { content?: string };
    };
    const dc = obj.data?.content;
    if (dc === 'example-sentence-a') {
      const text = flattenText(obj.content);
      if (text) source = text;
      return;
    }
    if (dc === 'example-sentence-b') {
      const text = flattenText(obj.content);
      if (text) translation = text;
      return;
    }
    if (obj.content !== undefined) visit(obj.content);
  };
  visit(content);
  if (!source && !translation) return '';
  if (source && translation) return `${source} — ${translation}`;
  return source || translation;
}

function flattenText(node: unknown): string {
  if (typeof node === 'string') return node.trim();
  if (Array.isArray(node)) return node.map(flattenText).filter(Boolean).join(' ').trim();
  if (!node || typeof node !== 'object') return '';
  const obj = node as { text?: string; content?: unknown };
  if (typeof obj.text === 'string') return obj.text.trim();
  if (obj.content !== undefined) return flattenText(obj.content);
  return '';
}
