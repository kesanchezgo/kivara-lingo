/**
 * RED TESTS — PR #167 (base main@0744adf6).
 *
 * Netflix volume/mute must cross into the MAIN world: the Cadmium session
 * player (`getVideoPlayerBySessionId(...).setVolume / setMuted`) keeps the
 * level across episodes and audio-track switches. The ISOLATED side reads the
 * live `<video>` for display and falls back to the element only when the
 * MAIN world has no such method.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../../src/content/platform-adapters/main-world-interceptor';
import {
  muteThroughMainWorld,
  resetPlaybackBridgeForTests,
  volumeThroughMainWorld,
} from '../../src/content/platform-adapters/netflix-main-bridge';
import { createNetflixPlaybackController } from '../../src/content/platform-adapters/playback';

const CMD_SOURCE = 'kivara-lingo:playback';
const RESULT_SOURCE = 'kivara-lingo:playback-result';
const NONCE = 'test-nonce';

type NetflixTestWindow = Window & { netflix?: unknown };

function makeApi(videoPlayer: unknown): unknown {
  return {
    appContext: { state: { playerApp: { getAPI: () => ({ videoPlayer }) } } },
  };
}

function send(command: Record<string, unknown>, id: string): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      source: window,
      data: { source: CMD_SOURCE, id, nonce: NONCE, ...command },
    }),
  );
}

function nextResult(id: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const listener = (event: MessageEvent) => {
      const data = event.data as { source?: unknown; id?: unknown; ok?: unknown; error?: unknown } | null;
      if (!data || typeof data !== 'object') return;
      if (data.source !== RESULT_SOURCE || data.id !== id) return;
      window.removeEventListener('message', listener);
      resolve({ ok: data.ok === true, error: typeof data.error === 'string' ? data.error : undefined });
    };
    window.addEventListener('message', listener);
  });
}

beforeEach(() => {
  document.documentElement.setAttribute('data-kivara-nonce', NONCE);
  resetPlaybackBridgeForTests();
  // happy-dom does not stamp `event.source` on postMessage deliveries, and
  // BOTH sides of the bridge gate on `source === window`. Routing postMessage
  // through a synthetic MessageEvent closes the real round trip: the
  // ISOLATED client posts, the MAIN handler answers, the client resolves.
  // Async like the real thing: the client must be able to await an answer
  // that arrives on a later task.
  vi.spyOn(window, 'postMessage').mockImplementation(((message: unknown) => {
    queueMicrotask(() => {
      window.dispatchEvent(new MessageEvent('message', { source: window, data: message }));
    });
  }) as typeof window.postMessage);
});

afterEach(() => {
  document.documentElement.removeAttribute('data-kivara-nonce');
  delete (window as NetflixTestWindow).netflix;
  vi.restoreAllMocks();
});

describe('MAIN-world volume/mute (Cadmium session)', () => {
  it('routes volume and mute through the active session player', async () => {
    const calls: string[] = [];
    (window as NetflixTestWindow).netflix = makeApi({
      getAllPlayerSessionIds: () => ['s1'],
      getVideoPlayerBySessionId: () => ({
        seek: () => {},
        setVolume: (v: number) => calls.push(`vol:${v}`),
        setMuted: (m: boolean) => calls.push(`mute:${m}`),
      }),
    });
    send({ cmd: 'volume', volume: 0.35 }, 'v1');
    expect((await nextResult('v1')).ok).toBe(true);
    send({ cmd: 'mute', muted: true }, 'm1');
    expect((await nextResult('m1')).ok).toBe(true);
    expect(calls).toEqual(['vol:0.35', 'mute:true']);
  });

  it('answers an error when the session lacks the method (the element fallback applies)', async () => {
    (window as NetflixTestWindow).netflix = makeApi({
      getAllPlayerSessionIds: () => ['s1'],
      getVideoPlayerBySessionId: () => ({ seek: () => {} }),
    });
    send({ cmd: 'volume', volume: 0.5 }, 'v2');
    const volume = await nextResult('v2');
    expect(volume.ok).toBe(false);
    expect(volume.error).toBe('no volume API available');
    send({ cmd: 'mute', muted: false }, 'm2');
    const mute = await nextResult('m2');
    expect(mute.ok).toBe(false);
    expect(mute.error).toBe('no mute API available');
  });

  it('clamps and validates the volume before touching the player', async () => {
    const calls: number[] = [];
    (window as NetflixTestWindow).netflix = makeApi({
      getAllPlayerSessionIds: () => ['s1'],
      getVideoPlayerBySessionId: () => ({ seek: () => {}, setVolume: (v: number) => calls.push(v) }),
    });
    send({ cmd: 'volume', volume: 4 }, 'v3');
    const high = await nextResult('v3');
    expect(high.ok).toBe(false);
    expect(high.error).toBe('volume out of range');
    send({ cmd: 'volume', volume: Number.NaN }, 'v4');
    expect((await nextResult('v4')).ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('bridge clients + controller fallback', () => {
  it('volumeThroughMainWorld/muteThroughMainWorld post the command and resolve', async () => {
    const calls: string[] = [];
    (window as NetflixTestWindow).netflix = makeApi({
      getAllPlayerSessionIds: () => ['s1'],
      getVideoPlayerBySessionId: () => ({
        seek: () => {},
        setVolume: (v: number) => calls.push(`vol:${v}`),
        setMuted: (m: boolean) => calls.push(`mute:${m}`),
      }),
    });
    await volumeThroughMainWorld(0.8);
    await muteThroughMainWorld(true);
    expect(calls).toEqual(['vol:0.8', 'mute:true']);
  });

  it('the Netflix controller falls back to the element when the bridge refuses', async () => {
    const video = document.createElement('video');
    Object.defineProperty(video, 'volume', { value: 1, writable: true, configurable: true });
    Object.defineProperty(video, 'muted', { value: false, writable: true, configurable: true });
    const controller = createNetflixPlaybackController(() => video);
    controller.setVolume!(0.4);
    controller.setMuted!(true);
    // The bridge rejects (no nonce answer yet): the element is the safety net.
    await vi.waitFor(() => {
      expect(video.volume).toBeCloseTo(0.4);
      expect(video.muted).toBe(true);
    });
    expect(controller.getVolume!()).toBeCloseTo(0.4);
    expect(controller.isMuted!()).toBe(true);
  });
});
