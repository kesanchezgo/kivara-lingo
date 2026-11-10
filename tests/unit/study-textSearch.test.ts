import { describe, expect, it } from 'vitest';
import { findRanges, foldForSearch, splitByRanges } from '../../src/shared/study/textSearch';

describe('textSearch · foldForSearch', () => {
  it('lowercases and removes accents', () => {
    expect(foldForSearch('Vuelos')).toBe('vuelos');
    expect(foldForSearch('renunciá')).toBe('renuncia');
  });

  it('preserves the length of the original string', () => {
    const s = 'Café Ñandú';
    expect(foldForSearch(s)).toHaveLength(s.length);
  });

  it('handles empty input', () => {
    expect(foldForSearch('')).toBe('');
  });
});

describe('textSearch · findRanges', () => {
  it('finds every non-overlapping match in order', () => {
    expect(findRanges('Vuelos vuelos', 'vuelos')).toEqual([[0, 6], [7, 13]]);
  });

  it('returns nothing for an empty query', () => {
    expect(findRanges('anything', '')).toEqual([]);
  });
});

describe('textSearch · splitByRanges', () => {
  it('splits a fragment into hit and non-hit chunks', () => {
    expect(splitByRanges('hello world', 0, [[0, 5]])).toEqual([
      { text: 'hello', hit: true },
      { text: ' world', hit: false },
    ]);
  });

  it('ignores ranges outside the fragment', () => {
    expect(splitByRanges('hello', 0, [[10, 12]])).toEqual([{ text: 'hello', hit: false }]);
  });
});