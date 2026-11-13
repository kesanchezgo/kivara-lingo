/**
 * MAIN-world Netflix seek routing (F6 · docs/REDESIGN-V2.md §4.5).
 *
 * The playback command handler installs itself at import time inside
 * `main-world-interceptor.ts`, so the tests drive it the way the page does:
 * a nonce-tagged postMessage command in, the `playback-result` answer out,
 * with a faked `window.netflix` standing in for the player API. The contract
 * under test: the documented session-id API (`getAllPlayerSessionIds()` +
 * `getVideoPlayerBySessionId(id).seek(ms)`) is tried FIRST, the pre-session
 * fallbacks stay in place behind it unchanged, and with several sessions the
 * one that reports the active video wins.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../../src/content/platform-adapters/main-world-interceptor';

const CMD_SOURCE = 'kivara-lingo:playback';
const RESULT_SOURCE = 'kivara-lingo:playback-result';
const NONCE = 'test-nonce';

type NetflixTestWindow = Window & { netflix?: unknown };

interface SeekResult {
  ok: boolean;
  error?: string;
}

/** Minimal `netflix.appContext.state.playerApp.getAPI()` shape. */
function makeApi(videoPlayer: unknown): unknown {
  return {
    appContext: {
      state: {
        playerApp: {
          getAPI: () => ({ videoPlayer }),
        },
      },
    },
  };
}

function installNetflix(netflix: unknown): void {
  (window as NetflixTestWindow).netflix = netflix;
}

function sendRate(rate: number, id: string): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      source: window,
      data: { source: CMD_SOURCE, id, cmd: 'rate', rate, nonce: NONCE },
    }),
  );
}

function sendSeek(timeMs: number, id: string): void {
  // Dispatch explicitly: happy-dom does not guarantee `event.source` on
  // postMessage-delivered events, and the MAIN handler gates on it.
  window.dispatchEvent(
    new MessageEvent('message', {
      source: window,
      data: { source: CMD_SOURCE, id, cmd: 'seek', timeMs, nonce: NONCE },
    }),
  );
}

/** Resolve with the handler's answer for `id`. Rejects on vitest's timeout
 *  if the handler never answers — which is itself a contract breach. */
function nextResult(id: string): Promise<SeekResult> {
  return new Promise((resolve) => {
    const listener = (event: MessageEvent) => {
      const data = event.data as
        | { source?: unknown; id?: unknown; ok?: unknown; error?: unknown }
        | null;
      if (!data || typeof data !== 'object') return;
      if (data.source !== RESULT_SOURCE || data.id !== id) return;
      window.removeEventListener('message', listener);
      resolve({
        ok: data.ok === true,
        error: typeof data.error === 'string' ? data.error : undefined,
      });
    };
    window.addEventListener('message', listener);
  });
}

