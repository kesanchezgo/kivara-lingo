/**
 * The Anki ping's retry policy: the two timers the popup runs with, as named
 * constants and one testable transition. The popup component itself would be a
 * nightmare to drive with fake timers (store hydration, chrome APIs, the whole
 * pill tree), so the POLICY lives here and its test drives the component's
 * exact logic — see tests/unit/popup-ping-retry.test.ts.
 *
 * The bug this file exists for: the previous version used ONE counter for both
 * policies. It incremented on any 'pinging' and reset to 0 on 'error', and its
 * guard (`< 1`) then returned before scheduling — so the "auto-retry every 4 s"
 * promised in the comment never ran once.
 */

/** Silent-first-ping case: re-ping after this long, at most BOOT_RETRY_MAX times. */
export const BOOT_RETRY_MS = 2_500;
export const BOOT_RETRY_MAX = 2;

/** Disconnected case: poll this often while the status is error. */
export const ERROR_RETRY_MS = 4_000;

export type PingStatus = 'idle' | 'pinging' | 'ok' | 'error';

/** What the popup's retry effect should schedule for a given status. */
export interface PingRetryDecision {
  /** Boot re-ping (silent first ping), or null when none is due. */
  bootRetryMs: number | null;
  /** Periodic retry (disconnected), or null when not running. */
  errorRetryMs: number | null;
  /** How many boot attempts this status transition consumed. */
  bootAttempts: number;
}

/**
 * The popup's decision, as a function of the status and how many boot attempts
 * have run. Boot attempts only count while the status STAYS pinging (a re-ping
 * landing back on 'pinging' would otherwise retry itself forever), and the
 * counter does not reset on error — the two policies are independent questions
 * asked of the same status.
 */
export function pingRetryDecision(status: PingStatus, bootAttempts: number): PingRetryDecision {
  if (status === 'pinging') {
    if (bootAttempts >= BOOT_RETRY_MAX) {
      return { bootRetryMs: null, errorRetryMs: null, bootAttempts };
    }
    return { bootRetryMs: BOOT_RETRY_MS, errorRetryMs: null, bootAttempts: bootAttempts + 1 };
  }
  if (status === 'error') {
    // Boot attempts stay where they are: the periodic loop is what runs now.
    return { bootRetryMs: null, errorRetryMs: ERROR_RETRY_MS, bootAttempts };
  }
  return { bootRetryMs: null, errorRetryMs: null, bootAttempts: 0 };
}
