/**
 * Hard limits on the MAIN ↔ ISOLATED subtitle bus (debt D4).
 *
 * The bus accepts `window.postMessage` traffic, and any script on the page can
 * post on it: the message shape is public and the nonce lives in a DOM
 * attribute the page can read. That is a bar-raiser against casual spoofing,
 * not a trust boundary — so the receiving side must survive hostile input:
 *
 *   • a 500k-cue array must not be kept (and must not reach the parsers);
 *   • a cue whose text is megabytes must be truncated;
 *   • a cue missing/with a non-numeric start or end must be dropped;
 *   • an MPD over the size limit must never be parsed;
 *   • the de-dup URL set must stay bounded over a long live session.
 *
 * Each case below FAILS before the limits existed (the bus kept everything).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INTERCEPT_LIMITS,
  getLastTrack,
  onTrack,
  __resetInterceptedBusForTests,
  __seenUrlCountForTests,
} from '../../src/content/platform-adapters/intercepted-bus';
import type { RawCue } from '../../src/content/platform-adapters/parsers';

const EVENT = 'kivara-lingo:subtitle-track';
const MPD_EVENT = 'kivara-lingo:dash-manifest';

/** The bus publishes its nonce on the root element; the page can read it. */
function nonce(): string {
  return document.documentElement.getAttribute('data-kivara-nonce') ?? '';
}

function post(payload: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', {
    source: window,
    data: { nonce: nonce(), ...payload },
  }));
}

function cue(start: number, end: number, text: string): RawCue {
  return { start, end, text };
}

let unsubscribe: (() => void) | null = null;

beforeEach(() => {
  __resetInterceptedBusForTests();
  unsubscribe = null;
});

afterEach(() => {
  unsubscribe?.();
  __resetInterceptedBusForTests();
  vi.restoreAllMocks();
});

describe('cue limits', () => {
  it('keeps at most INTERCEPT_LIMITS.cues cues from one track', () => {
    const seen: number[] = [];
    unsubscribe = onTrack((track) => seen.push(track.cues.length));
    const flood = Array.from({ length: INTERCEPT_LIMITS.cues + 5_000 }, (_, i) =>
      cue(i, i + 1, `line ${i}`));
    post({ source: EVENT, url: 'https://example.test/flood', cues: flood });
    expect(seen).toEqual([INTERCEPT_LIMITS.cues]);
    expect(getLastTrack()?.cues.length).toBe(INTERCEPT_LIMITS.cues);
  });

  it('truncates a cue text over the per-cue limit', () => {
    unsubscribe = onTrack(() => {});
    post({
      source: EVENT,
      url: 'https://example.test/long',
      cues: [cue(0, 1, 'x'.repeat(INTERCEPT_LIMITS.cueText + 500))],
    });
    expect(getLastTrack()?.cues[0].text.length).toBe(INTERCEPT_LIMITS.cueText);
  });

  it('drops cues whose fields are missing or not numbers', () => {
    unsubscribe = onTrack(() => {});
    post({
      source: EVENT,
      url: 'https://example.test/malformed',
      cues: [
        cue(0, 1, 'good'),
        { start: 1, end: 2 } as unknown as RawCue,
        { start: '3', end: 4, text: 'string start' } as unknown as RawCue,
        { start: Number.NaN, end: 4, text: 'nan' } as unknown as RawCue,
        { start: 4, end: 5, text: 42 } as unknown as RawCue,
        { start: 5, end: 6, text: 'align ok', align: 'start' } as unknown as RawCue,
        { start: 6, end: 7, text: 'bad align', align: 'diagonal' } as unknown as RawCue,
      ],
    });
    const cues = getLastTrack()?.cues ?? [];
    expect(cues.map((c) => c.text)).toEqual(['good', 'align ok', 'bad align']);
    expect(cues[1].align).toBe('start');
    // An unknown align is dropped, not forwarded to the overlay.
    expect(cues[2].align).toBeUndefined();
  });

  it('drops the whole message when nothing survives validation', () => {
    const seen = vi.fn();
    unsubscribe = onTrack(seen);
    post({ source: EVENT, url: 'https://example.test/empty', cues: [{ text: 'no numbers' }] });
    expect(seen).not.toHaveBeenCalled();
    expect(getLastTrack()).toBeNull();
  });

  it('drops cues whose end is before their start (D4)', () => {
    unsubscribe = onTrack(() => {});
    post({
      source: EVENT,
      url: 'https://example.test/backwards',
      cues: [
        cue(0, 1, 'good'),
        cue(5, 2, 'backwards'),
        cue(2, 2, 'empty span'),
      ],
    });
    // A backwards cue never matches a playhead and would be picked as the
    // "next line"; an empty span at least names an instant, so it stays.
    expect(getLastTrack()?.cues.map((c) => c.text)).toEqual(['good', 'empty span']);
  });
});

describe('DASH manifest limit', () => {
  it('never parses a manifest over the size limit', () => {
    const seen = vi.fn();
    unsubscribe = onTrack(seen);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = `<MPD>${' '.repeat(INTERCEPT_LIMITS.mpdBytes + 1)}</MPD>`;
    post({ source: MPD_EVENT, url: 'https://example.test/manifest.mpd', body });
    expect(warn).toHaveBeenCalledWith(
      '[Kivara Lingo] DASH manifest ignored: over the size limit',
    );
    // No DASH download was started (no track ever reached a listener).
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('seen-URLs LRU', () => {
  it('keeps the de-dup set bounded over a long session', () => {
    unsubscribe = onTrack(() => {});
    const total = INTERCEPT_LIMITS.seenUrls + 20;
    for (let i = 0; i < total; i += 1) {
      post({ source: EVENT, url: `https://example.test/seg-${i}`, cues: [cue(0, 1, `s${i}`)] });
    }
    expect(__seenUrlCountForTests()).toBe(INTERCEPT_LIMITS.seenUrls);
  });

  it('still de-duplicates an immediate replay of the last track', () => {
    unsubscribe = onTrack(() => {});
    post({ source: EVENT, url: 'https://example.test/same', cues: [cue(0, 1, 'first')] });
    post({ source: EVENT, url: 'https://example.test/same', cues: [cue(0, 1, 'second')] });
    expect(getLastTrack()?.cues[0].text).toBe('first');
  });
});
