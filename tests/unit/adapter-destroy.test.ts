/**
 * Adapter lifecycle (audit finding: adapters were never destroyed).
 *
 * A content script is re-created on every SPA navigation. Each generation
 * started a new adapter — a 50–120 ms interval, bus subscriptions, injected
 * styles — and nothing ever released the previous one, so after a few videos
 * the page ran several pollers at once and cues from the OLD video kept
 * answering as if they were current.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { attachYouTube } from '../../src/content/platform-adapters/youtube';
import { attachGenericHtml5 } from '../../src/content/platform-adapters/generic-html5';

function makeVideo(): HTMLVideoElement {
  const video = document.createElement('video');
  document.body.appendChild(video);
  const track = video.addTextTrack('captions', 'English', 'en');
  const cue = new VTTCue(0, 1000, 'hello world');
  track.addCue(cue);
  return video;
}

describe('adapter destroy()', () => {
  let video: HTMLVideoElement;
  const intervals: number[] = [];
  const cleared: number[] = [];

  beforeEach(() => {
    video = makeVideo();
    intervals.length = 0;
    cleared.length = 0;
    // Keep the REAL implementations; only record the ids so the test can
    // compare what startPolling created with what destroy cleared.
    const realSet = window.setInterval.bind(window);
    vi.spyOn(window, 'setInterval').mockImplementation(((fn: () => void, ms: number) => {
      const id = realSet(fn, ms) as unknown as number;
      intervals.push(id);
      return id;
    }) as unknown as typeof window.setInterval);
    const realClear = window.clearInterval.bind(window);
    vi.spyOn(window, 'clearInterval').mockImplementation(((id: number) => {
      cleared.push(id);
      realClear(id as unknown as ReturnType<typeof clearInterval>);
    }) as unknown as typeof window.clearInterval);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('releases the YouTube polling interval', () => {
    const adapter = attachYouTube();
    expect(adapter).not.toBeNull();
    expect(intervals.length).toBeGreaterThan(0);
    const before = intervals.length;

    adapter!.destroy!();

    expect(cleared).toEqual(intervals.slice(0, before));
  });

  it('unbinds the textTrack and drops the injected hide style', () => {
    const adapter = attachYouTube()!;
    const track = video.textTracks[0];
    track.mode = 'hidden';
    adapter.hideNativeSubtitles();
    expect(document.getElementById('kivara-lingo-yt-hide')).not.toBeNull();

    adapter.destroy!();

    expect(track.oncuechange).toBeNull();
    expect(document.getElementById('kivara-lingo-yt-hide')).toBeNull();
  });

  it('stops delivering cues after destroy', () => {
    vi.useFakeTimers();
    const adapter = attachYouTube()!;
    const seen: number[] = [];
    adapter.onCueChange((cues) => seen.push(cues.length));
    vi.advanceTimersByTime(300); // at least one DOM poll

    const beforeDestroy = seen.length;
    adapter.destroy!();
    vi.advanceTimersByTime(1000);
    expect(seen.length).toBe(beforeDestroy); // nothing new after destroy
    vi.useRealTimers();
  });

  it('generic adapter unbinds its track and forgets the cue after destroy', () => {
    const generic = attachGenericHtml5(video);
    expect(video.textTracks[0].oncuechange).not.toBeNull();

    generic.destroy!();

    // The cue-change handler is unbound, so a fired event cannot reach a
    // React tree that no longer exists.
    expect(video.textTracks[0].oncuechange).toBeNull();
    expect(generic.getActiveCue()).toBeNull();
  });

  it('destroy is safe to call twice (unmount happens on every navigation)', () => {
    const adapter = attachYouTube()!;
    adapter.destroy!();
    expect(() => adapter.destroy!()).not.toThrow();
  });
});
