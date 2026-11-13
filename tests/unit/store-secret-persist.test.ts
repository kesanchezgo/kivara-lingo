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

/**
 * A live secret slot: ciphertext under the current format, not a tombstone and
 * not blank. `__cleared__` and `''` both mean "no key"; only `enc:v1:` means
 * the write landed.
 */
function isSealed(value: string | undefined): boolean {
  return typeof value === 'string' && value.startsWith('enc:v1:');
}

/**
 * Poll instead of sleeping a fixed delay. The persist path is async and a
 * fixed sleep raced under a loaded machine (two CI jobs at once), flaking
 * tests that used to pass in isolation.
 *
 * Budget: 12 s by default, and each test's own timeout is its sum of budgets
 * plus a margin. It was 100 attempts of 20 ms = 2 s, then 250 (nominally 5 s):
 * a full-suite run was measured spending 2 194 ms in one write under load, and
 * with six copies of this file on a saturated CPU a single write + decrypt was
 * seen taking ~8 s of wall clock.
 *
 * The budget is a DEADLINE, not an attempt count. As `tries = 250` of
 * `flush(20)` it read as 5 s but only was 5 s on an idle box: when the machine
 * is starved a 20 ms timer comes back much later, so one nominal "5 s" wait
 * could outlive the whole test limit and surface as `Test timed out` with no
 * clue which wait was stuck. With a deadline the cap is real, and the sum of a
 * test's budgets is exactly what that test's timeout has to clear.
 *
 * `what` names the wait in the failure. Without it every timeout in this file
 * said "waitFor timed out", which under load pointed at the poller instead of
 * at the write that never landed.
 */
