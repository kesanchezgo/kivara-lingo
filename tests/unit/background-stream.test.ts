/**
 * The SW half of the `kvl-resolve-word` port (enrichment/stream.ts).
 *
 * These pin the handler's contract across the #27 move: written against the
 * pre-move code in a git worktree (the module path changed, nothing else),
 * and they still hold unchanged.
 *
 * The review's baseline, all five asks:
 *  - a port whose produce emits local -> error -> enrichment -> done
 *    receives ALL of them: `error` is NOT terminal (it only logs), so a
 *    regression that makes it terminal — or drops the phases after it —
 *    fails here. This is the family of the 884a410 phase-rank bug.
 *  - `needsAccess` survives on the terminal `done` intact;
 *  - a produce that throws reports error (scope enrichment, THROWN message)
 *    + done;
 *  - the emit stops on disconnect;
 *  - a port already closed receives no further postMessage.
 *
 * No wall-clock anywhere: the only ordering signal is the promise chain of
 * the produce itself, so a slow CI cannot invert the order.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installResolveWordPort } from '../../src/background/enrichment/stream';

interface StubPort {
  name: string;
  posted: Array<Record<string, unknown>>;
  onMessage: { addListener: (l: (m: unknown) => void) => void; fire: (m: unknown) => void };
  onDisconnect: { addListener: (l: () => void) => void; fire: () => void };
  postMessage: (m: unknown) => void;
  disconnect: () => void;
  closing: boolean;
}

function makePort(name = 'kvl-resolve-word'): StubPort {
  const mC: Array<(m: unknown) => void> = [];
  const dC: Array<() => void> = [];
  const port: StubPort = {
    name,
    posted: [],
    closing: false,
    onMessage: {
      addListener: (l: (m: unknown) => void) => mC.push(l),
      fire: (m: unknown) => mC.forEach((l) => l(m)),
    },
    onDisconnect: {
      addListener: (l: () => void) => dC.push(l),
      fire: () => dC.forEach((l) => l()),
    },
    postMessage: (m: unknown) => {
      if (port.closing) throw new Error('port closed');
      port.posted.push(m as Record<string, unknown>);
    },
    disconnect: () => {},
  };
  return port;
}

function wire(
  produce: (_params: unknown, emit: (m: Record<string, unknown>) => void) => Promise<void>,
  port: StubPort,
): void {
  const listeners: Array<(p: StubPort) => void> = [];
  vi.stubGlobal('chrome', {
    runtime: { onConnect: { addListener: (l: (p: StubPort) => void) => listeners.push(l) } },
  });
  installResolveWordPort(produce as never);
  listeners[0]!(port);
  port.onMessage.fire({ kind: 'resolve-word', token: 'run' });
}

const phasesOf = (port: StubPort): string[] => port.posted.map((m) => m.phase as string);

/** Drain microtasks only — deterministic on any machine, no fake timers. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

describe('installResolveWordPort (SW side)', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  it('ignores a port with a different name', () => {
    const port = makePort('some-other-channel');
    wire(async (_p, emit) => { emit({ phase: 'local' }); }, port);
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
    await flush();
    expect(phasesOf(port)).toEqual(['local', 'error', 'enrichment', 'done']);
  });

  it('carries needsAccess on the terminal done intact', async () => {
    const needsAccess = [{ source: 'forvo', group: 'audio' }, { source: 'unsplash', group: 'images' }];
    const port = makePort();
    wire(async (_p, emit) => {
      emit({ phase: 'local', entry: { token: 'run' } });
      emit({ phase: 'done', needsAccess });
    }, port);
    await flush();
    const done = port.posted.find((m) => m.phase === 'done');
    expect(done).toBeDefined();
    expect(done!.needsAccess).toEqual(needsAccess);
  });

  it('reports error + done with the thrown detail when produce throws', async () => {
    const port = makePort();
    wire(async () => { throw new Error('boom-kaboom'); }, port);
    await flush();
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
    await flush();
    expect(phasesOf(port)).toEqual(['local']);
    port.onDisconnect.fire();
    release!();
    await flush();
    expect(phasesOf(port)).toEqual(['local']);
  });

  it('never posts on a closed port (mid-flight dismiss)', async () => {
    const port = makePort();
    wire(async (_p, emit) => {
      emit({ phase: 'local', entry: { token: 'run' } }); // still alive
      await Promise.resolve();
      port.closing = true; // mid-flight the port dies
      emit({ phase: 'enrichment' }); // throws -> the handler cancels
      await Promise.resolve();
      emit({ phase: 'done' }); // swallowed, never reaches the port
    }, port);
    await flush();
    expect(phasesOf(port)).toEqual(['local']);
  });
});