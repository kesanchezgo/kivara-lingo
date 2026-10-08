/**
 * AES-GCM at-rest encryption for sensitive Zustand fields (API keys, mostly).
 *
 * Threat model — what this protects against:
 *   • A malicious page reading `chrome.storage.sync` via a compromised
 *     extension upload (which can happen if a developer's account is
 *     phished and a new build is pushed). Any code running in the SW
 *     still has access to the master key and can decrypt — but a
 *     storage dump alone won't leak credentials.
 *   • Another extension reading our exported store JSON if the user
 *     forwards it (e.g. when sending a bug report).
 *
 * What it does NOT protect against:
 *   • A malicious build of Kivara itself — by design the SW must be
 *     able to decrypt to actually call the providers.
 *   • Disk forensics on a compromised machine — chrome.storage.local
 *     is not encrypted at rest by Chrome on most platforms.
 *
 * The master key is derived (PBKDF2, 100k iterations, SHA-256) from a
 * per-installation salt persisted in `chrome.storage.local` plus the
 * extension's runtime ID. The salt is generated once on first run and
 * never rotates. Re-installing the extension creates a new salt, which
 * means previously-encrypted values become unreadable — that's
 * acceptable because re-installs already wipe `chrome.storage`.
 */

const STORAGE_KEY = 'kivara-secret-store-salt-v1';
const PREFIX = 'enc:v1:'; // versioned so we can rotate the schema later

let cachedKey: CryptoKey | null = null;
/** Salt the cachedKey was derived from — when the stored salt changes
 * under us (cross-context first-run race) the cached key is dropped. */
let cachedSalt: string | null = null;
// Single-flight lock so concurrent first-run callers (SW + content script)
// don't generate divergent salts. Module-level per context; combined with
// re-read-after-write below it converges across contexts too.
let saltPromise: Promise<string> | null = null;

async function getOrCreateSalt(): Promise<string> {
  if (saltPromise) return saltPromise;
  saltPromise = (async () => {
    try {
      const found = await chrome.storage.local.get(STORAGE_KEY);
      const existing = found[STORAGE_KEY];
      if (typeof existing === 'string' && existing.length >= 32) return existing;
    } catch {
      /* fall through */
    }

    const random = new Uint8Array(32);
    crypto.getRandomValues(random);
    const salt = Array.from(random, (b) => b.toString(16).padStart(2, '0')).join('');
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: salt });
    } catch (err) {
      console.warn('[Kivara secret-store] could not persist salt', err);
      return salt;
    }
    // Re-read after write: if another context won the race and wrote its
    // own salt first/last, converge on the stored value instead of our
    // local candidate so all callers derive the same key going forward.
    try {
      const check = await chrome.storage.local.get(STORAGE_KEY);
      const stored = check[STORAGE_KEY];
      if (typeof stored === 'string' && stored.length >= 32) return stored;
    } catch {
      /* fall through, use local candidate */
    }
    return salt;
  })();
  try {
    return await saltPromise;
  } finally {
    saltPromise = null;
  }
}

