import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ozdicSource } from '../../src/background/enrichment/sources/ozdic';

const ctx = { sourceLang: 'en', targetLang: 'es', timeoutMs: 8000 };

/**
 * Live-verified 2026-08-30 against `https://ozdic.com/api/search?q=run`:
 * six noun-sense collocation blocks, each carrying a per-sense gloss.
 * The parser must publish them as sense-bound relationGroups — the
 * merger's contextual gate then picks the current sense's chunks instead
 * of mixing nautical/cricket/theatre phrases into every lookup.
 */
const runFixture = {
  word: 'run',
  definitions: [
    {
      pos: 'noun',
      senses: [
        { gloss: 'an act of running; a journey on foot', examples: ['She goes for a run every morning.'] },
      ],
    },
  ],
  collocations: [
    {
      n: 1,
      gloss: '(noun.) on foot',
      groups: [
        {
          cat: 'ADJ',
          clusters: [
            { words: ['five-mile,etc.', 'fun,sponsored', 'training'], example: 'a fun run for charity' },
          ],
        },
        { cat: 'VERB + RUN', clusters: [{ words: ['go for,have', 'go on'] }] },
      ],
    },
    {
      n: 2,
      gloss: '(noun.) of success/failure',
      groups: [
        { cat: 'ADJ', clusters: [{ words: ['long,winning', 'lucky', 'successful'] }] },
        { cat: 'VERB + RUN', clusters: [{ words: ['halt', 'break'] }] },
      ],
    },
    {
      n: 5,
      gloss: '(noun.) in cricket/baseball',
      groups: [
        { cat: 'VERB + RUN', clusters: [{ words: ['score'] }] },
      ],
    },
  ],
};

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ozdic sense-bound collocations', () => {
  it('publishes each collocation block as a relationGroup anchored to its sense gloss', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(runFixture));

    const result = await ozdicSource.enrich('run', ctx);

    expect(result.relationGroups).toBeDefined();
    const groups = result.relationGroups!;

    // One group per collocation block, not one flat dump.
    expect(groups).toHaveLength(3);

    // Each group carries its block's gloss as the sense anchor…
    expect(groups[0].definition).toBe('(noun.) on foot');
    expect(groups[1].definition).toBe('(noun.) of success/failure');
    expect(groups[2].definition).toBe('(noun.) in cricket/baseball');

    // …with ONLY that block's collocations inside.
    expect(groups[0].collocations).toContain('training run');
    expect(groups[0].collocations).not.toContain('winning run');
    expect(groups[1].collocations).toContain('winning run');
    expect(groups[1].collocations).not.toContain('training run');

    // The guide strips the POS prefix for a readable sense label.
    expect(groups[0].guide).toBe('on foot');

    // Cluster examples still feed the example field.
    expect(result.examples?.some((example) => /fun run for charity/.test(example.text))).toBe(true);
  });

  it('keeps the flat collocations list for backward compatibility', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(runFixture));

    const result = await ozdicSource.enrich('run', ctx);

    // The flat list still exists (other consumers), but every phrase in
    // it is traceable to one of the sense groups.
    const flat = result.collocations ?? [];
    expect(flat.length).toBeGreaterThan(0);
    const fromGroups = new Set(groups(result).flatMap((group) => group.collocations ?? []));
    for (const phrase of flat) expect(fromGroups.has(phrase)).toBe(true);
  });

  it('returns nothing for non-English lookups', async () => {
    const result = await ozdicSource.enrich('correr', { ...ctx, sourceLang: 'es' });
    expect(result).toEqual({});
  });
});

function groups(result: { relationGroups?: Array<{ collocations?: string[] }> }) {
  return result.relationGroups ?? [];
}
