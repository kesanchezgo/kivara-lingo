/**
 * F5 gate: the subtitle frequency list is fetched lazily and cached
 * (docs/REDESIGN-V2.md §3 H8, §5.3, §8).
 *
 * The asset is ~345 KB of JSON and must NOT be imported into the content
 * bundle: it is fetched once per language from the extension origin and
 * cached in memory. Parsing drops `_meta` and any ragged value, so a broken
 * row cannot poison `Math.log` downstream.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createFrequencyCache, hasFrequencyList, parseFrequency,
} from '../../src/shared/study/frequency';
import enRank from '../../src/assets/frequency/en-rank.json';

describe('parseFrequency', () => {
  it('reads lemma → rank and ignores metadata and bad values', () => {
    const ranks = parseFrequency({
      _meta: { count: 2 },
      day: 149,
      Time: 80,
      broken: 'high',
      zero: 0,
    });
    expect(ranks.size).toBe(2);
    expect(ranks.rankOf('day')).toBe(149);
    expect(ranks.rankOf('time')).toBe(80);
    expect(ranks.rankOf('broken')).toBeNull();
    expect(ranks.rankOf('zero')).toBeNull();
    expect(ranks.rankOf('missing')).toBeNull();
  });

  it('folds typographic apostrophes before matching', () => {
    const ranks = parseFrequency({ "won't": 500 });
    expect(ranks.rankOf('won\u2019t')).toBe(500);
  });

  it('parses the committed asset', () => {
    const ranks = parseFrequency(enRank);
    expect(ranks.size).toBe(21_731);
    expect(ranks.rankOf('time')).toBe(80);
    expect(ranks.rankOf('day')).toBe(149);
    expect(ranks.rankOf('sane')).toBe(8342);
  });
});

describe('createFrequencyCache', () => {
  it('loads once per language, even with concurrent callers', async () => {
    const load = vi.fn(async () => ({ day: 149 }));
    const cache = createFrequencyCache(load);
    const [a, b] = await Promise.all([cache.get('en'), cache.get('en')]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(cache.peek('en')?.rankOf('day')).toBe(149);
    // A second call after the load does not hit the loader again.
    await cache.get('en');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed load: the next call retries', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ day: 149 });
    const cache = createFrequencyCache(load);
    expect(await cache.get('en')).toBeNull();
    expect(cache.peek('en')).toBeNull();
    expect(await cache.get('en')).not.toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reset forgets the parsed list', async () => {
    const load = vi.fn(async () => ({ day: 149 }));
    const cache = createFrequencyCache(load);
    await cache.get('en');
    cache.reset();
    expect(cache.peek('en')).toBeNull();
    await cache.get('en');
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('shipped languages', () => {
  it('only English has a list; others are an honest null', () => {
    expect(hasFrequencyList('en')).toBe(true);
    expect(hasFrequencyList('fr')).toBe(false);
  });
});