async function deriveKey(): Promise<CryptoKey> {
  if (cachedKey) {
    // The salt may have been replaced under us (another context won the
    // first-run race and overwrote it). Re-read cheaply and drop the
    // cached key when it changed — otherwise we'd keep encrypting with a
    // key nobody else can derive.
    try {
      const found = await chrome.storage.local.get(STORAGE_KEY);
      const stored = found[STORAGE_KEY];
      if (typeof stored === 'string' && stored.length >= 32 && stored !== cachedSalt) {
        cachedKey = null;
      }
    } catch {
      // storage unreadable — keep the cached key, best effort
    }
    if (cachedKey) return cachedKey;
  }

  const salt = await getOrCreateSalt();
  // Anchor the master password on chrome.runtime.id so a copy of the
  // chrome.storage dump alone (without the matching extension id) can't
  // be decrypted.
  const password = `kivara-lingo|${chrome.runtime?.id ?? 'unknown'}|${salt}`;
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  cachedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(salt),
      iterations: 100_000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  cachedSalt = salt;
  return cachedKey;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * True if `value` looks like a Kivara-encrypted blob. Used to skip
 * re-encrypting and to detect plaintext leftovers from older builds.
 */
export function isEncrypted(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Encrypt a plaintext secret. Empty string passes through unchanged so
 * "no key configured" stays distinguishable from "key configured but
 * encrypted to empty bytes". On crypto failure, returns the original
 * plaintext (it's still safer than crashing the whole settings save —
 * the worst case is a key that wasn't encrypted, not a key that was
 * lost).
 *
 * MARKING: an unencrypted result is self-identifying — it does NOT carry
 * the `enc:v1:` prefix, so `isEncrypted()` (and therefore every reader)
 * can tell "stored plaintext because crypto was unavailable" from real
 * ciphertext. The failure is also warned on the console above. We do NOT
 * invent a fake prefix here because callers treat prefixed values as
 * ciphertext and would try to decrypt garbage.
 */
export async function encryptSecret(plaintext: string): Promise<string> {
  if (!plaintext) return '';
  if (isEncrypted(plaintext)) return plaintext; // idempotent

  try {
    const key = await deriveKey();
    const iv = crypto.getRandomValues(new Uint8Array(12)); // GCM 96-bit IV
    const cipher = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(plaintext),
    );
    const cipherBytes = new Uint8Array(cipher);
    const blob = new Uint8Array(iv.length + cipherBytes.length);
    blob.set(iv, 0);
    blob.set(cipherBytes, iv.length);
    return PREFIX + toBase64(blob);
  } catch (err) {
    console.warn('[Kivara secret-store] encrypt failed, storing plaintext', err);
    return plaintext;
  }
}

/**
 * Decrypt a value previously emitted by `encryptSecret`. If the input is
 * already plaintext (legacy data, migration in progress, …) it's
 * returned unchanged. On crypto failure (wrong salt after reinstall, salt
 * mismatch across devices, corrupt blob) the ORIGINAL CIPHERTEXT is
 * returned unchanged — never ''. Returning '' would poison the in-memory
 * store and, on the next persist tick, overwrite the stored ciphertext
 * with an empty string, permanently deleting the user's key.
 * Callers that need usable plaintext must check `isEncrypted(result)`:
 * still-encrypted after decrypt means "unreadable here, but preserved".
 */
export async function decryptSecret(value: string | undefined | null): Promise<string> {
  if (!value) return '';
  if (!isEncrypted(value)) return value; // legacy plaintext

  try {
    const key = await deriveKey();
    const blob = fromBase64(value.slice(PREFIX.length));
    if (blob.length < 13) return value;
    const iv = blob.slice(0, 12);
    const cipher = blob.slice(12);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      cipher,
    );
    return new TextDecoder().decode(plain);
  } catch (err) {
    console.warn('[Kivara secret-store] decrypt failed, preserving ciphertext', err);
    return value;
  }
}

/**
 * Synchronous helper for components that need to *display* (not use)
 * a secret — returns `'••••••••'` for encrypted values, the raw value
 * for empties, and a generic mask for plaintext leftovers. Used by
 * the SettingsTab inputs so we never re-show the user a key they
 * already entered.
 *
 * IMPORTANT for controlled inputs: when the stored value is still-encrypted
 * (unreadable on this device — cross-device salt mismatch), render '' so
 * the `<input type="password" value={...}>` doesn't display the `enc:v1:`
 * blob. The caller must treat '' as "no usable key here" and show the
 * re-enter hint (see `unreadableSecret` below), not as "user cleared it".
 */
export function maskSecret(value: string | undefined | null): string {
  if (!value) return '';
  if (isEncrypted(value)) return '';
  // Plaintext leftover from older builds or from a manual import.
  return value.length > 6 ? value.slice(0, 2) + '••••••••' : '••••••';
}

/** True when the stored value is ciphertext this device cannot read
 * (wrong salt after reinstall, salt mismatch across synced devices).
 * The UI should show "clave no disponible en este dispositivo, vuelve a
 * introducirla" instead of the raw `enc:v1:` blob, and must NOT let the
 * user edit-and-save the blob as if it were plaintext (that would store
 * garbage). */
export function unreadableSecret(value: string | undefined | null): boolean {
  return isEncrypted(value ?? '');
}

/* ──────────────────────────────────────────────────────────────────────────
 * LOCAL SECRET SLOTS — secrets live in chrome.storage.local, NOT in sync.
 *
 * Why: `chrome.storage.sync` replicates across devices while the AES salt
 * lives only in `storage.local`. A ciphertext synced to a second device
 * could never be decrypted there; the old path then injected '' on failure
 * and the NEXT persist wrote '' over the ciphertext — permanently
 * destroying the key on every device. Moving the values to `local` fixes
 * the root cause: the ciphertext never leaves the machine that made it.
 *
 * Contract:
 *  - SAVE: each secret field is written to its own local slot (encrypted
 *    with the local salt) and BLANKED in the sync JSON. Sync carries no
 *    secret material at all (also shrinks the 8 KB/item sync quota).
 *  - LOAD: slot values are injected back as plaintext. A still-encrypted
 *    slot result is injected as-is (ciphertext) so `unreadableSecret()`
 *    can show the re-enter hint instead of lying with ''.
 *  - MIGRATION: a legacy value sitting in the sync blob (older builds
 *    stored ciphertext — or plaintext — inline) is moved to a slot on the
 *    first load and blanked from sync on the first save.
 *  - FAILURE: if the local write fails on save, we fall back to the old
 *    inline-encryption behavior instead of blanking (never destroy the
 *    only copy).
 * ────────────────────────────────────────────────────────────────────────── */

