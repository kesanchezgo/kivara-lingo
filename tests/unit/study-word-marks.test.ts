/**
 * F5 gate: the overlay marks and the tokenizer reconciliation
 * (docs/REDESIGN-V2.md §5.1, §7 F5).
 *
 * The status axis comes from the profile resolver; the type axis (expression
 * bracket) is independent. «mastered» — the tokenizer's explicit learned set —
 * IS the «known» status, so the two taxonomies cannot disagree.
 */
import { describe, expect, it } from 'vitest';
import { markAttrs, markContainerAttrs, markOf } from '../../src/content/ui/wordMarks';
import type { Token, TokenKind } from '../../src/content/nlp/tokenize';

const token = (kind: TokenKind, key = 'sane', lemma?: string): Token => ({
  text: key,
  key,
  kind,
  ...(lemma ? { lemma } : {}),
});

describe('markOf', () => {
  it('draws only the expression bracket without a resolver (F3 behaviour)', () => {
    expect(markOf(token('known'))).toEqual({ expr: false });
    expect(markOf(token('mwe', 'look up'))).toEqual({ expr: true });
  });

  it('resolves the profile status for learnable vocabulary', () => {
    const statusOf = () => 'learning' as const;
    expect(markOf(token('known'), statusOf)).toEqual({ status: 'learning', expr: false });
    expect(markOf(token('unknown'), statusOf)).toEqual({ status: 'learning', expr: false });
    expect(markOf(token('mwe', 'look up'), statusOf)).toEqual({ status: 'learning', expr: true });
  });

  it('asks by lemma, never by the inflected surface', () => {
    const seen: string[] = [];
    markOf(token('known', 'days', 'day'), (key) => {
      seen.push(key);
      return 'known';
    });
    expect(seen).toEqual(['day']);
  });

  it('maps the tokenizer’s «mastered» kind to the «known» status', () => {
    expect(markOf(token('mastered'), () => 'new')).toEqual({ status: 'known', expr: false });
    // Even without a resolver, mastered is known.
    expect(markOf(token('mastered'))).toEqual({ status: 'known', expr: false });
  });

  it('never marks proper nouns or ignored tokens', () => {
    const statusOf = () => 'new' as const;
    expect(markOf(token('proper-noun-known', 'america'), statusOf)).toEqual({ expr: false });
    expect(markOf(token('ignored', 'pedro'), statusOf)).toEqual({ expr: false });
    expect(markOf(token('punct', '.'), statusOf)).toEqual({ expr: false });
  });

  it('serializes the mark into data attributes', () => {
    expect(markAttrs({ status: 'new', expr: true })).toEqual({ 'data-ws': 'new', 'data-expr': '' });
    expect(markAttrs({ expr: false })).toEqual({ 'data-ws': undefined, 'data-expr': undefined });
    expect(markContainerAttrs('none')).toEqual({ 'data-new-marks': 'none' });
  });
});
