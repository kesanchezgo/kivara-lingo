/**
 * Point 3 — createRateSync, with fake timers and a manual clock.
 *
 * The echo window is wall-clock (Date.now), so the tests drive the clock by
 * stubbing Date.now between steps. Semantics:
 *  - `applied(r)` arms the echo window;
 *  - a ratechange agreeing with the armed value is our own echo — ignored;
 *  - a disagreeing one inside the window is a platform revert → ONE re-apply;
 *  - a second disagreement → the platform's rate is accepted and reported;
 *  - a change outside any armed window is the user on the NATIVE menu → accepted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRateSync } from '../../src/content/platform-adapters/playback';

function makeVideo(): HTMLVideoElement {
  const video = document.createElement('video');
  Object.defineProperty(video, 'playbackRate', { value: 1, writable: true });
  document.body.appendChild(video);
  return video;
}

describe('createRateSync', () => {
  let video: HTMLVideoElement;
  let events: { apply: number[]; accept: number[]; reverts: number[] };

  beforeEach(() => {
    vi.useFakeTimers();
    video = makeVideo();
    events = { apply: [], accept: [], reverts: [] };
    vi.stubGlobal('Date', {
      ...Date,
      now: vi.fn(() => 0),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const change = (rate: number) => {
    video.playbackRate = rate;
    video.dispatchEvent(new Event('ratechange'));
  };

  it('accepts an external change that nobody armed', () => {
    const sync = createRateSync(video, {
      apply: (r) => events.apply.push(r),
      accept: (r) => events.accept.push(r),
    });
    change(1.25);
    expect(events.accept).toEqual([1.25]);
    expect(events.apply).toEqual([]);
    sync.detach();
  });

  it('treats the echo of our own apply as ours (no accept, no re-apply)', () => {
    const sync = createRateSync(video, {
      apply: (r) => { events.apply.push(r); video.playbackRate = r; },
      accept: (r) => events.accept.push(r),
    });
    sync.applied(1.25);
    change(1.25); // the element echoing the API call
    expect(events.apply).toEqual([]);
    expect(events.accept).toEqual([]);
    sync.detach();
  });

  it('re-tries ONCE when the platform reverts our apply', () => {
    const sync = createRateSync(video, {
      apply: (r) => { events.apply.push(r); video.playbackRate = r; },
      accept: (r) => events.accept.push(r),
    });
    sync.applied(1.25);
    change(1.0); // revert inside the echo window
    expect(events.apply).toEqual([1.25]); // exactly one re-apply
    expect(events.accept).toEqual([]);
    sync.detach();
  });

  it('accepts and reports when it reverts a second time (no fight)', () => {
    const sync = createRateSync(video, {
      apply: (r) => { events.apply.push(r); video.playbackRate = r; },
      accept: (r) => events.accept.push(r),
      onPlatformRevert: (r) => events.reverts.push(r),
    });
    sync.applied(1.25);
    change(1.0); // revert → retry once
    change(1.0); // revert again → accept
    expect(events.apply).toEqual([1.25]);
    expect(events.accept).toEqual([1.0]);
    expect(events.reverts).toEqual([1.0]);
    sync.detach();
  });

  it('a change after the echo window closed is the native menu (accepted)', () => {
    let clock = 0;
    vi.stubGlobal('Date', { ...Date, now: vi.fn(() => clock) });
    const sync = createRateSync(video, {
      apply: (r) => { events.apply.push(r); video.playbackRate = r; },
      accept: (r) => events.accept.push(r),
    });
    sync.applied(1.25);
    clock = 1_000; // echo window (600 ms) closed
    change(1.25); // the platform's rate landed — accepted as the user's choice
    expect(events.accept).toEqual([1.25]);
    sync.detach();
  });

  it('shouldAccept gates what lands in the store', () => {
    const sync = createRateSync(video, {
      apply: (r) => events.apply.push(r),
      accept: (r) => events.accept.push(r),
    }, { shouldAccept: (r) => r >= 0.25 && r <= 4 });
    change(10);
    expect(events.accept).toEqual([]);
    sync.detach();
  });
});
