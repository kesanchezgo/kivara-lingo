/**
 * Debug logging, off unless `kivaraDebug` is set in local storage by the
 * options page. A production build ships silent.
 *
 * The flag is re-read on every WRITE to local storage rather than sampled
 * once: a user who turns debugging on in one context expects the service
 * worker's next log line without reloading it, and guessing at intervals
 * (a timer that keeps the worker alive) is worse than listening.
 */
let DEBUG = false;

function readFlag(): void {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local?.get) {
      void chrome.storage.local.get({ kivaraDebug: false }).then((v) => {
        DEBUG = Boolean((v as { kivaraDebug?: boolean }).kivaraDebug);
      });
    }
  } catch {
    // Non-extension context (vitest, plain page): stay silent.
  }
}

readFlag();
try {
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    // `local` only: the flag is a local-storage key, and a sync change for an
    // unrelated key must not cost anything.
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes.kivaraDebug) DEBUG = Boolean(changes.kivaraDebug.newValue);
    });
  }
} catch {
  /* listener unavailable (tests) */
}

/** Loud in dev, silent in a shipped build. */
export function dbg(...args: unknown[]): void {
  if (DEBUG) console.log(...args);
}

/**
 * Same guard, deduplicated per distinct argument tuple.
 *
 * A keydown listener fires per keystroke, and an unmapped combo is usually
 * the SAME one repeating — one line per distinct message instead of one per
 * press. Nothing sensitive lands here anyway.
 */
const seenDebug = new Set<string>();

export function dbgOnce(...args: unknown[]): void {
  if (!DEBUG) return;
  const key = args.map((a) => String(a)).join('\u0000');
  if (seenDebug.has(key)) return;
  seenDebug.add(key);
  dbg(...args);
}
