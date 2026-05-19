/**
 * StarDict-format dictionary pack importer.
 *
 * StarDict packs ship as three (sometimes four) sibling files:
 *
 *   <name>.ifo            — text "INI"-style metadata (bookname, wordcount, …)
 *   <name>.idx            — concatenated   [ word\0  offset:uint32  size:uint32 ]
 *   <name>.dict           — raw dictionary data, indexed by .idx offsets
 *   <name>.dict.dz        — gzip-compressed .dict (alternative to plain .dict)
 *   <name>.syn            — optional synonym index (unused for now)
 *
 * The community ships StarDict packs as `.zip` or `.tar.bz2`. We only
 * accept `.zip` here so we can reuse `fflate`. (`.tar.bz2` packs can be
 * re-zipped in 10 seconds by the user — we document this in the UI.)
 *
 * Spec reference: https://github.com/huzheng001/stardict-3/blob/master/dict/doc/StarDictFileFormat
 */
import { unzipSync, gunzipSync, strFromU8 } from 'fflate';
import { getDB } from '../../shared/db';
import type { DictPackRow, DictTermRow } from '../../shared/db';
import { recordPackInstall } from '../../shared/telemetry';

export interface StarDictImportResult {
  ok: true;
  pack: DictPackRow;
  termsImported: number;
}

export interface StarDictImportError {
  ok: false;
  error: string;
}

interface StarDictIfo {
  bookname: string;
  wordcount: number;
  idxfilesize?: number;
  sametypesequence?: string;
  author?: string;
  description?: string;
  date?: string;
  /** ISO 639-1 / BCP-47 from the optional `lang` field. */
  sourceLang?: string;
  targetLang?: string;
}

/**
 * Parse a StarDict pack distributed as a single ZIP archive.
 *
 * Re-imports overwrite the same pack id (derived from bookname + version).
 */
export async function importStarDictPack(
  zipBytes: ArrayBuffer | Uint8Array,
  override?: { sourceLang?: string; targetLang?: string },
): Promise<StarDictImportResult | StarDictImportError> {
  let files: Record<string, Uint8Array>;
  try {
    const bytes = zipBytes instanceof Uint8Array ? zipBytes : new Uint8Array(zipBytes);
    files = unzipSync(bytes);
  } catch (err) {
    return { ok: false, error: `Could not unzip pack: ${(err as Error).message}` };
  }

  // Locate the .ifo — it's the only file with a guaranteed extension.
  const ifoEntry = Object.entries(files).find(([name]) => name.toLowerCase().endsWith('.ifo'));
  if (!ifoEntry) return { ok: false, error: 'Missing .ifo file in StarDict pack' };

  const ifo = parseIfo(strFromU8(ifoEntry[1]));
  if (!ifo.bookname) return { ok: false, error: '.ifo missing "bookname"' };

  // Match siblings by stem (everything before the extension). The .idx may
  // ship gzip-compressed as `.idx.gz`; the .dict may ship as `.dict.dz`.
  const stem = ifoEntry[0].replace(/\.ifo$/i, '');
  const findSibling = (suffixRegex: RegExp): Uint8Array | undefined => {
    const hit = Object.entries(files).find(
      ([name]) => name.startsWith(stem) && suffixRegex.test(name.slice(stem.length)),
    );
    return hit?.[1];
  };

  const idxRaw = findSibling(/^\.idx$/i);
  const idxGz = findSibling(/^\.idx\.gz$/i);
  const dictRaw = findSibling(/^\.dict$/i);
  const dictDz = findSibling(/^\.dict\.dz$/i);

  const idxBytes = idxRaw ?? (idxGz ? safeGunzip(idxGz) : undefined);
  if (!idxBytes) return { ok: false, error: 'Missing .idx (or .idx.gz) file' };
  const dictBytes = dictRaw ?? (dictDz ? safeGunzip(dictDz) : undefined);
  if (!dictBytes) return { ok: false, error: 'Missing .dict (or .dict.dz) file' };

  const entries = parseIdx(idxBytes);
  if (entries.length === 0) {
    return { ok: false, error: '.idx has zero entries' };
  }

  const sequence = ifo.sametypesequence ?? 'm';
  const id = packId(ifo.bookname, ifo.date ?? `wc${ifo.wordcount}`);
  const termRows: DictTermRow[] = [];
  for (const e of entries) {
    if (e.offset + e.size > dictBytes.length) continue;
    const slice = dictBytes.subarray(e.offset, e.offset + e.size);
    const definitions = decodeDictPayload(slice, sequence);
    if (definitions.length === 0) continue;
    termRows.push({
      packId: id,
      expression: e.word.toLowerCase(),
      definitions,
      popularity: 0,
      termTags: 'stardict',
    });
  }
  if (termRows.length === 0) {
    return { ok: false, error: 'No readable definitions in pack' };
  }

  const pack: DictPackRow = {
    id,
    title: ifo.bookname,
    revision: ifo.date ?? `wc${ifo.wordcount}`,
    format: 3,
    sourceLang: override?.sourceLang ?? ifo.sourceLang ?? 'en',
    targetLang: override?.targetLang ?? ifo.targetLang ?? 'es',
    termCount: termRows.length,
    enabled: true,
    author: ifo.author,
    description: ifo.description ?? 'Imported from StarDict',
    createdAt: Date.now(),
  };

  const db = getDB();
  await db.transaction('rw', db.dict_packs, db.dict_terms, async () => {
    await db.dict_terms.where('packId').equals(id).delete();
    const CHUNK = 5000;
    for (let i = 0; i < termRows.length; i += CHUNK) {
      await db.dict_terms.bulkAdd(termRows.slice(i, i + CHUNK));
    }
    await db.dict_packs.put(pack);
  });

  void recordPackInstall(id, pack.title);

  return { ok: true, pack, termsImported: termRows.length };
}

