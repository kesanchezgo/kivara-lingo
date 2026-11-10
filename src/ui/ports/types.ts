/**
 * Shared port types for the v2 UI layer (docs/REDESIGN-V2.md §4.2–4.5).
 *
 * These are the contracts the ported prototype views speak to. Each type is
 * built on an existing repo shape where one exists, so the real engine can slot
 * in behind a port without reshaping the view data.
 *
 * Type-only imports by design: `src/ui/**` must not pull runtime code from
 * `chrome.*` or `../shared/db`. `import type` is erased at compile time, so the
 * contracts below add zero runtime edges to those modules.
 */
import type { SubtitleCue, SubtitleSource } from '../../content/platform-adapters/types';
import type { Token } from '../../content/nlp/tokenize';
import type { DictionaryEntry } from '../../shared/types';
import type { ImportResult, ImportError } from '../../content/nlp/yomitan';

/** The cue shape shared by every adapter and by the transcript rail. */
export type { SubtitleCue } from '../../content/platform-adapters/types';

/** Re-exported so port modules share one dictionary-entry shape. */
export type { DictionaryEntry } from '../../shared/types';

/** Platform id union taken from the real adapter contract. */
export type PlatformId = SubtitleSource['platform'];

/**
 * Best-effort episode metadata for a playing piece of media. The card tags,
 * the transcript header and the Anki `source` field all read from here.
 * Mirrors docs/REDESIGN-V2.md §4.5.
 */
export interface MediaInfo {
  platform: PlatformId;
  title: string;
  series?: string;
  season?: number;
  episode?: number;
  url: string;
}

/**
 * The single vetted path for seeking and rate changes. Netflix must never be
 * driven by writing `video.currentTime` directly (error M7375); the real
 * implementation routes the jump through the MAIN-world player API.
 * Mirrors docs/REDESIGN-V2.md §4.5.
 */
export interface PlaybackController {
  seek(timeMs: number): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  getRate(): number;
  setRate(rate: number): void;
  isPaused(): boolean;
  currentTimeMs(): number;
}

/**
 * Structured "explain this sentence" answer (meaning, grammar, expressions and
 * how the line actually sounds when run together).
 * Mirrors docs/REDESIGN-V2.md §4.6 / `AI_EXPLAIN_SENTENCE`.
 */
export interface SentenceExplanation {
  meaning: string;
  grammar: string;
  expressions: { text: string; gloss: string }[];
  sound: { phrase: string; sounds: string; note?: string }[];
}

/** Input for the sentence explanation request. */
export interface ExplainSentenceInput {
  prev?: string;
  line: string;
  next?: string;
  lang: string;
  uiLang: string;
  nativeLang: string;
}

/** Lifecycle of a card in the recent-cards queue. */
export type CardStatus = 'sending' | 'saved' | 'queued' | 'failed';

/** Note flavour the card was created as. */
export type CardKind = 'word' | 'expression' | 'cloze';

/**
 * A card entry in the recent list / retry queue. The SW is the single writer of
 * these records (docs/REDESIGN-V2.md §4.3); the view only reads them.
 */
export interface RecentCard {
  id: string;
  word: string;
  sentence: string;
  status: CardStatus;
  kind: CardKind;
  deck: string;
  createdAt: number;
  error?: string;
}

/** Health of a single enrichment source, surfaced in the VIP section. */
export interface SourceHealth {
  state: 'ok' | 'slow' | 'error';
  latencyMs?: number;
  lastError?: string;
  at: number;
}

/** Tokenizer output, aliased to the repo's real `Token` shape. */
export type LexiconToken = Token;

/** CEFR level union taken from the dictionary entry. */
export type CefrLevel = NonNullable<DictionaryEntry['level']>;

/** Draft handed to AnkiConnect when creating a note. */
export interface CreateCardInput {
  word: string;
  sentence: string;
  kind: CardKind;
  deck: string;
  lang: string;
  media?: MediaInfo;
  cloze?: string;
  contextLines?: { prev?: string; next?: string };
}

/** Payload for "add this scene" — attaches context to an existing note. */
export interface AddContextInput {
  noteId: number;
  sentence: string;
  frame?: string;
  audio?: string;
  tags: string[];
}

/** "View in Anki" — open the browser by note id or by a raw query. */
export interface BrowseQuery {
  noteId?: number;
  query?: string;
}

/**
 * Installed dictionary-pack row. Derived from the real `ImportResult.pack`
 * (`DictPackRow`) through a pure type projection so this module never imports
 * `../shared/db`.
 */
export type DictPackInfo = ImportResult['pack'];

/** Result of installing a pack from a URL. Mirrors `INSTALL_DICT_PACK_FROM_URL`. */
export type InstallPackResult = ImportResult | ImportError;
