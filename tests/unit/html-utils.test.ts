import { describe, it, expect } from 'vitest';
import { stripHtml, decodeJsUnicode, decodeEntities, expandSlashAlternatives } from '../../src/background/enrichment/html-utils';

describe('decodeJsUnicode', () => {
  it('decodes \\uXXXX escapes that leak from scraped JS literals', () => {
    // Reverso embeds the translation in `var response = { comment: "s\u00e9ptimo" }`.
    expect(decodeJsUnicode('s\\u00e9ptimo')).toBe('séptimo');
    expect(decodeJsUnicode('una s\\u00e9ptima parte')).toBe('una séptima parte');
  });

  it('decodes \\xXX escapes', () => {
    expect(decodeJsUnicode('caf\\xe9')).toBe('café');
  });

  it('leaves clean text untouched and is cheap on no-backslash input', () => {
    expect(decodeJsUnicode('séptimo')).toBe('séptimo');
    expect(decodeJsUnicode('plain text')).toBe('plain text');
  });

  it('unescapes JS string-literal quotes/slashes', () => {
    expect(decodeJsUnicode('he said \\"hi\\"')).toBe('he said "hi"');
    expect(decodeJsUnicode('a\\/b')).toBe('a/b');
  });
});

describe('stripHtml integrates unicode decoding', () => {
  it('decodes \\u escapes embedded in extracted HTML/JS text', () => {
    // Simulates text pulled out of an inline script literal.
    expect(stripHtml('<span>s\\u00e9ptimo</span>')).toBe('séptimo');
  });

  it('still decodes HTML numeric + named entities', () => {
    expect(stripHtml('caf&#233; &amp; t&#233;')).toBe('café & té');
    expect(stripHtml('a &mdash; b')).toBe('a — b');
  });
});

describe('decodeEntities', () => {
  it('resolves named + numeric entities', () => {
    expect(decodeEntities('a &amp; b &#233;')).toBe('a & b é');
  });
});

describe('expandSlashAlternatives', () => {
  it('expands suffix alternatives sharing a head prefix', () => {
    // Live 2026-09-06 Longman `give`: 13 COLLO spans, almost all compressed.
    expect(expandSlashAlternatives('give orders/instructions')).toEqual([
      'give orders',
      'give instructions',
    ]);
    expect(
      expandSlashAlternatives('give somebody control/authority/responsibility etc'),
    ).toEqual([
      'give somebody control',
      'give somebody authority',
      'give somebody responsibility',
    ]);
  });

  it('expands prefix alternatives sharing a tail suffix', () => {
    // `well/badly run` lives in Longman's manage-sense block (run__3).
    expect(expandSlashAlternatives('well/badly run')).toEqual([
      'well run',
      'badly run',
    ]);
  });

  it('repairs a stranded `an` before a consonant and drops trailing etc', () => {
    expect(expandSlashAlternatives('give an account/description')).toEqual([
      'give an account',
      'give a description',
    ]);
  });

  it('refuses multi-word alternatives rather than guessing the split', () => {
    // `six months/three years` cannot be split without inventing a head.
    expect(expandSlashAlternatives('give somebody six months/three years etc')).toEqual([]);
    expect(expandSlashAlternatives('run on electricity/gas/petrol etc')).toEqual([
      'run on electricity',
      'run on gas',
      'run on petrol',
    ]);
  });

  it('passes plain chunks through unchanged', () => {
    expect(expandSlashAlternatives('give a speech')).toEqual(['give a speech']);
    expect(expandSlashAlternatives('')).toEqual([]);
  });
});
