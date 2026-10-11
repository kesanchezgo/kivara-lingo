/**
 * The TTL guard, shared by the settings UI, the store and the background
 * cache. It lives in `shared/` — NOT next to the cache — because the app
 * bundle must not pull Dexie in just to validate a number.
 *
 * The settings input used `Number(v) || 14`, which catches 0 and NaN but
 * lets a typed `-5` through; a negative ttl computes a prune threshold
 * ABOVE `now`, so the pruner deleted every row and the reader called every
 * row stale — the whole cache wiped because someone typed a dash. Values
 * reach the cache from saved settings too (an older build, a hand-edited
 * flag), so every entry point normalizes: the read, the write, the UI and
 * the store hydration.
 *
 * A cleared field, a `0`, a negative or a non-finite is an unfinished or
 * wrong input, not "the minimum": those fall back to the DEFAULT (14).
 * 0 < ttl < 1 floors to 1: a user who typed a fraction meant whole days,
 * and a fraction of a day is one day.
 */
export const DEFAULT_CACHE_TTL_DAYS = 14;
export const MAX_CACHE_TTL_DAYS = 365;

export function normalizeTtlDays(days: number | null | undefined): number {
  // No input, an empty field, a cleared `0` or a non-finite: the user
  // cleared the field, not asked for a one-day cache. A negative is not
  // an intention of `minimum` either — both fall back to the default.
  if (typeof days !== 'number' || !Number.isFinite(days) || days <= 0) {
    return DEFAULT_CACHE_TTL_DAYS;
  }
  // 0 < ttl < 1 floors to 1: a fraction of a day is one day.
  if (days < 1) return 1;
  return Math.floor(Math.min(days, MAX_CACHE_TTL_DAYS));
}
