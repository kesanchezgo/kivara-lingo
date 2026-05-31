import { describe, it, expect } from 'vitest';
import { stripHtml, decodeJsUnicode, decodeEntities } from '../../src/background/enrichment/html-utils';

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
