/**
 * The CREATE_CARD body, extracted from the SW so it runs against injected deps
 * in unit tests. Production registers it as the onMessage handler verbatim.
 */
import type {
  AnkiMapping,
  CaptureSettings,
  CreateCardRequest,
  CreateCardResponse,
} from '../shared/types';
import { buildCardTags, buildCreateCardRow, cardSourceFromMedia, newCardId } from '../shared/cards';
import { createCardFromRequest } from './capture-orchestrator';
import { cardRegistry } from './card-registry';

export interface CreateCardDeps {
  loadMapping: () => Promise<AnkiMapping>;
  loadCaptureSettings: () => Promise<CaptureSettings>;
  refreshAnkiOriginRules: (url: string) => Promise<void>;
  invalidateSavedWordsCache: () => void;
  createCardFromRequest: typeof createCardFromRequest;
  /** E2E request mirror — absent in production. */
  mirrorRequest?: (raw: CreateCardRequest) => Promise<void>;
}

export async function handleCreateCard(
  raw: CreateCardRequest,
  deps: CreateCardDeps,
): Promise<CreateCardResponse> {
  await deps.mirrorRequest?.(raw);
  const mapping = await deps.loadMapping();
  const capture = await deps.loadCaptureSettings();

  const lang = (raw.lang ?? raw.language ?? 'en').trim() || 'en';
  const deck = (raw.deck ?? '').trim() || mapping.decks?.[lang] || mapping.deckName;
  const kind = raw.kind ?? (/\s/.test(raw.token.trim()) ? 'expression' : 'word');
  const request: CreateCardRequest = {
    ...raw,
    cardId: raw.cardId ?? newCardId(),
    lang,
    language: lang,
    kind,
    deck,
  };

  // ONE row builder for production and tests — identity slice included.
  await cardRegistry.put(buildCreateCardRow(request, {
    cardId: request.cardId!,
    deck,
    lang,
    kind,
    tags: buildCardTags(kind, request.media, lang),
    source: cardSourceFromMedia(request.media),
    media: {
      frame: !!request.frame,
      audio: !!(request.audio || (request.cueStart != null && request.cueEnd != null)),
      word: true,
    },
  }));

  await deps.refreshAnkiOriginRules(mapping.ankiUrl);
  const response = await deps.createCardFromRequest(
    request,
    { ...mapping, deckName: deck },
    capture,
  );
  if (response.ok) deps.invalidateSavedWordsCache();
  return response;
}
