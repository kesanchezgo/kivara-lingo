/**
 * F5 gate: the vocabulary check (docs/REDESIGN-V2.md §7 F5, §8).
 *
 * What matters:
 *   • the bank is the committed one: 160 real lemmas in four frequency bands
 *     plus 60 invented words;
 *   • every attempt is a different sample (10 per band + 5 invented = 45),
 *     and a fixed seed reproduces one attempt exactly;
 *   • the check NEVER blocks saving: marking all the invented words or failing
 *     every meaning question lowers the weight of the result and says so, but
 *     the answers are still stored as evidence.
 */
import { describe, expect, it } from 'vitest';
import {
  COMMITTED_BANK, VC_BANDS, VC_FAKES_SHOWN, VC_PER_BAND, bandOfRank, checkAnswerOf, checkOptions,
  isVcRealWord, pickCheckWords, sampleTest, scoreVocabCheck, testObservations, withGlosses,
} from '../../src/shared/study/vocabCheck';
import { DEFAULT_LEVEL_PROFILE, reviveLevelProfile, withVocabTest } from '../../src/shared/study/levelProfile';

const GLOSSED = withGlosses(COMMITTED_BANK, (word) => `gloss of ${word}`);

describe('the committed bank', () => {
  it('has 160 lemmas in four bands and 60 invented words', () => {
    expect(COMMITTED_BANK.items).toHaveLength(160);
    expect(COMMITTED_BANK.fakes).toHaveLength(60);
    expect(new Set(COMMITTED_BANK.items.map((it) => it.word)).size).toBe(160);
    for (let band = 0; band < VC_BANDS; band += 1) {
      expect(COMMITTED_BANK.items.filter((it) => it.band === band)).toHaveLength(40);
    }
  });

  it('maps ranks onto the band edges of the dataset', () => {
    expect(bandOfRank(80)).toBe(0);
    expect(bandOfRank(1250)).toBe(0);
    expect(bandOfRank(1251)).toBe(1);
    expect(bandOfRank(5000)).toBe(2);
    expect(bandOfRank(11996)).toBe(3);
    expect(COMMITTED_BANK.items.every((it) => it.band === bandOfRank(it.rank))).toBe(true);
  });
});

describe('sampleTest', () => {
  it('shows 10 per band and 5 invented words (45 items)', () => {
    const items = sampleTest(COMMITTED_BANK, 1234);
    expect(items).toHaveLength(VC_BANDS * VC_PER_BAND + VC_FAKES_SHOWN);
    for (let band = 0; band < VC_BANDS; band += 1) {
      expect(items.filter((it) => it.band === band)).toHaveLength(VC_PER_BAND);
    }
    expect(items.filter((it) => it.band === null)).toHaveLength(VC_FAKES_SHOWN);
    expect(new Set(items.map((it) => it.word)).size).toBe(items.length);
  });

  it('is reproducible for a fixed seed and different across attempts', () => {
    const a = sampleTest(COMMITTED_BANK, 42).map((it) => it.word);
    const b = sampleTest(COMMITTED_BANK, 42).map((it) => it.word);
    const c = sampleTest(COMMITTED_BANK, 43).map((it) => it.word);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe('meaning check helpers', () => {
  it('offers four distinct glosses including the correct one', () => {
    const options = checkOptions(GLOSSED, 'time', []);
    expect(options).toHaveLength(4);
    expect(new Set(options).size).toBe(4);
    expect(options).toContain('gloss of time');
  });

  it('classifies an answer against the correct gloss', () => {
    expect(checkAnswerOf(GLOSSED, 'time', 'gloss of time')).toBe('ok');
    expect(checkAnswerOf(GLOSSED, 'time', 'gloss of day')).toBe('wrong');
    expect(checkAnswerOf(GLOSSED, 'time', null)).toBe('idk');
  });

  it('picks at most five marked words and only real ones', () => {
    const marked = new Set([...COMMITTED_BANK.items.slice(0, 12).map((it) => it.word), COMMITTED_BANK.fakes[0]]);
    const picked = pickCheckWords(marked, COMMITTED_BANK, 7);
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.length).toBeLessThanOrEqual(5);
    expect(picked.every((word) => marked.has(word) && isVcRealWord(word))).toBe(true);
  });
});

describe('the check never blocks saving', () => {
  const items = sampleTest(COMMITTED_BANK, 99);
  const shown = items.map((it) => it.word);
  const everything = new Set(shown);

  it('corrects a run of false alarms instead of rejecting the result', () => {
    const observed = testObservations(everything, 'en', 1, undefined, shown, COMMITTED_BANK);
    expect(observed.falseAlarms).toBe(VC_FAKES_SHOWN);
    expect(observed.fakeTotal).toBe(VC_FAKES_SHOWN);
    expect(observed.quality).toBe('low');
    expect(observed.lowReason).toBe('fakes');

    const result = scoreVocabCheck(everything, 'en', undefined, shown, COMMITTED_BANK);
    expect(result.quality).toBe('low');
    expect(result.size).toBeGreaterThan(0);
    expect(Number.isFinite(result.size)).toBe(true);
  });

  it('still returns a result when every meaning answer is wrong', () => {
    const checks = Object.fromEntries(
      pickCheckWords(everything, COMMITTED_BANK, 3).map((word) => [word, 'wrong' as const]),
    );
    const result = scoreVocabCheck(everything, 'es', checks, shown, GLOSSED);
    expect(result.checked).toBeGreaterThan(0);
    expect(result.passed).toBe(0);
    expect(result.quality).toBe('low');
    expect(result.size).toBeGreaterThan(0);
  });

  it('stores the answers as evidence regardless of quality', () => {
    const saved = withVocabTest(DEFAULT_LEVEL_PROFILE, everything, undefined, shown, 1_700_000_000_000);
    expect(saved.vocabTest?.answers).toEqual([...everything]);
    expect(saved.vocabTest?.shown).toEqual(shown);
    // Round-trips through the profile reviver (answers restricted to what was shown).
    const revived = reviveLevelProfile(saved);
    expect(revived.vocabTest?.answers).toEqual([...everything]);
    expect(revived.vocabTest?.shown).toEqual(shown);
    // The self-assessment is not touched by a check.
    expect(revived.selfLevel).toBeNull();
  });

  it('ignores answers outside the bank when reviving a profile', () => {
    const revived = reviveLevelProfile({
      selfLevel: 'B1',
      vocabTest: { answers: ['not-a-word'], at: 1 },
    });
    expect(revived.vocabTest).toBeNull();
    expect(revived.selfLevel).toBe('B1');
  });

  it('discards a check that does not say what it showed', () => {
    const revived = reviveLevelProfile({
      selfLevel: 'A2',
      vocabTest: { answers: ['time', 'day'], at: 1 },
    });
    expect(revived.vocabTest).toBeNull();
    expect(revived.selfLevel).toBe('A2');
  });
});
