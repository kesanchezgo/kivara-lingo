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
import type { DictPackRow, DictTermRow, PackStatsRow } from './dict-types';
import type {
  AiEnrichment,
  AiProvider,
  CreateCardRequest,
  SentenceExplanation,
} from './types';

export interface SavedNoteRow {
  id?: number;
  /** The token (word or MWE) the user saved */
  token: string;
  /** ISO BCP-47 language tag of the source */
  language: string;
  /** Full sentence (cue text) when the card was made — helps dedup near-misses */
  sentence: string;
  /** Deck the note landed in — the idempotency check is per-deck: the
   * same card saved to a different deck is a different card. */
  deckName: string;
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
  /** Resolved sentence-audio captured on the FIRST attempt (data URL +
   * mime). The ring buffer no longer holds the cue on retry, so the row
   * carries the original clip forward instead of re-slicing live audio.
   * Absent when the first attempt never got that far (TTS fallback text
   * is deterministic and regenerates identically, so it needs no slot).
   * Cap: one cue clip, small enough for a Dexie row. */
  resolvedAudio?: { dataUrl: string; mime: string } | null;
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
 * One cached "Explain sentence" answer (F7, docs/REDESIGN-V2.md §4.3, §10).
 *
 * Keyed by `sha1(provider|model|lang|uiLang|nativeLang|prev|line|next)` and
 * expired against `ai.cacheTtlDays`. Only the service worker reads or writes
 * this table (H5): the content script asks over `AI_EXPLAIN_SENTENCE`.
 */
export interface ExplainCacheRow {
  /** {@link explainCacheKey} output. */
  key: string;
  provider: AiProvider;
  model: string;
  lang: string;
  uiLang: string;
  nativeLang: string;
  prev?: string;
  line: string;
  next?: string;
  data: SentenceExplanation;
  expiresAt: number;
  createdAt: number;
}

/**
 * Dictionary-pack row shapes live in `dict-types.ts` so modules that must not
 * touch the Dexie schema (the in-page panel) can still type their data. The
 * re-export keeps every existing `from './db'` import valid.
 */
export type { DictPackRow, DictTermRow, PackStatsRow } from './dict-types';

class KivaraDB extends Dexie {
  saved_notes!: Table<SavedNoteRow, number>;
  pending_notes!: Table<PendingNoteRow, number>;
  translation_cache!: Table<TranslationRow, string>;
  media_cache!: Table<MediaCacheRow, string>;
  ai_cache!: Table<AiCacheRow, string>;
  dict_packs!: Table<DictPackRow, string>;
  dict_terms!: Table<DictTermRow, number>;
  pack_stats!: Table<PackStatsRow, string>;
  /**
   * Cache for the multi-source enrichment chain. Keyed by
   * `<sourceLang>|<targetLang>|<lower-token>` so re-hovering the same
   * word in the same direction is instant. Rows expire on read via the
   * orchestrator's `cacheTtlDays` check (no scheduled cleanup needed —
   * stale rows are overwritten on the next look-up).
   */
  vip_cache!: Table<{ key: string; payload: unknown; storedAt: number }, string>;
  /** "Explain sentence" answers, written only by the service worker. */
  explain_cache!: Table<ExplainCacheRow, string>;

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
    this.version(5)
      .stores({
        saved_notes: '++id, &[token+language+sentence], ankiNoteId, createdAt',
        pending_notes: '++id, nextAttemptAt, createdAt',
        translation_cache: '&key, [provider+sourceLang+targetLang], expiresAt',
        media_cache: '&hash, kind, createdAt',
        ai_cache: '&key, [provider+sourceLang+nativeLang], expiresAt',
        dict_packs: '&id, enabled, sourceLang, targetLang, createdAt',
        dict_terms: '++id, [packId+expression], expression, packId',
        pack_stats: '&packId, lastUsedAt, createdAt',
        // Multi-source enrichment cache. Schema kept tiny — payload
        // type is opaque to Dexie (we serialise the orchestrator
        // result as-is and parse on read). Indexed by `storedAt` so a
        // future cleanup pass can prune oldest rows.
        vip_cache: '&key, storedAt',
      });
    // v6: idempotency is per-deck (same card in another deck is another
    // card) and pending rows carry the first-attempt audio forward.
    // Dexie `upgrade` backfills deckName for pre-v6 ledger rows so the
    // compound index never sees undefined.
    this.version(6)
      .stores({
        saved_notes: '++id, &[token+language+sentence+deckName], ankiNoteId, createdAt',
        pending_notes: '++id, nextAttemptAt, createdAt',
        translation_cache: '&key, [provider+sourceLang+targetLang], expiresAt',
        media_cache: '&hash, kind, createdAt',
        ai_cache: '&key, [provider+sourceLang+nativeLang], expiresAt',
        dict_packs: '&id, enabled, sourceLang, targetLang, createdAt',
        dict_terms: '++id, [packId+expression], expression, packId',
        pack_stats: '&packId, lastUsedAt, createdAt',
        vip_cache: '&key, storedAt',
      })
      .upgrade((tx) =>
        (tx.table('saved_notes') as Dexie.Table<SavedNoteRow, number>)
          .toCollection()
          .modify((row) => {
            if (typeof row.deckName !== 'string') row.deckName = '';
          }),
      );
    // v7: "Explain sentence" cache (F7). New table only — old rows are
    // untouched, and expiry is checked on read, so no cleanup pass is needed.
    this.version(7).stores({
      saved_notes: '++id, &[token+language+sentence+deckName], ankiNoteId, createdAt',
      pending_notes: '++id, nextAttemptAt, createdAt',
      translation_cache: '&key, [provider+sourceLang+targetLang], expiresAt',
      media_cache: '&hash, kind, createdAt',
      ai_cache: '&key, [provider+sourceLang+nativeLang], expiresAt',
      dict_packs: '&id, enabled, sourceLang, targetLang, createdAt',
      dict_terms: '++id, [packId+expression], expression, packId',
      pack_stats: '&packId, lastUsedAt, createdAt',
      vip_cache: '&key, storedAt',
      explain_cache: '&key, expiresAt',
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
