/**
 * chromeLocalStore — the createPersistedStore of the prototype, on top of
 * `chrome.storage.local`.
 *
 * Why local and not the synced store: `chrome.storage.sync` caps each item at
 * 8 KB and each extension at 120 writes/minute. Word-status maps, level
 * profiles and the recent-card log grow with the user and would blow both
 * (docs/REDESIGN-V2.md §3 H4). `chrome.storage.local` has neither limit, is
 * readable from the content script, and an `onChanged` listener keeps every
 * tab of the same device in step. Cross-device sync is deliberately out of
 * scope for v2.0 (D8).
 *
 * Write discipline, same as the synced store: the cached value is updated
 * synchronously (the UI never waits), the disk write is debounced, and a
 * write equal to the last one is skipped. Remote `onChanged` events that
 * carry our own bytes are ignored — otherwise a tab would re-adopt the value
 * it just wrote and clobber a newer local edit.
 */

export interface ChromeLocalStore<T> {
  /** Current value. Starts as `initial` until `hydrate()` resolves. */
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  /** Value changes from this context (set) or any other (onChanged). */
  subscribe(listener: (value: T) => void): () => void;
  /** Read the persisted value once. Safe to call more than once. */
  hydrate(): Promise<void>;
  /** Flush a pending debounced write immediately (tests, unload). */
  flush(): Promise<void>;
}

const WRITE_DEBOUNCE_MS = 300;

interface ChromeLike {
  storage?: {
    local?: {
      get(keys: string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
    onChanged?: {
      addListener(
        cb: (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>, area: string) => void,
      ): void;
    };
  };
}

function chromeApi(): ChromeLike | undefined {
  return (globalThis as { chrome?: ChromeLike }).chrome;
}

export function createChromeLocalStore<T>(
  key: string,
  initial: T,
  revive?: (raw: unknown) => T,
): ChromeLocalStore<T> {
  const listeners = new Set<(value: T) => void>();
  let value: T = initial;
  let hydrated = false;
  let hydrating: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Serialized form of the last value we wrote, to skip no-op writes and
   * to recognise our own onChanged echo. */
  let lastWritten: string | null = null;

  const notify = () => {
    for (const listener of [...listeners]) listener(value);
  };

  const adopt = (raw: unknown, serialized: string) => {
    const next = revive ? revive(raw) : (raw as T);
    value = next;
    lastWritten = serialized;
    notify();
  };

  const write = async () => {
    timer = null;
    const serialized = JSON.stringify(value);
    if (serialized === lastWritten) return;
    lastWritten = serialized;
    const storage = chromeApi()?.storage?.local;
    if (!storage) return; // in-memory only (tests, non-extension contexts)
    try {
      await storage.set({ [key]: value });
    } catch {
      // Quota or a torn-down SW: keep the in-memory value; the next set()
      // schedules another attempt.
      lastWritten = null;
    }
  };

  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => void write(), WRITE_DEBOUNCE_MS);
  };

  if (typeof chromeApi()?.storage?.onChanged?.addListener === 'function') {
    chromeApi()!.storage!.onChanged!.addListener((changes, area) => {
      if (area !== 'local' || !(key in changes)) return;
      const serialized = JSON.stringify(changes[key]?.newValue ?? null);
      if (serialized === lastWritten) return; // our own echo
      adopt(changes[key]?.newValue, serialized);
    });
  }

  return {
    get: () => value,
    set(next) {
      value = typeof next === 'function' ? (next as (prev: T) => T)(value) : next;
      notify();
      schedule();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hydrate() {
      if (hydrated) return Promise.resolve();
      if (hydrating) return hydrating;
      hydrating = (async () => {
        const storage = chromeApi()?.storage?.local;
        if (!storage) {
          hydrated = true;
          return;
        }
        try {
          const stored = (await storage.get(key))?.[key];
          if (stored !== undefined) adopt(stored, JSON.stringify(stored));
        } catch {
          // A read failure leaves the initial value in place.
        }
        hydrated = true;
      })();
      return hydrating;
    },
    async flush() {
      if (timer !== null) clearTimeout(timer);
      await write();
    },
  };
}
