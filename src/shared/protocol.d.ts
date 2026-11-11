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
} from './types';

declare module 'webext-bridge' {
  export interface ProtocolMap {
    CREATE_CARD: ProtocolWithReturn<CreateCardRequest, CreateCardResponse>;
    UPDATE_NOTE_FRAME: ProtocolWithReturn<
      { noteId: number; fieldName: string | null; frame: string },
      { ok: boolean; error?: string }
    >;
    ANKI_PING: ProtocolWithReturn<{ url?: string; apiKey?: string }, AnkiPingResponse>;
    ANKI_DECKS: ProtocolWithReturn<{ url?: string; apiKey?: string }, AnkiListsResponse>;
    ANKI_MODELS: ProtocolWithReturn<{ url?: string; apiKey?: string }, AnkiListsResponse>;
    ANKI_FIELDS: ProtocolWithReturn<{ url?: string; apiKey?: string; modelName: string }, AnkiFieldsResponse>;
    ANKI_CREATE_DECK: ProtocolWithReturn<{ url?: string; apiKey?: string; deckName: string }, { ok: boolean; error?: string }>;
    ANKI_SAVED_WORDS: ProtocolWithReturn<{ url?: string; apiKey?: string; deckName?: string; fieldName?: string }, { words: string[] }>;
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
