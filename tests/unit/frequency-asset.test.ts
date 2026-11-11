/**
 * F5 hygiene gate: the committed frequency asset carries no alphabet tokens,
 * no negative-contraction stems and no proper names (issue #39).
 *
 * Two layers, because the defect has two shapes:
 *   - the rule helpers used by the builder (`scripts/build-frequency.ts`) must
 *     classify the noise correctly, and
 *   - the committed `en-rank.json` must not contain any of it — a rule that is
 *     right but a stale asset ships the bug anyway.
 */
import { describe, expect, it } from 'vitest';
import enRank from '../../src/assets/frequency/en-rank.json';
import {
  CONTRACTION_STEMS,
  PROPER_NAMES,
  isDroppedSurface,
} from '../../scripts/build-frequency';

const ASSET = enRank as Record<string, number | object>;

/** Stems the issue names explicitly. */
const ISSUE_STEMS = [
  'don', 'didn', 'isn', 'couldn', 'shouldn', 'wouldn', 'doesn', 'hasn',
  'hadn', 'aren', 'wasn', 'weren',
] as const;

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

describe('frequency asset hygiene', () => {
  it('contains none of the 26 single letters', () => {
    for (const letter of LETTERS) {
      expect(ASSET[letter], `single letter "${letter}" survived`).toBeUndefined();
    }
  });

  it('contains no negative-contraction stem named by issue #39', () => {
    for (const stem of ISSUE_STEMS) {
      expect(ASSET[stem], `contraction stem "${stem}" survived`).toBeUndefined();
    }
  });

  it('contains no entry from the contraction-stem rule', () => {
    for (const stem of CONTRACTION_STEMS) {
      expect(ASSET[stem], `contraction stem "${stem}" survived`).toBeUndefined();
    }
  });

  it('contains no entry from the proper-name inventory', () => {
    const leaked = [...PROPER_NAMES].filter((name) => ASSET[name] !== undefined);
    expect(leaked).toEqual([]);
  });

  it('reports the dropped counts in _meta and keeps the attribution', () => {
    const meta = ASSET._meta as Record<string, unknown>;
    expect(meta.license).toBe('CC BY-SA 4.0');
    expect(meta.source).toBe('OpenSubtitles FrequencyWords (HermitDave)');
    expect(meta.count).toBe(Object.keys(ASSET).length - 1);
    const dropped = meta.dropped as Record<string, number>;
    expect(dropped.singleLetter).toBeGreaterThanOrEqual(26);
    expect(dropped.properName).toBeGreaterThan(0);
    expect(dropped.total).toBe(
      dropped.singleLetter + dropped.contractionStem + dropped.properName + dropped.nonWord,
    );
  });
});

describe('drop rules', () => {
  it('drops single letters but keeps real one-letter-free words', () => {
    expect(isDroppedSurface('a')).toBe(true);
    expect(isDroppedSurface('i')).toBe(true);
    expect(isDroppedSurface('l')).toBe(true);
    expect(isDroppedSurface('okay')).toBe(false);
    expect(isDroppedSurface('time')).toBe(false);
  });

  it('drops contraction stems but keeps the real words that share the shape', () => {
    expect(isDroppedSurface('don')).toBe(true);
    expect(isDroppedSurface('isn')).toBe(true);
    expect(isDroppedSurface('wouldn')).toBe(true);
    // `won` and `can` are ordinary words, not stems.
    expect(isDroppedSurface('won')).toBe(false);
    expect(isDroppedSurface('can')).toBe(false);
    // `have` is the lemma of "haven't" and must survive.
    expect(isDroppedSurface('haven')).toBe(false);
  });

  it('drops unambiguous names but keeps name-shaped ordinary words', () => {
    expect(isDroppedSurface('michael')).toBe(true);
    expect(isDroppedSurface('sarah')).toBe(true);
    expect(isDroppedSurface('toronto')).toBe(true);
    expect(isDroppedSurface('mark')).toBe(false);
    expect(isDroppedSurface('rose')).toBe(false);
    expect(isDroppedSurface('knight')).toBe(false);
    expect(isDroppedSurface('turkey')).toBe(false);
  });
});
