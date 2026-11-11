import { describe, expect, it } from 'vitest';
import {
  COVERAGE_MIN, COVERAGE_OPTIMAL, coverageVerdictKey, episodeCoverage,
} from '../../src/app/components/tabs/episodeCoverage';
import type { WordStatus } from '../../src/shared/study/wordStatus';

const statusMap: Record<string, WordStatus> = { k: 'known', l: 'learning', n: 'new' };
const statusOf = (key: string): WordStatus => statusMap[key];

describe('episodeCoverage', () => {
  it('counts running words per status and rounds the shares', () => {
    // 92 known, 5 learning, 3 new = 100 running words.
    const coverage = episodeCoverage(
      [{ key: 'k', count: 92 }, { key: 'l', count: 5 }, { key: 'n', count: 3 }],
      statusOf,
    );
    expect(coverage.occ).toEqual({ known: 92, learning: 5, new: 3 });
    expect(coverage.total).toBe(100);
    expect(coverage.pct('known')).toBe(92);
    expect(coverage.pct('learning')).toBe(5);
    expect(coverage.pct('new')).toBe(3);
    expect(coverage.knownPct).toBe(92);
  });

  it('rounds to the nearest integer and survives an empty episode', () => {
    const coverage = episodeCoverage(
      [{ key: 'k', count: 2 }, { key: 'n', count: 1 }],
      statusOf,
    );
    expect(coverage.pct('known')).toBe(67);
    expect(coverage.pct('new')).toBe(33);

    const empty = episodeCoverage([], statusOf);
    expect(empty.total).toBe(0);
    expect(empty.knownPct).toBe(0);
    expect(empty.pct('learning')).toBe(0);
  });
});

describe('coverageVerdictKey', () => {
  it('buckets comprehension at the 80% and 95% boundaries', () => {
    expect(coverageVerdictKey(100)).toBe('ws.coverageEasy');
    expect(coverageVerdictKey(COVERAGE_OPTIMAL)).toBe('ws.coverageEasy');
    expect(coverageVerdictKey(94)).toBe('ws.coverageOk');
    expect(coverageVerdictKey(COVERAGE_MIN)).toBe('ws.coverageOk');
    expect(coverageVerdictKey(79)).toBe('ws.coverageHard');
    expect(coverageVerdictKey(0)).toBe('ws.coverageHard');
  });
});
