import { describe, expect, it } from 'vitest';
import { contextSentence, MAX_WORDS, segmentSentences } from '../../src/shared/study/sentence';

describe('sentence · segmentSentences', () => {
  it('splits a text into its sentences', () => {
    const segs = segmentSentences('Hi. Bye.');
    expect(segs.map((s) => s.text.trim())).toEqual(['Hi.', 'Bye.']);
  });

  it('filters out empty segments', () => {
    expect(segmentSentences('   ').every((s) => s.text.trim().length > 0)).toBe(true);
  });
});

describe('sentence · contextSentence', () => {
  it('picks the sentence that contains the word', () => {
    const cues = [{ start: 0, end: 2, target: 'Not this time. I cannot afford it.' }];
    const res = contextSentence(cues, 0, 25);
    expect(res.text).toBe('I cannot afford it.');
    expect(res.lines).toEqual([0]);
    expect(res.span).toEqual({ start: 0.85, end: 2 });
  });

  it('joins the neighbouring sentence when the target sentence is too short', () => {
    const cues = [{ start: 0, end: 2, target: 'Yes. It is ridiculous.' }];
    const res = contextSentence(cues, 0, 11);
    expect(res.text).toBe('Yes. It is ridiculous.');
    expect(res.lines).toEqual([0]);
  });

  it('continues onto the next line when the sentence is cut by a line break', () => {
    const cues = [
      { start: 0, end: 1, target: 'I was' },
      { start: 1.2, end: 3, target: 'working late.' },
    ];
    const res = contextSentence(cues, 0, 2);
    expect(res.text).toBe('I was working late.');
    expect(res.lines).toEqual([0, 1]);
  });

  it('returns an empty result for a missing line', () => {
    expect(contextSentence([], 0, 0)).toEqual({ text: '', lines: [] });
    expect(contextSentence([{ start: 0, end: 1, target: 'hi' }], 3, 0)).toEqual({ text: '', lines: [] });
  });
});

describe('sentence · MAX_WORDS', () => {
  it('caps a context sentence at 30 words', () => {
    expect(MAX_WORDS).toBe(30);
  });
});
