/**
 * The SW half of the `kvl-resolve-word` port (enrichment/stream.ts).
 *
 * These pin the handler's contract across the #27 move, and they got
 * tightened in review: a closed-port case must count CALLS to
 * postMessage, not successful pushes — otherwise the vacuous variant
 * passes whether or not `cancelled = true` exists in the catch block.
 * The flush drains macrotasks (a setTimeout(0)), so if the handler adds
 * an await the driver still sees everything it emitted.
 *
 * Covered:
 *  - `error` is NOT terminal: local, error, enrichment, done all reach;
 *  - needsAccess survives the terminal done intact;
 *  - a throwing produce reports error (scope enrichment + thrown text)
 *    + done;
 *  - after disconnect the emit stops — and after a CLOSE the handler
 *    stops POSTING (call count, not push count);
 *  - phases pass through untouched in the order emitted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installResolveWordPort } from '../../src/background/enrichment/stream';

interface AttemptLog {
  posted: Array<Record<string, unknown>>;
  calls: number; // postMessage ATTEMPTS, throws included
  closing: boolean;
}

interface StubPort {
  name: string;
  posted: Array<Record<string, unknown>>;
  onMessage: { addListener: (l: (m: unknown) => void) => void; fire: (m: unknown) => void };
  onDisconnect: { addListener: (l: () => void) => void; fire: () => void };
  postMessage: (m: unknown) => void;
  disconnect: () => void;
  log: AttemptLog;
}

function makePort(name = 'kvl-resolve-word'): StubPort {
  const mC: Array<(m: unknown) => void> = [];
  const dC: Array<() => void> = [];
  const log: AttemptLog = { posted: [], calls: 0, closing: false };
  const port: StubPort = {
    name,
    posted: log.posted,
    onMessage: {
      addListener: (l: (m: unknown) => void) => mC.push(l),
      fire: (m: unknown) => mC.forEach((l) => l(m)),
    },
    onDisconnect: {
      addListener: (l: () => void) => dC.push(l),
      fire: () => dC.forEach((l) => l()),
    },
    postMessage: (m: unknown) => {
      log.calls += 1;
      if (log.closing) throw new Error('port closed');
      log.posted.push(m as Record<string, unknown>);
    },
    disconnect: () => {},
    log,
  };
  return port;
}

function makeListeners(): {
  wire: (produce: (_p: unknown, emit: (m: Record<string, unknown>) => void) => Promise<void>, port: StubPort) => void;
} {
  const listeners: Array<(p: StubPort) => void> = [];
  return {
    wire: (produce, port) => {
      vi.stubGlobal('chrome', {
        runtime: { onConnect: { addListener: (l: (p: StubPort) => void) => listeners.push(l) } },
      });
      installResolveWordPort(produce as never);
      listeners[0]!(port);
      port.onMessage.fire({ kind: 'resolve-word', token: 'run' });
    },
  };
}

const wire = (
  produce: (_p: unknown, emit: (m: Record<string, unknown>) => void) => Promise<void>,
  port: StubPort,
): void => { makeListeners().wire(produce, port); };

const phasesOf = (port: StubPort): string[] => port.posted.map((m) => m.phase as string);

/** Macrotask flush: lets the handler's promise chain settle, no wall-clock race. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('installResolveWordPort (SW side)', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('ignores a port with a different name', async () => {
    const port = makePort('some-other-channel');
    wire(async (_p, emit) => { emit({ phase: 'local' }); }, port);
    await settle();
    expect(port.posted).toHaveLength(0);
  });

  it('delivers every phase in order, error included, then done', async () => {
    const port = makePort();
    wire(async (_p, emit) => {
      emit({ phase: 'local', entry: { token: 'run' } });
      emit({ phase: 'error', scope: 'remote', message: 'translate failed' });
      emit({ phase: 'enrichment', entry: { token: 'run' } });
      emit({ phase: 'done' });
    }, port);
    await settle();
    expect(phasesOf(port)).toEqual(['local', 'error', 'enrichment', 'done']);
    // The error scope travels with the message — the client keys off it.
    const err = port.posted.find((m) => m.phase === 'error');
    expect(err!.scope).toBe('remote');
  });

  it('carries needsAccess on the terminal done — and done is LAST', async () => {
    const needsAccess = [{ source: 'forvo', group: 'audio' }, { source: 'unsplash', group: 'images' }];
    const port = makePort();
    wire(async (_p, emit) => {
      emit({ phase: 'local', entry: { token: 'run' } });
      emit({ phase: 'enrichment', entry: { token: 'run' } });
      emit({ phase: 'done', needsAccess });
    }, port);
    await settle();
    expect(phasesOf(port)).toEqual(['local', 'enrichment', 'done']);
    const done = port.posted[port.posted.length - 1];
    expect(done.phase).toBe('done');
    expect(done.needsAccess).toEqual(needsAccess);
  });

  it('reports error + done with the thrown detail when produce throws', async () => {
    const port = makePort();
    wire(async () => { throw new Error('boom-kaboom'); }, port);
    await settle();
    expect(phasesOf(port)).toEqual(['error', 'done']);
    const err = port.posted[0]!;
    expect(err.scope).toBe('enrichment');
    expect(String(err.message)).toContain('boom-kaboom');
  });

  it('stops emitting after the port disconnects', async () => {
    const port = makePort();
    let release: (() => void) | null = null;
    wire(async (_p, emit) => {
      emit({ phase: 'local', entry: { token: 'run' } });
      await new Promise<void>((r) => { release = r; });
      emit({ phase: 'enrichment' });
      emit({ phase: 'done' });
    }, port);
    await settle();
    expect(phasesOf(port)).toEqual(['local']);
    port.onDisconnect.fire();
    release!();
    await settle();
    expect(phasesOf(port)).toEqual(['local']);
  });

  it('stops POSTING once the port closes mid-stream (call count, not push count)', async () => {
    // The vacuous variant: `posted` stays ['local'] whether or not the
    // catch sets cancelled. Counting ATTEMPTS proves the guard: after the
    // first throw, no further postMessage call fires.
    const port = makePort();
    wire(async (_p, emit) => {
      emit({ phase: 'local', entry: { token: 'run' } }); // 1 attempt, lands
      await Promise.resolve();
      port.log.closing = true;
      emit({ phase: 'enrichment' }); // attempt 2: throws -> cancelled
      emit({ phase: 'done' });        // must NOT attempt again
    }, port);
    await settle();
    expect(port.posted).toEqual([{ phase: 'local', entry: { token: 'run' } }]);
    expect(port.log.calls).toBe(2); // 'local' + the first throwing one, no more
  });
});