export const SECRET_FIELDS: Array<{
  section: 'translate' | 'ai' | 'ankiMapping' | 'tts' | 'vip';
  field: string;
}> = [
  { section: 'translate', field: 'deeplToken' },
  { section: 'translate', field: 'googleToken' },
  { section: 'translate', field: 'libreTranslateToken' },
  { section: 'ai', field: 'apiKey' },
  { section: 'ankiMapping', field: 'apiKey' },
  { section: 'tts', field: 'elevenLabsApiKey' },
  { section: 'vip', field: 'unsplashAccessKey' },
  { section: 'vip', field: 'pixabayApiKey' },
];

export function secretSlotKey(section: string, field: string): string {
  return `kivara-secret:v1:${section}.${field}`;
}

/**
 * Tombstone written by "Quitar". An EMPTY slot ('') must not be confused
 * with "no slot": legacy builds left ciphertext in the sync blob, and a
 * cleared-but-present slot must win over that legacy value forever —
 * otherwise every load would re-migrate the key the user just deleted.
 */
export const SECRET_CLEARED = '__cleared__';

/**
 * Per-context baseline: slotKey → the plaintext THIS context last loaded or
 * wrote. Used to (a) skip no-op re-encrypts (fresh IV per call used to spam
 * onChanged(local)) and (b) — critically — stop a STALE context from
 * overwriting a key another context just changed: its value still matches
 * its own baseline, so the write is skipped.
 */
const lastPersisted = new Map<string, string>();

/** Test-only: clear the per-context baseline (and the in-memory slot
 * fallback) so cases start from a clean slate. */
export function __resetSecretSlotsForTests(): void {
  lastPersisted.clear();
  memorySlots.clear();
}

export interface SecretSlotIO {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** chrome.storage.local-backed IO; in-memory fallback for tests / no chrome. */
const memorySlots = new Map<string, unknown>();
export const defaultSlotIO: SecretSlotIO = {
  async get(keys) {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const found = await chrome.storage.local.get(keys);
      const out: Record<string, unknown> = {};
      for (const k of keys) out[k] = found[k];
      return out;
    }
    const out: Record<string, unknown> = {};
    for (const k of keys) if (memorySlots.has(k)) out[k] = memorySlots.get(k);
    return out;
  },
  async set(items) {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set(items);
      return;
    }
    for (const [k, v] of Object.entries(items)) memorySlots.set(k, v);
  },
};

async function saveSecrets(
  state: Record<string, Record<string, unknown>> | undefined,
  io: SecretSlotIO,
): Promise<boolean> {
  if (!state) return false;
  const toLocal: Record<string, unknown> = {};
  const written: Array<{ section: string; field: string; plain: string }> = [];
  for (const { section, field } of SECRET_FIELDS) {
    const node = state[section];
    if (!node || typeof node !== 'object') continue;
    const rec = node as Record<string, unknown>;
    const value = rec[field];
    if (typeof value !== 'string') continue;
    const key = secretSlotKey(section, field);
    // DIFF, don't blind-write. Two jobs in one:
    //  • no change in THIS context → skip (no fresh-IV churn in local);
    //  • value equal to our baseline while ANOTHER context updated the slot
    //    (we haven't rehydrated yet) → skip, so a stale context can't
    //    clobber the newer key or resurrect one cleared elsewhere.
    if (lastPersisted.get(key) === value) continue;
    toLocal[key] =
      value === ''
        ? SECRET_CLEARED
        : isEncrypted(value)
          ? value // legacy ciphertext already in sync — move as-is
          : await encryptSecret(value);
    written.push({ section, field, plain: value });
  }
  if (Object.keys(toLocal).length > 0) {
    try {
      await io.set(toLocal); // MUST succeed before we blank sync — never
      // destroy the only copy of a key because local storage hiccuped.
    } catch (err) {
      console.warn('[Kivara secret-store] local slot write failed, falling back to inline encryption', err);
      // Fallback = the OLD behavior: encrypt in place in the sync blob.
      // State stays safe to persist: never plaintext, never blanked.
      for (const { section, field, plain } of written) {
        if (!plain || isEncrypted(plain)) continue;
        const node = state[section];
        if (!node || typeof node !== 'object') continue;
        (node as Record<string, unknown>)[field] = await encryptSecret(plain);
      }
      return false;
    }
    for (const { section, field, plain } of written) {
      lastPersisted.set(secretSlotKey(section, field), plain);
    }
  }
  // Sync carries zero secret material regardless — blank them all.
  for (const { section, field } of SECRET_FIELDS) {
    const node = state[section];
    if (!node || typeof node !== 'object') continue;
    const rec = node as Record<string, unknown>;
    if (typeof rec[field] === 'string') rec[field] = '';
  }
  return true;
}

