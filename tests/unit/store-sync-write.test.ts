/**
 * The chrome.storage.sync adapter inside zustand persist — the four
 * behaviors the review flagged as untracked:
 *
 *  1. The write-through fallback beats chrome.storage on read (our own slow
 *     or failed write must not be overwritten by a stale blob).
 *  2. The own-echo RING (not a single slot): the echo of write A can arrive
 *     after write B landed, so A must still be recognised as ours — a
 *     single-slot memory treated it as a remote change, dropped the
 *     fallback and rehydrated to A, silently reverting B.
 *  3. A genuine remote change DOES drop the fallback (and the ring).
 *  4. A failed chrome write sets the visible failure flag (`getSyncWriteFailed`),
 *     notifies subscribers, and `retrySyncWrite` clears it once storage
 *     recovers — plus `removeItem` cleans the fallback up.
 *
 * These run against the exported adapter so nothing has to wait on zustand's
 * debounce.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type MapStore = Map<string, string>;
type ChangedListener = (changes: unknown, area: string) => void;

const SYNC_KEY = 'kivara-lingo-state';

function makeMapStorage(store: MapStore, failSets: () => boolean) {
  return {
    get: async (key: string | string[]) => {
      const keys = Array.isArray(key) ? key : [key];
      const out: Record<string, unknown> = {};
      for (const k of keys) if (store.has(k)) out[k] = store.get(k);
      return out;
    },
    set: async (items: Record<string, unknown>) => {
      if (failSets()) throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
      for (const [k, v] of Object.entries(items)) store.set(k, String(v));
    },
    remove: async (key: string | string[]) => {
      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) store.delete(k);
    },
  };
}

interface Env {
  sync: MapStore;
  listeners: ChangedListener[];
  failSets: boolean;
  fire: (changes: Record<string, unknown>, area: string) => void;
  restore: () => void;
}

function installChrome(): Env {
  const sync = new Map<string, string>();
  const listeners: ChangedListener[] = [];
  const failSets = { on: false };
  const g = globalThis as unknown as { chrome: Record<string, unknown> };
  const prev = g.chrome;
  g.chrome = {
    ...(prev as object),
    runtime: {
      id: 'test-extension-id',
      sendMessage: () => {},
      onMessage: { addListener: () => {}, removeListener: () => {} },
      onInstalled: { addListener: () => {} },
      getURL: (p: string) => `chrome-extension://test/${p}`,
    },
    storage: {
      sync: makeMapStorage(sync, () => failSets.on),
      local: makeMapStorage(new Map(), () => false),
      onChanged: { addListener: (l: ChangedListener) => listeners.push(l) },
    },
  };
  return {
    sync,
    listeners,
    get failSets() {
      return failSets.on;
    },
    set failSets(v: boolean) {
      failSets.on = v;
    },
    fire: (changes, area) => {
      for (const l of listeners) l(changes, area);
    },
    restore: () => {
      g.chrome = prev;
    },
  };
}

/** A sealed-shaped blob: `sealForSync`/`openFromSync` need `{ state: {} }`;
 * `marker` lets us tell two blobs apart after the JSON round trip. The sync
 * adapter stamps `_w` (writer id) on every write, so content comparisons go
 * through `canon()` and the tagged values are read back from "chrome" when a
 * test needs to replay a real echo. */
function blob(marker: string): string {
  return JSON.stringify({ marker, state: {}, version: 1 });
}

function canon(raw: string): string {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  delete parsed._w;
  return JSON.stringify(parsed);
}

/** A fired onChanged event schedules a debounced rehydrate (250 ms). Wait it
 * out INSIDE the test so no stray timer runs against a later test's chrome
 * mock (and so a rejection surfaces here, where it can be read). */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 320));
}

async function markerOf(value: string | null): Promise<string | null> {
  if (value == null) return null;
  return (JSON.parse(value) as { marker?: string }).marker ?? value;
}

