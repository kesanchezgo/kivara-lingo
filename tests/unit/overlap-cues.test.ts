/**
 * Overlapping cues.
 *
 * Verified with player-netflix.html and a TTML carrying A 0–3 s and B 2.3–5 s:
 * at 2.6 s Kivara showed only A, and B appeared at 3.4 s — when A ended. That
 * late arrival is the probable source of the 691–750 ms drifts the sync test
 * measured.
 *
 * The fix: every cue active at the playhead is combined (texts in start order,
 * newline separated, start = the earliest) and re-emitted the moment the SET
 * changes — so B shows at 2.3 s, not at A's end.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { InterceptedTrack } from '../../src/content/platform-adapters/intercepted-bus';
import type { RawCue } from '../../src/content/platform-adapters/parsers';

const bus = vi.hoisted(() => ({
  tracks: new Map<string, InterceptedTrack>(),
  last: null as InterceptedTrack | null,
  listeners: new Set<(t: InterceptedTrack) => void>(),
}));

vi.mock('../../src/content/platform-adapters/intercepted-bus', () => ({
  getTrackByLanguage: (lang: string) => bus.tracks.get(lang.trim().toLowerCase().split(/[-_]/)[0]) ?? null,
  getLastTrack: () => bus.last,
  getKnownLanguages: () => Array.from(bus.tracks.keys()),
  onTrack: (listener: (t: InterceptedTrack) => void) => {
    bus.listeners.add(listener);
    return () => { bus.listeners.delete(listener); };
  },
}));

import { findActiveCues } from '../../src/content/platform-adapters/tracks';
import { createNetflixAdapter } from '../../src/content/platform-adapters/netflix';

const CUES: RawCue[] = [
  { start: 0, end: 3000, text: 'A' },
  { start: 2300, end: 5000, text: 'B' },
];

function overlapTrack(): InterceptedTrack {
  return { url: 'https://example.test/overlap.ttml', language: 'en', cues: CUES };
}

describe('findActiveCues', () => {
  it('returns every cue on screen, in start order', () => {
    expect(findActiveCues(CUES, 2600).map((c) => c.text)).toEqual(['A', 'B']);
    expect(findActiveCues(CUES, 3400).map((c) => c.text)).toEqual(['B']);
    expect(findActiveCues(CUES, 100).map((c) => c.text)).toEqual(['A']);
    expect(findActiveCues(CUES, 9000)).toEqual([]);
  });
});

describe('the interrupted adapter combines overlapping cues', () => {
  beforeEach(() => {
    bus.tracks.clear();
    bus.last = null;
    bus.listeners.clear();
    document.body.innerHTML = '';
  });
  afterEach(() => {
    bus.tracks.clear();
    bus.listeners.clear();
    document.body.innerHTML = '';
  });

  it('shows both lines while they overlap, with the earliest start', () => {
    const adapter = createNetflixAdapter();
    try {
      const video = document.createElement('video');
      document.body.appendChild(video);
      video.currentTime = 2.6;
      bus.listeners.forEach((l) => l(overlapTrack()));
      const cue = adapter.getActiveCue();
      expect(cue?.text).toBe('A\nB');
      expect(cue?.start).toBe(0);
      expect(cue?.end).toBe(5000);
    } finally {
      adapter.destroy?.();
    }
  });

  it('re-emits when the second line enters, not when the first ends', async () => {
    const adapter = createNetflixAdapter();
    const seen: Array<{ text: string; t: number }> = [];
    adapter.onCueChange((cues) => {
      const video = document.querySelector('video');
      seen.push({ text: cues[0]?.text ?? '', t: video ? video.currentTime : -1 });
    });
    try {
      const video = document.createElement('video');
      document.body.appendChild(video);
      // happy-dom does not track currentTime on a detached element: back it
      // with a plain variable so the poll sees what the test sets.
      let clock = 2.0;
      Object.defineProperty(video, 'currentTime', { get: () => clock, set: (v: number) => { clock = v; }, configurable: true });
      // The adapter polls every 50 ms; drive the clock and let the poll run.
      video.currentTime = 2.0;
      bus.listeners.forEach((l) => l(overlapTrack()));
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          const before = seen.length;
          video.currentTime = 2.4;
          setTimeout(() => {
            const afterEnter = seen.slice(before);
            expect(afterEnter[0]?.text).toBe('A\nB');
            expect(afterEnter[0]?.t).toBeGreaterThanOrEqual(2.3);
            video.currentTime = 3.2;
            setTimeout(() => {
              expect(adapter.getActiveCue()?.text).toBe('B');
              resolve();
            }, 120);
          }, 120);
        }, 120);
      });
    } finally {
      adapter.destroy?.();
    }
  });
});
