import { describe, expect, it } from 'vitest';
import {
  resampleLinear,
  buildPcmClip,
  bufferBounds,
  type PcmChunk,
} from '../../src/offscreen/pcm-timeline';

/**
 * These cover the load-bearing math behind "perfect phrase audio": that a clip
 * assembled from timestamped PCM chunks has the exact requested duration and
 * places every chunk at its true temporal offset, even when the capture tab
 * was throttled and dropped ScriptProcessor callbacks (gaps), or the device
 * sample rate drifted mid-stream. The logic is platform-agnostic — Netflix,
 * Prime, HBO, Disney+, YouTube all feed the same chunk shape.
 */

const TARGET = 16_000;

/** A chunk of `durationMs` filled with a constant sample value, at `rate`. */
function chunk(
  recordedAt: number,
  durationMs: number,
  value: number,
  rate = TARGET,
): PcmChunk {
  const n = Math.round((durationMs / 1000) * rate);
  const samples = new Float32Array(n).fill(value);
  return { samples, recordedAt, durationMs, sampleRate: rate };
}

describe('resampleLinear', () => {
  it('returns the input unchanged when rates match', () => {
    const input = new Float32Array([0, 0.5, 1, 0.5]);
    expect(resampleLinear(input, TARGET, TARGET)).toBe(input);
  });

  it('downsamples to roughly half the length at half the rate', () => {
    const input = new Float32Array(100).fill(0.3);
    const out = resampleLinear(input, 32_000, 16_000);
    expect(out.length).toBe(50);
    // Constant signal stays constant through linear interpolation.
    expect(out[10]).toBeCloseTo(0.3, 5);
  });

  it('upsamples to roughly double the length at double the rate', () => {
    const input = new Float32Array(50).fill(-0.2);
    const out = resampleLinear(input, 16_000, 32_000);
    expect(out.length).toBe(100);
    expect(out[25]).toBeCloseTo(-0.2, 5);
  });

  it('linearly interpolates between two samples', () => {
    const input = new Float32Array([0, 1]);
    const out = resampleLinear(input, 1, 4); // 2 -> ~8 samples
    // out[i] samples input at pos = i * (1/4). At i=2, pos=0.5 -> exactly
    // halfway between 0 and 1.
    expect(out[2]).toBeCloseTo(0.5, 5);
    expect(out[1]).toBeCloseTo(0.25, 5);
    expect(out[3]).toBeCloseTo(0.75, 5);
  });
});

describe('buildPcmClip', () => {
  it('returns null with no chunks', () => {
    expect(buildPcmClip([], 0, 1000, TARGET)).toBeNull();
  });

  it('returns null for a non-positive window', () => {
    expect(buildPcmClip([chunk(0, 250, 0.5)], 500, 500, TARGET)).toBeNull();
  });

  it('produces a clip whose length matches the requested window exactly', () => {
    // Two contiguous 250 ms chunks covering [1000, 1500).
    const chunks = [chunk(1000, 250, 0.4), chunk(1250, 250, 0.6)];
    const clip = buildPcmClip(chunks, 1000, 1500, TARGET);
    expect(clip).not.toBeNull();
    expect(clip!.sampleRate).toBe(TARGET);
    // 500 ms at 16 kHz = 8000 samples.
    expect(clip!.samples.length).toBe(8000);
  });

  it('preserves a dropped-callback gap as silence instead of compressing time', () => {
    // Chunk A at [0,250), then a 500 ms GAP (throttled tab dropped callbacks),
    // then chunk B at [750,1000). Window is [0,1000) = 1000 ms.
    const chunks = [chunk(0, 250, 0.8), chunk(750, 250, 0.9)];
    const clip = buildPcmClip(chunks, 0, 1000, TARGET);
    expect(clip).not.toBeNull();
    // Full 1000 ms window is allocated regardless of the gap.
    expect(clip!.samples.length).toBe(16_000);

    const s = clip!.samples;
    // First chunk audio sits at the start.
    expect(s[100]).toBeCloseTo(0.8, 5);
    // The gap region [250,750) ms -> samples [4000,12000) must be silence,
    // proving audio was NOT slid back-to-back (which would have compressed it).
    expect(s[8000]).toBe(0); // 500 ms mark, dead center of the gap
    // Second chunk audio lands at its true offset (~750 ms -> sample 12000).
    expect(s[12_100]).toBeCloseTo(0.9, 5);
  });

  it('anchors chunks at their true offset within the window', () => {
    // Single chunk starting 100 ms into a 400 ms window [1000,1400).
    const chunks = [chunk(1100, 200, 0.5)];
    const clip = buildPcmClip(chunks, 1000, 1400, TARGET);
    expect(clip).not.toBeNull();
    const s = clip!.samples;
    // Leading 100 ms (samples 0..1600) is silence.
    expect(s[0]).toBe(0);
    expect(s[1500]).toBe(0);
    // Audio begins near the 100 ms mark (sample ~1600).
    expect(s[1700]).toBeCloseTo(0.5, 5);
    // Trailing silence after the chunk ends (300 ms -> sample 4800).
    expect(s[5000]).toBe(0);
  });

  it('clips a chunk that overhangs the window boundaries', () => {
    // Chunk spans [900,1600) but window is [1000,1500).
    const chunks = [chunk(900, 700, 0.7)];
    const clip = buildPcmClip(chunks, 1000, 1500, TARGET);
    expect(clip).not.toBeNull();
    expect(clip!.samples.length).toBe(8000); // 500 ms
    // Whole visible window is filled by the overhanging chunk.
    expect(clip!.samples[10]).toBeCloseTo(0.7, 5);
    expect(clip!.samples[7900]).toBeCloseTo(0.7, 5);
  });

  it('isolates a mid-stream sample-rate change per chunk', () => {
    // Chunk A at 48 kHz, chunk B at 44.1 kHz — both resampled to TARGET
    // independently and placed on the timeline without corruption.
    const chunks = [
      chunk(0, 250, 0.3, 48_000),
      chunk(250, 250, 0.6, 44_100),
    ];
    const clip = buildPcmClip(chunks, 0, 500, TARGET);
    expect(clip).not.toBeNull();
    expect(clip!.samples.length).toBe(8000);
    expect(clip!.samples[100]).toBeCloseTo(0.3, 4);
    expect(clip!.samples[4100]).toBeCloseTo(0.6, 4);
  });

  it('returns null when no chunk overlaps the window', () => {
    const chunks = [chunk(0, 250, 0.5)];
    expect(buildPcmClip(chunks, 5000, 6000, TARGET)).toBeNull();
  });
});

describe('bufferBounds', () => {
  it('returns null for empty buffers', () => {
    expect(bufferBounds([], [])).toBeNull();
  });

  it('folds min-start / max-end across multiple buffers', () => {
    const a = [{ recordedAt: 1000, durationMs: 250 }];
    const b = [
      { recordedAt: 500, durationMs: 250 },
      { recordedAt: 2000, durationMs: 250 },
    ];
    const bounds = bufferBounds(a, b);
    expect(bounds).toEqual({ minStart: 500, maxEnd: 2250 });
  });
});
