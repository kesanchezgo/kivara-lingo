/**
 * IndexedDB schema for Kivara Lingo (via Dexie).
 *
 * Tables:
 *  - saved_notes: dedup ledger of cards that successfully made it into Anki
 *  - pending_notes: queue of requests that couldn't reach AnkiConnect; retried by alarm
 *  - translation_cache: provider responses keyed by (text, source, target, provider)
 *  - media_cache: optional dedup hashes for audio/frame blobs (kept small)
 *  - ai_cache: AI enrichment responses keyed by provider+source+native+sha1(token+sentence)
 */
import Dexie, { type Table } from 'dexie';
import type { AiEnrichment, AiProvider, CreateCardRequest } from './types';

export interface SavedNoteRow {
  id?: number;
  /** The token (word or MWE) the user saved */
  token: string;
  /** ISO BCP-47 language tag of the source */
  language: string;
  /** Full sentence (cue text) when the card was made — helps dedup near-misses */
  sentence: string;
  /** AnkiConnect-assigned note id */
  ankiNoteId: number;
  createdAt: number;
}

export interface PendingNoteRow {
  id?: number;
  request: CreateCardRequest;
  retries: number;
  lastError: string | null;
  createdAt: number;
  nextAttemptAt: number;
}

export interface TranslationRow {
  /** composite key: `${provider}|${source}|${target}|${text.toLowerCase()}` */
  key: string;
  provider: string;
  sourceLang: string;
  targetLang: string;
  sourceText: string;
  translatedText: string;
  expiresAt: number;
  createdAt: number;
}

export interface MediaCacheRow {
  /** SHA-256 hex of the underlying bytes */
  hash: string;
  /** 'audio' or 'frame' */
  kind: 'audio' | 'frame';
  /** Anki filename stored on the server */
  ankiFilename: string;
  createdAt: number;
}

export interface AiCacheRow {
  /** composite key — see {@link aiCacheKey} */
  key: string;
  provider: AiProvider;
  sourceLang: string;
  nativeLang: string;
  token: string;
  sentence: string;
  data: AiEnrichment;
  expiresAt: number;
  createdAt: number;
}

/**
 * Metadata for a user-installed dictionary pack (Yomitan-compatible).
 *
 * One `dict_pack` row points at many `dict_term` rows via `packId`. Toggling a
 * pack on/off flips `enabled` without deleting its terms, so users can A/B
 * test packs cheaply.
 */
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
 * We flatten what we need and keep the original definitions array for the
 * popover. Lookup is by lowercased `expression`.
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

class KivaraDB extends Dexie {
  saved_notes!: Table<SavedNoteRow, number>;
  pending_notes!: Table<PendingNoteRow, number>;
  translation_cache!: Table<TranslationRow, string>;
  media_cache!: Table<MediaCacheRow, string>;
  ai_cache!: Table<AiCacheRow, string>;
  dict_packs!: Table<DictPackRow, string>;
  dict_terms!: Table<DictTermRow, number>;
  pack_stats!: Table<PackStatsRow, string>;

  constructor() {
    super('kivara-lingo');
    this.version(1).stores({
      saved_notes: '++id, &[token+language+sentence], ankiNoteId, createdAt',
      pending_notes: '++id, nextAttemptAt, createdAt',
      translation_cache: '&key, [provider+sourceLang+targetLang], expiresAt',
      media_cache: '&hash, kind, createdAt',
    });
    this.version(2)
      .stores({
        saved_notes: '++id, &[token+language+sentence], ankiNoteId, createdAt',
        pending_notes: '++id, nextAttemptAt, createdAt',
        translation_cache: '&key, [provider+sourceLang+targetLang], expiresAt',
        media_cache: '&hash, kind, createdAt',
        ai_cache: '&key, [provider+sourceLang+nativeLang], expiresAt',
      });
    this.version(3)
      .stores({
        saved_notes: '++id, &[token+language+sentence], ankiNoteId, createdAt',
        pending_notes: '++id, nextAttemptAt, createdAt',
        translation_cache: '&key, [provider+sourceLang+targetLang], expiresAt',
        media_cache: '&hash, kind, createdAt',
        ai_cache: '&key, [provider+sourceLang+nativeLang], expiresAt',
        // dict_packs is keyed by string id; dict_terms is keyed by autoinc id
        // with a compound index on (packId, expression) so we can both list a
        // pack's terms and lookup-by-headword across all enabled packs.
        dict_packs: '&id, enabled, sourceLang, targetLang, createdAt',
        dict_terms: '++id, [packId+expression], expression, packId',
      });
    this.version(4)
      .stores({
        saved_notes: '++id, &[token+language+sentence], ankiNoteId, createdAt',
        pending_notes: '++id, nextAttemptAt, createdAt',
        translation_cache: '&key, [provider+sourceLang+targetLang], expiresAt',
        media_cache: '&hash, kind, createdAt',
        ai_cache: '&key, [provider+sourceLang+nativeLang], expiresAt',
        dict_packs: '&id, enabled, sourceLang, targetLang, createdAt',
        dict_terms: '++id, [packId+expression], expression, packId',
        // Local-only telemetry. Keyed by string id (pack id, or one of the
        // pseudo-ids 'bundle' / 'remote' / 'miss').
        pack_stats: '&packId, lastUsedAt, createdAt',
      });
  }
}

let _db: KivaraDB | null = null;

/** Lazy singleton — Dexie throws if instantiated outside of an `indexedDB` environment. */
export function getDB(): KivaraDB {
  if (!_db) _db = new KivaraDB();
  return _db;
}

export function translationCacheKey(
  provider: string,
  source: string,
  target: string,
  text: string,
): string {
  return `${provider}|${source}|${target}|${text.trim().toLowerCase()}`;
}

/**
 * Stable cache key for AI enrichment responses. Uses a lightweight hash over
 * the (token, sentence) tuple so the key length stays bounded even for long
 * cues. Not cryptographically strong — only a dedup helper.
 */
export function aiCacheKey(
  provider: string,
  source: string,
  native: string,
  token: string,
  sentence: string,
): string {
  const normalized = `${token.trim().toLowerCase()}|${sentence.trim().toLowerCase()}`;
  return `${provider}|${source}|${native}|${djb2(normalized)}`;
}

function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  // unsigned 32-bit hex
  return (hash >>> 0).toString(16);
}
