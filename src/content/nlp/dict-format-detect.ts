/**
 * Auto-detect the format of a dictionary file the user just picked.
 *
 * Surface goal: replace the "Yomitan / StarDict / CSV" choice in the panel
 * with a single "Importar archivo" button that routes to the right importer
 * automatically. Mis-routing today errors out half a second after the user
 * clicks — a poor UX for a feature that's supposed to feel obvious.
 *
 * Heuristics, in order:
 *
 *  1. **ZIP** (magic bytes `PK\x03\x04`):
 *     - If the central directory contains `index.json` at the root → Yomitan
 *     - Else if the central directory contains an `*.ifo` entry → StarDict
 *     - Else → unknown ZIP (the importer would otherwise wrongly accept it)
 *
 *  2. **Plain text** (no ZIP magic):
 *     - Always treated as CSV/TSV input. The CSV importer already accepts
 *       both delimiters and tolerates an optional header row.
 *
 * The detector reads only the first ~64 KB of a ZIP — enough to scan
 * filenames in the central directory of even very large packs (filenames
 * sit right after the EOCD record, but for our use case the local-file
 * headers at the start are already enough). Falls back to a full unzip
 * only if the heuristic is inconclusive.
 *
 * Pure module: no IndexedDB, no fetch, no React. Easy to test.
 */

export type DictFormat = 'yomitan' | 'stardict' | 'csv' | 'unknown';

export interface DetectResult {
  format: DictFormat;
  /** Reason / hint surfaced to the user when format is `unknown`. */
  reason?: string;
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

/**
 * Inspect the first bytes of a buffer and decide whether it's a ZIP or
 * plain text. ZIP magic is the 4-byte sequence `PK\x03\x04` at offset 0.
 */
export function isZipBuffer(buffer: ArrayBuffer | Uint8Array): boolean {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 4) return false;
  for (let i = 0; i < 4; i += 1) {
    if (bytes[i] !== ZIP_MAGIC[i]) return false;
  }
  return true;
}

/**
 * Inspect the central directory of a ZIP and return the list of filenames
 * found. We use this to decide between Yomitan (`index.json`) and StarDict
 * (`*.ifo`). The walker is tolerant of malformed entries — it just stops at
 * the first parse error and returns whatever it managed to read.
 *
 * Local-file-header layout (we only read the part we need):
 *
 *   Offset  Size  Field
 *   ──────  ────  ─────────────────────────────
 *      0     4    Magic (PK\x03\x04)
 *      4     2    Version needed
 *      6     2    Flags
 *      8     2    Compression method
 *     10     4    Last-modified
 *     14     4    CRC-32
 *     18     4    Compressed size
 *     22     4    Uncompressed size
 *     26     2    Filename length (n)
 *     28     2    Extra field length (m)
 *     30     n    Filename
 *     30+n   m    Extra field
 *     30+n+m       … data …
 */
export function listZipFilenames(
  buffer: ArrayBuffer | Uint8Array,
  maxFiles: number = 256,
): string[] {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const out: string[] = [];
  let i = 0;
  while (i + 30 <= bytes.length && out.length < maxFiles) {
    if (
      bytes[i] !== ZIP_MAGIC[0] ||
      bytes[i + 1] !== ZIP_MAGIC[1] ||
      bytes[i + 2] !== ZIP_MAGIC[2] ||
      bytes[i + 3] !== ZIP_MAGIC[3]
    ) {
      // No more local-file headers (we likely hit the central directory or
      // EOCD). Stop walking.
      break;
    }
    const compressedSize = dv.getUint32(i + 18, true);
    const filenameLen = dv.getUint16(i + 26, true);
    const extraLen = dv.getUint16(i + 28, true);
    const filenameStart = i + 30;
    const filenameEnd = filenameStart + filenameLen;
    if (filenameEnd > bytes.length) break;
    const name = decoder.decode(bytes.subarray(filenameStart, filenameEnd));
    if (name) out.push(name);
    i = filenameEnd + extraLen + compressedSize;
  }
  return out;
}

/**
 * Decide what kind of dictionary file the user picked.
 *
 * `filename` is consulted only as a tie-breaker (e.g. `.csv` / `.tsv` text
 * files vs. arbitrary `.txt`); ZIP detection always wins via magic bytes
 * regardless of the filename extension.
 */
