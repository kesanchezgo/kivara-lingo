/**
 * Synchronous SHA-1 over a string, hex-encoded.
 *
 * The explain cache key is `sha1(provider|model|lang|uiLang|nativeLang|prev|line|next)`
 * (docs/REDESIGN-V2.md §10) and it is computed inside the service worker as
 * well as in unit tests. `crypto.subtle.digest` is async and absent in some
 * test hosts, so the digest is implemented here: small, deterministic, and
 * identical in every context.
 *
 * SHA-1 is used as a dedup key, never as a security primitive.
 */

/** 32-bit left rotate. */
function rotl(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) | 0;
}

/**
 * SHA-1 of the UTF-8 bytes of `input`, as 40 lowercase hex characters.
 */
export function sha1Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const withMarker = bytes.length + 1;
  // Zero padding until the last 8 bytes hold the 64-bit length.
  const zeros = (56 - (withMarker % 64) + 64) % 64;
  const total = withMarker + zeros + 8;

  const message = new Uint8Array(total);
  message.set(bytes);
  message[bytes.length] = 0x80;
  const view = new DataView(message.buffer);
  view.setUint32(total - 4, bitLength >>> 0);
  view.setUint32(total - 8, Math.floor(bitLength / 0x1_0000_0000));

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const words = new Int32Array(80);

  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i += 1) words[i] = view.getInt32(offset + i * 4);
    for (let i = 16; i < 80; i += 1) {
      words[i] = rotl(words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16], 1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i += 1) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + words[i]) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  return [h0, h1, h2, h3, h4]
    .map((word) => (word >>> 0).toString(16).padStart(8, '0'))
    .join('');
}
