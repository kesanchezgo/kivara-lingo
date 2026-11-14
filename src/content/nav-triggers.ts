/**
 * SPA navigation triggers, extracted from index.tsx so they are testable.
 *
 * Patching `history.pushState` / `history.replaceState` and listening for
 * `popstate` is enough for a cooperative SPA, but not for one that captured
 * the native history methods BEFORE the content script ran: Netflix's player
 * framework keeps its own reference to the original `pushState`, so every SPA
 * navigation from /browse to /watch bypassed the patch — and `popstate` does
 * not fire for pushState. Result on real Netflix: Kivara never mounted on the
 * watch page (QA stage A3).
 *
 * Two catch-alls fix it, both installed here:
 *  - Chrome's Navigation API (`window.navigation`) fires `navigate` for every
 *    navigation, pushState included, regardless of who holds the old
 *    reference.
 *  - A 1 Hz href watchdog on the host location, for engines without the
 *    Navigation API and as the final net if an isolated-world listener is not
 *    delivered. One string comparison per second, no DOM work.
 *
 * Everything is injected through `host` so the unit tests can drive it with a
 * fake window and fake timers.
 */

/** The slice of `window` the triggers need. */
export interface NavTriggersHost {
  history: Pick<History, 'pushState' | 'replaceState'>;
  location: { href: string };
  addEventListener(type: string, listener: () => void): void;
  setInterval(handler: () => void, ms: number): number;
  clearInterval(id: number): void;
  navigation?: {
    addEventListener(type: string, listener: () => void): void;
  };
}

/** How often the href watchdog compares the URL when the Navigation API is silent. */
export const HREF_WATCHDOG_MS = 1_000;

/**
 * Install every navigation trigger on `host`; each one calls `onChange`.
 * Returns a teardown that stops the watchdog (the history patch and the
 * listeners stay: undoing a patch the page may have captured already is
 * pointless, and removing listeners mid-session gains nothing).
 */
export function installNavigationTriggers(
  host: NavTriggersHost,
  onChange: () => void,
  watchdogMs: number = HREF_WATCHDOG_MS,
): () => void {
  const history = host.history as History;
  const origPush = history.pushState;
  history.pushState = function (this: History, ...args: Parameters<History['pushState']>) {
    const result = origPush.apply(this, args);
    onChange();
    return result;
  };
  const origReplace = history.replaceState;
  history.replaceState = function (this: History, ...args: Parameters<History['replaceState']>) {
    const result = origReplace.apply(this, args);
    onChange();
    return result;
  };
  host.addEventListener('popstate', onChange);

  // Catch-all #1: the Navigation API sees the navigations the patch cannot.
  host.navigation?.addEventListener('navigate', onChange);

  // Catch-all #2: href watchdog. One comparison per tick; silent unless the
  // URL actually changed, so it never triggers a spurious remount.
  let lastHref = host.location.href;
  const watchdog = host.setInterval(() => {
    const href = host.location.href;
    if (href === lastHref) return;
    lastHref = href;
    onChange();
  }, watchdogMs);

  return () => host.clearInterval(watchdog);
}
