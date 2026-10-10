/**
 * The Anki ping's retry policy AND its hook. The review caught the previous
 * version testing a pure function Popup never called, while Popup ran its own
 * inline copy of the same rules. The policy lives in ONE place (this module),
 * Popup consumes it through the hook, and the hook is what the test drives with
 * fake timers.
 *
 * Two retry situations, asked of the same status:
 *
 *  - BOOT: the first ping can reach the SW before it has finished waking (the SW
 *    stays productive through storage hydration, so pre-flight looks fine), the
 *    message is dropped, AnkiConnect never registers a hit, and the pill sits on
 *    "Comprobando…". A bounded re-ping fixes that with no user click.
 *  - ERROR: disconnected. Poll forever so the popup recovers when Anki opens.
 *
 * The bug this file exists for: an old Popup effect used ONE counter — reset to
 * 0 on the error branch, with a `< 1` guard that returned before scheduling, so
 * "Auto-retry every 4 s" never ran once; and its boot branch could not produce a
 * second attempt, because the counter only advanced on a status CHANGE and a
 * re-ping landing back on 'pinging' is neither a new render nor an effect
 * re-entry.
 */

import { useEffect, useRef } from 'react';

/** Silent-first-ping: re-ping after this long, at most BOOT_RETRY_MAX times. */
export const BOOT_RETRY_MS = 2_500;
export const BOOT_RETRY_MAX = 2;

/** Disconnected: poll this often while the status is error. */
export const ERROR_RETRY_MS = 4_000;

/** A boot attempt with no answer by now: the request was dropped, not slow. */
export const BOOT_WATCHDOG_MS = 5_000;

export type PingStatus = 'idle' | 'pinging' | 'ok' | 'error';

export interface PingRetryOptions {
  status: PingStatus;
  /** A re-ping. `force` means "skip Popup's in-flight dedup on purpose". */
  ping: (force?: boolean) => void;
  /** Move to the error state because a watchdog outlived its answer. */
  fail: () => void;
}

/**
 * Wire the policy to the ping.
 *
 * The retry chain is driven by the timer callbacks themselves, not by status
 * changes: `setPing({status:'pinging'})` over a ping already 'pinging' produces
 * neither a render nor an effect re-entry, which is what kept the old boot loop
 * at one attempt forever. The sequence carried by each watchdog token is what
 * makes a watchdog retire the moment its attempt is answered or superseded.
 */
export function usePingRetry({ status, ping, fail }: PingRetryOptions): void {
  const bootRef = useRef(0);
  const seqRef = useRef(0);

  // A new ping cycle resets the boot cap (so a later disconnect starts fresh).
  if (status !== 'pinging') bootRef.current = 0;

  useEffect(() => {
    // `seq` is bumped when the watchdog is ARMED, so an answer (which lands as
    // a status change and clears this effect) or a newer manual re-ping cannot
    // be shot down by the watchdog that preceded it.
    const token = (seqRef.current += 1);
    let retry: ReturnType<typeof setTimeout> | null = null;

    if (status === 'pinging') {
      const watchdog = setTimeout(() => {
        // Superseded: either a newer ping was armed, or the answer landed.
        if (seqRef.current !== token) return;
        if (bootRef.current >= BOOT_RETRY_MAX) return;
        // Stuck: move to error, which owns the periodic poll, then re-ping
        // ONCE, forced, so the user does not wait a full poll tick.
        fail();
        bootRef.current += 1;
        retry = setTimeout(() => ping(true), BOOT_RETRY_MS);
      }, BOOT_WATCHDOG_MS);
      return () => {
        clearTimeout(watchdog);
        if (retry) clearTimeout(retry);
      };
    }

    if (status === 'error') {
      retry = setTimeout(() => {
        if (seqRef.current !== token) return;
        ping(false);
      }, ERROR_RETRY_MS);
      return () => {
        if (retry) clearTimeout(retry);
      };
    }

    return undefined;
  }, [status, ping, fail]);
}
