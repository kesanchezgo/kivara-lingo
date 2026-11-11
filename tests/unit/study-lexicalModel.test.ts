import { describe, expect, it } from 'vitest';
import type { CefrLevel } from '../../src/shared/study/types';
import {
  cognateOf,
  cognateShift,
  difficulty,
  estimateTheta,
  LABEL_RANK,
  LEVEL_RANK,
  LEVEL_VOCAB,
  levelForVocab,
  levelProgress,
  levenshtein,
  MODEL,
  normalizeKey,
  orthoSim,
  pKnown,
  STUDY_LEVELS,
  vocabOf,
  wordFeatures,
} from '../../src/shared/study/lexicalModel';

describe('lexicalModel · normalizeKey', () => {
  it('lowercases and canonicalizes typographic apostrophes', () => {
    expect(normalizeKey('Won’t')).toBe("won't");
  });

  it('handles empty input', () => {
    expect(normalizeKey('')).toBe('');
  });
});

describe('lexicalModel · levenshtein', () => {
  it('computes the edit distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });

  it('equals the other length against an empty string', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });
});

describe('lexicalModel · orthoSim', () => {
  it('measures spelling similarity without accents', () => {
    expect(orthoSim('ridiculous', 'ridículo')).toBeCloseTo(0.8, 5);
  });

  it('returns 1 for identical words and 0 for two empty ones', () => {
    expect(orthoSim('casa', 'casa')).toBe(1);
    expect(orthoSim('', '')).toBe(0);
  });
});

/** Fixture glossary: the prototype's demo registry, kept in the test, not in src/. */
const GLOSSARY: Record<string, { level: CefrLevel; rank?: number; gloss: string; falseFriend?: string }> = {
  travel: { level: 'A2', rank: 2100, gloss: 'viajar' },
  flights: { level: 'A2', rank: 1700, gloss: 'vuelos' },
  ridiculous: { level: 'B2', rank: 2600, gloss: 'ridículo' },
  sane: { level: 'B2', rank: 8700, gloss: 'cuerdo, en su sano juicio', falseFriend: 'sano' },
};
/** Lemma → surface form, mirroring the old registry's reverse index. */
const LEMMA_FORM: Record<string, string> = { flight: 'flights' };

function featuresOf(key: string, l1 = 'es') {
  const entry = GLOSSARY[LEMMA_FORM[key] ?? key];
  return wordFeatures({ key, level: entry?.level, rank: entry?.rank, gloss: entry?.gloss, falseFriend: entry?.falseFriend }, l1);
}

describe('lexicalModel · wordFeatures', () => {
  it('passes level and rank through', () => {
    expect(featuresOf('travel')).toMatchObject({ level: 'A2', rank: 2100, falseFriend: undefined });
  });

  it('resolves a lemma back to its surface form', () => {
    expect(featuresOf('flight')).toMatchObject({ level: 'A2', rank: 1700 });
  });

  it('marks a false friend and drops its cognate', () => {
    expect(featuresOf('sane')).toMatchObject({ falseFriend: 'sano', cognate: undefined });
  });

  it('finds a cognate from the gloss', () => {
    expect(featuresOf('ridiculous')).toMatchObject({ cognate: { word: 'ridículo', sim: 0.8 } });
  });

  it('ignores the false friend and the cognate for another language', () => {
    expect(wordFeatures({ key: 'sane', falseFriend: 'sano' }, 'fr')).toEqual({
      level: undefined,
      rank: undefined,
      cognate: undefined,
      falseFriend: undefined,
    });
  });
});

describe('lexicalModel · cognateOf', () => {
  it('finds the closest gloss word above the threshold', () => {
    expect(cognateOf('ridiculous', 'ridículo')).toEqual({ word: 'ridículo', sim: 0.8 });
  });

  it('returns undefined for a phrase or a very short word', () => {
    expect(cognateOf('look up', 'buscar en el diccionario')).toBeUndefined();
    expect(cognateOf('i', 'yo')).toBeUndefined();
  });

  it('returns undefined for an empty gloss', () => {
    expect(cognateOf('travel', '')).toBeUndefined();
  });
});

describe('lexicalModel · cognateShift / difficulty', () => {
  it('reaches the maximum boost for a perfect cognate and zero without one', () => {
    expect(cognateShift({ word: 'x', sim: 1 })).toBeCloseTo(MODEL.cognateBoost, 6);
    expect(cognateShift(undefined)).toBe(0);
  });

  it('averages frequency and level, and subtracts the cognate effect', () => {
    expect(difficulty({ rank: 100 })).toBeCloseTo(Math.log(100), 6);
    expect(difficulty({ rank: 100, level: 'A1' })).toBeCloseTo((Math.log(100) + Math.log(LABEL_RANK.A1)) / 2, 6);
    expect(difficulty({ rank: 100, cognate: { word: 'x', sim: 1 } })!).toBeLessThan(difficulty({ rank: 100 })!);
  });

  it('returns undefined when there is no data', () => {
    expect(difficulty({})).toBeUndefined();
  });
});

describe('lexicalModel · probability and estimation', () => {
  it('is 0.5 when capacity matches difficulty', () => {
    expect(pKnown(0, 0)).toBe(0.5);
  });

  it('rises as capacity rises', () => {
    expect(pKnown(2, 0)).toBeGreaterThan(pKnown(-2, 0));
  });

  it('returns the prior mean when there is no evidence', () => {
    const mu = Math.log(2000);
    expect(Math.abs(estimateTheta(mu, 0.6, []) - mu)).toBeLessThan(0.01);
  });

  it('moves above the prior when an easy word is known', () => {
    const mu = Math.log(2000);
    expect(estimateTheta(mu, 0.6, [{ d: mu - 2, y: 1, w: 1 }])).toBeGreaterThan(mu);
  });
});

describe('lexicalModel · vocabulary and levels', () => {
  it('rounds the exponential to a multiple of 50', () => {
    expect(vocabOf(Math.log(2000))).toBe(2000);
    expect(vocabOf(Math.log(50))).toBe(50);
  });

  it('maps a vocabulary size to its closest level', () => {
    expect(levelForVocab(2000)).toBe('A2');
    expect(levelForVocab(1)).toBe('A1');
  });

  it('reports the level, the next one and the progress through it', () => {
    const p = levelProgress(2000);
    expect(p.level).toBe('A2');
    expect(p.next).toBe('B1');
    expect(p.nextAt).toBe(2450);
    expect(p.progress).toBeGreaterThan(0);
    expect(p.progress).toBeLessThan(1);
  });

  it('has no next level at the top', () => {
    expect(levelProgress(9000)).toMatchObject({ level: 'C2', next: null, nextAt: null });
  });

  it('exposes the level tables', () => {
    expect(STUDY_LEVELS).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
    expect(LEVEL_RANK.C1).toBe(5);
    expect(LEVEL_VOCAB.C2).toBe(9000);
  });
});
