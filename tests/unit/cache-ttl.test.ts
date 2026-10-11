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
    expect(normalizeTtlDays(0 as unknown as number)).toBe(14);
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

  it('falls back to the CALLER default, not the module one', () => {
    // 23766cc wired the AI cache through this guard with NO fallback, so an
    // unset/0/negative AI ttl read the module's 14 and silently halved that
    // cache's window from its shipped 30. The fallback belongs to the caller
    // depends on which cache is being guarded.
    expect(normalizeTtlDays(0, 30)).toBe(30);
    expect(normalizeTtlDays(-5, 30)).toBe(30);
    expect(normalizeTtlDays(undefined, 30)).toBe(30);
    expect(normalizeTtlDays(NaN, 30)).toBe(30);
    expect(normalizeTtlDays(null, 30)).toBe(30);
    // An in-range value ignores the fallback entirely.
    expect(normalizeTtlDays(7, 30)).toBe(7);
    // A real fraction still floors to 1 under any fallback.
    expect(normalizeTtlDays(0.4, 30)).toBe(1);
    // The default call keeps the module default.
    expect(normalizeTtlDays(0)).toBe(14);
  });
});
