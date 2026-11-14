/**
 * Completing #114 — the adapters must not invent a language.
 *
 * Verified on Netflix: with a Spanish TTML and sourceLang 'en'
 *  (1) `xml:lang="es"` → Kivara showed NOTHING (the track was dropped as
 *      "not the primary language" and no notice explained why);
 *  (2) no declared language → the Spanish cues came out labelled 'en', so the
 *      disagreement notice never fired and every lookup went to an English
 *      dictionary.
 *
 * The rule: label each cue with the TRACK's declared language and nothing
 * else; when the only track available is in another language, publish it so
 * the mismatch can be explained instead of hiding the subtitles.
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
  { start: 0, end: 4000, text: 'El taxista dijo que ya está en la ciudad.' },
  { start: 4000, end: 8000, text: 'No los he visto en un mes, pero volverán.' },
];

function track(language: string | null): InterceptedTrack {
  return { url: 'https://example.test/t.ttml', language, cues: ES_CUES };
}

function setSourceLang(lang: string): void {
  useKivaraStore.setState((state) => ({ translate: { ...state.translate, sourceLang: lang } }));
}

describe('the adapter does not stamp the learning language on a track', () => {
  beforeEach(() => {
    setSourceLang('en');
    bus.tracks.clear();
    bus.last = null;
    bus.listeners.clear();
    document.body.innerHTML = '';
  });
  afterEach(() => {
    bus.tracks.clear();
    bus.last = null;
    bus.listeners.clear();
    setSourceLang('en');
    document.body.innerHTML = '';
  });

  it('leaves language empty when the track declares none (no false "en")', () => {
    const adapter = createNetflixAdapter();
    try {
      const video = document.createElement('video');
      document.body.appendChild(video);
      video.currentTime = 1.5;
      bus.listeners.forEach((l) => l(track(null)));
      const cue = adapter.getActiveCue();
      expect(cue?.text).toBe(ES_CUES[0].text);
      expect(cue?.language ?? '').toBe('');
      const full = adapter.getTrackCues?.() ?? [];
      expect(full.every((c) => (c.language ?? '') === '')).toBe(true);
    } finally {
      adapter.destroy?.();
    }
  });

  it('publishes a track in another language instead of dropping it', () => {
    const adapter = createNetflixAdapter();
    try {
      const video = document.createElement('video');
      document.body.appendChild(video);
      video.currentTime = 1.5;
      // Only the Spanish track ever arrives; the learner is on English.
      bus.listeners.forEach((l) => l(track('es')));
      const cue = adapter.getActiveCue();
      expect(cue?.text).toBe(ES_CUES[0].text);
      expect(cue?.language).toBe('es');
      expect((adapter.getTrackCues?.() ?? []).length).toBeGreaterThan(0);
    } finally {
      adapter.destroy?.();
    }
  });

  it('an English track replaces the foreign fallback when it arrives', () => {
    const adapter = createNetflixAdapter();
    try {
      const video = document.createElement('video');
      document.body.appendChild(video);
      video.currentTime = 1.5;
      bus.listeners.forEach((l) => l(track('es')));
      const EN: RawCue[] = [{ start: 0, end: 4000, text: 'The Spanish track is now English.' }];
      bus.listeners.forEach((l) => l({ url: 'https://example.test/en.ttml', language: 'en', cues: EN }));
      expect(adapter.getActiveCue()?.language).toBe('en');
      expect(adapter.getActiveCue()?.text).toBe(EN[0].text);
    } finally {
      adapter.destroy?.();
    }
  });
});

/**
 * The app switches the track itself: nobody opens Netflix's subtitle menu to
 * pick what they are learning.
 */
const bridgeCalls = vi.hoisted(() => ({ select: [] as string[], media: 0 }));

vi.mock('../../src/content/platform-adapters/netflix-main-bridge', () => ({
  listSubtitleTracks: async () => ({
    tracks: [
      { trackId: 'T:es', bcp47: 'es', displayName: 'Español', isNoneTrack: false, isForcedNarrative: false },
      { trackId: 'T:en', bcp47: 'en', displayName: 'Inglés', isNoneTrack: false, isForcedNarrative: false },
    ],
    current: { trackId: 'T:es', bcp47: 'es' },
  }),
  selectSubtitleTrackThroughMainWorld: async (lang: string) => {
    bridgeCalls.select.push(lang);
    return { trackId: `T:${lang}`, bcp47: lang };
  },
  mediaThroughMainWorld: async () => {
    bridgeCalls.media += 1;
    return { videoId: '1', title: 'x' };
  },
}));

describe('createNetflixAdapter asks the player for the learning-language track', () => {
  beforeEach(() => {
    bridgeCalls.select.length = 0;
    bus.tracks.clear();
    bus.last = null;
    bus.listeners.clear();
    setSourceLang('en');
  });
  afterEach(() => {
    bus.tracks.clear();
    bus.last = null;
    bus.listeners.clear();
  });

  it('selects the learning language when the bus has no track for it', async () => {
    bus.tracks.set('es', track('es'));
    const adapter = createNetflixAdapter();
    try {
      await new Promise((r) => setTimeout(r, 0));
      expect(bridgeCalls.select).toContain('en');
    } finally {
      adapter.destroy?.();
    }
  });

  it('does not touch the player when the learning track is already on the bus', async () => {
    bus.tracks.set('en', track('en'));
    const adapter = createNetflixAdapter();
    try {
      await new Promise((r) => setTimeout(r, 0));
      expect(bridgeCalls.select).toHaveLength(0);
    } finally {
      adapter.destroy?.();
    }
  });
});
