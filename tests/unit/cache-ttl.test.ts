/**
 * The guard every cache-ttl entry point shares (the reviews of 884a410 and
 * 5539df5). The failure each case pins is a REAL one that shipped:
 * `Number(v) || 14` caught 0 and NaN but let a typed `-5` through, and a
 * negative ttl computes a prune threshold ABOVE `now` — every row deleted,
 * every row declared stale by the reader.
 *
 * The last shape decision, from review: a cleared field, `0` and a negative
 * are NOT "the minimum" — they are an unfinished or wrong input, so they fall
 * back to the DEFAULT (14). Only a real fraction (0 < t < 1) floors to 1.
 */
import { describe, it, expect } from 'vitest';
import { normalizeTtlDays, DEFAULT_CACHE_TTL_DAYS } from '../../src/shared/cache-ttl';

describe('normalizeTtlDays', () => {
  it('keeps in-range integers', () => {
    expect(normalizeTtlDays(14)).toBe(14);
    expect(normalizeTtlDays(30)).toBe(30);
    expect(normalizeTtlDays(365)).toBe(365);
  });

  it('caps at the ceiling', () => {
    expect(normalizeTtlDays(9_999)).toBe(365);
    expect(normalizeTtlDays(1_000_000)).toBe(365);
  });

  it('floors to whole days', () => {
    expect(normalizeTtlDays(14.7)).toBe(14);
    expect(normalizeTtlDays(30.99)).toBe(30);
  });

  it('treats 0, an empty field and non-finite as "unset" -> the default', () => {
    // 5539df5 turned a CLEARED field into a one-day cache: clearing the TTL
    // equivalent to "prune everything past 24 h". It is an unfinished input.
    expect(normalizeTtlDays(0)).toBe(14);
    expect(normalizeTtlDays(0)).toBe(DEFAULT_CACHE_TTL_DAYS);
    expect(normalizeTtlDays(NaN)).toBe(14);
    expect(normalizeTtlDays(Number.POSITIVE_INFINITY)).toBe(14);
    expect(normalizeTtlDays(null)).toBe(14);
    expect(normalizeTtlDays(undefined)).toBe(14);
  });

  it('treats a negative as "unset" -> the default, not the floor', () => {
    // A sign typo is not an intention of "minimum"; both read as fallback.
    expect(normalizeTtlDays(-5)).toBe(14);
    expect(normalizeTtlDays(-0.5)).toBe(14);
  });

  it('floors a real fraction of a day up to one day', () => {
    expect(normalizeTtlDays(0.5)).toBe(1);
    expect(normalizeTtlDays(0.999)).toBe(1);
  });
});