/**
 * PR #172 — the Cadmium bridge: audio, subtitles by track id, and episodes.
 *
 * The playback handler installs itself at import time inside
 * `main-world-interceptor.ts`, so these tests drive it the way the page does: a
 * nonce-tagged message in, the `playback-result` answer out, with a faked
 * `window.netflix` standing in for the player. (The real bridge posts through
 * `window.postMessage`, which happy-dom does not deliver with `event.source` —
 * so the command is dispatched as a MessageEvent carrying exactly what the
 * bridge would send, and the ISOLATED helpers are covered end to end by the
 * Chromium spec.)
 *
 * The contract that must NOT move: `action: 'select'` by `lang` keeps handing
 * `setTimedTextTrack` the track ID STRING (`track-language.spec.ts` pins it).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../src/content/platform-adapters/main-world-interceptor';

const CMD_SOURCE = 'kivara-lingo:playback';
const RESULT_SOURCE = 'kivara-lingo:playback-result';
const NONCE = 'test-nonce';

interface PlayerResult {
  ok: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

let commandId = 0;
let posted: Array<Record<string, unknown>> = [];

/**
 * One round trip through the MAIN-world handler.
 *
 * The handler ignores an event whose `source` is not the window (a page-side
 * listener must not be fed by anything else) and answers with
 * `window.postMessage`, which happy-dom records through the spy instead of
 * delivering — so the command carries the source and the answer is read back
 * from the recorded calls.
 */
async function send(command: Record<string, unknown>): Promise<PlayerResult> {
  commandId += 1;
  const id = `cmd-${commandId}`;
  window.dispatchEvent(new MessageEvent('message', {
    source: window,
    data: { source: CMD_SOURCE, id, nonce: NONCE, ...command },
  }));
  await Promise.resolve();
  const answer = posted.find((message) => message.source === RESULT_SOURCE && message.id === id);
  if (!answer) throw new Error(`no answer for ${String(command.cmd)}`);
  return {
    ok: answer.ok === true,
    error: typeof answer.error === 'string' ? answer.error : undefined,
    data: (answer.data ?? undefined) as Record<string, unknown> | undefined,
  };
}

/** A Cadmium session that records HOW it was called (object or id). */
function fakeSession(overrides: {
  audio?: Array<Record<string, unknown>>;
  subtitles?: Array<Record<string, unknown>>;
  falcorCache?: unknown;
  /** Modern builds accept the TRACK OBJECT; some accept only its id. */
  accept?: 'object' | 'id';
} = {}) {
  const calls: Array<{ method: string; arg: unknown }> = [];
  const accept = overrides.accept ?? 'object';
  const audio = overrides.audio ?? [
    { trackId: 'A:1', bcp47: 'es', displayName: 'Español', trackType: 'DUB', isNative: true, channels: '2.0' },
    { trackId: 'A:2', bcp47: 'en', displayName: 'English', trackType: 'DUB', isNative: false },
  ];
  const subtitles = overrides.subtitles ?? [
    { trackId: 'T:es', bcp47: 'es', displayName: 'Español', rawTrackType: 'SUBTITLES' },
    { trackId: 'T:en', bcp47: 'en', displayName: 'English', rawTrackType: 'SUBTITLES' },
    { trackId: 'T:none', bcp47: '', displayName: 'Off', isNoneTrack: true },
  ];
  let currentAudio = audio[0];
  let currentSub = subtitles[1];
  let visible = true;
  const acceptArg = (arg: unknown) => (accept === 'object' ? typeof arg === 'object' : typeof arg === 'string');
  const session: Record<string, unknown> = {
    // The session resolver only accepts a real PLAYER: `seek` is its marker.
    seek: () => {},
    getAudioTrackList: () => audio,
    getAudioTrack: () => currentAudio,
    setAudioTrack: (arg: unknown) => {
      calls.push({ method: 'setAudioTrack', arg });
      const id = typeof arg === 'string' ? arg : (arg as { trackId?: string })?.trackId;
      const found = audio.find((track) => track.trackId === id);
      if (found && acceptArg(arg)) currentAudio = found;
    },
    getTimedTextTrackList: () => subtitles,
    getTimedTextTrack: () => currentSub,
    setTimedTextTrack: (arg: unknown) => {
      calls.push({ method: 'setTimedTextTrack', arg });
      const id = typeof arg === 'string' ? arg : (arg as { trackId?: string })?.trackId;
      const found = subtitles.find((track) => track.trackId === id);
      if (found && acceptArg(arg)) currentSub = found;
    },
    getTimedTextVisibility: () => visible,
    setTimedTextVisible: (value: boolean) => {
      calls.push({ method: 'setTimedTextVisible', arg: value });
      visible = value;
    },
    getCurrentVideoId: () => '80000002',
  };
  return { calls, session, audio, subtitles };
}

function install(session: Record<string, unknown>, falcorCache?: unknown): void {
  (window as Window & { netflix?: unknown }).netflix = {
    appContext: {
      state: {
        playerApp: {
          getAPI: () => ({
            videoPlayer: {
              getAllPlayerSessionIds: () => ['s1'],
              getVideoPlayerBySessionId: () => session,
            },
          }),
        },
      },
    },
    falcorCache,
  };
}

