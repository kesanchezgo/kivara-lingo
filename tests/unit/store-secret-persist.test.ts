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

function makeMapStorage(store: MapStore) {
  return {
    get: async (key: string | string[]) => {
      const keys = Array.isArray(key) ? key : [key];
      const out: Record<string, unknown> = {};
      for (const k of keys) if (store.has(k)) out[k] = store.get(k);
      return out;
    },
    set: async (items: Record<string, unknown>) => {
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

function installChrome(sync: MapStore, local: MapStore) {
  const g = globalThis as unknown as { chrome: Record<string, unknown> };
  const prev = g.chrome;
  g.chrome = {
    ...prev,
    storage: {
      sync: makeMapStorage(sync),
      local: makeMapStorage(local),
      onChanged: { addListener: () => {} },
    },
    runtime: {
      id: 'test-extension-id',
      sendMessage: () => {},
      onMessage: { addListener: () => {}, removeListener: () => {} },
      onInstalled: { addListener: () => {} },
      getURL: (p: string) => `chrome-extension://test/${p}`,
    },
  };
  return () => {
    g.chrome = prev;
  };
}

function flush(ms = 60): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('zustand persist × secret slots (setItem/getItem e2e)', () => {
  let sync: MapStore;
  let local: MapStore;
  let restore: () => void;

  beforeEach(() => {
    vi.resetModules();
    sync = new Map();
    local = new Map();
    restore = installChrome(sync, local);
  });

  afterEach(() => {
    restore();
    vi.resetModules();
  });

  it('blanks the secret from sync, stores it in a local slot, and a second context reads it back', async () => {
    // ---- Context A writes a key through the real persist pipeline.
    const modA = await import('../../src/shared/store');
    modA.useKivaraStore.setState({
      ai: { ...modA.useKivaraStore.getState().ai, apiKey: 'sk-e2e-roundtrip' },
    });
    await flush();

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
    // getItem runs during hydration — wait for it.
    await flush();
    expect(modB.useKivaraStore.getState().ai.apiKey).toBe('sk-e2e-roundtrip');
  });

  it("a cleared key ('' via Quitar) survives a second context (no resurrection)", async () => {
    const modA = await import('../../src/shared/store');
    modA.useKivaraStore.setState({
      ai: { ...modA.useKivaraStore.getState().ai, apiKey: 'sk-to-clear' },
    });
    await flush();
    modA.useKivaraStore.setState({
      ai: { ...modA.useKivaraStore.getState().ai, apiKey: '' },
    });
    await flush();

    expect(local.get(SLOT_KEY)).toBe('__cleared__');

    vi.resetModules();
    const modB = await import('../../src/shared/store');
    await flush();
    expect(modB.useKivaraStore.getState().ai.apiKey).toBe('');
  });
});