describe('Netflix MAIN-world seek routing', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-kivara-nonce', NONCE);
  });
  afterEach(() => {
    document.documentElement.removeAttribute('data-kivara-nonce');
    delete (window as NetflixTestWindow).netflix;
  });

  it('tries the session-id API first and passes milliseconds to seek', async () => {
    const calls: string[] = [];
    const sessionSeek = vi.fn((ms: number) => {
      calls.push(`session:${ms}`);
    });
    const legacySeek = vi.fn(() => {
      calls.push('legacy');
    });
    installNetflix(
      makeApi({
        getAllPlayerSessionIds: () => ['session-a'],
        getVideoPlayerBySessionId: (id: string) =>
          id === 'session-a' ? { seek: sessionSeek } : undefined,
        getPlayerByIndex: () => ({ seek: legacySeek }),
      }),
    );
    sendSeek(4200, 't-first');
    const result = await nextResult('t-first');
    expect(result.ok).toBe(true);
    expect(calls).toEqual(['session:4200']);
    expect(sessionSeek).toHaveBeenCalledTimes(1);
    expect(legacySeek).not.toHaveBeenCalled();
  });

  it('falls back to the index player when the session API throws', async () => {
    const legacySeek = vi.fn();
    installNetflix(
      makeApi({
        getAllPlayerSessionIds: () => {
          throw new Error('API moved');
        },
        getPlayerByIndex: (index: number) => (index === 0 ? { seek: legacySeek } : undefined),
      }),
    );
    sendSeek(1500, 't-session-throw');
    const result = await nextResult('t-session-throw');
    expect(result.ok).toBe(true);
    expect(legacySeek).toHaveBeenCalledWith(1500);
  });

  it('falls back when the session player resolves but its seek throws', async () => {
    const sessionSeek = vi.fn(() => {
      throw new Error('seek refused');
    });
    const legacySeek = vi.fn();
    installNetflix(
      makeApi({
        getAllPlayerSessionIds: () => ['session-a'],
        getVideoPlayerBySessionId: () => ({ seek: sessionSeek }),
        getAllPlayerStates: () => [{ seek: legacySeek }],
      }),
    );
    sendSeek(900, 't-seek-throw');
    const result = await nextResult('t-seek-throw');
    expect(result.ok).toBe(true);
    expect(sessionSeek).toHaveBeenCalledWith(900);
    expect(legacySeek).toHaveBeenCalledWith(900);
  });

  it('still seeks through the index fallback when no session API exists', async () => {
    const legacySeek = vi.fn();
    installNetflix(makeApi({ getPlayerByIndex: () => ({ seek: legacySeek }) }));
    sendSeek(3000, 't-no-session-api');
    const result = await nextResult('t-no-session-api');
    expect(result.ok).toBe(true);
    expect(legacySeek).toHaveBeenCalledWith(3000);
  });

  it('reports the player unavailable when no player API exists at all', async () => {
    installNetflix(undefined);
    sendSeek(1000, 't-absent');
    const result = await nextResult('t-absent');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('player API unavailable');
  });

  it('prefers the session whose player reports isPlaying when several exist', async () => {
    const idleSeek = vi.fn();
    const activeSeek = vi.fn();
    installNetflix(
      makeApi({
        getAllPlayerSessionIds: () => ['session-a', 'session-b'],
        getVideoPlayerBySessionId: (id: string) =>
          id === 'session-a' ? { seek: idleSeek } : { seek: activeSeek, isPlaying: () => true },
      }),
    );
    sendSeek(8000, 't-is-playing');
    const result = await nextResult('t-is-playing');
    expect(result.ok).toBe(true);
    expect(activeSeek).toHaveBeenCalledWith(8000);
    expect(idleSeek).not.toHaveBeenCalled();
  });

  it('prefers the session the API reports as playing via getPlayingSessionId', async () => {
    const idleSeek = vi.fn();
    const activeSeek = vi.fn();
    installNetflix(
      makeApi({
        getAllPlayerSessionIds: () => ['session-a', 'session-b'],
        getPlayingSessionId: () => 'session-b',
        getVideoPlayerBySessionId: (id: string) =>
          id === 'session-a' ? { seek: idleSeek } : { seek: activeSeek },
      }),
    );
    sendSeek(250, 't-reported-playing');
    const result = await nextResult('t-reported-playing');
    expect(result.ok).toBe(true);
    expect(activeSeek).toHaveBeenCalledWith(250);
    expect(idleSeek).not.toHaveBeenCalled();
  });

  it('keeps the first session as the default when none reports playing', async () => {
    const firstSeek = vi.fn();
    const secondSeek = vi.fn();
    installNetflix(
      makeApi({
        getAllPlayerSessionIds: () => ['session-a', 'session-b'],
        getVideoPlayerBySessionId: (id: string) =>
          id === 'session-a' ? { seek: firstSeek } : { seek: secondSeek },
      }),
    );
    sendSeek(60_000, 't-default-first');
    const result = await nextResult('t-default-first');
    expect(result.ok).toBe(true);
    expect(firstSeek).toHaveBeenCalledWith(60_000);
    expect(secondSeek).not.toHaveBeenCalled();
  });
});

/** A YouTube MAIN-world player stub, the way the real page exposes it. */
function installYouTube(): { rates: number[] } {
  const rates: number[] = [];
  (window as unknown as Record<string, unknown>).movie_player = {
    setPlaybackRate(rate: number) { rates.push(rate); },
  };
  return { rates };
}

describe('MAIN-world rate command (point 3)', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-kivara-nonce', NONCE);
  });
  afterEach(() => {
    document.documentElement.removeAttribute('data-kivara-nonce');
    delete (window as unknown as Record<string, unknown>).movie_player;
    delete (window as NetflixTestWindow).netflix;
  });

  it('YouTube: routes the rate through movie_player.setPlaybackRate', async () => {
    const yt = installYouTube();
    sendRate(1.25, 'r1');
    const result = await nextResult('r1');
    expect(result.ok).toBe(true);
    expect(yt.rates).toEqual([1.25]);
  });

  it('Netflix: the session player API sets the rate when it exists', async () => {
    const rates: number[] = [];
    installNetflix(
      makeApi({
        getAllPlayerSessionIds: () => ['s1'],
        getVideoPlayerBySessionId: (id: string) =>
          id === 's1'
            ? { seek: vi.fn(), setPlaybackRate: (r: number) => rates.push(r) }
            : null,
      }),
    );
    sendRate(0.75, 'r2');
    const result = await nextResult('r2');
    expect(result.ok).toBe(true);
    expect(rates).toEqual([0.75]);
  });

  it('refuses rates outside [0.25, 4]', async () => {
    const yt = installYouTube();
    sendRate(10, 'r3');
    const result = await nextResult('r3');
    expect(result.ok).toBe(false);
    expect(yt.rates).toEqual([]);
  });

  it('with no rate API anywhere it answers an error (the element fallback applies)', async () => {
    sendRate(1.25, 'r4');
    const result = await nextResult('r4');
    expect(result.ok).toBe(false);
  });
});
