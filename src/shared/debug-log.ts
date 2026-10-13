/**
 * Debug logging, off unless `kivaraDebug` is set in local storage by the
 * options page. A production build ships silent.
 *
 * One module for every context — service worker, content script, popup — so
 * the flag is read in one place and no surface grows its own copy.
 */
let DEBUG = false;

try {
  if (typeof chrome !== 'undefined' && chrome.storage?.local?.get) {
    void chrome.storage.local.get({ kivaraDebug: false }).then((v) => {
      DEBUG = Boolean((v as { kivaraDebug?: boolean }).kivaraDebug);
    });
  }
} catch {
  // Non-extension context (vitest, plain page): stay silent.
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
