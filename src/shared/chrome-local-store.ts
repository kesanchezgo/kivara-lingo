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
 * Write discipline, same as the synced store: once hydrated the cached value
 * is updated synchronously (the UI never waits for disk), the disk write is
 * debounced, and a write equal to the last one is skipped. Remote `onChanged`
 * events that carry our own bytes are ignored — otherwise a tab would
 * re-adopt the value it just wrote and clobber a newer local edit.
 *
 * Two rules keep concurrent tabs and late hydration from eating writes:
 *
 *   • `set()` before `hydrate()` resolves is QUEUED, not applied. Hydration
 *     adopts the stored value and the queue is then replayed in order, so a
 *     functional updater sees the hydrated value as its `prev` and a write
 *     made while the read was in flight is never overwritten by it.
 *   • For record values the store can merge an `onChanged` from another tab
 *     key by key (`merge: 'keys'`): keys the writer dropped disappear, keys it
 *     never mentioned stay. Without the option the incoming value replaces the
 *     local one, which is what non-map stores (numbers, profiles) expect.
 */

export interface ChromeLocalStore<T> {
  /**
   * Current value. Starts as `initial` until `hydrate()` resolves; a `set()`
   * made before then is queued and not reflected here until hydration ends.
   */
  get(): T;
  /** Update the value. Before hydration the update is queued and replayed on top of the stored value. */
  set(next: T | ((prev: T) => T)): void;
  /** Value changes from this context (set) or any other (onChanged). */
  subscribe(listener: (value: T) => void): () => void;
  /** Read the persisted value once. Safe to call more than once. */
  hydrate(): Promise<void>;
  /** Flush a pending debounced write immediately (tests, unload). Waits for hydration first. */
  flush(): Promise<void>;
}

/**
 * How a value written by another context combines with the local one.
 *
 * `'replace'` (default) adopts it wholesale. `'keys'` merges plain-record
 * values key by key: a key the writer removed — present in its `oldValue`,
 * absent from its `newValue` — disappears locally, while a key the incoming
 * value does not mention stays. A function receives the local value, the
 * incoming one and the set of removed keys.
 */
export type ChromeLocalStoreMerge<T> =
  | 'replace'
  | 'keys'
  | ((base: T, incoming: T, removed: ReadonlySet<string>) => T);

export interface ChromeLocalStoreOptions<T> {
  merge?: ChromeLocalStoreMerge<T>;
}

const WRITE_DEBOUNCE_MS = 300;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keys the writer had and dropped between its `oldValue` and `newValue`. */
function removedKeys(previous: unknown, incoming: unknown): ReadonlySet<string> {
  const removed = new Set<string>();
  if (!isPlainRecord(previous) || !isPlainRecord(incoming)) return removed;
  for (const key of Object.keys(previous)) if (!(key in incoming)) removed.add(key);
  return removed;
}

function mergeKeys(base: unknown, incoming: unknown, removed: ReadonlySet<string>): unknown {
  if (!isPlainRecord(base) || !isPlainRecord(incoming)) return incoming;
  const merged: Record<string, unknown> = { ...base };
  for (const key of removed) delete merged[key];
  for (const [key, value] of Object.entries(incoming)) merged[key] = value;
  return merged;
}

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
  options: ChromeLocalStoreOptions<T> = {},
): ChromeLocalStore<T> {
  const merge = options.merge ?? 'replace';
  const listeners = new Set<(value: T) => void>();
  let value: T = initial;
  let hydrated = false;
  let hydrating: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** `set()` calls made before hydration resolved, replayed in order once it does. */
  const queued: Array<T | ((prev: T) => T)> = [];
  /** Serialized form of the last value we wrote, to skip no-op writes and
   * to recognise our own onChanged echo. */
  let lastWritten: string | null = null;
  /** True while the hydration read is in flight (a remote change then may be older than it). */
  let reading = false;
  /** Remote changes adopted while the read was in flight, replayed over the stored value. */
  const remotesDuringRead: Array<{ raw: unknown; previousRaw: unknown; serialized: string }> = [];

  const notify = () => {
    for (const listener of [...listeners]) listener(value);
  };

  const adopt = (raw: unknown, serialized: string) => {
    const next = revive ? revive(raw) : (raw as T);
    value = next;
    lastWritten = serialized;
    notify();
  };

  const apply = (next: T | ((prev: T) => T)) => {
    value = typeof next === 'function' ? (next as (prev: T) => T)(value) : next;
    notify();
    schedule();
  };

  /** Replay the writes made while hydration was in flight, oldest first. */
  const drain = () => {
    const ops = queued.splice(0);
    for (const op of ops) apply(op);
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

  const applyRemote = (raw: unknown, previousRaw: unknown, serialized: string) => {
    if (merge === 'replace' || raw === undefined) {
      adopt(raw, serialized);
      return;
    }
    const incoming = revive ? revive(raw) : (raw as T);
    // A writer with no previous value had not seen any key of ours: nothing to remove.
    const base = previousRaw === undefined
      ? initial
      : (revive ? revive(previousRaw) : (previousRaw as T));
    const removed = removedKeys(base, incoming);
    value = merge === 'keys'
      ? (mergeKeys(value, incoming, removed) as T)
      : merge(value, incoming, removed);
    lastWritten = serialized;
    notify();
  };

  if (typeof chromeApi()?.storage?.onChanged?.addListener === 'function') {
    chromeApi()!.storage!.onChanged!.addListener((changes, area) => {
      if (area !== 'local' || !(key in changes)) return;
      const change = changes[key];
      const serialized = JSON.stringify(change?.newValue ?? null);
      if (serialized === lastWritten) return; // our own echo
      // The read may resolve with a value older than this change: keep it so it
      // can be replayed on top of what storage returned.
      if (reading) remotesDuringRead.push({ raw: change?.newValue, previousRaw: change?.oldValue, serialized });
      applyRemote(change?.newValue, change?.oldValue, serialized);
    });
  }

  const hydrateOnce = (): Promise<void> => {
    if (hydrated) return Promise.resolve();
    if (hydrating) return hydrating;
    hydrating = (async () => {
      const storage = chromeApi()?.storage?.local;
      reading = true;
      try {
        if (storage) {
          const stored = (await storage.get(key))?.[key];
          if (stored !== undefined) adopt(stored, JSON.stringify(stored));
        }
      } catch {
        // A read failure leaves the initial value in place.
      }
      reading = false;
      // A remote change that landed mid-read is newer than the stored value.
      for (const remote of remotesDuringRead.splice(0)) {
        applyRemote(remote.raw, remote.previousRaw, remote.serialized);
      }
      hydrated = true;
      drain();
    })();
    return hydrating;
  };

  return {
    get: () => value,
    set(next) {
      if (!hydrated) {
        queued.push(next);
        // A write must not wait for a hydrate() nobody called: start it so the
        // queue drains on top of the stored value instead of hanging.
        void hydrateOnce();
        return;
      }
      apply(next);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hydrate: hydrateOnce,
    async flush() {
      if (!hydrated) await hydrateOnce();
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await write();
    },
  };
}
