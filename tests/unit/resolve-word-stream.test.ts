/**
 * The reconnect this client adds (kivara-lingo#27): when the service worker
 * restarts between phases, the port dies mid-flight, and the OLD popover
 * code just cleared its loading flags — a half-filled card, "resolving"
 * forever, recovered only by re-hovering.
 *
 * These cases drive the REAL disconnect path with a stub port: the first
 * mid-flight disconnect replays on a new port; a second one gives up and
 * reports; a completed stream never reconnects; an unmount never reconnects.
 * Falsified: without the replay the first case sees a second connect count
 * of 1 and the card sits on dead flags.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openResolveWordStream } from '../../src/content/resolve-word-stream';

interface StubPort {
  name: string;
  posted: unknown[];
  disconnects: number;
  onMessage: { addListener: (l: (m: unknown) => void) => void; fire: (m: unknown) => void };
  onDisconnect: { addListener: (l: () => void) => void; fire: () => void };
  postMessage: (m: unknown) => void;
  disconnect: () => void;
  throwOnPost: boolean;
}

function stubChrome(spawn: () => StubPort) {
  vi.stubGlobal('chrome', {
    runtime: { connect: () => spawn() },
  });
}

const req = {
  kind: 'resolve-word' as const,
  token: 'run',
  sentence: 'run',
  sourceLang: 'en',
  includeAi: false,
};

let ports: StubPort[] = [];
/** Ports that die immediately on the second send (SW restart simulation). */
let killOnPostFrom: number;
/** -1: kill by range (killOnPostFrom); >=0: ONLY that port index dies. */
let killOnly = -1;

function spawnPort(): StubPort {
  const messageCbs: Array<(m: unknown) => void> = [];
  const disconnectCbs: Array<() => void> = [];
  const port: StubPort = {
    name: 'kvl-resolve-word',
    posted: [],
    disconnects: 0,
    throwOnPost: false,
    onMessage: {
      addListener: (l: (m: unknown) => void) => messageCbs.push(l),
      fire: (m: unknown) => messageCbs.forEach((l) => l(m)),
    },
    onDisconnect: {
      addListener: (l: () => void) => disconnectCbs.push(l),
      fire: () => disconnectCbs.forEach((l) => l()),
    },
    postMessage: (m: unknown) => {
      port.posted.push(m);
      const diesOnThisPost =
        killOnly >= 0
          ? ports.indexOf(port) === killOnly
          : ports.indexOf(port) >= killOnPostFrom;
      if (diesOnThisPost) {
        // Simulate the death on THIS send: the SW restarted between phases.
        setTimeout(() => port.onDisconnect.fire(), 0);
      }
    },
    disconnect: () => {
      port.disconnects += 1;
    },
  };
  ports.push(port);
  return port;
}

const seen: Array<{ phase: string }> = [];
const failures: number[] = [];
const run = () => {
  ports = [];
  failures.length = 0;
  seen.length = 0;
  const stream = openResolveWordStream(req, {
    onMessage: (m) => seen.push({ phase: m.phase }),
    onDisconnected: () => failures.push(Date.now()),
  });
  return stream;
};

