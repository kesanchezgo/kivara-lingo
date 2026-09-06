import { describe, expect, it } from 'vitest';
import {
  computeCueWindow,
  shouldFallbackToTts,
  waitForCueTailMs,
} from '../../src/background/cue-window';

/**
 * `computeCueWindow` maps a subtitle cue's video-time window onto the rolling
 * recorder's wall-clock timeline. Every streaming platform feeds the same three
 * numbers (cue start, cue end, video currentTime at save), so proving the math
 * here proves per-platform correctness — Netflix, Prime, HBO Max, Disney+,
 * YouTube and generic HTML5 differ only in how they *source* those numbers.
 */

describe('computeCueWindow', () => {
  it('maps a fully-elapsed cue to a past wall-clock window', () => {
    // User saved at video 10_000 ms, right now is wall-clock 1_000_000.
    // Cue ran [8000, 9500] in video-time — 500..2000 ms ago.
    const w = computeCueWindow({
      cueStart: 8000,
      cueEnd: 9500,
      videoTimeAtSave: 10_000,
      requestedAt: 1_000_000,
      preRollMs: 0,
      postRollMs: 0,
    });
    // cueStartAgo = 2000 -> start = 998_000; cueEndAgo = 500 -> end = 999_500.
    expect(w.start).toBe(998_000);
    expect(w.end).toBe(999_500);
    expect(w.cueEndInFuture).toBe(-500); // ended 500 ms ago
    // Window duration equals the cue duration.
    expect(w.end - w.start).toBe(1500);
  });

  it('applies pre-roll and post-roll padding symmetrically to the edges', () => {
    const w = computeCueWindow({
      cueStart: 8000,
      cueEnd: 9500,
      videoTimeAtSave: 10_000,
      requestedAt: 1_000_000,
      preRollMs: 120,
      postRollMs: 180,
    });
    expect(w.start).toBe(998_000 - 120);
    expect(w.end).toBe(999_500 + 180);
    expect(w.end - w.start).toBe(1500 + 120 + 180);
  });

  it('flags a still-playing cue whose tail is in the future', () => {
    // Saved mid-cue: video at 9000, cue ends at 9500 -> 500 ms still to come.
    const w = computeCueWindow({
      cueStart: 8000,
      cueEnd: 9500,
      videoTimeAtSave: 9000,
      requestedAt: 1_000_000,
      preRollMs: 0,
      postRollMs: 0,
    });
    expect(w.cueEndInFuture).toBe(500);
  });

  it('clamps negative padding to zero', () => {
    const w = computeCueWindow({
      cueStart: 1000,
      cueEnd: 2000,
      videoTimeAtSave: 2000,
      requestedAt: 500_000,
      preRollMs: -50,
      postRollMs: -50,
    });
    // Padding treated as 0: window is exactly [498_000, 500_000].
    expect(w.start).toBe(499_000);
    expect(w.end).toBe(500_000);
  });

  it.each([
    ['netflix', 12_340, 14_120, 15_000],
    ['prime', 3_100, 5_050, 6_000],
    ['hbo', 0, 1_800, 2_400],
    ['disney', 88_200, 90_000, 91_500],
    ['youtube', 500, 2_750, 3_000],
    ['generic', 45_000, 47_200, 48_000],
  ])(
    'produces a window matching the cue duration for %s',
    (_platform, cueStart, cueEnd, videoTimeAtSave) => {
      const requestedAt = 5_000_000;
      const preRollMs = 120;
      const postRollMs = 180;
      const w = computeCueWindow({
        cueStart,
        cueEnd,
        videoTimeAtSave,
        requestedAt,
        preRollMs,
        postRollMs,
      });
      // Window duration is always cue duration + both paddings, regardless of
      // platform-specific timestamps.
      expect(w.end - w.start).toBe(cueEnd - cueStart + preRollMs + postRollMs);
      // A cue that already finished is never flagged as future.
      expect(w.cueEndInFuture).toBe(cueEnd - videoTimeAtSave);
      expect(w.cueEndInFuture).toBeLessThanOrEqual(0);
    },
  );
});

describe('shouldFallbackToTts', () => {
  it('falls back when paused with the tail still in the future', () => {
    expect(shouldFallbackToTts(500, true)).toBe(true);
  });

  it('does not fall back when playing (tail can still arrive)', () => {
    expect(shouldFallbackToTts(500, false)).toBe(false);
  });

  it('does not fall back when paused but the cue already ended', () => {
    expect(shouldFallbackToTts(-200, true)).toBe(false);
  });

  it('ignores a tiny future tail under the threshold', () => {
    expect(shouldFallbackToTts(80, true)).toBe(false);
  });
});

describe('waitForCueTailMs', () => {
  it('returns 0 when the cue has already ended', () => {
    expect(waitForCueTailMs(-100, 180)).toBe(0);
  });

  it('waits for tail + post-roll + a small guard', () => {
    expect(waitForCueTailMs(500, 180)).toBe(500 + 180 + 150);
  });

  it('clamps the wait to the max so a bad anchor cannot hang the save', () => {
    expect(waitForCueTailMs(60_000, 180)).toBe(8_000);
  });
});
