/**
 * The persisted-state migrate hook, driven through the REAL persist pipeline.
 *
 * Why the harness is heavy: zustand's `migrate` receives the already-
 * unwrapped state (storage holds `{ state, version }`, persist hands over
 * `state`). The first implementation read `persisted.state.ai` and never
 * fired, while its unit test passed because it fed that same wrong shape.
 * These tests hydrate the actual store from a written snapshot, so neither
 * side of the contract can drift.
 *
 * The scenarios that matter:
 *  • a retired model id in the snapshot becomes a live one;
 *  • a snapshot written by c2c00bb (version 1, unchanged, because of that
 *    bug) is still picked up by the bump to 2;
 *  • a snapshot already at the current version is left alone — which is what
 *    keeps a user's own later provider choice from being re-decided;
 *  • the migrated state is re-persisted at the new version.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const KEY = 'kivara-lingo-state';

let snapshots: Map<string, string>;
let prevChrome: unknown;

function seed(version: number | undefined, model: string) {
  snapshots.set(
    KEY,
    JSON.stringify({ state: { ai: { model, provider: 'anthropic', apiKey: 'sk-ant-live' } }, version }),
  );
}

async function hydrateStore() {
  vi.resetModules();
  const mod = await import('../../src/shared/store');
  await mod.useKivaraStore.persist.rehydrate();
  return mod;
}

function installChrome() {
  snapshots = new Map();
  // The store's storage wrapper awaits chrome.storage.sync.get(), so the
  // mock must answer a promise, not the callback form.
  const pick = (keys: string[] | string) => {
    const list = Array.isArray(keys) ? keys : [keys];
    const out: Record<string, unknown> = {};
    for (const k of list) if (snapshots.has(k)) out[k] = snapshots.get(k);
    return out;
  };
  const sync = {
    get: async (keys: string[] | string) => pick(keys),
    set: async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) snapshots.set(k, String(v));
    },
    remove: async (k: string) => {
      snapshots.delete(k);
    },
  };
  const local = {
    get: async () => ({} as Record<string, unknown>),
    set: async () => {},
    remove: async (_k: string) => {},
  };
  const g = globalThis as unknown as { chrome: Record<string, unknown> };
  prevChrome = g.chrome;
  g.chrome = {
    storage: {
      sync,
      local,
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
    runtime: { id: 'test', lastError: undefined, getURL: (p: string) => `chrome-extension://test/${p}` },
    i18n: { getUILanguage: () => 'en' },
  };
}

describe('persist migrate: retired AI models, through the real pipeline', () => {
  beforeEach(installChrome);

  afterEach(() => {
    (globalThis as unknown as { chrome: unknown }).chrome = prevChrome;
    vi.restoreAllMocks();
  });

  it('rewrites a retired id found in a stored snapshot', async () => {
    seed(undefined, 'claude-3-5-haiku-latest');
    const mod = await hydrateStore();
    expect(mod.useKivaraStore.getState().ai.model).toBe('claude-haiku-4-5');
  });

  it('rewrites the version-1 snapshot written by the first (broken) cut', async () => {
    // c2c00bb stamped version 1 without changing anything. The bump to 2 is
    // what makes those profiles migrate; dropping the bump turns this red.
    seed(1, 'gemini-2.0-flash');
    const mod = await hydrateStore();
    expect(mod.useKivaraStore.getState().ai.model).toBe('gemini-2.5-flash');
  });

  it('keeps the rest of the ai block', async () => {
    seed(undefined, 'claude-3-5-sonnet-latest');
    const mod = await hydrateStore();
    const { ai } = mod.useKivaraStore.getState();
    expect(ai.model).toBe('claude-sonnet-4-6');
    expect(ai.provider).toBe('anthropic');
    // The migration touches the model only — a key sitting inline in an old
    // sync snapshot still round-trips (loadSecrets decrypts legacy values).
    expect((ai as { apiKey?: string }).apiKey ?? '').toBe('sk-ant-live');
  });

  it('leaves a live id untouched', async () => {
    seed(undefined, 'claude-opus-4-7');
    const mod = await hydrateStore();
    expect(mod.useKivaraStore.getState().ai.model).toBe('claude-opus-4-7');
  });

  it('does not re-decide a snapshot already at the current version', async () => {
    seed(2, 'claude-haiku-4-5');
    const mod = await hydrateStore();
    expect(mod.useKivaraStore.getState().ai.model).toBe('claude-haiku-4-5');
  });

  it('re-persists the migrated model at the new version', async () => {
    seed(1, 'gemini-2.0-flash');
    const mod = await hydrateStore();
    expect(mod.useKivaraStore.getState().ai.model).toBe('gemini-2.5-flash');
    await vi.waitFor(() => {
      expect(snapshots.has(KEY)).toBe(true);
      const written = JSON.parse(snapshots.get(KEY)!) as { state?: { ai?: { model?: string } }; version?: number };
      expect(written.state?.ai?.model).toBe('gemini-2.5-flash');
      expect(written.version).toBe(2);
    });
  });
});
