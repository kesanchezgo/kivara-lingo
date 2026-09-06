import { describe, expect, it } from 'vitest';
import { scoreFrameQuality } from '../../src/content/capture/frame';

/**
 * `scoreFrameQuality` is the pure gate behind `captureBestFrame`. It decides
 * whether a captured video frame is worth shipping to the card or whether the
 * orchestrator should fall back to a web image. These cases cover the failure
 * modes seen when saving from a paused stream: fade-to-black, blown-out white,
 * a flat title card, letterbox-heavy frames, and a normal scene.
 */

/** Build an RGBA buffer of `n` pixels, each with the given channels. */
function solid(n: number, r: number, g: number, b: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i += 1) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return data;
}

/** Build an RGBA buffer alternating between two colours — high variance. */
function checker(n: number, a: number, b: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i += 1) {
    const v = i % 2 === 0 ? a : b;
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return data;
}

describe('frame quality scoring', () => {
  it('rejects a fade-to-black frame', () => {
    const q = scoreFrameQuality(solid(1024, 2, 2, 2));
    expect(q.usable).toBe(false);
    expect(q.luma).toBeLessThan(0.05);
    expect(q.darkRatio).toBeGreaterThan(0.9);
  });

  it('rejects a blown-out white frame', () => {
    const q = scoreFrameQuality(solid(1024, 255, 255, 255));
    expect(q.usable).toBe(false);
    expect(q.luma).toBeGreaterThan(0.98);
  });

  it('rejects a flat solid-colour title card', () => {
    const q = scoreFrameQuality(solid(1024, 120, 120, 120));
    expect(q.usable).toBe(false);
    expect(q.variance).toBeLessThan(0.012);
  });

  it('accepts a normal scene with real detail', () => {
    const q = scoreFrameQuality(checker(1024, 40, 200));
    expect(q.usable).toBe(true);
    expect(q.variance).toBeGreaterThan(0.012);
  });

  it('keeps a dim but detailed night scene', () => {
    // Low mean luminance but genuine contrast — must survive the gate.
    const q = scoreFrameQuality(checker(1024, 8, 90));
    expect(q.usable).toBe(true);
  });

  it('ranks a detailed frame above a flat one', () => {
    const detailed = scoreFrameQuality(checker(1024, 40, 200));
    const flat = scoreFrameQuality(solid(1024, 120, 120, 120));
    expect(detailed.score).toBeGreaterThan(flat.score);
  });

  it('ranks any usable frame above any unusable one', () => {
    const usable = scoreFrameQuality(checker(1024, 30, 120));
    const black = scoreFrameQuality(solid(1024, 1, 1, 1));
    expect(usable.score).toBeGreaterThan(black.score);
    expect(usable.usable).toBe(true);
    expect(black.usable).toBe(false);
  });

  it('handles an empty buffer without throwing', () => {
    const q = scoreFrameQuality(new Uint8ClampedArray(0));
    expect(q.usable).toBe(false);
    expect(q.score).toBe(0);
  });
});