function packId(bookname: string, version: string): string {
  const input = `stardict|${bookname.toLowerCase()}|${version}`;
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return `pack-sd-${(hash >>> 0).toString(16)}`;
}

/** Parse the `.ifo` INI-style metadata file. */
export function parseIfo(text: string): StarDictIfo {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();
    out[key] = value;
  }
  return {
    bookname: out.bookname || '',
    wordcount: Number.parseInt(out.wordcount || '0', 10) || 0,
    idxfilesize: out.idxfilesize ? Number.parseInt(out.idxfilesize, 10) : undefined,
    sametypesequence: out.sametypesequence,
    author: out.author,
    description: out.description,
    date: out.date,
    sourceLang: out.lang ? out.lang.split('-')[0] : undefined,
    targetLang: out.lang && out.lang.includes('-') ? out.lang.split('-')[1] : undefined,
  };
}

/**
 * Parse a StarDict `.idx` blob into an array of {word, offset, size}.
 * Format: NUL-terminated UTF-8 word + 4-byte BE offset + 4-byte BE size.
 *
 * Exported for unit testing.
 */
export function parseIdx(bytes: Uint8Array): { word: string; offset: number; size: number }[] {
  const out: { word: string; offset: number; size: number }[] = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8');
  let i = 0;
  while (i < bytes.length) {
    // Find next NUL.
    let end = i;
    while (end < bytes.length && bytes[end] !== 0) end += 1;
    if (end + 8 >= bytes.length + 1) break; // truncated tail
    const word = decoder.decode(bytes.subarray(i, end));
    const offset = dv.getUint32(end + 1, false); // big-endian
    const size = dv.getUint32(end + 5, false);
    out.push({ word, offset, size });
    i = end + 9;
  }
  return out;
}

/**
 * Decode the payload of a single .dict entry given the type sequence.
 * StarDict reserves a single letter per chunk: lowercase = "size prefixed
 * via the index" (one chunk = the whole slice), uppercase = "explicit
 * uint32 size prefix". We only translate text-bearing types ('m', 'l', 'g',
 * 'x', 't', 'y') — image/audio/binary types are skipped.
 *
 * Exported for unit testing.
 */
export function decodeDictPayload(bytes: Uint8Array, sequence: string): string[] {
  const decoder = new TextDecoder('utf-8');
  const out: string[] = [];
  if (sequence.length === 1) {
    if (isTextType(sequence)) {
      const text = decoder.decode(bytes).trim();
      if (text) out.push(text);
    }
    return out;
  }
  // Multi-type chunks: walk types in order, slicing the buffer as we go.
  let pos = 0;
  for (const type of sequence) {
    if (pos >= bytes.length) break;
    if (isUppercase(type)) {
      // Explicit uint32 size prefix.
      if (pos + 4 > bytes.length) break;
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const size = dv.getUint32(pos, false);
      pos += 4;
      const slice = bytes.subarray(pos, pos + size);
      pos += size;
      if (isTextType(type)) {
        const text = decoder.decode(slice).trim();
        if (text) out.push(text);
      }
    } else {
      // NUL-terminated text chunk.
      let end = pos;
      while (end < bytes.length && bytes[end] !== 0) end += 1;
      const slice = bytes.subarray(pos, end);
      pos = end + 1;
      if (isTextType(type)) {
        const text = decoder.decode(slice).trim();
        if (text) out.push(text);
      }
    }
  }
  return out;
}

function isTextType(t: string): boolean {
  // m: plain text, l: locale-encoded, g: pango, x: xdxf, t: phonetic,
  // y: chinese yinbiao, h: html, w: wordnet (treat html/wordnet as text
  // too — the popover can render them as-is).
  const ch = t.toLowerCase();
  return 'mlgxtyhwk'.includes(ch);
}

function isUppercase(t: string): boolean {
  return t >= 'A' && t <= 'Z';
}

/** Catch-all gunzip that returns undefined on failure rather than throwing. */
function safeGunzip(bytes: Uint8Array): Uint8Array | undefined {
  try {
    return gunzipSync(bytes);
  } catch {
    return undefined;
  }
}
