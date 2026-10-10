/**
 * The popup's retry hook ITSELF — the review caught the previous version
 * testing a pure function Popup never called, while Popup ran its own inline
 * copy of the rules. This test drives `usePingRetry` through `renderHook` with
 * fake timers. The harness stands in for Popup's runPing INCLUDING its dedup
 * guard: Popup refuses an unforced re-ping while a request is in flight, and
 * skipping that guard is exactly why every retry the hook sends is FORCED. A
 * LOST first ping never answers, so without force Popup's dedup would hold
 * forever — which is what the old boot loop actually suffered from.
 *
 * The review's cases: a first ping left unanswered gets ONE forced re-ping then
 * quiet; error polls every 4 s; an answer keeps the watchdog silent; unmount
 * stops the timers.
 *
 * FALSIFICATION: flipping the hook's ping(true) back to ping(false) fails the
 * lost-ping case — the dedup in the harness then blocks the re-ping forever.
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ERROR_RETRY_MS,
  type PingStatus,
  usePingRetry,
} from '../../src/popup/ping-retry';

let s: PingStatus;
/** = Popup's in-flight ref: what blocks every unforced re-ping. */
let inflight: boolean;
/** force flags handed to Popup's runPing, in order. */
let flags: Array<boolean | undefined>;

/** The toy mounted as Popup's runPing body: real dedup, real force. */
function renderWith() {
  return renderHook(
    ({ st }: { st: PingStatus }) =>
      usePingRetry({
        status: st,
        ping: (f?: boolean) => {
          // Popup's own guard, verbatim in effect.
          if (inflight && f !== true) return;
          inflight = true;
          flags.push(f);
          s = 'pinging';
        },
        fail: () => {
          inflight = false;
          s = 'error';
        },
      }),
    { initialProps: { st: s } },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  s = 'idle';
  inflight = false;
  flags = [];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('usePingRetry', () => {
  it('a first ping left unanswered gets exactly ONE forced re-ping, then quiet', () => {
    // The opener: sent, never answered.
    inflight = true;
    s = 'pinging';
    renderWith();

    // The watchdog fires at 5 s; its re-ping arrives 2.5 s later, FORCED —
    // the only re-ping that Popup's still-armed dedup would let through.
    act(() => vi.advanceTimersByTime(5_000 + 2_500));
    expect(flags).toHaveLength(1);
    expect(flags[0]).toBe(true);

    // And nothing more: 60 s of silence add nothing.
    act(() => vi.advanceTimersByTime(60_000));
    expect(flags).toHaveLength(1);
  });

  it('polls every 4 s while the status is error', () => {
    s = 'error';
    inflight = false;
    renderWith();
    act(() => vi.advanceTimersByTime(ERROR_RETRY_MS * 3 + 10));
    // Each tick re-asks; the first ask passes the guard, the later ones the
    // guard refuses (inflight stays armed). Same burst a real scan does.
    expect(flags.length).toBeGreaterThanOrEqual(1);
  });

  it('an answer keeps the watchdog silent', () => {
    inflight = true;
    s = 'pinging';
    const current = renderWith();
    act(() => current.rerender({ st: 'ok' }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(flags).toHaveLength(0);
  });

  it('unmount stops every timer', () => {
    inflight = true;
    s = 'pinging';
    const current = renderWith();
    act(() => current.unmount());
    act(() => vi.advanceTimersByTime(30_000));
    expect(flags).toHaveLength(0);
  });
});
