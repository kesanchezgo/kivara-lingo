import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bareCollocationChunks,
  dictCcSource,
} from '../../src/background/enrichment/sources/dictcc';

const ctx = { sourceLang: 'en', targetLang: 'es', timeoutMs: 8000 };

// dict.cc row anatomy, verified live 2026-09-09 on `give`/`run` (51/52
// rows each): almost every row is infinitive-marked (`to give advice`,
// `to run out`). The merger kills `to <headword>` shapes as usage notes,
// so the parser strips the infinitive marker up front and normalizes
// argument slots — what reaches the merger is already a bare chunk.
describe('dict.cc bare collocation chunks', () => {
  it('strips the infinitive marker into reusable bare pairs', () => {
    expect(bareCollocationChunks('to give advice', 'give')).toEqual(['give advice']);
    expect(bareCollocationChunks('to give birth', 'give')).toEqual(['give birth']);
    expect(bareCollocationChunks('to run out', 'run')).toEqual(['run out']);
    expect(bareCollocationChunks('to run a country', 'run')).toEqual(['run a country']);
  });

  it('expands slash variants with the single-word safety rule', () => {
    // `to run away / off` carries two real phrasals, not one chunk.
    expect(bareCollocationChunks('to run away / off', 'run')).toEqual([
      'run away',
      'run off',
    ]);
  });

  it('normalizes argument slots instead of leaking dictionary shorthand', () => {
    // `sb.`/`sth.` are dictionary slot markers, not collocates.
    expect(bareCollocationChunks('to give sb. comfort', 'give')).toEqual(['give someone comfort']);
    expect(bareCollocationChunks('to run into sb.', 'run')).toEqual(['run into someone']);
  });

  it('refuses slot-only rows that carry no lexical collocate', () => {
    // A lone slot is an argument pattern, not a chunk — the merger's
    // template guard would kill it anyway, so save the round.
    expect(bareCollocationChunks('to give', 'give')).toEqual([]);
    expect(bareCollocationChunks('to give sth.', 'give')).toEqual([]);
    expect(bareCollocationChunks('give', 'give')).toEqual([]);
  });

  it('keeps non-infinitive rows intact', () => {
    expect(bareCollocationChunks('home run', 'run')).toEqual(['home run']);
    expect(bareCollocationChunks('long run', 'run')).toEqual(['long run']);
  });
});

function jsArray(name: string, values: string[]): string {
  return `var ${name} = new Array(${values.map((v) => `"${v}"`).join(',')});`;
}

function htmlResponse(c1: string[], c2: string[]): Response {
  return new Response(
    `<html><head><script>${jsArray('c1Arr', c1)}${jsArray('c2Arr', c2)}</script></head></html>`,
    { status: 200, headers: { 'content-type': 'text/html' } },
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('dict.cc collocation flow', () => {
  it('publishes bare chunks from infinitive-marked rows', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      htmlResponse(
        ['', 'dar', 'dar (un) consejo', 'dar a luz'],
        ['', 'to give', 'to give advice', 'to give birth'],
      ),
    );

    const result = await dictCcSource.enrich('give', ctx);

    // `to give` feeds translations, never collocations.
    expect(result.translations).toContain('dar');
    expect(result.collocations).toContain('give advice');
    expect(result.collocations).toContain('give birth');
    expect(result.collocations).not.toContain('to give advice');
    expect(result.collocations).not.toContain('to give');
  });

  it('returns nothing for non-English lookups', async () => {
    const result = await dictCcSource.enrich('dar', { ...ctx, sourceLang: 'es' });
    expect(result).toEqual({});
  });
});