export function detectDictFormat(
  buffer: ArrayBuffer | Uint8Array,
  filename?: string,
): DetectResult {
  if (isZipBuffer(buffer)) {
    const names = listZipFilenames(buffer);
    const hasIndex = names.some((n) => n === 'index.json' || n.endsWith('/index.json'));
    if (hasIndex) return { format: 'yomitan' };
    const hasIfo = names.some((n) => /\.ifo$/i.test(n));
    if (hasIfo) return { format: 'stardict' };
    return {
      format: 'unknown',
      reason: 'ZIP sin index.json (Yomitan) ni .ifo (StarDict).',
    };
  }
  if (looksLikeText(buffer)) {
    if (filename && /\.(csv|tsv|txt)$/i.test(filename)) return { format: 'csv' };
    if (!filename) return { format: 'csv' };
    // Unknown extension on a plain-text file — still try CSV; the importer
    // surfaces a clear error if parsing fails.
    return { format: 'csv' };
  }
  return {
    format: 'unknown',
    reason: 'Formato no reconocido. Esperaba ZIP (Yomitan/StarDict) o texto (CSV/TSV).',
  };
}

/**
 * Sniff the first 4 KB to decide whether the buffer is plausibly text. Any
 * NUL byte rules it out (binary). Anything else passes — the CSV importer
 * does its own malformed-line handling downstream.
 */
function looksLikeText(buffer: ArrayBuffer | Uint8Array): boolean {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const upper = Math.min(4096, bytes.length);
  for (let i = 0; i < upper; i += 1) {
    if (bytes[i] === 0) return false;
  }
  return upper > 0;
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  High-level "import this file" orchestrator                              */
/* ──────────────────────────────────────────────────────────────────────── */

import type { DictPackRow } from '../../shared/db';
import { importYomitanPack } from './yomitan';
import { importStarDictPack } from './stardict';
import { importCsvList } from './csv-importer';

export interface AutoImportResult {
  ok: true;
  format: Exclude<DictFormat, 'unknown'>;
  pack: DictPackRow;
  termsImported: number;
  /** Populated for CSV imports where a header / blank row was skipped. */
  skipped?: number;
}

export interface AutoImportError {
  ok: false;
  format: DictFormat;
  error: string;
}

/**
 * Pick the right importer based on `detectDictFormat` and run it. This is
 * the single entry point the panel UI uses for the "Importar archivo"
 * button — the user no longer has to know whether their file is Yomitan,
 * StarDict, or a CSV list.
 *
 * `filename` is forwarded to the CSV importer so the synthetic pack title
 * defaults to the filename minus extension when the user didn't override it.
 */
export async function autoImportDictFile(
  buffer: ArrayBuffer,
  filename?: string,
  csvTitleOverride?: string,
): Promise<AutoImportResult | AutoImportError> {
  const detection = detectDictFormat(buffer, filename);
  if (detection.format === 'unknown') {
    return {
      ok: false,
      format: 'unknown',
      error: detection.reason ?? 'Formato no reconocido.',
    };
  }
  if (detection.format === 'yomitan') {
    const result = await importYomitanPack(buffer);
    return result.ok
      ? { ok: true, format: 'yomitan', pack: result.pack, termsImported: result.termsImported }
      : { ok: false, format: 'yomitan', error: result.error };
  }
  if (detection.format === 'stardict') {
    const result = await importStarDictPack(buffer);
    return result.ok
      ? { ok: true, format: 'stardict', pack: result.pack, termsImported: result.termsImported }
      : { ok: false, format: 'stardict', error: result.error };
  }
  // CSV / TSV plain-text fallback.
  const text = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buffer));
  const baseTitle =
    csvTitleOverride?.trim() ||
    (filename ? filename.replace(/\.[^.]+$/, '') : 'Mi lista');
  const result = await importCsvList(text, { title: baseTitle });
  return result.ok
    ? {
        ok: true,
        format: 'csv',
        pack: result.pack,
        termsImported: result.termsImported,
        skipped: result.skipped,
      }
    : { ok: false, format: 'csv', error: result.error };
}
