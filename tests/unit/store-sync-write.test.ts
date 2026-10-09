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

function makeMapStorage(store: MapStore, failSets?: () => boolean, onSet?: () => void) {
  return {
    get: async (key: string | string[]) => {
      const keys = Array.isArray(key) ? key : [key];
      const out: Record<string, unknown> = {};
      for (const k of keys) if (store.has(k)) out[k] = store.get(k);
      return out;
    },
    set: async (items: Record<string, unknown>) => {
      if (failSets?.()) throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
      onSet?.();
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
  failRemoves: boolean;
  /** Number of chrome.storage.sync.set calls so far. */
  setCalls: number;
  fire: (changes: Record<string, unknown>, area: string) => void;
  restore: () => void;
}

function installChrome(): Env {
  const sync = new Map<string, string>();
  const listeners: ChangedListener[] = [];
  const failSets = { on: false };
  const failRemoves = { on: false };
  const counters = { setCalls: 0 };
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
      sync: {
        ...makeMapStorage(sync, () => failSets.on, () => {
          counters.setCalls++;
        }),
        remove: async (key: string | string[]) => {
          if (failRemoves.on) throw new Error('chrome.storage.sync.remove failed');
          const keys = Array.isArray(key) ? key : [key];
          for (const k of keys) sync.delete(k);
        },
      },
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
    get failRemoves() {
      return failRemoves.on;
    },
    set failRemoves(v: boolean) {
      failRemoves.on = v;
    },
    get setCalls() {
      return counters.setCalls;
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

    expect(mod.getSyncWriteStatus()).toEqual({ failed: false, discarded: false });
    const seen: Array<{ failed: boolean; discarded: boolean }> = [];
    const unsubscribe = mod.subscribeSyncWriteStatus((status) => seen.push(status));

    env.failSets = true;
    await storage.setItem(SYNC_KEY, blob('A')); // chrome.storage rejects
    expect(mod.getSyncWriteFailed()).toBe(true);
    expect(seen).toEqual([{ failed: true, discarded: false }]);
    // The blob was still kept locally, so a retry is possible.
    expect(await markerOf(await storage.getItem(SYNC_KEY))).toBe('A');

    env.failSets = false;
    const retried = await mod.retrySyncWrite();
    expect(retried).toBe(true);
    expect(mod.getSyncWriteFailed()).toBe(false);
    expect(seen).toEqual([
      { failed: true, discarded: false },
      { failed: false, discarded: false },
    ]);
    // The retry really wrote the sealed blob — tag intact (still ours, so its
    // echo is not mistaken for a remote change), secrets already blanked.
    expect(canon(env.sync.get(SYNC_KEY)!)).toBe(blob('A'));
    expect(JSON.parse(env.sync.get(SYNC_KEY)!)._w).toBeTruthy();

    unsubscribe();
    // No notification for a no-op state after unsubscribing.
    await storage.setItem(SYNC_KEY, blob('B')); // succeeds → already clean
    expect(seen).toHaveLength(2);
  });

  it('a pending failed write is reported as discarded when a remote change wins', async () => {
    const mod = await import('../../src/shared/store');
    const storage = mod.makeChromeStorage('sync');

    env.failSets = true;
    await storage.setItem(SYNC_KEY, blob('A'));
    expect(mod.getSyncWriteFailed()).toBe(true);

    // Another device lands a change: the write-through fallback (our only
    // copy of the failed write) is dropped and the rehydrate reads remote.
    // Silently clearing the warning there read as "fixed now".
    env.failSets = false;
    env.fire({ [SYNC_KEY]: { newValue: blob('remote') } }, 'sync');

    expect(mod.getSyncWriteFailed()).toBe(false);
    expect(mod.getSyncWriteDiscarded()).toBe(true);
    await settle();
  });

  it('a failed write retries itself on the next identical save', async () => {
    // 🟠 regression: the no-op guard was set before the await and never
    // cleaned on failure, so the next identical save (a panel toggle) was
    // skipped and the banner could only clear by pressing Retry or by a real
    // state change.
    const mod = await import('../../src/shared/store');
    const storage = mod.makeChromeStorage('sync');

    env.failSets = true;
    await storage.setItem(SYNC_KEY, blob('A'));
    expect(mod.getSyncWriteFailed()).toBe(true);

    // Connectivity is back; the app saves the same state again.
    env.failSets = false;
    const before = env.setCalls;
    await storage.setItem(SYNC_KEY, blob('A'));

    expect(env.setCalls - before).toBe(1);          // it really retried
    expect(mod.getSyncWriteFailed()).toBe(false);   // banner gone, no click
    expect(mod.getSyncWriteDiscarded()).toBe(false);
    expect(canon(env.sync.get(SYNC_KEY)!)).toBe(blob('A'));

    // And no-ops are no-ops again once storage is aligned.
    await storage.setItem(SYNC_KEY, blob('A'));
    expect(env.setCalls - before).toBe(1);
  });

  it('an out-of-order rejection after a newer write is not pending', async () => {
    // Ordering hazard: write A in flight, write B lands, then A rejects. sync
    // holds B (newer), so A is not pending — flagging it would raise a warning
    // whose Retry can only re-send B, and a remote change arriving first would
    // announce deleted edits that were never lost.
    const originalSet = (globalThis as unknown as { chrome: { storage: { sync: { set: unknown } } } })
      .chrome.storage.sync.set;
    const releaseA = new Promise<void>((resolve) => setTimeout(resolve, 20));
    let firstSeen = false;

    (globalThis as unknown as { chrome: { storage: { sync: { set: (i: Record<string, unknown>) => Promise<void> } } } })
      .chrome.storage.sync.set = async (items: Record<string, unknown>) => {
        if (!firstSeen) {
          firstSeen = true;
          await releaseA;
          throw new Error('QUOTA_BYTES quota exceeded');
        }
        for (const [k, v] of Object.entries(items)) env.sync.set(k, String(v));
      };

    try {
      const mod = await import('../../src/shared/store');
      const inFlightA = mod.makeChromeStorage('sync').setItem(SYNC_KEY, blob('A'));
      await new Promise((r) => setTimeout(r, 0)); // A is parked in chrome.set
      await mod.makeChromeStorage('sync').setItem(SYNC_KEY, blob('B')); // lands
      expect(canon(env.sync.get(SYNC_KEY)!)).toBe(blob('B'));
      await inFlightA; // A rejects now — too late, nothing is pending

      expect(mod.getSyncWriteFailed()).toBe(false);
      expect(mod.getSyncWriteDiscarded()).toBe(false);
      // And a remote change must not claim discarded edits.
      env.fire({ [SYNC_KEY]: { newValue: blob('remote') } }, 'sync');
      expect(mod.getSyncWriteDiscarded()).toBe(false);
      await settle();
    } finally {
      (globalThis as unknown as { chrome: { storage: { sync: { set: unknown } } } })
        .chrome.storage.sync.set = originalSet;
    }
  });

  it('a remote change with nothing pending only clears the notice', async () => {
    // A successful write leaves the fallback populated — that is its job — and
    // that must NOT read as "unsynced edits lost". Only a blob that actually
    // failed to reach sync qualifies.
    const mod = await import('../../src/shared/store');
    const storage = mod.makeChromeStorage('sync');

    await storage.setItem(SYNC_KEY, blob('A')); // reached sync — nothing lost
    env.fire({ [SYNC_KEY]: { newValue: blob('remote') } }, 'sync');

    expect(mod.getSyncWriteFailed()).toBe(false);
    expect(mod.getSyncWriteDiscarded()).toBe(false);
    await settle();
  });

  it('a failed removeItem alone never claims discarded edits', async () => {
    const mod = await import('../../src/shared/store');
    const storage = mod.makeChromeStorage('sync');

    await storage.setItem(SYNC_KEY, blob('A'));
    env.failRemoves = true;
    await storage.removeItem(SYNC_KEY);
    expect(mod.getSyncWriteFailed()).toBe(true);

    env.failRemoves = false;
    env.fire({ [SYNC_KEY]: { newValue: blob('remote') } }, 'sync');
    expect(mod.getSyncWriteFailed()).toBe(false);
    expect(mod.getSyncWriteDiscarded()).toBe(false); // nothing was pending
    await settle();
  });

  it('the discarded notice can be dismissed', async () => {
    const mod = await import('../../src/shared/store');
    const storage = mod.makeChromeStorage('sync');

    env.failSets = true;
    await storage.setItem(SYNC_KEY, blob('A'));
    env.failSets = false;
    env.fire({ [SYNC_KEY]: { newValue: blob('remote') } }, 'sync');
    expect(mod.getSyncWriteDiscarded()).toBe(true);

    mod.dismissSyncDiscarded();
    expect(mod.getSyncWriteDiscarded()).toBe(false);
    expect(mod.getSyncWriteFailed()).toBe(false);
  });

  it('the snapshot object is stable while nothing changes', async () => {
    const mod = await import('../../src/shared/store');
    const first = mod.getSyncWriteStatus();
    // Same identity across calls is what keeps useSyncExternalStore from
    // looping through re-renders.
    expect(mod.getSyncWriteStatus()).toBe(first);
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

  it('an identical blob is never written twice (state partialize excludes)', async () => {
    // 🟠 regression: every send stamps a fresh writer id, so an unchanged
    // state still looked like a new value and reached chrome.storage — firing
    // onChanged in every tab, the popup and the SW, and forcing a full
    // rehydrate + decrypt pass in each, against a 120 writes/min quota.
    // `panelOpen` / `isPopupMode` / `audioCaptureActive` are excluded from
    // `partialize`, so toggling the panel serialises the SAME json.
    const { makeChromeStorage } = await import('../../src/shared/store');
    const storage = makeChromeStorage('sync');

    await storage.setItem(SYNC_KEY, blob('A'));
    const tagA = JSON.parse(env.sync.get(SYNC_KEY)!)._w as string;

    // Three more saves of an identical state (three panel toggles).
    const before = env.setCalls;
    await storage.setItem(SYNC_KEY, blob('A'));
    await storage.setItem(SYNC_KEY, blob('A'));
    await storage.setItem(SYNC_KEY, blob('A'));
    expect(env.setCalls - before).toBe(0);
    // Storage still holds the FIRST write — untouched, no new writer id.
    expect(JSON.parse(env.sync.get(SYNC_KEY)!)._w).toBe(tagA);

    // A real change DOES go out, with a new writer id.
    await storage.setItem(SYNC_KEY, blob('B'));
    expect(env.setCalls - before).toBe(1);
    expect(canon(env.sync.get(SYNC_KEY)!)).toBe(blob('B'));
    expect(JSON.parse(env.sync.get(SYNC_KEY)!)._w).not.toBe(tagA);

    // And the no-op guard is per-value: back to A, it goes out again.
    await storage.setItem(SYNC_KEY, blob('A'));
    expect(canon(env.sync.get(SYNC_KEY)!)).toBe(blob('A'));
  });

  it('a remote change resets the no-op guard', async () => {
    // After a remote write, "what storage holds" is unknown — the next
    // identical-looking save must still be sent, or this context could never
    // restore its own value.
    const mod = await import('../../src/shared/store');
    const storage = mod.makeChromeStorage('sync');

    await storage.setItem(SYNC_KEY, blob('A'));
    env.fire({ [SYNC_KEY]: { newValue: blob('remote') } }, 'sync');

    await storage.setItem(SYNC_KEY, blob('A'));
    expect(canon(env.sync.get(SYNC_KEY)!)).toBe(blob('A'));
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