async function loadSecrets(
  state: Record<string, Record<string, unknown>> | undefined,
  io: SecretSlotIO,
): Promise<void> {
  if (!state) return;
  const keys = SECRET_FIELDS.map((f) => secretSlotKey(f.section, f.field));
  let local: Record<string, unknown> = {};
  try {
    local = await io.get(keys);
  } catch (err) {
    console.warn('[Kivara secret-store] local slot read failed', err);
  }
  const migrate: Record<string, unknown> = {};
  for (const { section, field } of SECRET_FIELDS) {
    const node = state[section];
    if (!node || typeof node !== 'object') continue;
    const rec = node as Record<string, unknown>;
    const key = secretSlotKey(section, field);
    const slotVal = local[key];
    const legacy = rec[field];
    // SLOT PRESENT (even '' or the tombstone) → it is authoritative and the
    // legacy sync value is NEVER consulted — that's what makes "Quitar"
    // survive a stale ciphertext still sitting in an old sync blob.
    if (typeof slotVal === 'string') {
      const injected =
        slotVal === '' || slotVal === SECRET_CLEARED
          ? ''
          : await decryptSecret(slotVal); // preserves ciphertext on failure
      rec[field] = injected;
      lastPersisted.set(key, injected);
      continue;
    }
    if (typeof legacy === 'string' && legacy !== '') {
      // Legacy value still in the sync blob (older build): decrypt it for
      // this session AND migrate it to a local slot. If the salt changed
      // (fresh device), decryptSecret hands back the ciphertext — we still
      // migrate it so the next save blanks it from sync.
      const plain = await decryptSecret(legacy);
      rec[field] = plain;
      migrate[key] = isEncrypted(plain) ? legacy : await encryptSecret(plain);
      lastPersisted.set(key, plain);
      continue;
    }
    rec[field] = '';
    lastPersisted.set(key, ''); // baseline: nothing stored → an empty save
    // below is a no-op, so a stale context can't clear another's fresh key
  }
  if (Object.keys(migrate).length > 0) {
    try {
      await io.set(migrate); // best-effort — sync copy is blanked on save
    } catch (err) {
      console.warn('[Kivara secret-store] migration write failed', err);
    }
  }
}

/** SAVE path: move secrets out of the sync JSON into local slots.
 * Returns false when the local write failed — callers must then fall back
 * to inline encryption instead of blanking the sync blob. */
export async function pushSecretsToLocal(
  state: Record<string, Record<string, unknown>> | undefined,
  io: SecretSlotIO = defaultSlotIO,
): Promise<boolean> {
  return saveSecrets(state, io);
}

/** LOAD path: inject local-slot secrets into the store JSON (+ migrate
 * legacy inline values on their way out of sync). */
export async function pullSecretsFromLocal(
  state: Record<string, Record<string, unknown>> | undefined,
  io: SecretSlotIO = defaultSlotIO,
): Promise<void> {
  await loadSecrets(state, io);
}

/** Background readers (SW / offscreen) call this instead of decrypting the
 * sync blob, which no longer carries secret material.
 * Returns plaintext, '' when missing, or '' when the slot ciphertext is
 * unreadable on this device (never hands `enc:v1:` to a provider). */
export async function resolveSecret(
  section: string,
  field: string,
  legacyBlobValue?: string,
): Promise<string> {
  const key = secretSlotKey(section, field);
  try {
    const found = await (typeof chrome !== 'undefined' && chrome.storage?.local
      ? chrome.storage.local.get(key)
      : defaultSlotIO.get([key]));
    const slot = found[key];
    // SLOT PRESENT (even '' or the tombstone) is authoritative — never fall
    // back to the legacy sync value, or a cleared key would be re-migrated
    // from stale ciphertext.
    if (typeof slot === 'string') {
      if (slot === '' || slot === SECRET_CLEARED) return '';
      const plain = await decryptSecret(slot);
      return isEncrypted(plain) ? '' : plain;
    }
  } catch {
    // fall through to legacy blob value
  }
  // No slot at all (undefined) → consult the legacy sync value.
  if (legacyBlobValue) {
    const plain = await decryptSecret(legacyBlobValue);
    return isEncrypted(plain) ? '' : plain;
  }
  return '';
}
