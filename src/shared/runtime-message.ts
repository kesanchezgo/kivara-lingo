/**
 * One `chrome.runtime.sendMessage` round-trip, normalised.
 *
 * Three things can go wrong before a handler ever runs, and each used to be
 * handled slightly differently at every call site: no `chrome.runtime` at all
 * (tests, non-extension contexts), a dead channel (`lastError` — the worker was
 * reloaded or there is no receiver), and a send that throws synchronously
 * ("Extension context invalidated"). This module collapses them into one
 * outcome; callers decide how to phrase the failure.
 *
 * No i18n here on purpose: what counts as user-facing copy differs per surface,
 * and `src/shared` modules must not reach the UI dictionary.
 */
export type RuntimeMessageFailure =
  | { ok: false; unavailable: true }
  | { ok: false; unavailable: false; error: string };

export type RuntimeMessageOutcome<T> = { ok: true; reply: T } | RuntimeMessageFailure;

export function sendRuntimeMessage<T>(message: unknown): Promise<RuntimeMessageOutcome<T>> {
  return new Promise((resolve) => {
    try {
      const runtime = typeof chrome === 'undefined' ? undefined : chrome.runtime;
      if (!runtime?.sendMessage) {
        resolve({ ok: false, unavailable: true });
        return;
      }
      runtime.sendMessage(message, (reply?: T) => {
        // Chrome sets lastError only while the callback runs, and reading it
        // is what drains it (an unread one logs a warning to the host page).
        const err = runtime.lastError;
        if (err) {
          resolve({ ok: false, unavailable: true });
          return;
        }
        if (reply === undefined || reply === null) {
          resolve({ ok: false, unavailable: false, error: 'empty reply' });
          return;
        }
        resolve({ ok: true, reply });
      });
    } catch (err) {
      resolve({ ok: false, unavailable: false, error: (err as Error).message });
    }
  });
}