describe('chrome.storage.sync persist adapter', () => {
  let env: Env;

  beforeEach(async () => {
    vi.resetModules();
    env = installChrome();
  });

  afterEach(() => {
    env.restore();
    vi.resetModules();
  });

  it('the write-through fallback wins over a stale chrome.storage blob', async () => {
    const { makeChromeStorage } = await import('../../src/shared/store');
    const storage = makeChromeStorage('sync');

    await storage.setItem(SYNC_KEY, blob('A'));
    expect(canon(env.sync.get(SYNC_KEY)!)).toBe(blob('A'));
    // Every write carries a writer id the reader never sees.
    expect(JSON.parse(env.sync.get(SYNC_KEY)!)._w).toBeTruthy();

    // Someone else's write is still in flight / chrome is holding an older
    // blob: our fallback must answer, not the stale chrome value.
    env.sync.set(SYNC_KEY, blob('stale'));
    expect(await markerOf(await storage.getItem(SYNC_KEY))).toBe('A');
  });

  it("an earlier write's echo is not mistaken for a remote change (A→B)", async () => {
    const { makeChromeStorage } = await import('../../src/shared/store');
    const storage = makeChromeStorage('sync');

    await storage.setItem(SYNC_KEY, blob('A'));
    const echoA = env.sync.get(SYNC_KEY)!;   // tagged — exactly what chrome echoes
    await storage.setItem(SYNC_KEY, blob('B'));
    env.sync.set(SYNC_KEY, blob('stale'));   // B's chrome write lags behind

    // Chrome delivers A's echo AFTER B was written. A belongs to the ring of
    // our own writes (matched by writer id, not by content) → skip. The
    // single-slot version dropped the fallback here and the debounced
    // rehydrate reverted the UI to A.
    env.fire({ [SYNC_KEY]: { newValue: echoA } }, 'sync');
    expect(await markerOf(await storage.getItem(SYNC_KEY))).toBe('B');
    await settle();
  });

  it("another context writing the SAME blob is not our echo", async () => {
    // The settings blob is deterministic once the secrets are gone, so
    // content-matching would call an identical remote write ours. Only the
    // writer id separates the two.
    const { makeChromeStorage } = await import('../../src/shared/store');
    const storage = makeChromeStorage('sync');

    await storage.setItem(SYNC_KEY, blob('X1'));
    await storage.setItem(SYNC_KEY, blob('X2'));
    const bWrote = blob('X1'); // context B saved the blob we already wrote

    env.sync.set(SYNC_KEY, bWrote); // B's write landed in chrome
    env.fire({ [SYNC_KEY]: { newValue: bWrote } }, 'sync');

    expect(await markerOf(await storage.getItem(SYNC_KEY))).toBe('X1');
    await settle();
  });

  it('a genuine remote change drops the fallback and the echo ring', async () => {
    const { makeChromeStorage } = await import('../../src/shared/store');
    const storage = makeChromeStorage('sync');

    await storage.setItem(SYNC_KEY, blob('A'));
    env.fire({ [SYNC_KEY]: { newValue: blob('remote') } }, 'sync');

    // Fallback gone → the fresh chrome blob answers.
    env.sync.set(SYNC_KEY, blob('remote'));
    expect(await markerOf(await storage.getItem(SYNC_KEY))).toBe('remote');

    // Ring gone too: A is now a foreign value again, so a late echo of it
    // must NOT be able to hide the remote change.
    env.sync.set(SYNC_KEY, blob('remote-again'));
    env.fire({ [SYNC_KEY]: { newValue: blob('A') } }, 'sync');
    expect(await markerOf(await storage.getItem(SYNC_KEY))).toBe('remote-again');
    await settle();
  });

  it('a quota failure raises the visible flag, and the retry clears it', async () => {
    const mod = await import('../../src/shared/store');
    const storage = mod.makeChromeStorage('sync');

    expect(mod.getSyncWriteFailed()).toBe(false);
    const seen: boolean[] = [];
    const unsubscribe = mod.subscribeSyncWriteError((failed) => seen.push(failed));

    env.failSets = true;
    await storage.setItem(SYNC_KEY, blob('A')); // chrome.storage rejects
    expect(mod.getSyncWriteFailed()).toBe(true);
    expect(seen).toEqual([true]);
    // The blob was still kept locally, so a retry is possible.
    expect(await markerOf(await storage.getItem(SYNC_KEY))).toBe('A');

    env.failSets = false;
    const retried = await mod.retrySyncWrite();
    expect(retried).toBe(true);
    expect(mod.getSyncWriteFailed()).toBe(false);
    expect(seen).toEqual([true, false]);
    // The retry really wrote the sealed blob — tag intact (still ours, so its
    // echo is not mistaken for a remote change), secrets already blanked.
    expect(canon(env.sync.get(SYNC_KEY)!)).toBe(blob('A'));
    expect(JSON.parse(env.sync.get(SYNC_KEY)!)._w).toBeTruthy();

    unsubscribe();
    // No notification for a no-op state after unsubscribing.
    await storage.setItem(SYNC_KEY, blob('B')); // succeeds → already false
    expect(seen).toEqual([true, false]);
  });

  it('retrySyncWrite reports false when nothing was ever written', async () => {
    const mod = await import('../../src/shared/store');
    expect(await mod.retrySyncWrite()).toBe(false);
  });

  it('removeItem clears the fallback and the echo ring', async () => {
    const mod = await import('../../src/shared/store');
    const storage = mod.makeChromeStorage('sync');

    await storage.setItem(SYNC_KEY, blob('A'));
    await storage.removeItem(SYNC_KEY);

    // Fallback cleared → nothing is resurrected by a later getItem in this
    // context (the old removeItem returned before deleting it).
    expect(await storage.getItem(SYNC_KEY)).toBeNull();
    expect(env.sync.has(SYNC_KEY)).toBe(false);

    // Ring cleared → a late echo of the removed blob is handled as a remote
    // event, not silently skipped.
    env.fire({ [SYNC_KEY]: { newValue: blob('A') } }, 'sync');
    env.sync.set(SYNC_KEY, blob('recreated'));
    expect(await markerOf(await storage.getItem(SYNC_KEY))).toBe('recreated');
    await settle();
  });

  it('no chrome.storage at all: everything stays in the fallback', async () => {
    const g = globalThis as unknown as { chrome: unknown };
    const prev = g.chrome;
    g.chrome = undefined;
    try {
      const { makeChromeStorage } = await import('../../src/shared/store');
      const storage = makeChromeStorage('sync');
      await storage.setItem(SYNC_KEY, blob('A'));
      expect(await markerOf(await storage.getItem(SYNC_KEY))).toBe('A');
      await storage.removeItem(SYNC_KEY);
      expect(await storage.getItem(SYNC_KEY)).toBeNull();
    } finally {
      g.chrome = prev;
    }
  });
});
