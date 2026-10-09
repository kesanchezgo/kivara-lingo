/**
 * End-to-end: setItem/getItem through zustand persist with the REAL chrome
 * surface (Map-backed sync + local), written by context A, read by context B.
 *
 * Verifies the contract the review demanded:
 *  1. SAVE blanks the secret from the SYNC blob (no ciphertext, no plaintext).
 *  2. SAVE writes it to a local slot.
 *  3. A SECOND context (fresh module = its own baseline) reading getItem gets
 *     the plaintext back — the round trip survives across contexts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type MapStore = Map<string, string>;
type ChangedListener = (changes: unknown, area: string) => void;

interface ChromeEnv {
  sync: MapStore;
  local: MapStore;
  failSync: boolean;
  listeners: ChangedListener[];
  /** Every `chrome.storage.local.set` payload, in order — lets a test prove
   * an operation never touched a secret slot. */
  writes: Record<string, unknown>[];
  fireLocal: (changes: Record<string, unknown>) => void;
  restore: () => void;
}

function makeMapStorage(
  store: MapStore,
  failSets?: { on: boolean },
) {
  return {
    get: async (key: string | string[]) => {
      const keys = Array.isArray(key) ? key : [key];
      const out: Record<string, unknown> = {};
      for (const k of keys) if (store.has(k)) out[k] = store.get(k);
      return out;
    },
    set: async (items: Record<string, unknown>) => {
      if (failSets?.on) throw new Error('QUOTA_BYTES quota exceeded');
      for (const [k, v] of Object.entries(items)) store.set(k, String(v));
    },
    remove: async (key: string | string[]) => {
      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) store.delete(k);
    },
  };
}

const SYNC_KEY = 'kivara-lingo-state';
const SLOT_KEY = 'kivara-secret:v1:ai.apiKey';

function installChrome(sync: MapStore, local: MapStore): ChromeEnv {
  const g = globalThis as unknown as { chrome: Record<string, unknown> };
  const prev = g.chrome;
  const listeners: ChangedListener[] = [];
  const writes: Record<string, unknown>[] = [];
  const failSync = { on: false };
  g.chrome = {
    ...prev,
    storage: {
      sync: makeMapStorage(sync, failSync),
      local: {
        ...makeMapStorage(local),
        set: async (items: Record<string, unknown>) => {
          writes.push({ ...items });
          for (const [k, v] of Object.entries(items)) local.set(k, String(v));
        },
      },
      onChanged: {
        addListener: (l: ChangedListener) => listeners.push(l),
      },
    },
    runtime: {
      id: 'test-extension-id',
      sendMessage: () => {},
      onMessage: { addListener: () => {}, removeListener: () => {} },
      onInstalled: { addListener: () => {} },
      getURL: (p: string) => `chrome-extension://test/${p}`,
    },
  };
  return {
    sync,
    local,
    get failSync() {
      return failSync.on;
    },
    set failSync(v: boolean) {
      failSync.on = v;
    },
    listeners,
    writes,
    fireLocal: (changes) => {
      for (const l of listeners) l(changes, 'local');
    },
    restore: () => {
      g.chrome = prev;
    },
  };
}

function flush(ms = 60): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Poll instead of sleeping a fixed delay. The persist path is async and a
 * fixed sleep raced under a loaded machine (two CI jobs at once), flaking
 * tests that used to pass in isolation. */
async function waitFor(predicate: () => boolean, tries = 100): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return;
    await flush(20);
  }
  throw new Error('waitFor timed out');
}