beforeEach(() => {
  posted = [];
  vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => {
    posted.push(message as Record<string, unknown>);
  });
  document.documentElement.setAttribute('data-kivara-nonce', NONCE);
});

afterEach(() => {
  delete (window as Window & { netflix?: unknown }).netflix;
  vi.restoreAllMocks();
});

describe('PR #172 · audio through Cadmium', () => {
  it('lists the audio tracks and the active one', async () => {
    const { session } = fakeSession();
    install(session);
    const result = await send({ cmd: 'audio', action: 'list' });
    const tracks = result.data?.tracks as Array<Record<string, unknown>>;
    const current = result.data?.current as Record<string, unknown> | null;
    expect(result.ok).toBe(true);
    expect(tracks.map((track) => track.trackId)).toEqual(['A:1', 'A:2']);
    expect(tracks[0].displayName).toBe('Español');
    expect(tracks[0].isNative).toBe(true);
    expect(current?.trackId).toBe('A:1');
  });

  it('selects by OBJECT first, falling back to the id when the build wants one', async () => {
    const wanted = fakeSession({ accept: 'object' });
    install(wanted.session);
    const result = await send({ cmd: 'audio', action: 'select', trackId: 'A:2' });
    expect(typeof wanted.calls[0].arg, 'the object goes first').toBe('object');
    expect((wanted.calls[0].arg as { trackId: string }).trackId).toBe('A:2');
    expect(result.data?.applied, 'and it reports what really happened').toBe(true);

    // A build that only accepts the id needs the second attempt.
    const byId = fakeSession({ accept: 'id' });
    install(byId.session);
    const fallback = await send({ cmd: 'audio', action: 'select', trackId: 'A:2' });
    expect(byId.calls.map((call) => typeof call.arg)).toEqual(['object', 'string']);
    expect(fallback.data?.applied).toBe(true);
  });
});

describe('PR #172 · subtitles by track id, and off', () => {
  it('selects a track by id, object first, and forces the captions visible', async () => {
    const { session, calls } = fakeSession();
    install(session);
    const result = await send({ cmd: 'subtitles', action: 'selectTrack', trackId: 'T:es' });
    expect((calls[0].arg as { trackId: string }).trackId).toBe('T:es');
    expect(calls.some((call) => call.method === 'setTimedTextVisible' && call.arg === true)).toBe(true);
    expect(result.data).toMatchObject({ trackId: 'T:es', applied: true });
  });

  it('turns the captions off through the none-track and the visibility flag', async () => {
    const { session, calls } = fakeSession();
    install(session);
    const result = await send({ cmd: 'subtitles', action: 'selectTrack', trackId: null });
    expect((calls[0].arg as { trackId: string }).trackId, 'the Off track is what it means').toBe('T:none');
    expect(calls.some((call) => call.method === 'setTimedTextVisible' && call.arg === false)).toBe(true);
    expect(result.data).toMatchObject({ off: true });
  });

  it('answers an error for a track that does not exist', async () => {
    const { session } = fakeSession();
    install(session);
    const result = await send({ cmd: 'subtitles', action: 'selectTrack', trackId: 'T:nope' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('keeps the language path untouched: the ID STRING is what it hands over', async () => {
    const { session, calls } = fakeSession();
    install(session);
    // The very command `track-language.spec.ts` drives in real Chromium.
    const result = await send({ cmd: 'subtitles', action: 'select', lang: 'en' });
    expect(result.data).toMatchObject({ trackId: 'T:en' });
    expect(calls[0], 'the string, not the object').toMatchObject({ method: 'setTimedTextTrack', arg: 'T:en' });
  });
});

describe('PR #172 · the episode catalog over the bridge', () => {
  it('answers the catalog of the current video', async () => {
    const { session } = fakeSession();
    const atom = (value: unknown) => ({ $type: 'atom', value });
    install(session, {
      videos: {
        '80000001': { summary: atom({ id: 80000001, type: 'episode', title: 'One', seasonId: 1, seriesId: 7, episodeNumber: 1 }) },
        '80000002': { summary: atom({ id: 80000002, type: 'episode', title: 'Two', seasonId: 1, seriesId: 7, episodeNumber: 2 }) },
      },
      seasons: { '1': { summary: atom({ id: 1, title: 'Temporada 1', seq: 1 }) } },
    });
    const result = await send({ cmd: 'episodes' });
    const catalog = result.data?.catalog as { currentVideoId?: string; seasons: Array<{ episodes: Array<{ title: string; current: boolean }> }> } | null;
    expect(catalog?.currentVideoId).toBe('80000002');
    expect(catalog?.seasons[0].episodes.map((episode) => episode.title)).toEqual(['One', 'Two']);
    expect(catalog?.seasons[0].episodes[1].current).toBe(true);
  });

  it('answers null when the graph has nothing to offer', async () => {
    const { session } = fakeSession();
    install(session);
    const result = await send({ cmd: 'episodes' });
    expect(result.ok).toBe(true);
    expect(result.data?.catalog).toBeNull();
  });
});

describe('PR #172 · the handler never breaks the page', () => {
  it('answers an error instead of throwing when the API is missing', async () => {
    install({});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await send({ cmd: 'audio', action: 'list' });
    expect(result.ok, 'an answer, not a throw').toBe(false);
    expect(result.error).toContain('audio API');
    expect(error).not.toHaveBeenCalled();
  });
});
