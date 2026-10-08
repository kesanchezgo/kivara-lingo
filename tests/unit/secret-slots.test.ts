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
import { describe, it, expect, beforeEach } from 'vitest';
import {
  SECRET_FIELDS,
  secretSlotKey,
  pushSecretsToLocal,
  pullSecretsFromLocal,
  encryptSecret,
  decryptSecret,
  isEncrypted,
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
    // fresh module-level memory in defaultSlotIO not used here — every test
    // passes its own IO.
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
    expect(io.data.get(secretSlotKey('ai', 'apiKey'))).toBe('');
  });

  it('covers every declared secret field with a unique slot key', () => {
    const keys = SECRET_FIELDS.map((f) => secretSlotKey(f.section, f.field));
    expect(new Set(keys).size).toBe(SECRET_FIELDS.length);
  });
});
