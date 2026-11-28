/**
 * PR #172 — the track the user picked BY HAND in Kivara's own menu.
 *
 * Adopting only the learning language is right for the automatic path and wrong
 * for a human decision: choosing "Español" in our menu sent the command to the
 * player, and the adoption loop then threw the incoming track away because an
 * English one was already active — the menu looked like it changed nothing.
 * `markManualSubtitleChoice()` flags the next incoming track as hand-picked, and
 * that one is adopted whatever its language. The flag is spent on the first
 * track it honours, so the automatic rule comes back immediately after.
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

const cues = (text: string): RawCue[] => [
  { start: 0, end: 4000, text },
  { start: 4000, end: 8000, text: `${text} (2)` },
];

const trackIn = (lang: string, text: string): InterceptedTrack => ({
  url: `https://cdn.example/${lang}.ttml`,
  language: lang,
  cues: cues(text),
});

/** The fixture's screen: an English source track, then a foreign one. */
function setup() {
  const video = document.createElement('video');
  document.body.appendChild(video);
  video.currentTime = 1.5;
  const adapter = createNetflixAdapter();
  bus.listeners.forEach((listener) => listener(trackIn('en', 'Hello, this is the English track.')));
  return { adapter, video };
}

describe('PR #172: a hand-picked track is adopted even in another language', () => {
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
  });

  it('replaces the active English caption with the track the user chose', () => {
    const { adapter } = setup();
    try {
      expect(adapter.getActiveCue()?.text).toContain('English track');

      adapter.markManualSubtitleChoice?.();
      bus.listeners.forEach((listener) => listener(trackIn('es', 'Hola, esta es la pista elegida.')));

      expect(adapter.getActiveCue()?.text, 'the menu choice wins over the language rule').toContain('elegida');
      expect(adapter.getTrackCues?.().map((cue) => cue.text).join(' '), 'and the rail follows it').toContain('elegida');
    } finally {
      adapter.destroy?.();
    }
  });

  it('spends the marker: the next foreign track does not displace the chosen one', () => {
    const { adapter } = setup();
    try {
      adapter.markManualSubtitleChoice?.();
      bus.listeners.forEach((listener) => listener(trackIn('es', 'Hola, esta es la pista elegida.')));
      // A third language arrives, and nobody asked for it: the automatic rule
      // applies again and the hand-picked caption stays on screen.
      bus.listeners.forEach((listener) => listener(trackIn('fr', 'Bonjour, piste francaise.')));
      expect(adapter.getActiveCue()?.text).toContain('elegida');
    } finally {
      adapter.destroy?.();
    }
  });

  it('without the marker, a foreign track never displaces the active caption', () => {
    const { adapter } = setup();
    try {
      bus.listeners.forEach((listener) => listener(trackIn('es', 'Hola, esta es la pista nativa.')));
      expect(adapter.getActiveCue()?.text, 'the automatic path is untouched').toContain('English track');
    } finally {
      adapter.destroy?.();
    }
  });
});