describe('zustand persist × secret slots (setItem/getItem e2e)', () => {
  let env: ChromeEnv;
  let sync: MapStore;
  let local: MapStore;

  beforeEach(() => {
    vi.resetModules();
    env = installChrome(new Map(), new Map());
    sync = env.sync;
    local = env.local;
  });

  afterEach(() => {
    env.restore();
    vi.resetModules();
  });

  it('blanks the secret from sync, stores it in a local slot, and a second context reads it back', async () => {
    // ---- Context A writes a key through the real persist pipeline.
    const modA = await import('../../src/shared/store');
    modA.useKivaraStore.setState({
      ai: { ...modA.useKivaraStore.getState().ai, apiKey: 'sk-e2e-roundtrip' },
    });
    // Wait for the write to actually land instead of sleeping a fixed 60 ms:
    // the persist path is async and, on a loaded machine (two CI jobs at
    // once), the assertion below used to run before the slot existed.
    await waitFor(() => local.get(SLOT_KEY)?.startsWith('enc:v1:') === true);
    // SYNC must carry NO secret material — neither plaintext nor ciphertext.
    const syncRaw = sync.get(SYNC_KEY);
    expect(syncRaw).toBeDefined();
    const syncParsed = JSON.parse(syncRaw!) as { state: { ai: { apiKey: string } } };
    expect(syncParsed.state.ai.apiKey).toBe('');

    // LOCAL must hold the encrypted slot.
    const slot = local.get(SLOT_KEY);
    expect(slot).toBeDefined();
    expect(slot!.startsWith('enc:v1:')).toBe(true);
    expect(slot).not.toContain('sk-e2e-roundtrip');

    // ---- Context B: fresh module (its own baseline), same sync + local.
    vi.resetModules();
    const modB = await import('../../src/shared/store');
    // getItem runs during hydration — wait for the value to appear.
    await waitFor(() => modB.useKivaraStore.getState().ai.apiKey === 'sk-e2e-roundtrip');
  });

  it("a cleared key ('' via Quitar) survives a second context (no resurrection)", async () => {
    const modA = await import('../../src/shared/store');
    const { markSecretExplicitClear } = await import('../../src/shared/secret-store');
    modA.useKivaraStore.setState({
      ai: { ...modA.useKivaraStore.getState().ai, apiKey: 'sk-to-clear' },
    });
    await waitFor(() => !!local.get(SLOT_KEY));
    // Quitar path: the UI marks an explicit clear before saving.
    markSecretExplicitClear('ai', 'apiKey');
    modA.useKivaraStore.setState({
      ai: { ...modA.useKivaraStore.getState().ai, apiKey: '' },
    });
    await waitFor(() => local.get(SLOT_KEY) === '__cleared__');

    expect(local.get(SLOT_KEY)).toBe('__cleared__');

    vi.resetModules();
    const modB = await import('../../src/shared/store');
    // '' is also the default, so waiting for it proves nothing: wait for
    // hydration itself to have run (the store exposes it) and then assert the
    // key was NOT resurrected from the tombstone.
    await waitFor(() => modB.useKivaraStore.persist.hasHydrated?.() === true);
    expect(modB.useKivaraStore.getState().ai.apiKey).toBe('');
  });

  it('the sync retry never tombstones the saved keys', async () => {
    // 🔴 regression: retrySyncWrite used to replay the sealed blob through
    // setItem, so sealForSync ran twice and compared the blanked secret
    // fields against the real baselines — "the user cleared every key" —
    // writing a tombstone per slot and deleting every credential, then
    // spreading the deletion through onChanged(local).
    const modA = await import('../../src/shared/store');
    const { decryptSecret } = await import('../../src/shared/secret-store');
    modA.useKivaraStore.setState({
      ai: { ...modA.useKivaraStore.getState().ai, apiKey: 'sk-retry-survivor' },
    });
    await flush();
    const slotBefore = local.get(SLOT_KEY);
    expect(typeof slotBefore).toBe('string');
    expect(modA.getSyncWriteFailed()).toBe(false);

    // Quota blows on the next persist write.
    env.failSync = true;
    modA.useKivaraStore.setState({
      enabled: !modA.useKivaraStore.getState().enabled,
    });
    await flush();
    expect(modA.getSyncWriteFailed()).toBe(true);

    // The banner retries: the already-sealed blob is replayed verbatim.
    env.failSync = false;
    const writesBefore = env.writes.length;
    const retried = await modA.retrySyncWrite();
    // The retry must never go back through the save path: a re-seal compares
    // the blanked secret fields against the real baselines and tombstones
    // every slot. No secret slot may be written during the retry.
    const writesDuringRetry = env.writes.slice(writesBefore);
    expect(writesDuringRetry.some((w) => SLOT_KEY in w)).toBe(false);
    expect(retried).toBe(true);
    expect(modA.getSyncWriteFailed()).toBe(false);

    // Keys intact, both in the slot and after a full reload of the context.
    expect(local.get(SLOT_KEY)).toBe(slotBefore);
    expect(await decryptSecret(local.get(SLOT_KEY) as string)).toBe('sk-retry-survivor');

    vi.resetModules();
    const modC = await import('../../src/shared/store');
    // Poll for the hydrated value rather than sleeping a fixed delay — under
    // a loaded machine this used to read the store before hydration finished.
    await waitFor(() => modC.useKivaraStore.getState().ai.apiKey === 'sk-retry-survivor');
  });

  it('a Quitar from another context is not mistaken for our own tombstone', async () => {
    // 🟠 regression: `__cleared__` is byte-identical whoever writes it, so A
    // recognised its own tombstone as an own-echo and skipped the rehydrate
    // when B cleared the same field — keeping the dead key in memory and
    // rewriting it verbatim on the next edit.
    const modA = await import('../../src/shared/store');
    const secretA = await import('../../src/shared/secret-store');
    modA.useKivaraStore.setState({
      ai: { ...modA.useKivaraStore.getState().ai, apiKey: 'sk-one' },
    });
    await flush();

    // ---- Context B hydrates with the key and rewrites + clears it.
    vi.resetModules();
    const modB = await import('../../src/shared/store');
    const secretB = await import('../../src/shared/secret-store');
    await flush(320);
    expect(modB.useKivaraStore.getState().ai.apiKey).toBe('sk-one');

    modB.useKivaraStore.setState({
      ai: { ...modB.useKivaraStore.getState().ai, apiKey: 'sk-two' },
    });
    await flush();
    expect(local.get(SLOT_KEY)).not.toBe('__cleared__');

    secretB.markSecretExplicitClear('ai', 'apiKey');
    modB.useKivaraStore.setState({
      ai: { ...modB.useKivaraStore.getState().ai, apiKey: '' },
    });
    await flush();
    expect(local.get(SLOT_KEY)).toBe('__cleared__');

    // B's writes reach A as local onChanged events, exactly as chrome does.
    for (const value of ['__cleared__', 'sk-two-tombstone-target', '__cleared__']) {
      env.fireLocal({ [SLOT_KEY]: { newValue: value } });
      await flush(320);
    }

    // A rehydrated on the tombstone: its in-memory copy is gone, so nothing
    // can resurrect the key it no longer has.
    expect(modA.useKivaraStore.getState().ai.apiKey).toBe('');
    expect(secretA.isOwnLocalWrite(SLOT_KEY, '__cleared__')).toBe(false);
  });
});
