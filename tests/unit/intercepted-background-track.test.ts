/**
 * RED TEST — round 10 (B1): a background-published track (Netflix manifest,
 * DASH target, YouTube tlang) is an AUXILIARY translation surface. The
 * adapter must NEVER adopt it as the primary caption — not even when no
 * source track exists yet (subtitles OFF / NONE track): the overlay would
 * otherwise show the native text as the "source" line the moment Kivara
 * turns on, and the auto-subtitle-track watcher would treat the publish as
 * a player change.
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
  getTrackByLanguage: (lang: string) => {
    const key = lang.trim().toLowerCase().split(/[-_]/)[0];
    return bus.tracks.get(key) ?? null;
  },
  getLastTrack: () => bus.last,
  getKnownLanguages: () => Array.from(bus.tracks.keys()),
  onTrack: (listener: (t: InterceptedTrack) => void) => {
    bus.listeners.add(listener);
    return () => {
      bus.listeners.delete(listener);
    };
  },
}));

import { createNetflixAdapter } from '../../src/content/platform-adapters/netflix';
import { useKivaraStore } from '../../src/shared/use-kivara-store';

const ES_CUES: RawCue[] = [
  { start: 0, end: 4000, text: 'Hola, esta es la pista nativa.' },
  { start: 4000, end: 8000, text: 'La segunda línea.' },
];

function esBackgroundTrack(): InterceptedTrack {
  return {
    url: 'https://cdn.example/es.ttml',
    language: 'es',
    cues: ES_CUES,
    background: true,
  };
}

describe('B1: a background track is never the primary caption', () => {
  beforeEach(() => {
    useKivaraStore.setState((state) => ({
      translate: { ...state.translate, sourceLang: 'en' },
    }));
  });

  afterEach(() => {
    bus.tracks.clear();
    bus.last = null;
    bus.listeners.clear();
    document.body.innerHTML = '';
    useKivaraStore.setState((state) => ({
      translate: { ...state.translate, sourceLang: 'en' },
    }));
  });

  it('with NO source track, the ES background track is not adopted', () => {
    const adapter = createNetflixAdapter();
    try {
      const video = document.createElement('video');
      document.body.appendChild(video);
      video.currentTime = 1.5;
      bus.listeners.forEach((l) => l(esBackgroundTrack()));
      // The adapter has no source track: no cue may come from the ES track.
      expect(adapter.getActiveCue()).toBeNull();
      expect(adapter.getTrackCues?.() ?? []).toHaveLength(0);
    } finally {
      adapter.destroy?.();
    }
  });

  it('with a live EN source track, the ES background track does not displace it', () => {
    const adapter = createNetflixAdapter();
    try {
      const video = document.createElement('video');
      document.body.appendChild(video);
      video.currentTime = 1.5;
      const en: InterceptedTrack = {
        url: 'https://cdn.example/en.vtt',
        language: 'en',
        cues: [{ start: 0, end: 4000, text: 'Hello, this is the English track.' }],
      };
      bus.listeners.forEach((l) => l(en));
      expect(adapter.getActiveCue()?.text).toContain('English track');
      bus.listeners.forEach((l) => l(esBackgroundTrack()));
      expect(adapter.getActiveCue()?.text).toContain('English track');
    } finally {
      adapter.destroy?.();
    }
  });
});
