/**
 * B7 — the YouTube adapter must read the active cue from the intercepted
 * track, not from the caption DOM.
 *
 * The bus already holds the WHOLE `/api/timedtext` track with real
 * timings. The old adapter only read `.caption-visual-line` text and invented
 * `[now, now+2000]`, so the cue's start/end never matched the track and a page
 * with no `<video>.textTracks` entry emitted nothing at all.
 *
 * Red-before: with the pre-fix adapter this yields `{ start: 5700, end: 7700 }`
 * (or no cue when the DOM has no caption node).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { RawCue } from '../../src/content/platform-adapters/parsers';
import type { InterceptedTrack } from '../../src/content/platform-adapters/intercepted-bus';

/** Bus fixture, mutated per test. Hoisted so the vi.mock factory can see it. */
const bus = vi.hoisted(() => ({
  last: null as InterceptedTrack | null,
}));

vi.mock('../../src/content/platform-adapters/intercepted-bus', () => ({
  getTrackByLanguage: (lang: string) => {
    const key = lang.trim().toLowerCase().split(/[-_]/)[0];
    const language = bus.last?.language?.toLowerCase().split(/[-_]/)[0];
    return language === key ? bus.last : null;
  },
  getLastTrack: () => bus.last,
  getActiveTrackCues: () => bus.last?.cues ?? null,
  getKnownLanguages: () => (bus.last?.language ? [bus.last.language] : []),
  // youtube.ts only subscribes here for the transcript rail; no-op is enough.
  onTrack: () => () => {},
}));

import { attachYouTube } from '../../src/content/platform-adapters/youtube';
import { buildCueRequestFields } from '../../src/content/ui/save-request';

const CUES: RawCue[] = [
  { start: 0, end: 3000, text: 'Hello, this is a test cue.' },
  { start: 3000, end: 6000, text: 'The rat ships frames and audio.' },
  { start: 6000, end: 9000, text: 'Every crumb gets gnawed.' },
];

function track(language = 'en', cues = CUES): InterceptedTrack {
  return { url: `https://www.youtube.com/api/timedtext?v=x&lang=${language}&fmt=json3`, language, cues };
}

function makeVideo(atSeconds: number): HTMLVideoElement {
  const video = document.createElement('video');
  document.body.appendChild(video);
  video.currentTime = atSeconds;
  return video;
}

/** The YouTube caption DOM, as the player renders one line per visual line. */
function renderCaptionDom(text: string): void {
  const container = document.createElement('div');
  container.className = 'captions-text';
  const line = document.createElement('span');
  line.className = 'caption-visual-line';
  line.textContent = text;
  container.appendChild(line);
  document.body.appendChild(container);
}

describe('YouTube active cue comes from the intercepted track', () => {
  beforeEach(() => {
    bus.last = track();
  });

  afterEach(() => {
    bus.last = null;
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('picks the bus cue by video.currentTime and emits its real start/end/id', () => {
    vi.useFakeTimers();
    // No textTracks entry at all: the old adapter emitted nothing here.
    makeVideo(5.7);
    renderCaptionDom('The rat ships frames and audio.');

    const adapter = attachYouTube()!;
    const seen: Array<{ id: string; start: number; end: number; text: string }> = [];
    adapter.onCueChange((cues) => {
      if (cues[0]) {
        seen.push({ id: cues[0].id, start: cues[0].start, end: cues[0].end, text: cues[0].text });
      }
    });
    vi.advanceTimersByTime(130);

    const active = adapter.getActiveCue();
    expect(active).not.toBeNull();
    expect(active).toMatchObject({
      id: 'youtube-3000-6000',
      start: 3000,
      end: 6000,
      text: 'The rat ships frames and audio.',
      language: 'en',
    });
    // The full track uses the same id scheme, so App can find the cue by id
    // and build `contextLines.prev`.
    expect(adapter.getTrackCues?.().some((cue) => cue.id === 'youtube-3000-6000')).toBe(true);
    expect(seen.at(-1)).toMatchObject({ start: 3000, end: 6000 });

    adapter.destroy!();
  });

  it('builds the CREATE_CARD cue fields from the real cue (cueStart/cueEnd/contextLines)', () => {
    vi.useFakeTimers();
    makeVideo(5.7);
    renderCaptionDom('The rat ships frames and audio.');

    const adapter = attachYouTube()!;
    vi.advanceTimersByTime(130);

    const active = adapter.getActiveCue()!;
    const fields = buildCueRequestFields(active, adapter.getTrackCues?.() ?? []);

    expect(fields).toEqual({
      cueStart: 3000,
      cueEnd: 6000,
      contextLines: {
        prev: 'Hello, this is a test cue.',
        next: 'Every crumb gets gnawed.',
      },
    });

    adapter.destroy!();
  });

  it('re-anchors DOM caption text to the bus cue instead of inventing a window', () => {
    vi.useFakeTimers();
    // The playhead sits BETWEEN bus cues: only the DOM text can identify the
    // line, but its timings still must come from the track, not from now().
    makeVideo(9.5);
    renderCaptionDom('The rat ships frames and audio.');

    const adapter = attachYouTube()!;
    vi.advanceTimersByTime(130);

    expect(adapter.getActiveCue()).toMatchObject({
      id: 'youtube-3000-6000',
      start: 3000,
      end: 6000,
    });

    adapter.destroy!();
  });

  it('keeps the [now, now+2000] fallback only when the bus has no track', () => {
    vi.useFakeTimers();
    bus.last = null;
    makeVideo(5.7);
    renderCaptionDom('The rat ships frames and audio.');

    const adapter = attachYouTube()!;
    vi.advanceTimersByTime(130);

    expect(adapter.getActiveCue()).toMatchObject({
      start: 5700,
      end: 7700,
      text: 'The rat ships frames and audio.',
    });

    adapter.destroy!();
  });
});
