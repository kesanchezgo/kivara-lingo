/**
 * Polyfill for `@breezystack/lamejs`'s default export: the package is ESM
 * but ships no types, so we declare the surface we use (`Mp3Encoder`).
 *
 * Reference: https://github.com/zhuker/lamejs#api (API-compatible fork)
 */
declare module '@breezystack/lamejs' {
  /**
   * Streaming MP3 encoder. Accepts Int16Array PCM blocks of size 1152
   * (the LAME frame size) and emits Int8Array MP3 chunks.
   */
  export class Mp3Encoder {
    constructor(channels: number, sampleRate: number, bitrateKbps: number);
    encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
    flush(): Int8Array;
  }

  const _default: { Mp3Encoder: typeof Mp3Encoder };
  export default _default;
}
