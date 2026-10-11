/**
 * The SW half of the `kvl-resolve-word` port, characterized BEFORE the move
 * of #27 (src/background/stream.ts -> enrichment/stream). Same contract as
 * the merge and cache cuts: whatever the CURRENT code does on each input is
 * recorded as data, and the move must reproduce it exactly.
 *
 * The review's step-1 baseline, four asks:
 *
 *  - a port whose produce emits local -> delayed phases -> done delivers all
 *    of them IN ORDER on the port;
 *  - a produce that throws reports error + done;
 *  - the emit stops after the port disconnects;
 *  - a port already closed receives no further postMessage.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installResolveWordPort } from "../../src/background/stream";

interface StubPort {
  name: string;
  posted: unknown[];
  onMessage: { addListener: (l: (m: unknown) => void) => void; fire: (m: unknown) => void };
  onDisconnect: { addListener: (l: () => void) => void; fire: () => void };
  postMessage: (m: unknown) => void;
  disconnect: () => void;
}

function makePort(name = "kvl-resolve-word"): StubPort {
  const mC: Array<(m: unknown) => void> = [];
  const dC: Array<() => void> = [];
  const port: StubPort = {
    name,
    posted: [],
    onMessage: {
      addListener: (l: (m: unknown) => void) => mC.push(l),
      fire: (m: unknown) => mC.forEach((l) => l(m)),
    },
    onDisconnect: {
      addListener: (l: () => void) => dC.push(l),
      fire: () => dC.forEach((l) => l()),
    },
    postMessage: (m: unknown) => { port.posted.push(m); },
    disconnect: () => {},
  };
  return port;
}

/** Wire a produce fn and a port, then deliver the request. */
function wire(
  produce: (_params: unknown, emit: (m: unknown) => void) => Promise<void>,
  port: StubPort,
): void {
  const listeners: Array<(p: StubPort) => void> = [];
  vi.stubGlobal("chrome", {
    runtime: { onConnect: { addListener: (l: (p: StubPort) => void) => listeners.push(l) } },
  });
  installResolveWordPort(produce as never);
  listeners[0]!(port);
  port.onMessage.fire({ kind: "resolve-word", token: "run" });
}

const phasesOf = (port: StubPort): string[] =>
  (port.posted as Array<{ phase: string }>).map((m) => m.phase);

const settle = async (ms: number): Promise<void> => {
  await new Promise((r) => setTimeout(r, ms));
};

describe("installResolveWordPort (SW side)", () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  it("ignores a port with a different name", () => {
    const port = makePort("some-other-channel");
    wire(async (_p, emit) => { emit({ phase: "local" }); }, port);
    expect(port.posted as unknown[]).toHaveLength(0);
  });

  it("delivers every phase, in order, then done", async () => {
    const port = makePort();
    wire(async (_p, emit) => {
      emit({ phase: "local", entry: { token: "run" } });
      await settle(2);
      emit({ phase: "translation" });
      await settle(2);
      emit({ phase: "enrichment" });
      await settle(2);
      emit({ phase: "done" });
    }, port);
    await settle(20);
    expect(phasesOf(port)).toEqual(["local", "translation", "enrichment", "done"]);
  });

  it("reports error + done when produce throws", async () => {
    const port = makePort();
    wire(async () => { throw new Error("boom"); }, port);
    await settle(5);
    expect(phasesOf(port)).toEqual(["error", "done"]);
  });

  it("stops emitting after the port disconnects", async () => {
    const port = makePort();
    wire(async (_p, emit) => {
      emit({ phase: "local", entry: { token: "run" } });
      await settle(6);
      emit({ phase: "translation" });
      await settle(6);
      emit({ phase: "done" });
    }, port);
    await settle(2); // only `local` has landed
    port.onDisconnect.fire();
    await settle(20);
    expect(phasesOf(port)).toEqual(["local"]);
  });

  it("never posts on a closed port (mid-flight dismiss)", async () => {
    const port = makePort();
    let closed = false;
    port.postMessage = (m: unknown) => {
      if (closed) throw new Error("port closed");
      port.posted.push(m);
    };
    wire(async (_p, emit) => {
      emit({ phase: "local", entry: { token: "run" } });
      await settle(3);
      emit({ phase: "translation" }); // throws now -> cancel
      await settle(3);
      emit({ phase: "done" });        // must be swallowed
    }, port);
    await settle(2);
    closed = true;
    await settle(15);
    expect(phasesOf(port)).toEqual(["local"]);
  });
});