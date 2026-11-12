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
 *
 * `dbg`/`dbgOnce` used to live in `debug-log.ts` with their own copy of the
 * `kivaraDebug` flag — two flags, two gates, one purpose. They are now thin
 * aliases over THIS gate: after the unification one flag decides every debug
 * line (`kivaraDebug`, plus the `__DEV__` build constant). That is the point
 * of the change. The `dbgOnce` dedupe keeps its exact move-in semantics: same
 * Set, same NUL-joined argument-tuple key, and disabled lines are never
 * recorded.
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

/** Loud in dev, silent in a shipped build — thin alias of `devLog`. */
export function dbg(...args: unknown[]): void {
  devLog(...args);
}

/**
 * Same gate, deduplicated per distinct argument tuple.
 *
 * A keydown listener fires per keystroke, and an unmapped combo is usually
 * the SAME one repeating — one line per distinct message instead of one per
 * press. Nothing sensitive lands here anyway. The gate is checked BEFORE the
 * key is recorded, so a disabled build accumulates nothing.
 */
const seenOnce = new Set<string>();

export function dbgOnce(...args: unknown[]): void {
  if (!logEnabled()) return;
  const key = args.map((a) => String(a)).join('\u0000');
  if (seenOnce.has(key)) return;
  seenOnce.add(key);
  devLog(...args);
}

/** Test seam: clears all logger module state (gate flag + dedupe set). */
export function __resetLogForTests(): void {
  flag = false;
  seenOnce.clear();
}
