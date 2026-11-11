import { describe, expect, it } from 'vitest';
import { cueText, maskNotes, noteRanges, speechText, turnStarts } from '../../src/shared/study/subtitleText';

describe('subtitleText · cueText', () => {
  it('strips HTML tags and keeps the text', () => {
    expect(cueText('Hello <i>world</i>')).toBe('Hello world');
  });

  it('converts ASS escapes and tag blocks into real line breaks', () => {
    expect(cueText('{\\an8}Hi\\Nthere')).toBe('Hi\nthere');
  });

  it('decodes named and numeric entities', () => {
    expect(cueText('A&amp;B')).toBe('A&B');
    expect(cueText('&#65;&#x42;')).toBe('AB');
  });

  it('collapses spaces per line', () => {
    expect(cueText('  spaced   out  ')).toBe('spaced out');
  });

  it('handles empty input', () => {
    expect(cueText('')).toBe('');
  });
});

describe('subtitleText · noteRanges', () => {
  it('detects a sound description', () => {
    expect(noteRanges('[door slams]')).toEqual([{ start: 0, end: 12, kind: 'sound' }]);
  });

  it('detects a full music line', () => {
    expect(noteRanges('♪ la la ♪')).toEqual([{ start: 0, end: 9, kind: 'music' }]);
  });

  it('detects a speaker label at the start of the line', () => {
    expect(noteRanges('JOHN: Hello')).toEqual([{ start: 0, end: 5, kind: 'speaker' }]);
  });

  it('returns nothing for empty text', () => {
    expect(noteRanges('')).toEqual([]);
  });
});

describe('subtitleText · maskNotes', () => {
  it('replaces a note with equal-length spaces', () => {
    expect(maskNotes('[door slams] hi')).toBe(`${' '.repeat(12)} hi`);
  });

  it('returns the text unchanged when there are no notes', () => {
    expect(maskNotes('hi')).toBe('hi');
  });
});

describe('subtitleText · speechText', () => {
  it('drops the dialogue dash and joins to one line', () => {
    expect(speechText('- Hello there')).toBe('Hello there');
  });

  it('handles empty input', () => {
    expect(speechText('')).toBe('');
  });
});

describe('subtitleText · turnStarts', () => {
  it('marks each dialogue dash that opens a turn', () => {
    expect(turnStarts('- a\n- b')).toEqual([0, 4]);
  });

  it('returns nothing when there is no turn', () => {
    expect(turnStarts('hi')).toEqual([]);
  });
});
