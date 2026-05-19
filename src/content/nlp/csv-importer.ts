/**
 * CSV / TSV personal-list importer for Kivara Lingo.
 *
 * Lets the user paste or upload a list of `word, translation, …` rows and
 * have them surface in the popover just like a Yomitan pack. Each import
 * creates a synthetic `DictPackRow` (so the user can toggle / delete it
 * later) and a batch of `DictTermRow` rows keyed by the lowercased word.
 *
 * Supported column layouts (header is optional — auto-detected by sniffing
 * the first row for known field names):
 *
 *   word, translation
 *   word, translation, phonetic
 *   word, translation, phonetic, definition
 *   word, translation, phonetic, definition, example
 *
 * Either a comma OR a tab delimits columns. We pick whichever appears more
 * often on the first non-empty line. Quoted fields ("hello, world") are
 * honoured so users can paste exports from Anki / Quizlet without
 * cleanup. Blank lines and `#` comment lines are skipped silently.
 */
import { getDB } from '../../shared/db';
import type { DictPackRow, DictTermRow } from '../../shared/db';
import { recordPackInstall } from '../../shared/telemetry';

/** Field order for a parsed CSV/TSV row. */
type Field = 'word' | 'translation' | 'phonetic' | 'definition' | 'example';

const DEFAULT_FIELDS: Field[] = ['word', 'translation', 'phonetic', 'definition', 'example'];

const HEADER_ALIASES: Record<string, Field> = {
  // English variations
  word: 'word',
  term: 'word',
  expression: 'word',
  headword: 'word',
  source: 'word',
  english: 'word',
  en: 'word',
  // Spanish variations (the side panel is in Spanish; lots of users will
  // export from Quizlet/Anki decks named in their L1).
  palabra: 'word',
  termino: 'word',
  'término': 'word',
  ingles: 'word',
  'inglés': 'word',
  // Translation
  translation: 'translation',
  meaning: 'translation',
  definition: 'definition',
  def: 'definition',
  defincion: 'definition',
  'definición': 'definition',
  traduccion: 'translation',
  'traducción': 'translation',
  spanish: 'translation',
  es: 'translation',
  target: 'translation',
  // Phonetic
  phonetic: 'phonetic',
  ipa: 'phonetic',
  pronunciation: 'phonetic',
  fonetica: 'phonetic',
  'fonética': 'phonetic',
  // Example
  example: 'example',
  ejemplo: 'example',
  oracion: 'example',
  'oración': 'example',
  sentence: 'example',
};

export interface CsvImportOptions {
  /** Free-form title for the synthetic pack ("Mi lista", "Vocab S03E04"…). */
  title: string;
  /** Source language (ISO 639-1). Defaults to 'en'. */
  sourceLang?: string;
  /** Target language (ISO 639-1). Defaults to 'es'. */
  targetLang?: string;
}

export interface CsvImportResult {
  ok: true;
  pack: DictPackRow;
  termsImported: number;
  skipped: number;
}

export interface CsvImportError {
  ok: false;
  error: string;
}

/**
 * Parse a raw CSV/TSV blob into structured rows.
 *
 * Exported for unit testing; the importer path below is the public surface
 * that also writes to IndexedDB.
 */
export function parseCsv(text: string): { fields: Field[]; rows: Record<Field, string>[] } {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  if (lines.length === 0) {
    return { fields: ['word', 'translation'], rows: [] };
  }

  // Detect delimiter on the first line: whichever of TAB / COMMA occurs more.
  // Ties (or zero hits) fall back to COMMA so a single-word-per-line file
  // still parses (translation will be empty and the row gets skipped).
  const first = lines[0];
  const tabs = (first.match(/\t/g) ?? []).length;
  const commas = (first.match(/,/g) ?? []).length;
  const delimiter = tabs > commas ? '\t' : ',';

  // Header detection: if every non-empty cell of line 0 maps to a known
  // alias, treat the row as a header. Otherwise assume positional default.
  const firstRow = splitDelim(first, delimiter);
  const looksLikeHeader = firstRow.every((c) => {
    const key = c.trim().toLowerCase();
    return key in HEADER_ALIASES;
  });
  let fields: Field[];
  let dataStart = 0;
  if (looksLikeHeader) {
    fields = firstRow.map((c) => HEADER_ALIASES[c.trim().toLowerCase()]);
    dataStart = 1;
  } else {
    // Positional: pick the first N defaults to match the column count.
    fields = DEFAULT_FIELDS.slice(0, Math.max(2, firstRow.length));
  }

  const rows: Record<Field, string>[] = [];
  for (let i = dataStart; i < lines.length; i += 1) {
    const cells = splitDelim(lines[i], delimiter);
    const row: Record<Field, string> = {
      word: '',
      translation: '',
      phonetic: '',
      definition: '',
      example: '',
    };
    for (let c = 0; c < cells.length && c < fields.length; c += 1) {
      row[fields[c]] = cells[c].trim();
    }
    if (row.word) rows.push(row);
  }

  return { fields, rows };
}

/**
 * Quote-aware delimiter split. Handles `"foo, bar","baz"` correctly. Doubled
 * quotes inside a quoted cell collapse to a single quote (RFC 4180-ish).
 */
function splitDelim(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuote = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"' && cur.length === 0) {
        inQuote = true;
      } else if (ch === delimiter) {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

/** Stable id derived from title; re-importing the same title overwrites. */
function csvPackId(title: string): string {
  const input = `csv|${title.trim().toLowerCase()}`;
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return `pack-csv-${(hash >>> 0).toString(16)}`;
}

/**
 * Parse a CSV/TSV blob and write it to IndexedDB as a synthetic pack.
 *
 * Re-importing with the same `title` overwrites the previous rows so users
 * can keep updating a personal list without polluting the panel with copies.
 */
export async function importCsvList(
  text: string,
  options: CsvImportOptions,
): Promise<CsvImportResult | CsvImportError> {
  const title = options.title.trim();
  if (!title) return { ok: false, error: 'Missing list title' };

  let parsed: ReturnType<typeof parseCsv>;
  try {
    parsed = parseCsv(text);
  } catch (err) {
    return { ok: false, error: `Could not parse CSV: ${(err as Error).message}` };
  }
  if (parsed.rows.length === 0) {
    return { ok: false, error: 'No data rows found' };
  }
  const sourceLang = options.sourceLang || 'en';
  const targetLang = options.targetLang || 'es';
  const id = csvPackId(title);
  const revision = new Date().toISOString().slice(0, 10);

  const termRows: DictTermRow[] = [];
  let skipped = 0;
  for (const row of parsed.rows) {
    const expression = row.word.toLowerCase();
    if (!expression || !row.translation) {
      skipped += 1;
      continue;
    }
    const senses: string[] = [row.translation];
    if (row.definition) senses.push(row.definition);
    if (row.example) senses.push(`e.g. ${row.example}`);
    termRows.push({
      packId: id,
      expression,
      reading: row.phonetic || undefined,
      definitions: senses,
      // Personal lists get a constant high popularity so they win over noisy
      // crowd-sourced packs when the user has explicitly curated something.
      popularity: 1000,
      termTags: 'personal',
    });
  }
  if (termRows.length === 0) {
    return { ok: false, error: 'Every row was missing a word or translation' };
  }

  const pack: DictPackRow = {
    id,
    title,
    revision,
    format: 3,
    sourceLang,
    targetLang,
    termCount: termRows.length,
    enabled: true,
    author: 'Kivara · lista personal',
    description: `Lista CSV/TSV personal (${termRows.length} entradas)`,
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

  return { ok: true, pack, termsImported: termRows.length, skipped };
}
