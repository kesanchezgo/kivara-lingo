import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret, isEncrypted, maskSecret, unreadableSecret } from '../../src/shared/secret-store';

describe('secret-store', () => {
  it('isEncrypted detects encrypted values', () => {
    expect(isEncrypted('enc:v1:abc123')).toBe(true);
    expect(isEncrypted('sk-abc123')).toBe(false);
    expect(isEncrypted('')).toBe(false);
    expect(isEncrypted(null)).toBe(false);
  });

  it('encrypts and decrypts a secret round-trip', async () => {
    const original = 'sk-my-super-secret-api-key-12345';
    const encrypted = await encryptSecret(original);
    expect(encrypted).not.toBe(original);
    expect(isEncrypted(encrypted)).toBe(true);

    const decrypted = await decryptSecret(encrypted);
    expect(decrypted).toBe(original);
  });

  it('passes empty string through unchanged', async () => {
    const result = await encryptSecret('');
    expect(result).toBe('');
  });

  it('is idempotent — re-encrypting an encrypted value returns same', async () => {
    const original = 'test-key-123';
    const first = await encryptSecret(original);
    const second = await encryptSecret(first);
    expect(second).toBe(first); // already encrypted, returned as-is
  });

  it('decryptSecret passes plaintext through unchanged', async () => {
    const plain = 'sk-plaintext-legacy';
    const result = await decryptSecret(plain);
    expect(result).toBe(plain);
  });

  it('maskSecret blanks still-encrypted values for controlled inputs', () => {
    // Controlled <input value={...}> must never display the enc:v1: blob —
    // blank it and let the UI show the re-enter hint (unreadableSecret).
    expect(maskSecret('enc:v1:abc123')).toBe('');
    expect(unreadableSecret('enc:v1:abc123')).toBe(true);
    expect(unreadableSecret('sk-plain')).toBe(false);
    expect(unreadableSecret('')).toBe(false);
  });

  it('maskSecret masks plaintext partially', () => {
    const result = maskSecret('sk-12345678');
    expect(result).toContain('sk');
    expect(result).toContain('••••');
  });

  it('maskSecret returns empty for empty input', () => {
    expect(maskSecret('')).toBe('');
    expect(maskSecret(null)).toBe('');
  });

  it('decrypt failure preserves ciphertext instead of returning empty', async () => {
    // Regression: decryptSecret used to return '' on failure (wrong salt
    // after reinstall / cross-device salt mismatch). The store then wrote
    // '' back over the ciphertext on the next persist tick, permanently
    // deleting the user's key. Now the ciphertext survives.
    const garbage = 'enc:v1:' + btoa('not-a-real-iv+cipher-blob-0123456789');
    const result = await decryptSecret(garbage);
    expect(result).toBe(garbage);
    expect(isEncrypted(result)).toBe(true);
  });

  it('short blobs are preserved, not blanked', async () => {
    const short = 'enc:v1:AAAA';
    expect(await decryptSecret(short)).toBe(short);
  });
});
