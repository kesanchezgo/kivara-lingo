import 'webext-bridge';
import type { ProtocolWithReturn } from 'webext-bridge';
import type {
  CreateCardRequest,
  CreateCardResponse,
  AnkiPingResponse,
  AnkiListsResponse,
  AnkiFieldsResponse,
  AudioClipResponse,
  AudioCaptureStatus,
  TranslateRequest,
  TranslateResponse,
  TtsSpeakRequest,
  TtsResponse,
  AiEnrichRequest,
  AiEnrichResponse,
  AiExplainRequest,
  AiExplainResponse,
  ResolveWordRequest,
  ResolveWordResponse,
  EnrichSourceHealthMap,
  AnkiDeleteNoteRequest,
  AnkiDeleteNoteResponse,
  AnkiAddContextRequest,
  AnkiAddContextResponse,
  AnkiBrowseRequest,
  AnkiBrowseResponse,
  AnkiWordIntervalsRequest,
  AnkiWordIntervalsResponse,
  CardRetryRequest,
  CardRetryResponse,
  CardRetryAllResponse,
  CardDismissRequest,
  CardDismissResponse,
  AnkiListsReply,
  AnkiFieldsReply,
  AnkiErrorReply,
} from './types';
import type {
  DictPackImportBeginMessage,
  DictPackImportTermsMessage,
  DictPackImportCommitMessage,
  DictPackImportAbortMessage,
  DictPackImportReply,
  ImportPackStatsMessage,
  ExportPackStatsMessage,
  PackStatsReply,
} from './dict-import-protocol';

/**
 * The dictionary-pack channel travels over raw `chrome.runtime.sendMessage`
 * (the panel is a content script, not a webext-bridge client), but its
 * request/response pairs live here with every other cross-context contract so
 * there is one place to read them. `Omit<…, 'type'>` drops the discriminant —
 * the envelope carries the name.
 */
type DictPackImportRequest<T> = Omit<T, 'type'>;

declare module 'webext-bridge' {
  export interface ProtocolMap {
    DICT_PACK_IMPORT_BEGIN: ProtocolWithReturn<DictPackImportRequest<DictPackImportBeginMessage>, DictPackImportReply>;
    DICT_PACK_IMPORT_TERMS: ProtocolWithReturn<DictPackImportRequest<DictPackImportTermsMessage>, DictPackImportReply>;
    DICT_PACK_IMPORT_COMMIT: ProtocolWithReturn<DictPackImportRequest<DictPackImportCommitMessage>, DictPackImportReply>;
    DICT_PACK_IMPORT_ABORT: ProtocolWithReturn<DictPackImportRequest<DictPackImportAbortMessage>, DictPackImportReply>;
    GET_PACK_STATS: ProtocolWithReturn<Record<string, never>, PackStatsReply>;
    RESET_PACK_STATS: ProtocolWithReturn<Record<string, never>, PackStatsReply>;
    IMPORT_PACK_STATS: ProtocolWithReturn<DictPackImportRequest<ImportPackStatsMessage>, PackStatsReply>;
    EXPORT_PACK_STATS: ProtocolWithReturn<DictPackImportRequest<ExportPackStatsMessage>, PackStatsReply>;
    CREATE_CARD: ProtocolWithReturn<CreateCardRequest, CreateCardResponse>;
    UPDATE_NOTE_FRAME: ProtocolWithReturn<
      { noteId: number; fieldName: string | null; frame: string },
      { ok: boolean; error?: string }
    >;
    ANKI_PING: ProtocolWithReturn<{ url?: string; apiKey?: string }, AnkiPingResponse>;
    ANKI_DECKS: ProtocolWithReturn<{ url?: string; apiKey?: string }, AnkiListsReply>;
    ANKI_MODELS: ProtocolWithReturn<{ url?: string; apiKey?: string }, AnkiListsReply>;
    ANKI_FIELDS: ProtocolWithReturn<{ url?: string; apiKey?: string; modelName: string }, AnkiFieldsReply>;
    ANKI_CREATE_DECK: ProtocolWithReturn<{ url?: string; apiKey?: string; deckName: string }, { ok: boolean; error?: string }>;
    ANKI_SAVED_WORDS: ProtocolWithReturn<{ url?: string; apiKey?: string; deckName?: string; fieldName?: string }, { words: string[] } | AnkiErrorReply>;
    ANKI_DELETE_NOTE: ProtocolWithReturn<AnkiDeleteNoteRequest, AnkiDeleteNoteResponse>;
    ANKI_ADD_CONTEXT: ProtocolWithReturn<AnkiAddContextRequest, AnkiAddContextResponse>;
    ANKI_BROWSE: ProtocolWithReturn<AnkiBrowseRequest, AnkiBrowseResponse>;
    ANKI_WORD_INTERVALS: ProtocolWithReturn<AnkiWordIntervalsRequest, AnkiWordIntervalsResponse>;
    CARD_RETRY: ProtocolWithReturn<CardRetryRequest, CardRetryResponse>;
    CARD_RETRY_ALL: ProtocolWithReturn<Record<string, never>, CardRetryAllResponse>;
    CARD_DISMISS: ProtocolWithReturn<CardDismissRequest, CardDismissResponse>;
    START_AUDIO_CAPTURE: ProtocolWithReturn<{ tabId?: number }, { ok: boolean; error?: string }>;
    STOP_AUDIO_CAPTURE: ProtocolWithReturn<Record<string, never>, { ok: boolean }>;
    AUDIO_CAPTURE_STATUS: ProtocolWithReturn<Record<string, never>, AudioCaptureStatus>;
    EXTRACT_AUDIO_CLIP: ProtocolWithReturn<{ startMs: number; endMs: number }, AudioClipResponse>;
    TRANSLATE: ProtocolWithReturn<TranslateRequest, TranslateResponse>;
    TTS_SPEAK: ProtocolWithReturn<TtsSpeakRequest, TtsResponse>;
    AI_ENRICH: ProtocolWithReturn<AiEnrichRequest, AiEnrichResponse>;
    AI_EXPLAIN_SENTENCE: ProtocolWithReturn<AiExplainRequest, AiExplainResponse>;
    ENRICH_SOURCE_HEALTH: ProtocolWithReturn<Record<string, never>, EnrichSourceHealthMap>;
    OPEN_SETTINGS: ProtocolWithReturn<{ section?: string }, { ok: boolean }>;
    RESOLVE_WORD: ProtocolWithReturn<ResolveWordRequest, ResolveWordResponse>;
  }
}
