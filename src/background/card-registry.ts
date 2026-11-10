/**
 * Card registry owned by the service worker (docs/REDESIGN-V2.md §3 H10).
 *
 * One writer, one key: this module is the only code that writes
 * `kvl:cards.recent`. Views read the key through `chrome.storage.local` and
 * subscribe with `onChanged`; they never call into here. The registry is
 * persisted on every transition so a SW restart keeps the list, and the
 * in-memory cache is only a read-through of that key.
 */

import {
  RECENT_CARDS_KEY,
  trimCards,
  reviveCards,
  type RecentCard,
} from '../shared/cards';

export interface RegistryStorage {
  read(): Promise<unknown>;
  write(cards: RecentCard[]): Promise<void>;
}

function chromeStorage(): RegistryStorage | null {
  const storage = (globalThis as {
    chrome?: { storage?: { local?: {
      get(keys: string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    } } };
  }).chrome?.storage?.local;
  if (!storage) return null;
  return {
    async read() {
      const raw = await storage.get(RECENT_CARDS_KEY);
      return raw?.[RECENT_CARDS_KEY];
    },
    async write(cards) {
      await storage.set({ [RECENT_CARDS_KEY]: cards });
    },
  };
}

export interface CardRegistry {
  list(): Promise<RecentCard[]>;
  get(id: string): Promise<RecentCard | undefined>;
  findByNoteId(noteId: number): Promise<RecentCard | undefined>;
  /** Insert (or replace) a card and publish the trimmed list. */
  put(card: RecentCard): Promise<RecentCard | undefined>;
  /** Merge a patch into an existing card; no-op when it was dismissed. */
  patch(id: string, patch: Partial<RecentCard>): Promise<RecentCard | undefined>;
  remove(id: string): Promise<void>;
  removeByNoteId(noteId: number): Promise<void>;
}

/**
 * Build a registry over any storage. The default singleton uses
 * `chrome.storage.local`; tests pass an in-memory store.
 */
export function createCardRegistry(storage: RegistryStorage | null = chromeStorage()): CardRegistry {
  let cache: RecentCard[] | null = null;
  /** Serialize read-modify-write cycles so two saves cannot clobber each other. */
  let chain: Promise<unknown> = Promise.resolve();

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task, task);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const load = async (): Promise<RecentCard[]> => {
    if (cache) return cache;
    if (!storage) {
      cache = [];
      return cache;
    }
    try {
      cache = reviveCards(await storage.read());
    } catch {
      cache = [];
    }
    return cache;
  };

  const commit = async (next: RecentCard[]): Promise<RecentCard[]> => {
    cache = trimCards(next);
    if (storage) {
      try {
        await storage.write(cache);
      } catch {
        // A failed write keeps the in-memory value; the next transition retries.
      }
    }
    return cache;
  };

  return {
    list: () => enqueue(load),

    get(id) {
      return enqueue(async () => (await load()).find((c) => c.id === id));
    },

    findByNoteId(noteId) {
      return enqueue(async () => (await load()).find((c) => c.noteId === noteId));
    },

    put(card) {
      return enqueue(async () => {
        const list = await load();
        const next = [card, ...list.filter((c) => c.id !== card.id)];
        const written = await commit(next);
        return written.find((c) => c.id === card.id);
      });
    },

    patch(id, patch) {
      return enqueue(async () => {
        const list = await load();
        const current = list.find((c) => c.id === id);
        if (!current) return undefined;
        const next = { ...current, ...patch, id };
        await commit(list.map((c) => (c.id === id ? next : c)));
        return next;
      });
    },

    remove(id) {
      return enqueue(async () => {
        const list = await load();
        if (!list.some((c) => c.id === id)) return;
        await commit(list.filter((c) => c.id !== id));
      });
    },

    removeByNoteId(noteId) {
      return enqueue(async () => {
        const list = await load();
        if (!list.some((c) => c.noteId === noteId)) return;
        await commit(list.filter((c) => c.noteId !== noteId));
      });
    },
  };
}

/** The service worker's registry. Nothing else may write the key. */
export const cardRegistry = createCardRegistry();