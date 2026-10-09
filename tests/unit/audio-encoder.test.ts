/**
 * MP3 encoder smoke test.
 *
 * The audit found clips were saving as WAV even though MP3 was requested:
 * `encodeMp3Mono` awaited `import('lamejs')`, and a dynamic import splits the
 * CJS module into its own chunk where its UMD globals never initialise — so
 * Mp3Encoder was undefined, every call threw, and every caller fell back to
 * WAV (roughly ten times the bytes). This test fails if that ever comes back,
 * which a UI check cannot see (the card just has a bigger file).
 */
import { describe, it, expect } from 'vitest';
import { encodeMp3Mono } from '../../src/offscreen/audio-encoder';
import { mediaExtFor, fetchMediaWithLimits } from '../../src/shared/net-guard';

describe('encodeMp3Mono', () => {
  it('encodes one second of PCM into a real MP3 frame', async () => {
    const sampleRate = 16_000;
    const samples = new Float32Array(sampleRate);
    // A 440 Hz tone: enough content that LAME emits a full frame.
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5;
    }

    const blob = await encodeMp3Mono(samples, sampleRate, 64);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const head = Array.from(bytes.subarray(0, 3));

    expect(blob.type).toBe('audio/mpeg');
    expect(bytes.byteLength).toBeGreaterThan(400);
    // Either an ID3 tag or the 11-bit MPEG audio sync word — both are valid
    // starts; anything else (e.g. a RIFF/WAV header `52 49 46 46`) is the
    // silent WAV fallback this test exists to catch.
    const isId3 = head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33;
    const isFrameSync = head[0] === 0xff && (head[1] & 0xe0) === 0xe0;
    expect(isId3 || isFrameSync).toBe(true);
    expect(head).not.toEqual([0x52, 0x49, 0x46]); // not "RIF"
  });

  it('is dramatically smaller than the equivalent WAV', async () => {
    const sampleRate = 16_000;
    const samples = new Float32Array(sampleRate);
    for (let i = 0; i < samples.length; i += 1) samples[i] = i % 2 === 0 ? 0.4 : -0.4;

    const mp3 = (await encodeMp3Mono(samples, sampleRate, 64)).size;
    const wavBytes = 44 + samples.length * 4; // 16-bit mono
    expect(mp3).toBeLessThan(wavBytes / 2);
  });
});

describe('mediaExtFor', () => {
  it('trusts the content-type first', () => {
    expect(mediaExtFor('image/png', 'https://x/y.jpg')).toBe('png');
    expect(mediaExtFor('audio/mpeg', 'https://x/y.ogg')).toBe('mp3');
  });

  it('falls back to the URL when the type is useless', () => {
    // The exact bug: a Wikimedia `.ogg` file answered as octet-stream used to
    // be stored in Anki as `…​.mp3`, which mpv then refused to play.
    expect(mediaExtFor('application/octet-stream', 'https://upload.wikimedia.org/a/b.ogg')).toBe('ogg');
    expect(mediaExtFor('', 'https://x/y.webp')).toBe('webp');
  });

  it('keeps a neutral fallback when neither says anything', () => {
    expect(mediaExtFor('', 'https://x/y?q=1', 'jpg')).toBe('jpg');
  });
});

describe('fetchMediaWithLimits', () => {
  it('reports the content-type it actually got', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    spy.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    );
    const out = await fetchMediaWithLimits('https://cdn.example.com/a.png', {
      timeoutMs: 1000,
      maxBytes: 1024,
    });
    expect(out.contentType).toBe('image/png');
    expect(Array.from(out.bytes)).toEqual([1, 2, 3]);
  });

  it('refuses a private destination', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(
      fetchMediaWithLimits('http://10.1.2.3/x.png', { timeoutMs: 1000, maxBytes: 1024 }),
    ).rejects.toThrow();
  });
});
