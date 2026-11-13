/**
 * The intercepted adapters must resolve their SOURCE track from the user's
 * configured `translate.sourceLang` — the language they are LEARNING — the
 * same way youtube.ts does, never from a hardcoded `'en'`.
 *
 * The bug this pins: Disney+/HBO Max/Prime Video (and Netflix) keyed the
 * source caption under `'en'`, so a user learning, say, French got an
 * adapter that rejected the French track the DASH loader had downloaded
 * under `data-kivara-source-lang=fr` and sat waiting for an English one
 * that never came — the overlay froze and the dual-caption logic misfired.
 *
 * The bus is mocked (fixture keyed by primary subtag, exactly like the real
 * `tracksByLang`); the store is the real one, driven with `setState`, so the
 * resolution rule under test is the production code path.
 *
 * Also pinned here: `SubtitleSource.seek` is GONE. Every seek goes through
 * the `PlaybackController` (`source.playback` — the Netflix seek crosses
 * into the MAIN-world player API); the interface member was a second seek
 * mechanism that bypassed that bridge and could diverge. Nobody called it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { InterceptedTrack } from '../../src/content/platform-adapters/intercepted-bus';
import type { RawCue } from '../../src/content/platform-adapters/parsers';
import type { SubtitleSource } from '../../src/content/platform-adapters/types';

/** Bus fixture, mutated per test. Hoisted so the vi.mock factory can see it. */
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
  // `null` on purpose: every lookup in these tests must go through the
  // language key, never through the last-seen fallback.
  getLastTrack: () => bus.last,
  getKnownLanguages: () => Array.from(bus.tracks.keys()),
  onTrack: (listener: (t: InterceptedTrack) => void) => {
    bus.listeners.add(listener);
    return () => {
      bus.listeners.delete(listener);
    };
  },
}));

import { createDisneyPlusAdapter } from '../../src/content/platform-adapters/disney-plus';
import { createHboMaxAdapter } from '../../src/content/platform-adapters/hbo-max';
import { createPrimeVideoAdapter } from '../../src/content/platform-adapters/prime-video';
import { createNetflixAdapter } from '../../src/content/platform-adapters/netflix';
import { useKivaraStore } from '../../src/shared/use-kivara-store';

const FR_CUES: RawCue[] = [
  { start: 0, end: 4000, text: 'Bonjour, ceci est la piste française.' },
  { start: 4000, end: 8000, text: 'Le sous-titre source de l’apprenant.' },
];
const EN_CUES: RawCue[] = [
  { start: 0, end: 4000, text: 'Hello, this is the English track.' },
  { start: 4000, end: 8000, text: 'The one the hardcoded key used to pick.' },
];

function frTrack(): InterceptedTrack {
  return { url: 'https://cdn.example/fr.vtt', language: 'fr', cues: FR_CUES };
}
function enTrack(): InterceptedTrack {
  return { url: 'https://cdn.example/en.vtt', language: 'en', cues: EN_CUES };
}

function setSourceLang(lang: string): void {
  useKivaraStore.setState((state) => ({
    translate: { ...state.translate, sourceLang: lang },
  }));
}

describe.each([
  ['disney', createDisneyPlusAdapter],
  ['hbo', createHboMaxAdapter],
  ['prime', createPrimeVideoAdapter],
  ['netflix', createNetflixAdapter],
] as const)('%s resolves the source track by translate.sourceLang', (_platform, create) => {
  beforeEach(() => {
    setSourceLang('fr');
    bus.tracks.set('fr', frTrack());
    bus.tracks.set('en', enTrack());
    // The last-seen track is the English one: the language key must win.
    bus.last = enTrack();
  });

  afterEach(() => {
    bus.tracks.clear();
    bus.last = null;
    bus.listeners.clear();
    setSourceLang('en');
    document.body.innerHTML = '';
  });

  it('getTrackCues returns the fr track, not the en one', () => {
    const adapter = create();
    try {
      const cues = adapter.getTrackCues?.() ?? [];
      expect(cues.map((c) => c.text)).toContain(FR_CUES[0].text);
      expect(cues.map((c) => c.text)).not.toContain(EN_CUES[0].text);
      expect(cues.every((c) => c.language === 'fr')).toBe(true);
    } finally {
      adapter.destroy?.();
    }
  });

  it('adopts the fr track as the primary caption when it is published', () => {
    const adapter = create();
    try {
      const video = document.createElement('video');
      document.body.appendChild(video);
      video.currentTime = 1.5;
      // The player loads the French track after mount; the bus publishes it.
      // Adoption re-ticks synchronously, so the cue is active immediately.
      bus.listeners.forEach((l) => l(frTrack()));
      const cue = adapter.getActiveCue();
      expect(cue?.text).toBe(FR_CUES[0].text);
      expect(cue?.language).toBe('fr');
    } finally {
      adapter.destroy?.();
    }
  });
});

describe('SubtitleSource.seek is gone', () => {
  it('the interface no longer exposes seek — every seek goes through PlaybackController', () => {
    // Compile-time proof: if `seek` is ever re-added to SubtitleSource,
    // `ExposesSeek` becomes `true`, this assignment stops assigning
    // `false` to a `true`-typed variable, and `pnpm typecheck` fails
    // before the test even runs.
    type ExposesSeek = 'seek' extends keyof SubtitleSource ? true : false;
    const exposesSeek: ExposesSeek = false;
    expect(exposesSeek).toBe(false);
  });
});
