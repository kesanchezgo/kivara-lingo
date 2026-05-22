/**
 * In-memory cache of headwords (lowercased lemmas) covered by the user's
 * currently enabled Yomitan packs.
 *
 * The bundled `en.json` only ships ~4 100 hand-curated entries — every word
 * outside that list (including everyday vocabulary like `excuse`, `pee`,
 * `pants`, `seventh`, `grade`) was being classified as `unknown` and shown
 * with a "SIN DICC." badge in the popover, even when the user had a 1.8M-
 * row Wiktionary EN→EN pack installed. The fix is to consult the packs
 * during tokenization, not just during the popover's RESOLVE_WORD round-
 * trip.
 *
 * Design:
 *   - The content script asks the service worker for the headword list at
 *     startup via `GET_YOMITAN_HEADWORDS`. The SW reads the union of
 *     `expression` columns from every enabled pack and ships it back as a
 *     `string[]`. The tokenizer then puts them in a Set for O(1) lookup.
 *   - The `tokenize.ts` module imports `hasYomitanHeadword(token)` and
 *     calls it whenever the bundled dictionary misses, before falling back
 *     to the proper-noun heuristic. A hit promotes the token from
 *     `unknown` to `known`.
 *   - The cache is **read-only by everyone except the loader**. The loader
 *     replaces it atomically (no Set-mutation patterns) so callers never
 *     see a partial state.
 *
 * The 1.5M-string Set is roughly 12-15 MB on the V8 heap. That's a one-
 * time cost shared across the whole tab; tokenization runs every cue
 * change so the constant-time membership test pays back almost
 * immediately.
 */

let headwords: Set<string> = new Set();
let loaded = false;

/**
 * Return `true` when `token` (case-insensitive) is a known headword in any
 * enabled Yomitan pack. Returns `false` while the cache is still loading
 * (the tokenizer falls back to the bundled dictionary in that case, which
 * is the prior behaviour — so loading time is graceful, not a hard
 * failure).
 */
export function hasYomitanHeadword(token: string): boolean {
  if (!loaded || headwords.size === 0) return false;
  return headwords.has(token.trim().toLowerCase());
}

/**
 * Replace the in-memory cache with the freshly loaded list. Atomic — the
 * Set is built off-heap and swapped in only after every entry is added,
 * so the tokenizer never sees a half-populated state.
 */
export function setYomitanHeadwords(words: ReadonlyArray<string>): void {
  const next = new Set<string>();
  for (const w of words) {
    const k = (w ?? '').trim().toLowerCase();
    if (k) next.add(k);
  }
  headwords = next;
  loaded = true;
}

/** Drop the cache — used when the user toggles a pack off / on. */
export function clearYomitanHeadwords(): void {
  headwords = new Set();
  loaded = false;
}

/** Diagnostic / coverage telemetry. */
export function getYomitanHeadwordCount(): number {
  return headwords.size;
}
