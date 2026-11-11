/**
 * Row shapes for the dictionary-pack tables (`dict_packs` / `dict_terms` /
 * `pack_stats`), split out of `db.ts` so UI modules can type their data
 * without importing the Dexie schema.
 *
 * A type-only import from `db.ts` is erased at compile time, but the H5 lint
 * guard works on module paths, not runtime edges: the panel lives in the
 * content script, where the extension's IndexedDB is invisible, so its data
 * shapes must not come through the module that opens the database. `db.ts`
 * re-exports these, which keeps the existing imports working.
 *
 * The write path itself is the service worker's: the content script parses a
 * file into these rows and hands them over with `DICT_PACK_IMPORT_*` (see
 * `shared/dict-import-protocol.ts`).
 */

/** Metadata for a user-installed dictionary pack (Yomitan-compatible). */
export interface DictPackRow {
  /** Stable string id — sha1(title + revision) so re-imports overwrite. */
  id: string;
  /** Yomitan dictionary `title` field. */
  title: string;
  /** Yomitan dictionary `revision` field (free-form, often a date). */
  revision: string;
  /** Yomitan dictionary `format` / `version` field (1, 2, 3). */
  format: number;
  /** Source language ISO 639-1 / BCP-47. */
  sourceLang: string;
  /** Target language ISO 639-1 / BCP-47. */
  targetLang: string;
  /** Number of `dict_term` rows we wrote for this pack. */
  termCount: number;
  /** Whether the pack participates in lookups. */
  enabled: boolean;
  /** Free-form author/attribution from the pack's index.json. */
  author?: string;
  /** Free-form description from the pack's index.json. */
  description?: string;
  createdAt: number;
}

/**
 * A single dictionary term as imported from a Yomitan pack.
 *
 * The Yomitan term_bank format is a 8-tuple per entry:
 *   [ expression, reading, definitionTags, deinflectionRules,
 *     popularity, definitions, sequence, termTags ]
 *
 * We store the five fields we actually surface plus the pack key, so lookups
 * stay a single index read on `[packId+expression]`.
 */
export interface DictTermRow {
  id?: number;
  /** Pack this row belongs to. */
  packId: string;
  /** Lowercased headword for lookups. */
  expression: string;
  /** Reading / pronunciation (kana for JP packs, often IPA for EN/ES packs). */
  reading?: string;
  /** Yomitan definitions list — can be plain strings or structured objects. */
  definitions: unknown[];
  /** Yomitan popularity score; higher = preferred when multiple packs match. */
  popularity: number;
  /** Optional sense tags from the pack (e.g. 'noun', 'colloquial'). */
  definitionTags?: string;
  /** Optional term tags (e.g. 'A1', 'common'). */
  termTags?: string;
}

/**
 * Local-only telemetry row for a dictionary pack (or one of the synthetic
 * pseudo-packs `bundle` / `miss`). Keyed by the same `packId` Dexie uses for
 * `dict_packs`, so a JOIN-ish lookup is just a `get(id)`.
 *
 * Three synthetic ids exist alongside real pack ids:
 *  - `bundle`  → hits served by the in-extension `en.json` dictionary
 *  - `remote`  → hits served by the network translator chain
 *  - `miss`    → tokens that nothing could resolve (full miss)
 *
 * `hits` is best-effort — race-y increments only matter to the user when
 * comparing packs against each other, and Dexie's `put()` is fine here.
 */
export interface PackStatsRow {
  packId: string;
  hits: number;
  lastUsedAt: number;
  createdAt: number;
}

/**
 * A parsed-but-not-yet-persisted import: what every importer produces in the
 * content script before the service worker writes it.
 */
export interface ParsedDictPack {
  pack: DictPackRow;
  terms: DictTermRow[];
}
