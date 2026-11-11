/**
 * AnkiPort — the AnkiConnect boundary (docs/REDESIGN-V2.md §4.2, §4.6).
 *
 * Replaces the prototype's `mocks/anki.ts`. Phase F4 replaces the stub factory
 * below with the real client: `webext-bridge` messages to the service worker
 * (`anki-connect.ts` + `capture-orchestrator.ts`), extended with
 * `deleteNotes`, `addTags`, `guiBrowse`, `findCards` and `cardsInfo`.
 */
import type { AnkiFieldsResponse, AnkiListsResponse, AnkiPingResponse } from '../../shared/types';
import type { AddContextInput, BrowseQuery, CreateCardInput } from './types';

export interface AnkiPort {
  /** Connectivity probe with a machine-readable error code. */
  ping(): Promise<AnkiPingResponse>;
  /** Deck names in the user's collection. */
  decks(): Promise<AnkiListsResponse['decks']>;
  /** Note-type (model) names in the user's collection. */
  models(): Promise<AnkiListsResponse['models']>;
  /** Field names of a note type. */
  fields(modelName: string): Promise<AnkiFieldsResponse['fields']>;
  /** Create a note; resolves to the new note id. */
  createCard(input: CreateCardInput): Promise<number>;
  /** Undo (delete) a note by id. */
  undo(noteId: number): Promise<void>;
  /** Attach another scene/context to an existing note. */
  addContext(input: AddContextInput): Promise<void>;
  /** Open the Anki browser on a note id or a raw query. */
  browse(query: BrowseQuery): Promise<void>;
  /** Interval in days per word in a deck, keyed by word. */
  wordIntervals(lang: string, deck: string, fieldName: string): Promise<Record<string, number>>;
  /** Retry a single queued/failed card. */
  retry(id: string): Promise<void>;
  /** Drain the whole retry queue now. */
  retryAll(): Promise<void>;
  /** Dismiss a queued/failed card from the list. */
  dismiss(id: string): Promise<void>;
}

/**
 * Build an AnkiPort from the injected engine. This is a thin F4 stub: it only
 * forwards calls, so the view tree can mount before the real client lands.
 *
 * @deprecated Phase F4 replaces this factory with the real AnkiConnect client.
 */
export function createAnkiPort(engine: AnkiPort): AnkiPort {
  return {
    ping: () => engine.ping(),
    decks: () => engine.decks(),
    models: () => engine.models(),
    fields: (modelName) => engine.fields(modelName),
    createCard: (input) => engine.createCard(input),
    undo: (noteId) => engine.undo(noteId),
    addContext: (input) => engine.addContext(input),
    browse: (query) => engine.browse(query),
    wordIntervals: (lang, deck, fieldName) => engine.wordIntervals(lang, deck, fieldName),
    retry: (id) => engine.retry(id),
    retryAll: () => engine.retryAll(),
    dismiss: (id) => engine.dismiss(id),
  };
}
