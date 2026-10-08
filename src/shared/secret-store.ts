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
  if (cachedKey) return cachedKey;

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
 */
export function maskSecret(value: string | undefined | null): string {
  if (!value) return '';
  if (isEncrypted(value)) return '••••••••';
  // Plaintext leftover from older builds or from a manual import.
  return value.length > 6 ? value.slice(0, 2) + '••••••••' : '••••••';
}
