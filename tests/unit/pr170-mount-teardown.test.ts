/**
 * PR #170 · CI fix — the teardown order is the contract.
 *
 * CI caught it: `createEnableSync` runs `unmount()` before
 * `restoreNativeSubtitles()`, but `unmount()` nulls the mount — so the restore
 * in the deps read `mount?.adapter` as `null` and did nothing, leaving the
 * site's subtitles hidden. The adapter is the only thing that knows how to stop
 * the watcher that hid them, so the restore has to happen while it is still
 * alive, and before `destroy()`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { teardownMount } from '../../src/content/mount-teardown';
import type { SubtitleSource } from '../../src/content/platform-adapters/types';

afterEach(() => {
  document.body.innerHTML = '';
  for (const style of Array.from(document.querySelectorAll('style[id^="kivara-"]'))) style.remove();
});

function fakeMount(log: string[]) {
  const host = document.createElement('div');
  const videoHost = document.createElement('div');
  const container = document.createElement('div');
  container.style.position = 'relative';
  document.body.append(host, videoHost, container);
  const style = document.createElement('style');
  style.id = 'kivara-cleanup-netflix';
  document.head.appendChild(style);
  const adapter = {
    showNativeSubtitles: vi.fn(() => log.push('showNativeSubtitles')),
    destroy: vi.fn(() => log.push('destroy')),
  } as unknown as SubtitleSource;
  return {
    mount: {
      reactRoot: { unmount: () => log.push('reactRoot') },
      videoReactRoot: { unmount: () => log.push('videoReactRoot') },
      adapter,
      hostElement: host,
      videoHostElement: videoHost,
      forcedRelative: container,
    },
    adapter,
    host,
    videoHost,
    container,
    style,
  };
}

describe('PR #170 · teardownMount', () => {
  it('gives the site its subtitles back BEFORE destroying the adapter', () => {
    const log: string[] = [];
    const { mount, adapter } = fakeMount(log);
    teardownMount(mount);
    expect(adapter.showNativeSubtitles).toHaveBeenCalled();
    expect(adapter.destroy).toHaveBeenCalled();
    expect(log, 'the restore runs while the adapter is still alive').toEqual([
      'reactRoot',
      'videoReactRoot',
      'showNativeSubtitles',
      'destroy',
    ]);
  });

  it('removes our DOM, every injected sheet and the forced position', () => {
    const log: string[] = [];
    const { mount, host, videoHost, container, style } = fakeMount(log);
    teardownMount(mount);
    expect(host.isConnected).toBe(false);
    expect(videoHost.isConnected).toBe(false);
    expect(style.isConnected, 'the cleanup sheet is not left behind').toBe(false);
    expect(container.style.position, 'the player container is as the site had it').toBe('');
  });

  it('survives a mount with no adapter and no video root', () => {
    const log: string[] = [];
    const { mount } = fakeMount(log);
    const bare = { ...mount, adapter: null, videoReactRoot: undefined, forcedRelative: undefined };
    expect(() => teardownMount(bare)).not.toThrow();
    expect(log).toEqual(['reactRoot']);
  });
});
