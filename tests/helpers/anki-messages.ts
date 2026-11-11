/**
 * AnkiConnect messages fake for component tests.
 *
 * `createAnkiFake` (./ankiconnect) validates every request against the real
 * add-on fixture, but it speaks HTTP. The Cards tab speaks webext-bridge
 * `sendMessage`, and the service worker is what turns one into the other.
 * This helper stands in for that thin layer: it answers ANKI_PING /
 * ANKI_DECKS / ANKI_FIELDS by driving the REAL client (`ankiConnect`) over
 * the fake fetch, so a test that renders the tab still exercises the
 * production call shapes and the fixture contract.
 */
import { ankiConnect } from '../../src/background/anki-connect';
import { createAnkiFake, type AnkiFake, type AnkiFakeOptions } from './ankiconnect';

export interface AnkiMessagesFake extends AnkiFake {
  /** The webext-bridge surface: install it with `sendMessage.mockImplementation(send)`. */
  send: (type: string, data?: unknown) => Promise<unknown>;
}

interface AnkiMessageData {
  url?: string;
  apiKey?: string;
  modelName?: string;
}

export function createAnkiMessagesFake(options: AnkiFakeOptions = {}): AnkiMessagesFake {
  const fake = createAnkiFake(options);

  const send = async (type: string, data?: unknown): Promise<unknown> => {
    const request = (data ?? {}) as AnkiMessageData;
    switch (type) {
      case 'ANKI_PING': {
        const result = await ankiConnect.ping(request.url, request.apiKey);
        return result.ok
          ? { ok: true, version: result.version }
          : { ok: false, error: result.error, code: result.code };
      }
      case 'ANKI_DECKS': {
        try {
          const [decks, models] = await Promise.all([
            ankiConnect.deckNames(request.url, request.apiKey),
            ankiConnect.modelNames(request.url, request.apiKey),
          ]);
          return { decks, models };
        } catch {
          return { decks: [], models: [] };
        }
      }
      case 'ANKI_FIELDS': {
        try {
          const fields = await ankiConnect.modelFieldNames(request.modelName ?? '', request.url, request.apiKey);
          return { fields };
        } catch {
          return { fields: [] };
        }
      }
      default:
        return {};
    }
  };

  return { ...fake, send };
}
