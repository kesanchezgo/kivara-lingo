/**
 * Point 1 follow-up (QA finding) — the SPA wait for the playback route.
 *
 * `handleNavigation` waited a flat 3 s for a <video> after every SPA
 * navigation. On real Netflix that is not enough: clicking play on /browse
 * SPA-navigates to /watch and the player DOM takes longer than 3 s to exist —
 * the wait returned null, the handler demounted and never retried, and Kivara
 * never mounted on the watch page (QA stage A3: hosts 0/0 with the video
 * playing at 22 s).
 *
 * The rule is per route: a PLAY route gets the full 15 s budget (the player
 * takes as long as it takes), any other route keeps the short 3 s (trailers
 * appear fast, and a fast demount is what we want off-route).
 */
import { describe, expect, it } from 'vitest';
import { navWaitMs, isPlayRoute } from '../../src/content/mount-gate';

describe('navWaitMs (point 1 follow-up)', () => {
  it('gives play routes the full 15 s budget', () => {
    expect(navWaitMs('www.netflix.com', '/watch/70196252')).toBe(15_000);
    expect(navWaitMs('www.youtube.com', '/watch?v=x')).toBe(15_000);
    expect(navWaitMs('www.youtube.com', '/shorts/abc')).toBe(15_000);
    expect(navWaitMs('www.disneyplus.com', '/video/123')).toBe(15_000);
    expect(navWaitMs('play.max.com', '/episode/abc')).toBe(15_000);
    expect(navWaitMs('www.primevideo.com', '/detail/abc')).toBe(15_000);
  });

  it('keeps the short 3 s wait off the playback route (fast demount)', () => {
    expect(navWaitMs('www.netflix.com', '/browse')).toBe(3_000);
    expect(navWaitMs('www.youtube.com', '/')).toBe(3_000);
    expect(navWaitMs('www.amazon.com', '/dp/B0X')).toBe(3_000);
  });

  it('isPlayRoute agrees with the gate table', () => {
    expect(isPlayRoute('www.netflix.com', '/watch/1')).toBe(true);
    expect(isPlayRoute('www.netflix.com', '/browse')).toBe(false);
    expect(isPlayRoute('vimeo.com', '/123')).toBe(false); // no gate → generic
  });
});
