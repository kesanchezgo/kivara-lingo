/**
 * The TTL guard, shared by the settings UI, the store and the background
 * cache. It lives in `shared/` — NOT next to the cache — because the app
 * bundle must not pull Dexie in just to validate a number.
 *
 * The settings input used `Number(v) || 14`, which catches 0 and NaN but
 * lets a typed `-5` through; a negative ttl computes a prune threshold
 * ABOVE `now`, so the pruner deleted every row and the reader called every
 * row stale — the whole cache wiped because someone typed a dash. Values
 * come from saved settings too (an older build, a hand-edited flag), so
 * every entry point normalizes: the read, the write, the UI and hydration.
 *
 * 0 < ttl < 1 floors to 1, not to the default: a user who typed a fraction
 * meant days-as-a-whole-number, and a fraction of a day is one day.
 */
export const DEFAULT_CACHE_TTL_DAYS = 14;
export const MAX_CACHE_TTL_DAYS = 365;

export function normalizeTtlDays(days: number | null | undefined): number {
  if (typeof days !== 'number' || !Number.isFinite(days)) return DEFAULT_CACHE_TTL_DAYS;
  if (days < 1) return 1;
  return Math.min(Math.floor(days), MAX_CACHE_TTL_DAYS);
}