async function waitFor(predicate: () => boolean, what: string, budgetMs = 12_000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() >= deadline) {
      throw new Error(`waitFor timed out after ${(budgetMs / 1000).toFixed(1)}s: ${what}`);
    }
    await flush(20);
  }
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
    const modA = await import('../../src/shared/use-kivara-store');
    modA.useKivaraStore.setState({
      ai: { ...modA.useKivaraStore.getState().ai, apiKey: 'sk-e2e-roundtrip' },
    });
    // Wait for the write to actually land instead of sleeping a fixed 60 ms:
    // the persist path is async and, on a loaded machine (two CI jobs at
    // once), the assertion below used to run before the slot existed.
    await waitFor(() => isSealed(local.get(SLOT_KEY)), "A's key lands in the local slot");
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
    const modB = await import('../../src/shared/use-kivara-store');
    // getItem runs during hydration — wait for the value to appear.
    await waitFor(
      () => modB.useKivaraStore.getState().ai.apiKey === 'sk-e2e-roundtrip',
      'the second context reads the key back',
    );
    // 2 × 12 s of budgets + room for the module graph: a starved import of
    // this graph was measured at several seconds on its own.
  }, 40_000);

  it("a cleared key ('' via Quitar) survives a second context (no resurrection)", async () => {
    const modA = await import('../../src/shared/use-kivara-store');
    const { markSecretExplicitClear } = await import('../../src/shared/secret-store');
    modA.useKivaraStore.setState({
      ai: { ...modA.useKivaraStore.getState().ai, apiKey: 'sk-to-clear' },
    });
    await waitFor(() => isSealed(local.get(SLOT_KEY)), "A's key lands in the local slot");
    // Quitar path: the UI marks an explicit clear before saving.
    markSecretExplicitClear('ai', 'apiKey');
    modA.useKivaraStore.setState({
      ai: { ...modA.useKivaraStore.getState().ai, apiKey: '' },
    });
    await waitFor(
      () => local.get(SLOT_KEY) === '__cleared__',
      'Quitar writes the tombstone',
    );

    expect(local.get(SLOT_KEY)).toBe('__cleared__');

    vi.resetModules();
    const modB = await import('../../src/shared/use-kivara-store');
    // '' is also the default, so waiting for it proves nothing: wait for
    // hydration itself to have run (the store exposes it) and then assert the
    // key was NOT resurrected from the tombstone.
    await waitFor(
      () => modB.useKivaraStore.persist.hasHydrated?.() === true,
      'the second context hydrates',
    );
    expect(modB.useKivaraStore.getState().ai.apiKey).toBe('');
    // 3 × 12 s of budgets + room for the module graph.
  }, 50_000);

  it('the sync retry never tombstones the saved keys', async () => {
    // 🔴 regression: retrySyncWrite used to replay the sealed blob through
    // setItem, so sealForSync ran twice and compared the blanked secret
    // fields against the real baselines — "the user cleared every key" —
    // writing a tombstone per slot and deleting every credential, then
    // spreading the deletion through onChanged(local).
    const modA = await import('../../src/shared/store');
    const { useKivaraStore } = await import('../../src/shared/use-kivara-store');
    const { decryptSecret } = await import('../../src/shared/secret-store');
    useKivaraStore.setState({
      ai: { ...useKivaraStore.getState().ai, apiKey: 'sk-retry-survivor' },
    });
    // The slot write is async, and a fixed `flush(60)` here was the one place
    // in this file that still trusted a sleep: under a loaded box the poll in
    // the test above wins and this one reads `undefined`, which asserts as
    // "the retry tombstoned the key" — a real regression reported as a pass
    // blocker. Wait for the write to land instead.
    await waitFor(() => isSealed(local.get(SLOT_KEY)), "A's key lands in the local slot");
    expect(isSealed(local.get(SLOT_KEY))).toBe(true);
    expect(modA.getSyncWriteFailed()).toBe(false);

    // Quota blows on the next persist write.
    env.failSync = true;
    useKivaraStore.setState({
      enabled: !useKivaraStore.getState().enabled,
    });
    // The failure is reported from the write's catch, so it lands a tick after
    // setState — a fixed `flush()` here read the flag before the throw.
    await waitFor(() => modA.getSyncWriteFailed(), 'the failed sync write is reported');

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
    //
    // NOT a byte comparison against the pre-toggle ciphertext: the toggle
    // still writes the slot (local succeeds, only sync is quota-stuck) and a
    // re-seal of the same plaintext carries a fresh IV, so the ciphertext
    // legitimately differs depending on which write won the race. That the
    // retry never touches the slot is asserted above, from the recorded writes.
    const slotAfterRetry = local.get(SLOT_KEY);
    expect(slotAfterRetry).not.toBe('__cleared__');
    expect(await decryptSecret(slotAfterRetry as string)).toBe('sk-retry-survivor');

    vi.resetModules();
    const modC = await import('../../src/shared/use-kivara-store');
    // Poll for the hydrated value rather than sleeping a fixed delay — under
    // a loaded machine this used to read the store before hydration finished.
    await waitFor(
      () => modC.useKivaraStore.getState().ai.apiKey === 'sk-retry-survivor',
      'the reloaded context reads the key back',
    );
    // 3 × 12 s of budgets + room for the module graph.
  }, 50_000);

  it('a Quitar from another context is not mistaken for our own tombstone', async () => {
    // 🟠 regression: `__cleared__` is byte-identical whoever writes it, so A
    // recognised its own tombstone as an own-echo and skipped the rehydrate
    // when B cleared the same field — keeping the dead key in memory and
    // rewriting it verbatim on the next edit.
    const modA = await import('../../src/shared/use-kivara-store');
    const secretA = await import('../../src/shared/secret-store');
    modA.useKivaraStore.setState({
      ai: { ...modA.useKivaraStore.getState().ai, apiKey: 'sk-one' },
    });
    // The A write is async and this used to be a fixed 60 ms sleep. The module
    // reset below runs on the MAIN thread regardless of that write, so under
    // load the sleep expired first, B hydrated from an empty slot, and B never
    // re-reads — the failure then surfaced one step later, at "B reads A's
    // key". Wait for the ciphertext itself, then reset.
    await waitFor(() => isSealed(local.get(SLOT_KEY)), "A's 'sk-one' reaches the local slot");

    // ---- Context B hydrates with the key and rewrites + clears it.
    vi.resetModules();
    const modB = await import('../../src/shared/use-kivara-store');
    const secretB = await import('../../src/shared/secret-store');
    // Wait for the hydration EVENT, not a guessed 320 ms: the persist read is
    // async and the fixed sleep was the flake under a loaded machine.
    await waitFor(() => modB.useKivaraStore.persist.hasHydrated?.() === true, 'context B hydrates', 8_000);
    await waitFor(
      () => modB.useKivaraStore.getState().ai.apiKey === 'sk-one',
      "context B reads A's key",
    );

    const sealedByA = local.get(SLOT_KEY);
    modB.useKivaraStore.setState({
      ai: { ...modB.useKivaraStore.getState().ai, apiKey: 'sk-two' },
    });
    // Wait for B's write to REPLACE A's ciphertext — a bare "not the tombstone"
    // check passes on A's old value and proves nothing about B.
    await waitFor(
      () => {
        const value = local.get(SLOT_KEY);
        return isSealed(value) && value !== sealedByA;
      },
      "B's 'sk-two' replaces the slot",
      8_000,
    );
    expect(local.get(SLOT_KEY)).not.toBe('__cleared__');

    secretB.markSecretExplicitClear('ai', 'apiKey');
    modB.useKivaraStore.setState({
      ai: { ...modB.useKivaraStore.getState().ai, apiKey: '' },
    });
    await waitFor(
      () => local.get(SLOT_KEY) === '__cleared__',
      "B's Quitar tombstones the slot",
      8_000,
    );
    expect(local.get(SLOT_KEY)).toBe('__cleared__');

    // B's writes reach A as local onChanged events, exactly as chrome does.
    // They are fired back to back (A's rehydrate is debounced, so the last
    // value is the one that lands) and then polled — no fixed sleeps.
    for (const value of ['__cleared__', 'sk-two-tombstone-target', '__cleared__']) {
      env.fireLocal({ [SLOT_KEY]: { newValue: value } });
    }

    // A rehydrated on the tombstone: its in-memory copy is gone, so nothing
    // can resurrect the key it no longer has. The rehydrate is DEBOUNCED
    // (250 ms), so poll instead of assuming the last flush covered it —
    // under a loaded machine this assertion used to run before it landed.
    await waitFor(
      () => modA.useKivaraStore.getState().ai.apiKey === '',
      'A rehydrates on the foreign tombstone',
      8_000,
    );
    expect(secretA.isOwnLocalWrite(SLOT_KEY, '__cleared__')).toBe(false);
    // 12 + 8 + 12 + 8 + 8 + 8 = 56 s of budgets + room for the module graph.
  }, 70_000);
});
