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
  AnkiFieldsResponse,
  AnkiListsResponse,
  AnkiPingResponse,
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
            language: input.lang,
            platform: input.media?.platform,
          },
          'background',
        )) as CreateCardResponse;
        if (!res.ok) throw new Error(res.error ?? 'CREATE_CARD failed');
        return res.noteId ?? 0;
      },
      undo: notYet('F4'),
      addContext: notYet('F4'),
      browse: notYet('F4'),
      wordIntervals: notYet('F4'),
      retry: notYet('F4'),
      retryAll: notYet('F4'),
      dismiss: notYet('F4'),
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