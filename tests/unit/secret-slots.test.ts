/**
 * Secret slots (moved secrets from chrome.storage.sync → .local).
 *
 * Root cause this fixes: the AES salt lives ONLY in storage.local, but the
 * ciphertext used to ride in storage.sync. On a second device the decrypt
 * failed → the old path injected '' → the next persist wrote '' over the
 * ciphertext, destroying the key on every device.
 *
 * Contract under test:
 *  1. SAVE  → slots written (encrypted), sync blob blanked.
 *  2. LOAD  → slots injected as plaintext.
 *  3. MIGRATION → legacy inline ciphertext/plaintext in sync moves to a
 *     slot and is blanked from sync on the next save.
 *  4. Unreadable slot → ciphertext preserved in state (UI hint path).
 *  5. Local write failure on SAVE → inline-encryption fallback (the old
 *     behavior), never a plaintext leak, never a lost key.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SECRET_FIELDS,
  SECRET_CLEARED,
  secretSlotKey,
  pushSecretsToLocal,
  pullSecretsFromLocal,
  encryptSecret,
  decryptSecret,
  isEncrypted,
  resolveSecret,
  __resetSecretSlotsForTests,
  type SecretSlotIO,
} from '../../src/shared/secret-store';

type State = Record<string, Record<string, unknown>>;

function makeIO(initial: Record<string, unknown> = {}): SecretSlotIO & {
  data: Map<string, unknown>;
  failWrites: boolean;
} {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    data,
    failWrites: false,
    async get(keys) {
      const out: Record<string, unknown> = {};
      for (const k of keys) if (data.has(k)) out[k] = data.get(k);
      return out;
    },
    async set(items) {
      if (this.failWrites) throw new Error('storage.local unavailable');
      for (const [k, v] of Object.entries(items)) data.set(k, v);
    },
  };
}

/** A brand-new module instance — its own `lastPersisted` baseline, like a
 * real second browser context (popup vs content script). */
async function freshContext() {
  vi.resetModules();
  return (await import('../../src/shared/secret-store')) as typeof import('../../src/shared/secret-store');
}

/** Replace the setup.ts chrome.storage.local no-op with a Map-backed real
 * store so the DEFAULT slot IO path (used by resolveSecret) actually
 * persists within a test. Restores the original afterward. */
function stubLocalSlots(): { data: Map<string, unknown>; restore: () => void } {
  const g = globalThis as unknown as { chrome: { storage: { local: unknown } } };
  const original = g.chrome.storage.local;
  const data = new Map<string, unknown>();
  g.chrome.storage.local = {
    get: async (keys: string | string[]) => {
      const arr = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of arr) if (data.has(k)) out[k] = data.get(k);
      return out;
    },
    set: async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) data.set(k, v);
    },
    remove: async (keys: string | string[]) => {
      const arr = Array.isArray(keys) ? keys : [keys];
      for (const k of arr) data.delete(k);
    },
  };
  return {
    data,
    restore: () => {
      g.chrome.storage.local = original;
    },
  };
}

function stateWith(overrides: Partial<Record<string, Record<string, unknown>>>): State {
  return {
    translate: { deeplToken: '', googleToken: '', libreTranslateToken: '', ...overrides.translate },
    ai: { apiKey: '', ...overrides.ai },
    ankiMapping: { apiKey: '', ...overrides.ankiMapping },
    tts: { elevenLabsApiKey: '', ...overrides.tts },
    vip: { unsplashAccessKey: '', pixabayApiKey: '', ...overrides.vip },
  };
}