beforeEach(() => {
  vi.useFakeTimers();
  killOnPostFrom = Number.POSITIVE_INFINITY;
  killOnly = -1;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('openResolveWordStream', () => {
  it('replays ONCE on a mid-flight disconnect and delivers on the new port', () => {
    stubChrome(spawnPort);
    // Die on the FIRST port's very first post (a restart between phases).
    killOnly = 0; // port 0 dies; the replayed port delivers the phases
    const stream = run();
    expect(ports).toHaveLength(1);
    vi.advanceTimersByTime(2); // the death is a macrotask in real MV3
    // Replayed on a fresh port, carrying the SAME request.
    expect(ports).toHaveLength(2);
    expect(ports[1]!.posted).toEqual([req]);
    stream.close();
  });

  it('gives up and reports when the SECOND connection also dies', () => {
    stubChrome(spawnPort);
    killOnPostFrom = 0; // ports 0 and 1 die on their post
    const stream = run();
    vi.advanceTimersByTime(1);
    // Port 0 posted, died, replayed to port 1, which also died: NO third
    // connect — the budget is one replay, and the caller is told it's gone.
    expect(ports).toHaveLength(2);
    expect(failures.length).toBe(1); // exactly one report, never two
    stream.close();
  });

  it('does NOT reconnect after a completed stream', () => {
    stubChrome(spawnPort);
    const stream = run();
    // A done phase arrives, then the worker closes the port: no replay.
    ports[0]!.onMessage.fire({ phase: 'done' });
    ports[0]!.onDisconnect.fire();
    expect(ports).toHaveLength(1);
    expect(failures).toHaveLength(0);
    stream.close();
  });

  it('does NOT reconnect on an explicit close', () => {
    stubChrome(spawnPort);
    const stream = run();
    killOnPostFrom = 1;
    stream.close();
    // close() marks the stream dead: the coming disconnect reports nothing.
    ports[0]!.onDisconnect.fire();
    expect(ports).toHaveLength(1);
    expect(failures).toHaveLength(0);
  });

  it('replay: the re-sent local is dropped; richer phases still flow', () => {
    // The real case the minimal guard exists for. On the DEAD port: a `local`
    // and a `translation` are delivered. The worker restarts, the request is
    // replayed on a fresh port, and the SW re-sends its stream from the
    // start: `local` again — which would paste the poor entry back over the
    // rich one — plus `translation` again, which must still land.
    stubChrome(spawnPort);
    killOnly = 0;
    const stream = run();
    vi.advanceTimersByTime(1);
    expect(ports).toHaveLength(2); // replay happened

    // On the dead port: poor, then rich.
    ports[0]!.onMessage.fire({ phase: 'local' });
    ports[0]!.onMessage.fire({ phase: 'translation' });
    expect(seen.map((e) => e.phase)).toEqual(['local', 'translation']);

    // The replay re-sends both. `local` is dropped (richer already on this
    // stream); `translation` is an assignment and lands again.
    ports[1]!.onMessage.fire({ phase: 'local' });
    ports[1]!.onMessage.fire({ phase: 'translation' });
    expect(seen.map((e) => e.phase)).toEqual(
      ['local', 'translation', 'translation'],
    );
    stream.close();
  });

  it('replay with nothing richer: BOTH locals pass (guard is not a blanket ban)', () => {
    // The boundary: if the dead port only ever delivered `local`, the replay
    // re-sends it with nothing richer on the stream yet — the card still
    // holds the poor entry, so re-dressing it loses nothing. Expect TWO
    // locals, because `sawRicherThanLocal` is still false.
    stubChrome(spawnPort);
    killOnly = 0;
    const stream = run();
    vi.advanceTimersByTime(1);
    expect(ports).toHaveLength(2);
    ports[0]!.onMessage.fire({ phase: 'local' });
    ports[1]!.onMessage.fire({ phase: 'local' });
    expect(seen.map((e) => e.phase)).toEqual(['local', 'local']);
    stream.close();
  });

  it('replay after an error-only stream: the re-sent local still arrives', () => {
    // 851e10f found the guard had a hole: it counted `error` (and the closing
    // `done`) as "richer than local". So a lookup that failed — the SW dies
    // before anything richer landed, error is all that was ever sent — would
    // replay the `local` the popover never saw AND DROP it, ending up on a
    // card with no entry for a word it could have defined. Only phases that
    // DELIVER DATA count: translation, enrichment, ai.
    stubChrome(spawnPort);
    killOnly = 0;
    const stream = run();
    vi.advanceTimersByTime(1);
    expect(ports).toHaveLength(2);
    ports[0]!.onMessage.fire({ phase: 'error', scope: 'lookup', message: 'boom' });
    // The SW restarts before anything richer, and the replay re-sends local.
    ports[1]!.onMessage.fire({ phase: 'local' });
    expect(seen.map((e) => e.phase)).toEqual(['error', 'local']);
    stream.close();
  });

  it('delivers every phase out of order: translation, then error, then enrichment, then done', () => {
    // 884a410 froze this: `error` unmapped landed on rank 99 and every
    // later phase (done included) was dropped -- the card stuck on resolving
    // forever. The SW emits `error` on ordinary paths (translate failed,
    // enrichment failed, AI failed); it is NOT terminal.
    stubChrome(spawnPort);
    const stream = run();
    ports[0]!.onMessage.fire({ phase: 'translation' });
    ports[0]!.onMessage.fire({ phase: 'error', scope: 'translate' });
    ports[0]!.onMessage.fire({ phase: 'enrichment' });
    ports[0]!.onMessage.fire({ phase: 'done' });
    expect(seen.map((e) => e.phase)).toEqual([
      'translation', 'error', 'enrichment', 'done',
    ]);
    // The error must not read as a disconnect: the stream still completed.
    expect(failures).toHaveLength(0);
    stream.close();
  });

  it('delivers two enrichments (parallel AI and chain phases both land)', () => {
    // AI emits its own enrichment (mnemonic/etymology) alongside the chain's;
    // the parallel waves repeat `enrichment` legitimately.
    stubChrome(spawnPort);
    const stream = run();
    ports[0]!.onMessage.fire({ phase: 'enrichment' });
    ports[0]!.onMessage.fire({ phase: 'enrichment' });
    expect(seen.map((e) => e.phase)).toEqual(['enrichment', 'enrichment']);
    stream.close();
  });

  it('delivers ai before enrichment (parallel order is not fixed)', () => {
    // Whichever wave resolves first sends first; a rank gate dropped the
    // enrichment that arrived after `ai`.
    stubChrome(spawnPort);
    const stream = run();
    ports[0]!.onMessage.fire({ phase: 'ai' });
    ports[0]!.onMessage.fire({ phase: 'enrichment' });
    expect(seen.map((e) => e.phase)).toEqual(['ai', 'enrichment']);
    stream.close();
  });
  it('reports immediately when the port cannot be opened', () => {
    vi.stubGlobal('chrome', {
      runtime: { connect: () => { throw new Error('cold worker'); } },
    });
    const stream = run();
    expect(failures.length).toBe(1); // exactly one report, never two
    expect(ports).toHaveLength(0);
    stream.close();
  });
});
