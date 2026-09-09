import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extractPonsSenseGroups,
  ponsSource,
} from '../../src/background/enrichment/sources/pons';

const ctx = { sourceLang: 'en', targetLang: 'es', timeoutMs: 8000 };

// PONS sense-segment anatomy, verified live 2026-09-09 on `give`:
// every translation row lives inside exactly one `class="sense">gloss</span>`
// segment (406/406 buttons inside 118 segments, 0 orphans).
function senseHtml(gloss: string, rows: Array<[string, string]>): string {
  const buttons = rows
    .map(
      ([source, target]) =>
        `<button class="x" data-translation-source="${source}" ` +
        `data-translation-target="${target}" data-foo="1">add-to-vocabulary-trainer</button>`,
    )
    .join('');
  return `<span class="sense">${gloss}</span><div>${buttons}</div>`;
}

const GIVE_FIXTURE =
  senseHtml('(to hand)', [
    ['give', 'dar'],
    ['they give you the best years of my life', 'te dan los mejores años de mi vida'],
    ['give blood/organ', 'donar sangre/órganos'],
  ]) +
  senseHtml('(to make a gift of)', [
    ['to give sb a present', 'regalar algo a alguien'],
    ['give tip/money/alms', 'dar propina/dinero/limosna'],
  ]);

function htmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('PONS sense-segment extraction', () => {
  it('splits rows into one group per sense gloss', () => {
    const groups = extractPonsSenseGroups(GIVE_FIXTURE);

    expect(groups).toHaveLength(2);
    expect(groups[0].gloss).toBe('(to hand)');
    expect(groups[0].sources).toContain('give blood/organ');
    expect(groups[1].gloss).toBe('(to make a gift of)');
    expect(groups[1].sources).toContain('to give sb a present');
  });

  it('returns no groups when the page carries no sense marks', () => {
    expect(extractPonsSenseGroups('<div>no senses here</div>')).toEqual([]);
  });

  it('captures the first example sentence of each segment as group surface', () => {
    // A generic gloss like `(to hand)` never shares words with a real
    // sentence; the segment's example gives the group concrete surface
    // for the contextual gate. Mirrors Longman Sense groups (guide + DEF)
    // and Cambridge dsense groups (guide + example).
    const html =
      senseHtml('(to hand)', [
        ['they give you the best years of my life', 'te dan los mejores años de mi vida'],
        ['give blood/organ', 'donar sangre/órganos'],
      ]) + senseHtml('(to make a gift of)', [['give tip/money/alms', 'dar propina/dinero/limosna']]);
    const groups = extractPonsSenseGroups(html, 'give');

    expect(groups).toHaveLength(2);
    expect(groups[0].example).toBe('they give you the best years of my life');
    // A segment with no sentence-like row carries no example.
    expect(groups[1].example).toBeUndefined();
  });
});

describe('PONS sense-scoped collocation groups', () => {
  it('publishes each segment gloss as a relationGroup with its own chunks', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(htmlResponse(GIVE_FIXTURE));

    const result = await ponsSource.enrich('give', ctx);

    expect(result.relationGroups).toBeDefined();
    const groups = result.relationGroups!;

    // One group per segment that produced collocations…
    const hand = groups.find((g) => g.guide === '(to hand)');
    const gift = groups.find((g) => g.guide === '(to make a gift of)');
    expect(hand).toBeDefined();
    expect(gift).toBeDefined();

    // …with ONLY that segment's chunks inside (slash shorthand expands).
    expect(hand!.collocations).toContain('give blood');
    expect(hand!.collocations).toContain('give organ');
    expect(hand!.collocations).not.toContain('give tip');
    expect(gift!.collocations).toContain('give tip');
    expect(gift!.collocations).toContain('give money');
    expect(gift!.collocations).not.toContain('give blood');

    // The flat list still exists (other consumers), traceable to the groups.
    const flat = result.collocations ?? [];
    expect(flat.length).toBeGreaterThan(0);
    const fromGroups = new Set(groups.flatMap((g) => g.collocations ?? []));
    for (const phrase of flat) expect(fromGroups.has(phrase)).toBe(true);
  });

  it('keeps translations and examples flowing alongside the groups', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(htmlResponse(GIVE_FIXTURE));

    const result = await ponsSource.enrich('give', ctx);

    expect(result.translations).toContain('dar');
    expect(result.examples?.some((e) => /they give you the best years/.test(e.text))).toBe(true);
  });

  it('falls back to the flat contract when sense marks are absent', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      htmlResponse(
        `<button class="x" data-translation-source="give advice" ` +
          `data-translation-target="aconsejar" data-foo="1">add-to-vocabulary-trainer</button>`,
      ),
    );

    const result = await ponsSource.enrich('give', ctx);

    expect(result.collocations).toContain('give advice');
    expect(result.relationGroups ?? []).toEqual([]);
  });

  it('returns nothing for non-English lookups', async () => {
    const result = await ponsSource.enrich('dar', { ...ctx, sourceLang: 'es' });
    expect(result).toEqual({});
  });
});
