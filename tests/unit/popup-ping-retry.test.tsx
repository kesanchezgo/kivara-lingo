/**
 * The popup's retry hook, driven through a component with REAL React state —
 * the review caught every earlier version passing over a toy harness whose
 * fail() did not re-render and whose nothing ever re-rendered during pinging.
 * This one IS popup-shaped: the status is useState, ping/fail setState, and the
 * effect lifecycle is Popup's own (cleanup on every status change).
 *
 * Time is stepped in 1 s slices, because React defers the setState inside a
 * timer callback and one huge advanceTimersByTime(…) would collapse the
 * effect re-runs that sit between watchdog, re-ping and fail; 1 s slices flush
 * every commit, the way the real event loop does.
 *
 * The timeline the hook must produce, with the opening ping sent and LOST
 * (the SW still waking) and nothing answering it:
 *   t=7500ms  silent forced re-ping 1      (no error is ever shown)
 *   t=15000ms silent forced re-ping 2
 *   t=20000ms budget spent → error
 *   t=24000ms poll tick, every 4 s from there, each one forced
 * A poll ping that hangs returns the pill to error at 5 s and the interval
 * re-arms from the fresh error.
 *
 * Falsifications the review named: lambdas back in the effect deps break case 2;
 * ping(false) in the poll breaks the poll asserts; resetting bootRef on error
 * breaks case 3's chain.
 */
import { act, cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ERROR_RETRY_MS,
  type PingStatus,
  usePingRetry,
} from '../../src/popup/ping-retry';

let events: Array<{ at: number; kind: 'ping' | 'fail'; force: boolean }> = [];
/** Popup's in-flight ref, reproduced: blocks every unforced send. */
let inflight = false;
/** Whether an outstanding ping gets a reply. */
let answers: 'none' | 'ok';

function Harness({ churn = 0 }: { churn?: number }) {
  const [status, setStatus] = useState<PingStatus>('pinging');
  usePingRetry({
    status,
    ping: (f?: boolean) => {
      // Popup's runPing guard, verbatim: unforced pings dedup on the ref.
      if (inflight && f !== true) return;
      inflight = true;
      events.push({ at: Date.now(), kind: 'ping', force: f === true });
      setStatus('pinging');
      if (answers === 'ok') {
        setStatus('ok');
        inflight = false;
      }
    },
    fail: () => {
      inflight = false;
      events.push({ at: Date.now(), kind: 'fail', force: true });
      setStatus('error');
    },
  });
  return (
    <span data-testid="pill">
      {status}|{churn}
    </span>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  events = [];
  inflight = true; // The opening ping is out and lost, by default.
  answers = 'none';
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Advance ms, committing React work every slice (every 1 s). */
const tick = (ms: number) => {
  for (let left = ms; left > 0; left -= 1_000) {
    const step = Math.min(1_000, left);
    act(() => void vi.advanceTimersByTime(step));
  }
};

const pill = () => document.querySelector('[data-testid="pill"]')?.textContent ?? '';
const pings = () => events.filter((e) => e.kind === 'ping');
const fails = () => events.filter((e) => e.kind === 'fail');

/**
 * Advance ms seconds, but flip `answers` ON between a re-ping and its reply —
 * the review requires the case where the RETRY itself lands ok.
 */
const tickWithOkAt = (ms: number, okAt: number) => {
  for (let left = ms; left > 0; left -= 1_000) {
    const now = Date.now();
    if (now >= okAt && answers === 'none') answers = 'ok';
    act(() => void vi.advanceTimersByTime(Math.min(1_000, left)));
  }
};

describe('usePingRetry (through real React state)', () => {
  it('1: the first lost ping is retried SILENTLY, and an ok answer ends it', () => {
    render(<Harness />);
    tick(7_500);
    // The first re-ping (armed 2.5 s into the 5 s watchdog) is FORCED and the
    // pill never flips to error in between: one lost message is not "down".
    expect(pings().map((e) => e.at)).toEqual([7_500]);
    expect(pings()[0]!.force).toBe(true);
    expect(pill().startsWith('pinging')).toBe(true);

    // The reply reaches a later retry and the chain is over at once.
    tickWithOkAt(60_000, 1_000);
    expect(pill().startsWith('ok')).toBe(true);
    expect(pings().every((e) => e.force && e.at < 20_000)).toBe(true);
    expect(pings().every((e) => e.force)).toBe(true);
    expect(fails()).toHaveLength(0);
    const after = pings().length;
    tick(30_000);
    expect(pings()).toHaveLength(after); // silence from here on
  });

  it('1 tail: everything lost → error at the spent budget, then a forced poll', () => {
    render(<Harness />);
    tick(24_000);
    expect(pings().map((e) => e.at)).toEqual([7_500, 15_000, 24_000]);
    expect(pings().every((e) => e.force)).toBe(true);
    expect(fails().map((e) => e.at)).toEqual([20_000]);
    // The poll sent at 24 s, so the pill cycles: error → pinging → error.
    expect(pill().startsWith('pinging')).toBe(true);
    // The poll keeps asking every 4 s; the hung ones come back to error.
    tick(20_000);
    expect(fails().length).toBeGreaterThan(1);
    expect(pings().every((e) => e.force)).toBe(true);
  });

  it('2: a render during pinging does NOT restart the watchdog', () => {
    const current = render(<Harness />);
    // Real Popup churn (the store settles as a render while the pill is still
    // on "Comprobando…"): the status stays pinging.
    tick(2_000);
    act(() => current.rerender(<Harness churn={1} />));
    tick(3_000);
    expect(pings()).toHaveLength(0); // 5 s from arming — nothing fired at 3 s
    tick(2_500); // now at 7.5 s
    expect(pings().map((e) => e.at)).toEqual([7_500]);
    expect(fails()).toHaveLength(0);
  });

  it('3: a hung poll ping fails at 5 s and the poll re-arms', () => {
    render(<Harness />);
    tick(20_000);
    expect(pill().startsWith('error')).toBe(true);
    // The poll sends at 24 s; that ping hangs too → the budget is spent, so
    // the watchdog fails it straight back to error at 29 s.
    tick(9_000);
    expect(pings().filter((e) => e.at >= 24_000)).toHaveLength(1);
    expect(fails().map((e) => e.at)).toEqual([20_000, 29_000]);
    expect(pill().startsWith('error')).toBe(true);
    // The interval re-armed from the fresh error.
    const before = pings().length;
    tick(ERROR_RETRY_MS);
    expect(pings().length).toBeGreaterThan(before);
  });

  it('4: an ok answer keeps everything silent', () => {
    render(<Harness />);
    act(() => {
      answers = 'ok';
    });
    tick(7_500); // the retry carries the reply
    expect(pill().startsWith('ok')).toBe(true);
    const before = pings().length;
    tick(60_000);
    expect(pings()).toHaveLength(before);
    expect(fails()).toHaveLength(0);
  });

  it('5: unmount leaves zero timers', () => {
    const current = render(<Harness />);
    tick(2_000);
    act(() => current.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });
});
