/**
 * Dictionary-pack import from the in-page panel, routed through the service
 * worker.
 *
 * The panel is rendered inside the content script, so any `IndexedDB` call it
 * makes lands in the STREAMING SITE's database: the imported pack would be
 * readable by the site and invisible to the extension (issue #32). Parsing
 * itself is safe — the parsers are plain JS (fflate / TextDecoder / DataView,
 * no DOM) — so this module parses locally and ships plain rows to the worker,
 * which owns every write.
 *
 * Used by `DictPacksSection`, which runs both in the content script (side
 * panel) and in the Options page. One code path for both: the worker is a
 * valid target from either context.
 *
 * There is no import of `shared/db` here and there must never be one — this
 * file is bundled into the content script.
 */
import { detectDictFormat, type DictFormat } from './dict-format-detect';
import { buildCsvPack, type CsvImportOptions } from './csv-importer';
import { parseStarDictPack } from './stardict';
import { parseYomitanPack } from './yomitan-parse';
import type { DictPackRow, ParsedDictPack } from '../../shared/dict-types';
import {
  DICT_IMPORT_CHUNK_SIZE,
  DICT_PACK_IMPORT_ABORT,
  DICT_PACK_IMPORT_BEGIN,
  DICT_PACK_IMPORT_COMMIT,
  DICT_PACK_IMPORT_TERMS,
  type DictPackImportMessage,
  type DictPackImportReply,
} from '../../shared/dict-import-protocol';
import { sendRuntimeMessage } from '../../shared/runtime-message';
import { t } from '../../shared/i18n';

export interface DictImportSuccess {
  ok: true;
  format: Exclude<DictFormat, 'unknown'>;
  pack: DictPackRow;
  termsImported: number;
  /** Rows with a headword but no translation (CSV imports only). */
  skipped?: number;
}

export interface DictImportFailure {
  ok: false;
  format: DictFormat;
  error: string;
}

export type DictImportOutcome = DictImportSuccess | DictImportFailure;

/** What the parser produced before the worker touched it. */
interface ParsedLocalFile {
  format: Exclude<DictFormat, 'unknown'>;
  parsed: ParsedDictPack;
  skipped?: number;
}

/**
 * Send one message to the service worker and phrase the two ways it can fail
 * to answer: no runtime / dead channel, or a reply that never carried a
 * payload. Chrome's own `lastError` text is a debug string in English, so the
 * user gets the localized message instead.
 */
async function sendToWorker(message: DictPackImportMessage): Promise<DictPackImportReply> {
  const outcome = await sendRuntimeMessage<DictPackImportReply>(message);
  if (outcome.ok) return outcome.reply;
  return { ok: false, error: t('dict.swNoResponse') };
}

/**
 * BEGIN → TERMS (chunked) → COMMIT. Any failure after BEGIN asks the worker to
 * drop the partial rows, so a bad file never leaves half a pack behind.
 */
async function persistViaWorker(parsed: ParsedDictPack): Promise<DictPackImportReply> {
  const begin = await sendToWorker({ type: DICT_PACK_IMPORT_BEGIN, pack: parsed.pack });
  if (!begin.ok) return begin;

  for (let i = 0; i < parsed.terms.length; i += DICT_IMPORT_CHUNK_SIZE) {
    const batch = parsed.terms.slice(i, i + DICT_IMPORT_CHUNK_SIZE);
    const reply = await sendToWorker({
      type: DICT_PACK_IMPORT_TERMS,
      packId: parsed.pack.id,
      terms: batch,
    });
    if (!reply.ok) {
      await sendToWorker({ type: DICT_PACK_IMPORT_ABORT, packId: parsed.pack.id });
      return reply;
    }
  }

  const commit = await sendToWorker({ type: DICT_PACK_IMPORT_COMMIT, pack: parsed.pack });
  if (!commit.ok) {
    await sendToWorker({ type: DICT_PACK_IMPORT_ABORT, packId: parsed.pack.id });
    return commit;
  }
  return commit;
}

function toOutcome(
  format: DictFormat,
  reply: DictPackImportReply,
  parsed?: ParsedLocalFile,
): DictImportOutcome {
  if (!reply.ok || !parsed) {
    return {
      ok: false,
      format: parsed?.format ?? format,
      error: reply.error ?? 'Import failed',
    };
  }
  return {
    ok: true,
    format: parsed.format,
    pack: parsed.parsed.pack,
    termsImported: reply.termsImported ?? parsed.parsed.terms.length,
    skipped: parsed.skipped,
  };
}

/**
 * Detect, parse and install a file the user picked.
 *
 * `csvTitleOverride` wins over the filename-derived title when the file turns
 * out to be a plain-text list; ZIP formats ignore it.
 */
export async function importDictFileViaWorker(
  buffer: ArrayBuffer,
  filename?: string,
  csvTitleOverride?: string,
): Promise<DictImportOutcome> {
  const detection = detectDictFormat(buffer, filename);
  if (detection.format === 'unknown') {
    return {
      ok: false,
      format: 'unknown',
      error: detection.reason ?? 'Formato no reconocido.',
    };
  }

  let parsed: ParsedLocalFile;
  if (detection.format === 'yomitan') {
    const result = parseYomitanPack(buffer);
    if (!result.ok) return { ok: false, format: 'yomitan', error: result.error };
    parsed = { format: 'yomitan', parsed: result.parsed };
  } else if (detection.format === 'stardict') {
    const result = parseStarDictPack(buffer);
    if (!result.ok) return { ok: false, format: 'stardict', error: result.error };
    parsed = { format: 'stardict', parsed: result.parsed };
  } else {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buffer));
    const baseTitle =
      csvTitleOverride?.trim() ||
      (filename ? filename.replace(/\.[^.]+$/, '') : 'Mi lista');
    const result = buildCsvPack(text, { title: baseTitle });
    if (!result.ok) return { ok: false, format: 'csv', error: result.error };
    parsed = { format: 'csv', parsed: result.draft, skipped: result.draft.skipped };
  }

  const reply = await persistViaWorker(parsed.parsed);
  return toOutcome(detection.format, reply, parsed);
}

/**
 * Install a pasted CSV/TSV list. Same worker hand-off, no format detection:
 * the user already chose the list surface.
 */
export async function importCsvTextViaWorker(
  text: string,
  options: CsvImportOptions,
): Promise<DictImportOutcome> {
  const result = buildCsvPack(text, options);
  if (!result.ok) return { ok: false, format: 'csv', error: result.error };
  const parsed: ParsedLocalFile = {
    format: 'csv',
    parsed: result.draft,
    skipped: result.draft.skipped,
  };
  const reply = await persistViaWorker(parsed.parsed);
  return toOutcome('csv', reply, parsed);
}
