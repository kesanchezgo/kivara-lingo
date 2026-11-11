/**
 * Barrel re-exporting every port type and factory (docs/REDESIGN-V2.md §4.2).
 *
 * Import from here (`../../ui/ports`) rather than the individual modules so the
 * set of ports stays one import site for the view layer.
 */
export type {
  MediaInfo,
  PlaybackController,
  SentenceExplanation,
  ExplainSentenceInput,
  RecentCard,
  CardStatus,
  CardKind,
  SourceHealth,
  PlatformId,
  SubtitleCue,
  LexiconToken,
  CefrLevel,
  CreateCardInput,
  AddContextInput,
  BrowseQuery,
  DictPackInfo,
  InstallPackResult,
} from './types';

export { createLexiconPort } from './lexicon';
export type { LexiconPort } from './lexicon';
export { createEpisodePort } from './episode';
export type { EpisodePort } from './episode';
export { createAnkiPort } from './anki';
export type { AnkiPort } from './anki';
export { createAiPort } from './ai';
export type { AiPort } from './ai';
export { createPacksPort } from './packs';
export type { PacksPort } from './packs';
