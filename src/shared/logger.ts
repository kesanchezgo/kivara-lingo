/**
 * The extension's logger (debt D5).
 *
 * Two things decide whether a line is printed:
 *
 *  1. `__DEV__` — a build constant. `vite build` (what ships, and what CI
 *     builds) sets it false, so a production bundle has no console chatter at
 *     all; `vite dev` keeps it loud.
 *  2. The `kivaraDebug` local-storage flag — for the extension pages and the
 *     worker, where the user can turn debugging on for a shipped build. The
 *     MAIN-world interceptor cannot read `chrome.storage` (it runs in the
 *     page's world), so there the build constant is the only gate.
 *
 * `devLog` replaces the bare `console.log` calls that shipped to every user's
 * console; warnings and errors are NOT routed here — those are diagnostics the
 * user may need to report, and they are few and deliberate.
 */
declare const __DEV__: boolean | undefined;

function devBuild(): boolean {
  // `typeof` keeps this safe where the define is absent (vitest, plain node):
  // an undeclared identifier inside `typeof` does not throw.
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

let flag = false;

/** Wire the `kivaraDebug` flag (extension pages and the worker only). */
export function initLogFlag(): void {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage?.local?.get) return;
    void chrome.storage.local.get({ kivaraDebug: false }).then((v) => {
      flag = Boolean((v as { kivaraDebug?: boolean }).kivaraDebug);
    });
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area !== 'local' || !changes.kivaraDebug) return;
      flag = Boolean(changes.kivaraDebug.newValue);
    });
  } catch {
    // No extension APIs (tests, a plain page): the build constant decides.
  }
}

/** True when a log line would be printed. Exported for the tests. */
export function logEnabled(): boolean {
  return devBuild() || flag;
}

/** Debug-level logging: silent in a production build without the flag. */
export function devLog(...args: unknown[]): void {
  if (logEnabled()) console.log(...args);
}
