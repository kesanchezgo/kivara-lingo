/**
 * Pure Yomitan-pack parser.
 *
 * Split out of `yomitan.ts` so the in-page panel can parse a local `.zip`
 * without pulling the IndexedDB module into the content-script bundle: in a
 * content script, `IndexedDB` is the SITE's database, so the panel must never
 * open it. `yomitan.ts` keeps the persistence + lookup side and runs only in
 * the service worker and extension pages.
 *
 * Pack layout:
 *
 *   index.json                        — metadata (title, revision, format, ...)
 *   term_bank_1.json                  — array of 8-tuples, see below
 *   term_bank_2.json                  — ...
 *   term_meta_bank_1.json             — optional frequency / pitch data
 *   kanji_bank_1.json                 — optional (JP only)
 *
 * Each term_bank entry is the 8-tuple:
 *   [ expression, reading, definitionTags, deinflectionRules,
 *     popularity, definitions, sequence, termTags ]
 */
import { unzipSync, strFromU8 } from 'fflate';
import type { DictPackRow, DictTermRow, ParsedDictPack } from '../../shared/dict-types';
// Worker-subset dictionary: the UI barrel would drag the full 1308-key dict
// and React (via useSyncExternalStore) into the service worker bundle.
import { t } from '../../shared/i18n/sw';

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

export type YomitanParseResult =
  | { ok: true; parsed: ParsedDictPack }
  | { ok: false; error: string };

/** Cheap deterministic id derived from title + revision. */
export function packIdFor(title: string, revision: string): string {
  const input = `${title}|${revision}`;
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return `pack-${(hash >>> 0).toString(16)}`;
}

/**
 * Parse a `.zip` Yomitan pack into its pack row and term rows. No I/O: the
 * caller decides where the batch lands.
 *
 * A pack with no term banks but with `term_meta_*` banks (IPA / pronunciation
 * packs) is valid — its rows carry a reading and empty definitions so
 * lookups can overlay the pronunciation on other packs' hits.
 */
export function parseYomitanPack(zipBytes: ArrayBuffer | Uint8Array): YomitanParseResult {
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
  const id = packIdFor(title, revision);

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
    return { ok: false, error: t('yomitan.noTermBanks') };
  }

  const termRows: DictTermRow[] = [];

  // Standard term_bank entries (definitions, translations, etc.)
  for (const [name, bytes] of termBankFiles) {
    try {
      const arr = JSON.parse(strFromU8(bytes)) as YomitanTermTuple[];
      for (const tuple of arr) {
        if (!Array.isArray(tuple) || tuple.length < 6) continue;
        const expression = String(tuple[0] ?? '')
          .trim()
          .toLowerCase();
        if (!expression) continue;
        const reading = String(tuple[1] ?? '').trim();
        const definitionTags = (tuple[2] as string | null) ?? undefined;
        const popularity = Number(tuple[4] ?? 0) || 0;
        const definitions = Array.isArray(tuple[5]) ? tuple[5] : [];
        const termTags = (tuple[7] as string | null) ?? undefined;
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

  return { ok: true, parsed: { pack, terms: termRows } };
}

/**
 * Validate and clean an IPA string. Some packs contain Wiktionary template
 * artifacts like `/Template:IPAchar"},"params":{"1":{"wt":"/wʊd/`. We try
 * to extract the real IPA from inside the garbage first, and only reject
 * if nothing usable can be salvaged.
 *
 * Valid IPA strings start with `/`, `[`, or `\` and contain only IPA
 * characters (Unicode phonetic extensions, combining marks, basic Latin).
 */
export function cleanIpa(raw: string): string | null {
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

export function extractFirstIpa(meta: unknown): string | null {
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
