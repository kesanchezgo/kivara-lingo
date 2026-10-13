// Re-export shared types so the prototype keeps working and the extension uses
// a single source of truth. New code should import from '@/shared/types'.
export type {
  SubtitleStyles,
  FieldSource,
  AnkiMapping,
  Mode,
  EndDetect,
  CaptureSettings,
  CleanupSettings,
  DictionaryEntry,
  CueSnapshot,
  CaptureContext,
  CreateCardRequest,
  CreateCardResponse,
  AnkiPingResponse,
  AnkiListsResponse,
  AnkiFieldsResponse,
} from '../shared/types';
