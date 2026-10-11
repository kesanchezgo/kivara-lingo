/**
 * The Anki ping's retry policy AND its hook. The review caught three
 * regressions in the previous version, all hidden by a toy harness that did
 * not behave like Popup (its `fail` did not re-render, and nothing re-rendered
 * during pinging). The three were:
 *
 *  - the forced re-ping after the watchdog never left: `fail()` flipped the
 *    status to error, and the cleanup the flip caused cancelled the retry that
 *    had been chained off the status effect;
 *  - the error poll used setTimeout with ping(false) — refused by Popup's
 *    in-flight dedup — so the poll died after one tick and never re-armed;
 *  - `ping`/`fail` were inline lambdas in the hook's OWN effect deps, so any
 *    Popup render during pinging restarted the watchdog (indefinite delay).
 *
 * The shape that survives all three: callbacks in refs, `status` as the only
 * effect dep, retries that re-arm THEMSELVES from their own timer callbacks
 * (so a status change cannot cancel a chain in flight), a SILENT boot retry
 * (one lost message is not "AnkiConnect is down"), and an always-final error
 * poll.
 */

import { useEffect, useRef } from 'react';

export type PingStatus = 'idle' | 'pinging' | 'ok' | 'error';

/** A lost boot ping: watchdog 5 s, then a silent re-ping. Budget per opening. */
export const BOOT_RETRY_MS = 2_500;
export const BOOT_RETRY_MAX = 2;
export const BOOT_WATCHDOG_MS = 5_000;

/** Disconnected: forced poll every 4 s while the status is error.
 *
 * The nominal cadence is what the name says, but a hung poll ping lands the
 * status on pinging and pays for a 5 s watchdog first, so the observed gap
 * between two poll sends is 4 s + 5 s ≈ 9 s when the answers never arrive. */
export const ERROR_RETRY_MS = 4_000;

export interface PingRetryOptions {
  status: PingStatus;
  /**
   * One opening cycle: the url+key the pings go to. A change grants the new
   * cycle a fresh boot budget (switching the AnkiConnect url must not inherit
   * a spent budget from the previous one).
   */
  key?: string;
  /** A re-ping. `force` means "skip Popup's in-flight dedup on purpose". */
  ping: (force?: boolean) => void;
  /** Move to the error state (the boot budget is spent). */
  fail: () => void;
}

export function usePingRetry({ status, key = '', ping, fail }: PingRetryOptions): void {
  const pingRef = useRef(ping);
  const failRef = useRef(fail);
  pingRef.current = ping;
  failRef.current = fail;

  // The boot budget: re-pings granted to one opening cycle. Reset when the
  // cycle opens (idle/ok) or when its key changes — NOT on error, where the
  // poll owns the state from then on.
  const bootRef = useRef(0);
  const keyRef = useRef(key);
  const genRef = useRef(0);

  // The generation guards every timer callback: a chain armed during this
  // cycle is inert the moment a newer status OR key substitutes the effect.
  // `key` in the deps IS the fix: without it, changing url/port while
  // `pinging` retired the chain WITHOUT re-arming the watchdog (the budget
  // effect bumped the generation, the timer effect never re-ran), so the pill
  // sat on "Comprobando…" forever with no chain and no interval to resume it.
  useEffect(() => {
    if (keyRef.current !== key) {
      keyRef.current = key;
      bootRef.current = 0;
    } else if (status === 'idle' || status === 'ok') {
      bootRef.current = 0;
    }
    const gen = ++genRef.current;
    if (genRef.current !== gen) return undefined;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    if (status === 'pinging') {
      // A chain re-arms itself from its own callback: the budget comes from
      // bootRef (shared across pinging cycles of one opening), so a hung ping
      // after a fail does not get a fresh set of silent re-pings.
      const armWatchdog = () => {
        watchdog = setTimeout(() => {
          if (genRef.current !== gen) return;
          if (bootRef.current >= BOOT_RETRY_MAX) {
            // Budget spent: the failure is now real and visible.
            failRef.current();
            return;
          }
          bootRef.current += 1;
          // Re-ping SILENTLY — the pill stays on "Comprobando…", because a
          // single dropped message (the SW waking) is not "Anki is down".
          const next = setTimeout(() => {
            if (genRef.current !== gen) return;
            pingRef.current(true);
            armWatchdog();
          }, BOOT_RETRY_MS);
          watchdog = next;
        }, BOOT_WATCHDOG_MS);
      };
      armWatchdog();
      return () => {
        if (watchdog) clearTimeout(watchdog);
      };
    }

    if (status === 'error') {
      // Forced poll: the in-flight dedup in Popup refuses unforced sends, and
      // a hung poll ping keeps the status out of error — force is what keeps
      // this alive. A hung poll ping lands the status on pinging, which arms
      // its own watchdog against the (already spent) budget, fails back to
      // error in 5 s and this interval re-arms from the fresh error.
      interval = setInterval(() => pingRef.current(true), ERROR_RETRY_MS);
      return () => {
        if (interval) clearInterval(interval);
      };
    }

    return undefined;
  }, [status, key]);
}



