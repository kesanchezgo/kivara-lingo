/**
 * F5 gate: the level estimator and the status precedence
 * (docs/REDESIGN-V2.md §7 F5, §8).
 *
 * What matters:
 *   • the estimate is DETERMINISTIC — the same evidence gives the same θ,
 *     vocabulary and level, run after run (no clock, no RNG inside);
 *   • the precedence is mark > Anki > estimate, and a card promotes to known
 *     exactly at the mature boundary (21 days, Anki's own definition);
 *   • the estimate is not frozen: more «known» evidence raises the vocabulary,
 *     more «new» evidence lowers it.
 */
import { describe, expect, it } from 'vitest';
import {
  MATURE_INTERVAL_DAYS, buildEstimator, resolveDetailed,
  type AnkiCard, type EstimatorInput, type StudyWords, type WordStatus,
} from '../../src/shared/study/wordStatus';
import type { WordFeaturesInput } from '../../src/shared/study/lexicalModel';
import { COMMITTED_BANK } from '../../src/shared/study/vocabCheck';

/** Fixed evidence: no asset, no dictionary, no clock. */
const FEATURES: Record<string, WordFeaturesInput> = {
  time: { key: 'time', level: 'A1', rank: 80 },
  day: { key: 'day', level: 'A1', rank: 149 },
  sane: { key: 'sane', level: 'B2', rank: 8342 },
  afford: { key: 'afford', level: 'B1', rank: 1656 },
  cogent: { key: 'cogent' },
};
const words: StudyWords = { features: (key) => FEATURES[key] ?? { key } };

const NOW = 1_700_000_000_000;

const ANKI: Record<string, AnkiCard> = { time: { interval: 30 }, day: { interval: 2 } };
const MARKS: Record<string, WordStatus> = { sane: 'known', afford: 'new' };

function estimate(overrides: Partial<EstimatorInput> = {}) {
  return buildEstimator({
    marks: MARKS,
    profile: { selfLevel: 'B1', vocabTest: null },
    anki: ANKI,
    l1: 'en',
    words,
    now: NOW,
    ...overrides,
  });
}

describe('buildEstimator', () => {
  it('is deterministic for fixed evidence', () => {
    const a = estimate();
    const b = estimate();
    expect(a.theta).toBe(b.theta);
    expect(a.base).toBe(b.base);
    expect(a.total).toBe(b.total);
    expect(a.level).toBe(b.level);
    expect(a.next).toBe(b.next);
    expect(a.nextAt).toBe(b.nextAt);
  });

  it('produces the expected θ, vocabulary and level', () => {
    const est = estimate();
    expect(est.theta).toBeCloseTo(8.007719, 5);
    expect(est.base).toBe(3000);
    expect(est.total).toBe(3000);
    expect(est.level).toBe('B1');
    expect(est.next).toBe('B2');
    expect(est.nextAt).toBe(3650);
    expect(est.provisional).toBe(false);
  });

  it('counts the certain evidence: mature cards, learning cards and hand marks', () => {
    const est = estimate();
    expect(est.marks).toBe(2);
    expect(est.mature).toBe(1);
    expect(est.learning).toBe(1);
    expect(est.knownMarks).toBe(1);
  });

  it('does not move for a self-assessment alone (provisional reference)', () => {
    const est = estimate({ marks: {}, anki: {}, profile: { selfLevel: null, vocabTest: null } });
    expect(est.provisional).toBe(true);
    expect(est.startLevel).toBe('A2');
    expect(est.level).toBe('A2');
  });

  it('rises with «known» marks and falls with «new» ones', () => {
    const plain = estimate({ marks: {}, anki: {} });
    const known = estimate({ marks: { time: 'known', day: 'known' }, anki: {} });
    const fresh = estimate({ marks: { time: 'new', day: 'new' }, anki: {} });
    // The displayed total is rounded to 50, so θ is the honest signal here.
    expect(known.theta).toBeGreaterThan(plain.theta);
    expect(fresh.theta).toBeLessThan(plain.theta);
    expect(known.total).toBeGreaterThanOrEqual(plain.total);
    expect(fresh.total).toBeLessThanOrEqual(plain.total);
  });

  it('decays the weight of a check by half every six months', () => {
    const answers = COMMITTED_BANK.items.slice(0, 4).map((it) => it.word);
    const shown = answers;
    const profileAt = (at: number) => ({ selfLevel: null, vocabTest: { answers, at, shown } });
    const DAY = 86_400_000;
    const fresh = estimate({ marks: {}, anki: {}, profile: profileAt(NOW) });
    const stale = estimate({ marks: {}, anki: {}, profile: profileAt(NOW - 180 * DAY) });
    expect(fresh.testWeight).toBe(1);
    expect(stale.testWeight).toBeCloseTo(0.5, 5);
  });
});

describe('resolveDetailed precedence', () => {
  const est = estimate();

  it('a hand mark always wins, even over a mature card', () => {
    const resolved = resolveDetailed({ sane: 'new' }, 'sane', { sane: { interval: 400 } }, est);
    expect(resolved).toEqual({ status: 'new', source: 'user' });
  });

  it('a mature card is known and a young card is learning', () => {
    expect(resolveDetailed({}, 'time', ANKI, est)).toEqual({ status: 'known', source: 'history' });
    expect(resolveDetailed({}, 'day', ANKI, est)).toEqual({ status: 'learning', source: 'history' });
  });

  it('flips to known exactly at the mature boundary', () => {
    const young: Record<string, AnkiCard> = { time: { interval: MATURE_INTERVAL_DAYS - 1 } };
    const mature: Record<string, AnkiCard> = { time: { interval: MATURE_INTERVAL_DAYS } };
    expect(resolveDetailed({}, 'time', young, est).status).toBe('learning');
    expect(resolveDetailed({}, 'time', mature, est).status).toBe('known');
  });

  it('falls back to the estimate when there is no mark and no card', () => {
    const resolved = resolveDetailed({}, 'sane', {}, est);
    expect(resolved.source).toBe('estimate');
    expect(resolved.status).toBe('new');
    expect(resolved.reason).toBe('above');
    expect(resolved.basis?.p).toBeCloseTo(0.223891, 5);
  });

  it('reports no data for a word without level or frequency', () => {
    expect(resolveDetailed({}, 'cogent', {}, est)).toEqual({ status: 'new', source: 'default', reason: 'noData' });
  });
});
