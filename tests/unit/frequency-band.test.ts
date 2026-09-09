import { describe, expect, it } from 'vitest';
import { formatFrequencyBand, pickFrequencyWinner } from '../../src/shared/frequency';

describe('shared frequency band', () => {
  it('labels Longman bands with their learner rank', () => {
    // Live 2026-09-09 corpus: vip/run carries S1 + W1 + books-band 2.
    expect(formatFrequencyBand('longman-spoken', 'S1')).toBe('Top 1000 hablado');
    expect(formatFrequencyBand('longman-written', 'W1')).toBe('Top 1000 escrito');
    expect(formatFrequencyBand('longman-spoken', 's2')).toBe('Top 2000 hablado');
    expect(formatFrequencyBand('longman-written', 'W3')).toBe('Top 3000 escrito');
  });

  it('maps books-band to the learner ladder', () => {
    expect(formatFrequencyBand('books-band', '1')).toBe('Muy frecuente');
    expect(formatFrequencyBand('books-band', 2)).toBe('Frecuente');
    expect(formatFrequencyBand('books-band', '3')).toBe('Común');
    expect(formatFrequencyBand('books-band', '4')).toBe('Poco común');
  });

  it('falls back to raw scale for unknown sources', () => {
    expect(formatFrequencyBand('books-band', '9')).toBe('books-band: 9');
    expect(formatFrequencyBand('zipf', '5.2')).toBe('zipf: 5.2');
  });

  it('picks one winner: spoken Longman over written over books-band', () => {
    // The three scales are not comparable, so the popover and the Anki
    // writer render one band — never an average, never all three.
    const full = [
      { scale: 'books-band', value: '2' },
      { scale: 'longman-written', value: 'W1' },
      { scale: 'longman-spoken', value: 'S1' },
    ];
    expect(pickFrequencyWinner(full)).toEqual({ scale: 'longman-spoken', value: 'S1' });
    expect(
      pickFrequencyWinner([
        { scale: 'books-band', value: '1' },
        { scale: 'longman-written', value: 'W1' },
      ]),
    ).toEqual({ scale: 'longman-written', value: 'W1' });
    // Standard rows carry books-band alone and are unaffected.
    expect(pickFrequencyWinner([{ scale: 'books-band', value: '4' }])).toEqual({
      scale: 'books-band',
      value: '4',
    });
    expect(pickFrequencyWinner([])).toBeUndefined();
  });
});
