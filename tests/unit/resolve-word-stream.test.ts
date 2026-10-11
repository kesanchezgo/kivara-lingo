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
      if (ports.indexOf(port) >= killOnPostFrom) {
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
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('openResolveWordStream', () => {
  it('replays ONCE on a mid-flight disconnect and delivers on the new port', () => {
    stubChrome(spawnPort);
    // Die on the FIRST port's very first post (a restart between phases).
    killOnPostFrom = 0; // the FIRST port dies on its own post
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
    killOnPostFrom = 0; // every port dies immediately on its post
    const stream = run();
    vi.advanceTimersByTime(1);
    // Port 0 posted, died, replayed to port 1, which also died: NO third
    // connect — the budget is one replay, and the caller is told it's gone.
    expect(ports).toHaveLength(2);
    expect(failures.length).toBeGreaterThan(0);
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

  it('reports immediately when the port cannot be opened', () => {
    vi.stubGlobal('chrome', {
      runtime: { connect: () => { throw new Error('cold worker'); } },
    });
    const stream = run();
    expect(failures.length).toBeGreaterThan(0);
    expect(ports).toHaveLength(0);
    stream.close();
  });
});
