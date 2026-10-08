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
  TranscribeRequest,
  TranscribeResponse,
  TtsSpeakRequest,
  TtsResponse,
  AiEnrichRequest,
  AiEnrichResponse,
  ResolveWordRequest,
  ResolveWordResponse,
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
    START_AUDIO_CAPTURE: ProtocolWithReturn<{ tabId?: number }, { ok: boolean; error?: string }>;
    STOP_AUDIO_CAPTURE: ProtocolWithReturn<Record<string, never>, { ok: boolean }>;
    AUDIO_CAPTURE_STATUS: ProtocolWithReturn<Record<string, never>, AudioCaptureStatus>;
    EXTRACT_AUDIO_CLIP: ProtocolWithReturn<{ startMs: number; endMs: number }, AudioClipResponse>;
    TRANSCRIBE_AUDIO_CLIP: ProtocolWithReturn<TranscribeRequest, TranscribeResponse>;
    TRANSLATE: ProtocolWithReturn<TranslateRequest, TranslateResponse>;
    TTS_SPEAK: ProtocolWithReturn<TtsSpeakRequest, TtsResponse>;
    AI_ENRICH: ProtocolWithReturn<AiEnrichRequest, AiEnrichResponse>;
    RESOLVE_WORD: ProtocolWithReturn<ResolveWordRequest, ResolveWordResponse>;
  }
}
