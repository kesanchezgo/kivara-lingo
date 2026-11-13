/**
 * F6 unit coverage for the PlaybackController (docs/REDESIGN-V2.md §8:
 * "PlaybackController con un vídeo falso").
 *
 * The controller is the only path allowed to move the playhead, so its
 * contract is what keeps Netflix's stream alive: the media controller seeks the
 * element, and the Netflix controller NEVER touches `currentTime` — it rejects
 * when the MAIN-world player API does not answer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  clampRate,
  createMediaPlaybackController,
  createNetflixPlaybackController,
} from '../../src/content/platform-adapters/playback';
import {
  resetPlaybackBridgeForTests,
  seekThroughMainWorld,
} from '../../src/content/platform-adapters/netflix-main-bridge';
import { cueIndexAt } from '../../src/content/ui/useStudyPlayback';

class FakeVideo extends EventTarget {
  private _currentTime = 0;
  paused = true;
  playbackRate = 1;

  get currentTime(): number {
    return this._currentTime;
  }
  set currentTime(value: number) {
    this._currentTime = value;
    this.dispatchEvent(new Event('seeked'));
  }

  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

const asVideo = (video: FakeVideo) => video as unknown as HTMLVideoElement;

describe('media PlaybackController', () => {
  it('seeks the element and resolves on `seeked`', async () => {
    const fake = new FakeVideo();
    const controller = createMediaPlaybackController(() => asVideo(fake));
    await controller.seek(2500);
    expect(fake.currentTime).toBe(2.5);
  });

  it('clamps negative seeks to zero', async () => {
    const fake = new FakeVideo();
    const controller = createMediaPlaybackController(() => asVideo(fake));
    await controller.seek(-900);
    expect(fake.currentTime).toBe(0);
  });

  it('plays, pauses, reports time and clamps the rate', async () => {
    const fake = new FakeVideo();
    const controller = createMediaPlaybackController(() => asVideo(fake));
    await controller.play();
    expect(controller.isPaused()).toBe(false);
    controller.pause();
    expect(controller.isPaused()).toBe(true);
    controller.setRate(99);
    // Point 3: the rate goes through the MAIN bridge first and lands on the
    // element in a follow-up microtask — flush it before reading back.
    await new Promise((r) => setTimeout(r, 0));
    expect(controller.getRate()).toBe(4);
    controller.setRate(0.0001);
    await new Promise((r) => setTimeout(r, 0));
    expect(controller.getRate()).toBe(0.25);
    fake.paused = false;
    expect(controller.currentTimeMs()).toBe(0);
  });

  it('survives a missing element instead of throwing', async () => {
    const controller = createMediaPlaybackController(() => null);
    await controller.play();
    controller.pause();
    controller.setRate(1.25);
    expect(controller.isPaused()).toBe(true);
    expect(controller.currentTimeMs()).toBe(0);
  });

  it('clampRate normalizes junk', () => {
    expect(clampRate(Number.NaN)).toBe(1);
    expect(clampRate(1.25)).toBe(1.25);
  });
});

describe('Netflix PlaybackController', () => {
  beforeEach(() => {
    resetPlaybackBridgeForTests();
    document.documentElement.setAttribute('data-kivara-nonce', 'test-nonce');
  });
  afterEach(() => {
    document.documentElement.removeAttribute('data-kivara-nonce');
    resetPlaybackBridgeForTests();
  });

  it('routes the seek through the MAIN bridge and never writes currentTime', async () => {
    const fake = new FakeVideo();
    const writes: number[] = [];
    const spy = vi.spyOn(fake, 'currentTime', 'set');
    spy.mockImplementation((value: number) => {
      writes.push(value);
    });

    const reply = (event: MessageEvent) => {
      const data = event.data as { source?: string; id?: string; nonce?: string };
      if (data.source !== 'kivara-lingo:playback') return;
      // Dispatch explicitly: happy-dom does not guarantee `event.source`.
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          data: { source: 'kivara-lingo:playback-result', id: data.id, ok: true, nonce: 'test-nonce' },
        }),
      );
    };
    window.addEventListener('message', reply);
    try {
      const controller = createNetflixPlaybackController(() => asVideo(fake));
      // The bridge posts the command to the page; the listener above answers.
      await controller.seek(4200);
      expect(writes).toEqual([]);
    } finally {
      window.removeEventListener('message', reply);
    }
  });

  it('rejects when the MAIN world does not answer', async () => {
    vi.useFakeTimers();
    try {
      const fake = new FakeVideo();
      const controller = createNetflixPlaybackController(() => asVideo(fake));
      const pending = controller.seek(1000);
      const assertion = expect(pending).rejects.toThrow(/did not answer/);
      await vi.advanceTimersByTimeAsync(1600);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses to send without the bus nonce', async () => {
    document.documentElement.removeAttribute('data-kivara-nonce');
    await expect(seekThroughMainWorld(10)).rejects.toThrow(/not ready/);
  });
});

describe('cueIndexAt', () => {
  const cues = [
    { id: 'a', start: 0, end: 1000, text: 'a', language: 'en' },
    { id: 'b', start: 1000, end: 2000, text: 'b', language: 'en' },
    { id: 'c', start: 3000, end: 4000, text: 'c', language: 'en' },
  ];

  it('finds the cue under the playhead', () => {
    expect(cueIndexAt(cues, 500)).toBe(0);
    expect(cueIndexAt(cues, 1000)).toBe(1);
    expect(cueIndexAt(cues, 3500)).toBe(2);
  });

  it('keeps the line just passed between cues and -1 before the first', () => {
    expect(cueIndexAt(cues, 2500)).toBe(1);
    expect(cueIndexAt(cues, 5000)).toBe(2);
  });
});
