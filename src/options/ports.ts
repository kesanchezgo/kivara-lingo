/**
 * Ports for the Options page.
 *
 * The Options panel is the same view tree as the content panel, so it needs
 * the same ports. What exists today is wired to the real service-worker
 * messages; the actions whose messages ship in a later phase reject with the
 * phase name instead of pretending to work. F4/F6/F7 replace their bodies —
 * the interfaces are frozen in src/ui/ports, so nothing in the views moves.
 */
import { sendMessage } from 'webext-bridge/options';
import { useKivaraStore } from '../shared/store';
import type { Ports } from '../ui/ports/PortsProvider';
import type {
  AnkiAddContextResponse,
  AnkiBrowseResponse,
  AnkiDeleteNoteResponse,
  AnkiFieldsResponse,
  AnkiListsResponse,
  AnkiPingResponse,
  AnkiWordIntervalsResponse,
  CardDismissResponse,
  CardRetryAllResponse,
  CardRetryResponse,
  CreateCardResponse,
} from '../shared/types';
import type { DictPackInfo } from '../ui/ports/types';

const notYet = (phase: string) => async (): Promise<never> => {
  throw new Error(`${phase}: this action has no service-worker message yet`);
};

function ankiTarget() {
  const { ankiUrl, apiKey } = useKivaraStore.getState().ankiMapping;
  return { url: ankiUrl, apiKey };
}

export function createOptionsPorts(): Ports {
  return {
    anki: {
      ping: () => sendMessage('ANKI_PING', ankiTarget(), 'background') as Promise<AnkiPingResponse>,
      decks: async () => {
        const res = (await sendMessage('ANKI_DECKS', ankiTarget(), 'background')) as AnkiListsResponse;
        return res.decks ?? [];
      },
      models: async () => {
        const res = (await sendMessage('ANKI_MODELS', ankiTarget(), 'background')) as AnkiListsResponse;
        return res.models ?? [];
      },
      fields: async (modelName) => {
        const res = (await sendMessage(
          'ANKI_FIELDS',
          { ...ankiTarget(), modelName },
          'background',
        )) as AnkiFieldsResponse;
        return res.fields ?? [];
      },
      createCard: async (input) => {
        const res = (await sendMessage(
          'CREATE_CARD',
          {
            token: input.word,
            sentence: input.sentence,
            kind: input.kind,
            lang: input.lang,
            deck: input.deck,
            media: input.media,
            cloze: input.cloze,
            contextLines: input.contextLines,
          },
          'background',
        )) as CreateCardResponse;
        if (!res.ok) throw new Error(res.error ?? 'CREATE_CARD failed');
        return res.noteId ?? 0;
      },
      undo: async (noteId) => {
        const res = (await sendMessage('ANKI_DELETE_NOTE', { noteId }, 'background')) as AnkiDeleteNoteResponse;
        if (!res.ok) throw new Error(res.error ?? 'ANKI_DELETE_NOTE failed');
      },
      addContext: async (input) => {
        const res = (await sendMessage('ANKI_ADD_CONTEXT', input, 'background')) as AnkiAddContextResponse;
        if (!res.ok) throw new Error(res.error ?? 'ANKI_ADD_CONTEXT failed');
      },
      browse: async (query) => {
        const res = (await sendMessage('ANKI_BROWSE', query, 'background')) as AnkiBrowseResponse;
        if (!res.ok) throw new Error(res.error ?? 'ANKI_BROWSE failed');
      },
      wordIntervals: async (lang, deck, fieldName) => {
        const res = (await sendMessage(
          'ANKI_WORD_INTERVALS',
          { lang, deck, fieldName },
          'background',
        )) as AnkiWordIntervalsResponse;
        // `ok: false` is a failed query, not an empty deck — same contract as
        // the rest of the port: throw instead of answering an empty map.
        if (!res.ok) throw new Error(res.error ?? 'ANKI_WORD_INTERVALS failed');
        return res.words;
      },
      retry: async (id) => {
        const res = (await sendMessage('CARD_RETRY', { id }, 'background')) as CardRetryResponse;
        if (!res.ok) throw new Error(res.error ?? 'CARD_RETRY failed');
      },
      retryAll: async () => {
        const res = (await sendMessage('CARD_RETRY_ALL', {}, 'background')) as CardRetryAllResponse;
        if (!res.ok) throw new Error('CARD_RETRY_ALL failed');
      },
      dismiss: async (id) => {
        const res = (await sendMessage('CARD_DISMISS', { id }, 'background')) as CardDismissResponse;
        if (!res.ok) throw new Error('CARD_DISMISS failed');
      },
    },
    packs: {
      list: async () => {
        // Packs are an extension-page one-off, not part of the bridge protocol
        // yet (the DictPacks tab uses the same runtime message).
        const res = await new Promise<{ packs?: DictPackInfo[] }>((resolve) => {
          chrome.runtime.sendMessage({ type: 'LIST_DICT_PACKS' }, (value: { packs?: DictPackInfo[] }) => resolve(value ?? {}));
        });
        return res.packs ?? [];
      },
      installFromUrl: notYet('F5'),
      remove: notYet('F5'),
    },
    lexicon: {
      tokenize: notYet('F3'),
      lookup: notYet('F3'),
      rankOf: notYet('F5'),
      levelOf: notYet('F5'),
      lemmaOf: notYet('F3'),
    },
    // There is no media on the Options page: nothing is playing, so the
    // episode port is honestly empty rather than a fake cue list.
    episode: {
      cues: () => [],
      activeIndex: () => -1,
      subscribe: () => () => {},
      media: () => null,
      controller: null,
    },
    ai: {
      explainSentence: notYet('F7'),
    },
  };
}