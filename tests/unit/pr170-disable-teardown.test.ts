/**
 * PR #170 · 2 — the disable path, at the level the popup and the tabs share.
 *
 * The popup must tell every open tab NOW: the store only reaches them through a
 * 250 ms-debounced `chrome.storage` rehydrate, and "apagar" that takes a quarter
 * of a second while the video keeps looping is not "apagado".
 *
 * `createEnableSync` is the effect (order + idempotency); this file drives it
 * through both paths with a fake chrome and a fake store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createEnableSync, installEnableSync, type EnableSyncDeps } from '../../src/content/enable-sync';
import { useStudyPlayback } from '../../src/content/ui/useStudyPlayback';
import type { PlaybackController } from '../../src/content/platform-adapters/types';
import { SET_ENABLED_MESSAGE, broadcastEnabled } from '../../src/shared/enable-broadcast';

function deps(log: string[], mounted = { value: true }): EnableSyncDeps {
  return {
    isMounted: () => mounted.value,
    mount: () => { log.push('mount'); mounted.value = true; },
    unmount: () => { log.push('unmount'); mounted.value = false; },
    releasePlayback: () => log.push('releasePlayback'),
    restoreNativeSubtitles: () => log.push('restoreNativeSubtitles'),
  };
}

describe('PR #170 · disabling releases the platform before it removes our DOM', () => {
  it('runs the whole teardown in the same tick, in order', () => {
    const log: string[] = [];
    createEnableSync(deps(log)).apply(false);
    expect(log).toEqual(['releasePlayback', 'unmount', 'restoreNativeSubtitles']);
  });

  it('is idempotent: a repeated state does nothing', () => {
    const log: string[] = [];
    const sync = createEnableSync(deps(log));
    sync.apply(false);
    sync.apply(false);
    expect(log).toEqual(['releasePlayback', 'unmount', 'restoreNativeSubtitles']);
  });

  it('re-mounts on enable only when nothing is mounted', () => {
    const log: string[] = [];
    const mounted = { value: false };
    const sync = createEnableSync(deps(log, mounted));
    sync.apply(true);
    expect(log).toEqual(['mount']);
    sync.apply(false);
    sync.apply(true);
    expect(log).toEqual(['mount', 'releasePlayback', 'unmount', 'restoreNativeSubtitles', 'mount']);
  });

  it('tolerates a disable while nothing is mounted', () => {
    const log: string[] = [];
    createEnableSync(deps(log, { value: false })).apply(false);
    expect(log).toEqual(['releasePlayback', 'restoreNativeSubtitles']);
  });
});

describe('PR #170 · the tabs hear about it immediately', () => {
  const listeners: Array<(message: unknown) => void> = [];

  beforeEach(() => {
    listeners.length = 0;
    vi.stubGlobal('chrome', {
      runtime: { onMessage: { addListener: (fn: (message: unknown) => void) => listeners.push(fn) } },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('applies a SET_ENABLED broadcast synchronously, and mirrors it in the store', () => {
    const log: string[] = [];
    installEnableSync(deps(log));
    expect(listeners).toHaveLength(1);

    listeners[0]({ type: SET_ENABLED_MESSAGE, enabled: false });
    // Same tick: no await, no timer.
    expect(log).toEqual(['releasePlayback', 'unmount', 'restoreNativeSubtitles']);
  });

  it('ignores every other message', () => {
    const log: string[] = [];
    installEnableSync(deps(log));
    listeners[0]({ type: 'SOMETHING_ELSE' });
    listeners[0](undefined);
    expect(log).toEqual([]);
  });
});

describe('PR #170 · the popup tells the tabs, and only the real ones', () => {
  it(`sends ${SET_ENABLED_MESSAGE} to every http(s) tab`, async () => {
    const sendMessage = vi.fn(async () => ({}));
    const tabs = {
      query: vi.fn(async () => [
        { id: 1, url: 'https://www.netflix.com/watch/1' },
        { id: 2, url: 'chrome://extensions' },
        { id: 3, url: 'https://www.youtube.com/watch?v=1' },
        { url: 'https://nowhere.example' },
      ]),
      sendMessage,
    };
    const sent = await broadcastEnabled(false, tabs);
    expect(sent).toBe(2);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenCalledWith(1, { type: SET_ENABLED_MESSAGE, enabled: false });
    expect(sendMessage).toHaveBeenCalledWith(3, { type: SET_ENABLED_MESSAGE, enabled: false });
  });

  it('never throws when a tab has no content script', async () => {
    const sendMessage = vi.fn(async () => { throw new Error('Receiving end does not exist'); });
    const tabs = { query: vi.fn(async () => [{ id: 7, url: 'https://www.netflix.com/watch/1' }]), sendMessage };
    await expect(broadcastEnabled(true, tabs)).resolves.toBe(0);
  });
});
describe('PR #170 · suspending the study playback releases the media rate', () => {
  it('puts the platform back at 1x when the extension is switched off', () => {
    const controller = {
      seek: vi.fn(async () => {}),
      play: vi.fn(async () => {}),
      pause: vi.fn(),
      getRate: () => 0.75,
      setRate: vi.fn(),
      isPaused: () => false,
      currentTimeMs: () => 0,
    } as unknown as PlaybackController;
    const pausedByKivara = { current: false };
    const { rerender } = renderHook(
      ({ suspended }: { suspended: boolean }) => useStudyPlayback({
        controller, cues: [], video: null, pausedByKivara, suspended,
      }),
      { initialProps: { suspended: false } },
    );
    vi.mocked(controller.setRate).mockClear();
    rerender({ suspended: true });
    // 0.75x outliving apagar was the bug: Netflix kept the study speed.
    expect(controller.setRate).toHaveBeenCalledWith(1);
  });

  it('does not touch the rate when it was never suspended', () => {
    const controller = {
      seek: vi.fn(async () => {}), play: vi.fn(async () => {}), pause: vi.fn(),
      getRate: () => 1, setRate: vi.fn(), isPaused: () => false, currentTimeMs: () => 0,
    } as unknown as PlaybackController;
    renderHook(() => useStudyPlayback({
      controller, cues: [], video: null, pausedByKivara: { current: false }, suspended: false,
    }));
    expect(controller.setRate).not.toHaveBeenCalledWith(0.75);
  });
});
