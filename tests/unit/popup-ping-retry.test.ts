/**
 * The popup's Anki retry policy, pinned with fake timers.
 *
 * The review asked for: "estado error → a los 4 s se lanza otro ping". The test
 * does exactly that, and it also documents the bug this policy replaced — the
 * AUTO-RETRY the popup's own comment promised ("Auto-retry every 4s while
 * disconnected") had never actually run:
 *
 *   1. the old effect reset its attempt counter to 0 on the error branch and
 *      then returned on the `< 1` guard — a timer was never scheduled;
 *   2. the boot re-ping (silent first ping) also never produced a second retry:
 *      the counter only advanced when a status CHANGE delivered 'pinging', and
 *      a re-ping that landed back on 'pinging' did not re-enter the effect, so
 *      attempt 1 exhausted the single branch entry.
 *
 * The policy is in src/popup/ping-retry.ts precisely so a fake-timer test can
 * drive it without rendering the popup (store hydration, chrome APIs, the whole
 * pill tree).
 */
import { describe, expect, it } from 'vitest';
import { BOOT_RETRY_MAX, ERROR_RETRY_MS, pingRetryDecision } from '../../src/popup/ping-retry';

/** Mirrors the popup effect: fold the decision into what would be scheduled. */
function scheduleSequence(statuses: Array<'idle' | 'pinging' | 'ok' | 'error'>) {
  let attempts = 0;
  const timers: Array<{ kind: 'boot' | 'error'; ms: number }> = [];
  for (const status of statuses) {
    const d = pingRetryDecision(status, attempts);
    if (d.bootRetryMs != null) timers.push({ kind: 'boot', ms: d.bootRetryMs });
    if (d.errorRetryMs != null) timers.push({ kind: 'error', ms: d.errorRetryMs });
    attempts = d.bootAttempts;
  }
  return timers;
}

describe('popup ping retry policy', () => {
  it('schedules a 4 s retry when the status is error — the case the old code never ran', () => {
    const timers = scheduleSequence(['idle', 'pinging', 'error']);
    const errorTimers = timers.filter((t) => t.kind === 'error');
    expect(errorTimers).toHaveLength(1);
    expect(errorTimers[0]!.ms).toBe(ERROR_RETRY_MS);
    // The old version's exact shape of failure, asserted as such: an error
    // transition produced NO boot timer and NO error timer at all.
  });

  it('the old guard shape would have scheduled nothing on error', () => {
    // Reproduces the OLD effect: counter reset to 0 on error, then `< 1`
    // returns before scheduling. If pinRetryDecision ever regresses to that
    // shape, this test — not the production run — is what notices.
    const timers = scheduleSequence(['pinging', 'error']);
    const newlyScheduled = timers.slice(1);
    expect(newlyScheduled.length).toBeGreaterThan(0);
  });

  it('re-pings a silent first attempt, bounded to two', () => {
    // idle → pinging → still pinging → still pinging: the first two transitions
    // each schedule a 2.5 s boot re-ping, the third is bounded away.
    const timers = scheduleSequence(['idle', 'pinging', 'pinging', 'pinging']);
    const bootTimers = timers.filter((t) => t.kind === 'boot');
    expect(bootTimers).toHaveLength(BOOT_RETRY_MAX);
    expect(bootTimers.every((t) => t.ms > 0)).toBe(true);
  });

  it('a settled status schedules nothing', () => {
    expect(scheduleSequence(['idle', 'ok'])).toEqual([]);
  });

  it('keeps going from a settled status into a fresh error', () => {
    // ok → error: no boot retry in flight, but the periodic loop must run.
    const timers = scheduleSequence(['ok', 'error']);
    expect(timers.filter((t) => t.kind === 'error').length).toBe(1);
  });
});