describe('secret slots', () => {
  beforeEach(() => {
    // Every case starts with an empty per-context baseline, otherwise a
    // value written by a previous test is treated as "already persisted"
    // and its write is (correctly) skipped.
    __resetSecretSlotsForTests();
  });

  it('SAVE writes encrypted slots and blanks the sync state', async () => {
    const io = makeIO();
    const state = stateWith({ ai: { apiKey: 'sk-live-key' } });
    const ok = await pushSecretsToLocal(state, io);

    expect(ok).toBe(true);
    expect(state.ai.apiKey).toBe(''); // sync carries no secret material
    const slot = io.data.get(secretSlotKey('ai', 'apiKey')) as string;
    expect(typeof slot).toBe('string');
    expect(isEncrypted(slot)).toBe(true);
    expect(slot).not.toContain('sk-live-key');
  });

  it('LOAD injects the slot as plaintext', async () => {
    const io = makeIO();
    const saveState = stateWith({ translate: { deeplToken: 'deepl-token' } });
    await pushSecretsToLocal(saveState, io);

    const loadState = stateWith({ translate: { deeplToken: '' } });
    await pullSecretsFromLocal(loadState, io);
    expect(loadState.translate.deeplToken).toBe('deepl-token');
  });

  it('migrates a legacy ciphertext out of sync into a slot', async () => {
    const cipher = await encryptSecret('legacy-in-sync');
    const io = makeIO();
    const state = stateWith({ ankiMapping: { apiKey: cipher } });

    await pullSecretsFromLocal(state, io);
    // Injected for this session…
    expect(state.ankiMapping.apiKey).toBe('legacy-in-sync');
    // …and parked in a local slot. AES-GCM uses a fresh IV per encryption,
    // so the ciphertext bytes differ — what matters is it IS encrypted
    // and decrypts back to the same plaintext.
    const migrated = io.data.get(secretSlotKey('ankiMapping', 'apiKey')) as string;
    expect(isEncrypted(migrated)).toBe(true);
    expect(await decryptSecret(migrated)).toBe('legacy-in-sync');

    // Next SAVE blanks the sync copy — no secret leaves the device anymore.
    const ok = await pushSecretsToLocal(state, io);
    expect(ok).toBe(true);
    expect(state.ankiMapping.apiKey).toBe('');
  });

  it('migrates legacy PLAINTEXT too (very old builds)', async () => {
    const io = makeIO();
    const state = stateWith({ vip: { pixabayApiKey: 'plain-old-key' } });
    await pullSecretsFromLocal(state, io);
    expect(state.vip.pixabayApiKey).toBe('plain-old-key');
    const slot = io.data.get(secretSlotKey('vip', 'pixabayApiKey')) as string;
    expect(isEncrypted(slot)).toBe(true); // plaintext never lands in local either
    await pushSecretsToLocal(state, io);
    expect(state.vip.pixabayApiKey).toBe('');
  });

  it('unreadable slot keeps ciphertext in state (UI re-enter hint path)', async () => {
    const garbage = 'enc:v1:Zm9yZ2VkLWNpcGhlci1ibG9i';
    const io = makeIO({ [secretSlotKey('tts', 'elevenLabsApiKey')]: garbage });
    const state = stateWith({ tts: { elevenLabsApiKey: '' } });

    await pullSecretsFromLocal(state, io);
    // decryptSecret PRESERVES the ciphertext → unreadableSecret() can warn.
    expect(state.tts.elevenLabsApiKey).toBe(garbage);
  });

  it('falls back to inline encryption when the local write fails', async () => {
    const io = makeIO();
    io.failWrites = true;
    const state = stateWith({ ai: { apiKey: 'sk-must-not-leak' } });

    const ok = await pushSecretsToLocal(state, io);
    expect(ok).toBe(false);
    // The fallback path must encrypt INLINE (old behavior) — never blank,
    // never plaintext. This mirrors store.ts sealForSync's fallback.
    expect(isEncrypted(state.ai.apiKey as string)).toBe(true);
    expect(state.ai.apiKey).not.toBe('sk-must-not-leak');
  });

  it("explicit clear ('') drops the slot", async () => {
    const io = makeIO();
    await pushSecretsToLocal(stateWith({ ai: { apiKey: 'sk-x' } }), io);
    expect(io.data.has(secretSlotKey('ai', 'apiKey'))).toBe(true);

    await pushSecretsToLocal(stateWith({ ai: { apiKey: '' } }), io);
    // Cleared slots carry the tombstone, not '' — so a later load can
    // distinguish "user deleted this" from "no slot here".
    expect(io.data.get(secretSlotKey('ai', 'apiKey'))).toBe(SECRET_CLEARED);
  });

  it('a stale context cannot clobber a key another context just wrote', async () => {
    // Map-backed local: the salt must survive across fresh module instances
    // (the setup.ts mock is a no-op, so every instance would mint its own).
    const stub = stubLocalSlots();
    try {
      const io = makeIO(); // the shared "chrome.storage.local"
      const key = secretSlotKey('ai', 'apiKey');

      // Context B loads FIRST (empty slots) → baseline ''.
      const modB = await freshContext();
      const stateB = stateWith({});
      await modB.pullSecretsFromLocal(stateB, io);
      expect(stateB.ai.apiKey).toBe('');

      // Context A (separate baseline) writes a NEW key.
      const modA = await freshContext();
      const stateA = stateWith({});
      stateA.ai.apiKey = 'sk-A-new';
      await modA.pushSecretsToLocal(stateA, io);
      expect((await modB.decryptSecret(io.data.get(key) as string))).toBe('sk-A-new');

      // B (STALE — never rehydrated) persists after a toggle: its value ('')
      // matches its own baseline ('') → write SKIPPED → A's key survives.
      await modB.pushSecretsToLocal(stateB, io);
      expect((await modB.decryptSecret(io.data.get(key) as string))).toBe('sk-A-new');
    } finally {
      stub.restore();
    }
  });

  it("stale context with an OLD key does not revert A's newer key", async () => {
    const stub = stubLocalSlots();
    try {
      const io = makeIO({});
      const key = secretSlotKey('ai', 'apiKey');

      // Seed the slot with the OLD key using a FRESH instance: instance #1
      // (the static import) may hold a `cachedKey` from an earlier test
      // whose salt isn't in this stub — a fresh instance derives from the
      // stub's salt so the later decrypt works.
      const modSeed = await freshContext();
      await modSeed.pushSecretsToLocal(stateWith({ ai: { apiKey: 'sk-old' } }), io);

      // B loads when the slot holds 'sk-old' → baseline = 'sk-old'.
      const modB = await freshContext();
      const stateB = stateWith({});
      await modB.pullSecretsFromLocal(stateB, io);
      expect(stateB.ai.apiKey).toBe('sk-old');

      // A (separate baseline) replaces it with 'sk-new'.
      const modA = await freshContext();
      const stateA = stateWith({});
      stateA.ai.apiKey = 'sk-new';
      await modA.pushSecretsToLocal(stateA, io);

      // B (never rehydrated) saves again with its OLD value → its diff says
      // "unchanged from my baseline" → skip → A's key wins.
      await modB.pushSecretsToLocal(stateB, io);
      expect((await modB.decryptSecret(io.data.get(key) as string))).toBe('sk-new');
    } finally {
      stub.restore();
    }
  });

  it('tombstone / empty slot beats a stale legacy ciphertext in sync', async () => {
    const zombie = await encryptSecret('zombie-key'); // old sync blob value
    const key = secretSlotKey('ai', 'apiKey');

    // Case A: cleared slot (tombstone).
    const ioA = makeIO({ [key]: SECRET_CLEARED });
    const stateA = stateWith({ ai: { apiKey: zombie } });
    await pullSecretsFromLocal(stateA, ioA);
    expect(stateA.ai.apiKey).toBe(''); // NOT re-migrated

    // Case B: slot written as '' by the pre-tombstone build.
    const ioB = makeIO({ [key]: '' });
    const stateB = stateWith({ ai: { apiKey: zombie } });
    await pullSecretsFromLocal(stateB, ioB);
    expect(stateB.ai.apiKey).toBe(''); // NOT re-migrated
  });

  it('resolveSecret never consults legacy once a slot exists', async () => {
    __resetSecretSlotsForTests();
    const stub = stubLocalSlots();
    try {
      const zombie = await encryptSecret('zombie-key');
      // Seed a CLEARED slot through the DEFAULT IO (now backed by the stub).
      await pushSecretsToLocal(stateWith({ ai: { apiKey: '' } }));
      expect(stub.data.get(secretSlotKey('ai', 'apiKey'))).toBe(SECRET_CLEARED);
      // A legacy ciphertext still sits in the sync blob — resolveSecret must
      // return '' (slot wins) and never resurrect the zombie.
      const result = await resolveSecret('ai', 'apiKey', zombie);
      expect(result).toBe('');
    } finally {
      stub.restore();
    }
  });

  it('first save without a baseline never destroys a slot it never loaded', async () => {
    // The exact 🟠 scenario: no sync blob (getItem → null), so
    // loadSecrets/pullSecretsFromLocal never ran in this context → no
    // baseline. A real key sits in the local slot from another context.
    // NOTE: stubLocalSlots shares the salt across fresh module instances
    // (the default setup.ts mock is a no-op, so each freshContext would
    // otherwise mint its own salt and decrypt would preserve ciphertext).
    const stub = stubLocalSlots();
    try {
      const key = secretSlotKey('ai', 'apiKey');
      const seed = await freshContext();
      const io = makeIO();
      await seed.pushSecretsToLocal(stateWith({ ai: { apiKey: 'sk-survivor' } }), io);
      const before = io.data.get(key);
      expect(typeof before).toBe('string');
      expect(before).not.toBe('');

      // Fresh context WITHOUT pullSecretsFromLocal: baseline is empty, the
      // in-memory value is ''. An unrelated toggle triggers this save.
      const mod = await freshContext();
      const ok = await mod.pushSecretsToLocal(stateWith({}), io);
      expect(ok).toBe(true);
      expect(io.data.get(key)).toBe(before); // untouched, no tombstone
      // And the surviving key still decrypts.
      expect(await mod.decryptSecret(io.data.get(key) as string)).toBe('sk-survivor');
    } finally {
      stub.restore();
    }
  });

  it('deferred migration baseline survives a failed slot write', async () => {
    // loadSecrets must NOT record the baseline when io.set throws: the
    // next save would otherwise see value === baseline, skip the slot
    // write and blank the sync copy — losing the only copy of the key.
    const cipher = await encryptSecret('legacy-retry');
    const io = makeIO();
    io.failWrites = true;
    const state = stateWith({ ankiMapping: { apiKey: cipher } });
    await pullSecretsFromLocal(state, io);
    expect(state.ankiMapping.apiKey).toBe('legacy-retry');
    // Slot write failed → nothing parked, and crucially NO baseline, so
    // the retry still writes.
    expect(io.data.has(secretSlotKey('ankiMapping', 'apiKey'))).toBe(false);

    io.failWrites = false;
    const ok = await pushSecretsToLocal(state, io);
    expect(ok).toBe(true);
    const slot = io.data.get(secretSlotKey('ankiMapping', 'apiKey')) as string;
    expect(isEncrypted(slot)).toBe(true);
    expect(await decryptSecret(slot)).toBe('legacy-retry');
  });

  it('covers every declared secret field with a unique slot key', () => {
    const keys = SECRET_FIELDS.map((f) => secretSlotKey(f.section, f.field));
    expect(new Set(keys).size).toBe(SECRET_FIELDS.length);
  });
});
