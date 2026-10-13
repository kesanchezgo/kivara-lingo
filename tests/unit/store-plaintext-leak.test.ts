/**
 * The plaintext-leak the audit flagged, pinned end to end.
 *
 * `sealForSync` used to `return raw` when the secret pipeline threw — i.e.
 * it handed a blob still carrying the API key VERBATIM back to `setItem`,
 * which wrote it to `chrome.storage.sync`. That replicated a cleartext
 * credential to Chrome's sync servers and to every device on the account,
 * which is exactly what PRIVACY.md promises never happens. The doc comment
 * said "skipping this persist tick" while the code skipped nothing.
 *
 * Three guarantees, each with a way to fail:
 *  1. `chrome.storage.sync.set` is never called with a blob containing the
 *     key, plaintext or otherwise;
 *  2. the in-memory value survives, so the user's typed key is not lost;
 *  3. the UI learns about it (`secretSaveRefused`), because silently not
 *     saving looks identical to saving.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type MapStore = Map<string, string>;

interface ChromeEnv {
  sync: MapStore;
  local: MapStore;
  /** Every `chrome.storage.sync.set` payload, in order. */
  writes: Record<string, unknown>[];
  restore: () => void;
}

function installChrome(): ChromeEnv {
  const sync = new Map<string, string>();
  const local = new Map<string, string>();
  const writes: Record<string, unknown>[] = [];
  const promise = (fn: (arg: unknown) => unknown) => () => Promise.resolve(fn(undefined));
  const g = globalThis as unknown as { chrome: Record<string, unknown> };
  const prev = g.chrome;
  g.chrome = {
    storage: {
      sync: {
        get: async (keys: string[] | string) => {
          const out: Record<string, unknown> = {};
          for (const k of Array.isArray(keys) ? keys : [keys]) {
            if (sync.has(k)) out[k] = sync.get(k);
          }
          return out;
        },
        set: async (items: Record<string, unknown>) => {
          writes.push({ ...items });
          for (const [k, v] of Object.entries(items)) sync.set(k, String(v));
        },
        remove: (k: string, cb: () => void) => {
          sync.delete(k);
          cb();
        },
      },
      local: {
        get: promise(() => ({})),
        set: async () => {},
        remove: promise(() => {}),
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
    runtime: { id: 'test-extension-id', lastError: undefined },
  };
  return {
    sync,
    local,
    writes,
    restore: () => {
      g.chrome = prev;
    },
  };
}

async function flush(ms = 40): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(predicate: () => boolean, tries = 100): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return;
    await flush(20);
  }
  throw new Error('waitFor timed out');
}

const PLAINTEXT = 'sk-live-must-never-be-synced';

describe('sealForSync refuses the write instead of leaking a cleartext key', () => {
  let env: ChromeEnv;
  let originalCrypto: Crypto | undefined;

  beforeEach(() => {
    vi.resetModules();
    env = installChrome();
    // Break ONLY the two calls the secret pipeline makes — `deriveKey` and
    // `encrypt`. Replacing the whole `crypto` object also disables
    // `digest`/`deriveBits`, which makes unrelated lazy paths reject on their
    // own and turns every vitest run into a wall of unhandled-rejection
    // noise that says nothing about the behaviour under test.
    const real = globalThis.crypto;
    // Prototype-preserving override bound to the original SubtleCrypto: the
    // methods are brand-checked (`this` must be a real SubtleCrypto), so a
    // `Object.create` copy throws ERR_INVALID_THIS when anything other than
    // the two shadowed calls runs. Shadowing the two the secret pipeline needs
    // keeps every other method native — and object-spreading the interface
    // instead would have dropped them, breaking `digest` for unrelated code.
    const original = real.subtle;
    const override = Object.create(original) as SubtleCrypto;
    Object.defineProperty(override, 'deriveKey', {
      value: async () => {
        throw new Error('crypto unavailable');
      },
    });
    Object.defineProperty(override, 'encrypt', {
      value: async () => {
        throw new Error('crypto unavailable');
      },
    });
    vi.spyOn(real, 'subtle', 'get').mockReturnValue(override);
    // Methods the store actually calls keep the original brand.
    override.digest = original.digest.bind(original) as SubtleCrypto['digest'];
    override.importKey = original.importKey.bind(original) as SubtleCrypto['importKey'];
    override.decrypt = original.decrypt.bind(original) as SubtleCrypto['decrypt'];
  });

  afterEach(() => {
    vi.stubGlobal('crypto', originalCrypto);
    env.restore();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('never hands a blob containing the key to storage.sync', async () => {
    const mod = await import('../../src/shared/store');
    const { SecretEncryptionUnavailableError } = await import('../../src/shared/secret-store');
    expect(SecretEncryptionUnavailableError).toBeTruthy();

    // A permanently broken crypto makes the lazy key resolution reject on a
    // path nobody awaits (the background derivation started by the first
    // encrypt). Recorded rather than swallowed so the noise is visible and
    // so vitest does not report the run as unstable.
    mod.useKivaraStore.setState({
      ai: { ...mod.useKivaraStore.getState().ai, apiKey: PLAINTEXT, provider: 'openai' },
    });

    // Give the persist pipeline every chance to (wrongly) write.
    await flush(400);
    try {
      await mod.useKivaraStore.persist.rehydrate();
    } catch {
      /* rehydrate may fail with crypto broken — that is the point */
    }
    await flush(400);

    const allWrites = JSON.stringify(env.writes);
    expect(allWrites).not.toContain(PLAINTEXT);
    // And nothing was carried into the map either.
    for (const [name, value] of env.sync) {
      if (name === 'kivara-lingo-state') expect(value).not.toContain(PLAINTEXT);
    }
  });

  it('keeps the key in memory so the next successful save still works', async () => {
    const mod = await import('../../src/shared/store');
    mod.useKivaraStore.setState({
      ai: { ...mod.useKivaraStore.getState().ai, apiKey: PLAINTEXT },
    });
    await flush(300);
    expect(mod.useKivaraStore.getState().ai.apiKey).toBe(PLAINTEXT);
  });

  it('raises the status the UI reads, and dismiss it clears it', async () => {
    const mod = await import('../../src/shared/store');
    mod.useKivaraStore.setState({
      ai: { ...mod.useKivaraStore.getState().ai, apiKey: PLAINTEXT },
    });

    await waitFor(() => mod.getSyncWriteStatus().secretSaveRefused === true);
    expect(mod.getSyncWriteStatus().secretSaveRefused).toBe(true);

    mod.dismissSecretSaveRefused();
    expect(mod.getSyncWriteStatus().secretSaveRefused).toBe(false);
  });
});
