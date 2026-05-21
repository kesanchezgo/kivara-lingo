/**
 * Unit tests for the auto-detect helper that powers the unified
 * "Importar archivo" button. Pure logic + a couple of hand-crafted ZIPs
 * built with `fflate.zipSync` so we can exercise both branches without a
 * real Yomitan / StarDict pack on disk.
 */
import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
  detectDictFormat,
  isZipBuffer,
  listZipFilenames,
} from '../../src/content/nlp/dict-format-detect';

function makeZip(entries: Record<string, string>): Uint8Array {
  const obj: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(entries)) {
    obj[name] = strToU8(content);
  }
  return zipSync(obj);
}

describe('isZipBuffer', () => {
  it('matches the four-byte ZIP local-file-header magic', () => {
    const zip = makeZip({ 'a.txt': 'x' });
    expect(isZipBuffer(zip)).toBe(true);
  });

  it('rejects plain text and short buffers', () => {
    expect(isZipBuffer(strToU8('word,translation\nhello,hola\n'))).toBe(false);
    expect(isZipBuffer(new Uint8Array([0x50, 0x4b, 0x03]))).toBe(false);
    expect(isZipBuffer(new Uint8Array(0))).toBe(false);
  });
});

describe('listZipFilenames', () => {
  it('returns the in-order list of entries written into the ZIP', () => {
    const zip = makeZip({
      'index.json': '{}',
      'term_bank_1.json': '[]',
      'term_bank_2.json': '[]',
    });
    const names = listZipFilenames(zip);
    expect(names).toContain('index.json');
    expect(names).toContain('term_bank_1.json');
  });

  it('respects the maxFiles cap to bail out of malformed inputs', () => {
    const zip = makeZip({ 'a': '1', 'b': '2', 'c': '3' });
    expect(listZipFilenames(zip, 2)).toHaveLength(2);
  });
});

describe('detectDictFormat', () => {
  it('routes a ZIP that contains index.json to the Yomitan importer', () => {
    const zip = makeZip({
      'index.json': '{"title":"Test","format":3,"revision":"2024-01"}',
      'term_bank_1.json': '[]',
    });
    expect(detectDictFormat(zip)).toEqual({ format: 'yomitan' });
  });

  it('routes a ZIP that contains a .ifo entry to the StarDict importer', () => {
    const zip = makeZip({
      'mydict.ifo': 'StarDict\u0027s dict ifo file\nversion=3.0.0\n',
      'mydict.idx': '\0',
      'mydict.dict': '\0',
    });
    expect(detectDictFormat(zip)).toEqual({ format: 'stardict' });
  });

  it('reports unknown for a ZIP that has neither marker', () => {
    const zip = makeZip({ 'random.txt': 'hello' });
    const result = detectDictFormat(zip);
    expect(result.format).toBe('unknown');
    expect(result.reason).toMatch(/index\.json|\.ifo/);
  });

  it('treats plain text as CSV regardless of extension', () => {
    const text = strToU8('word,translation\nhello,hola\n');
    expect(detectDictFormat(text, 'list.csv').format).toBe('csv');
    expect(detectDictFormat(text, 'list.tsv').format).toBe('csv');
    expect(detectDictFormat(text, 'list.txt').format).toBe('csv');
    expect(detectDictFormat(text, undefined).format).toBe('csv');
    expect(detectDictFormat(text, 'list.unknownext').format).toBe('csv');
  });

  it('flags binary blobs without ZIP magic as unknown', () => {
    // 32 random-ish bytes including a NUL near the start so the looksLikeText
    // sniff bails out.
    const bin = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x00, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
      0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
    ]);
    expect(detectDictFormat(bin).format).toBe('unknown');
  });

  it('handles index.json nested inside a folder (some Yomitan packs zip a top dir)', () => {
    const zip = makeZip({
      'pack-1/index.json': '{}',
      'pack-1/term_bank_1.json': '[]',
    });
    expect(detectDictFormat(zip).format).toBe('yomitan');
  });

  it('handles .ifo nested inside a folder', () => {
    const zip = makeZip({
      'pack/dict.ifo': 'StarDict ifo',
      'pack/dict.idx': '\0',
    });
    expect(detectDictFormat(zip).format).toBe('stardict');
  });
});
