import { beforeEach, describe, expect, it, vi } from 'vitest';
import { datamuseSource } from '../../src/background/enrichment/sources/datamuse';

const ctx = { sourceLang: 'en', targetLang: 'es', timeoutMs: 8000 };

/**
 * Live-verified 2026-08-30 against api.datamuse.com:
 *   run        → f:96.445553   (occurrences per million words, LINEAR)
 *   know       → f:383.280232
 *   apple      → f:9.854269
 *   tensor     → f:2.230924
 *   piece of cake → f:0.000000 (no band — absence beats a wrong band)
 * The `f:` value is per-million frequency, NOT log10.
 */
function hit(word: string, f?: string): { word: string; score: number; tags?: string[] } {
  return f === undefined
    ? { word, score: 1000 }
    : { word, score: 1000, tags: [`f:${f}`] };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('datamuse frequency evidence', () => {
  it('publishes a books-band from the headword f: tag (per-million, linear)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes('md=f')) {
        return jsonResponse([hit('run', '96.445553')]);
      }
      return jsonResponse([]);
    });

    const result = await datamuseSource.enrich('run', ctx);

    // Source-partial shape: no `source` here. The orchestrator's `mergeFields`
    // stamps `{ ...evidence, source: source.id }` when merging, so attaching it
    // at the source layer would double-tag it.
    expect(result.frequencyEvidence).toEqual([
      { scale: 'books-band', value: '2' },
    ]);
  });

  it('bands very frequent words as 1 (Longman-style learner bands)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      if (String(input).includes('md=f')) return jsonResponse([hit('know', '383.280232')]);
      return jsonResponse([]);
    });

    const result = await datamuseSource.enrich('know', ctx);

    expect(result.frequencyEvidence).toEqual([
      { scale: 'books-band', value: '1' },
    ]);
  });

  it('bands uncommon technical vocabulary as 4', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      if (String(input).includes('md=f')) return jsonResponse([hit('tensor', '2.230924')]);
      return jsonResponse([]);
    });

    const result = await datamuseSource.enrich('tensor', ctx);

    expect(result.frequencyEvidence).toEqual([
      { scale: 'books-band', value: '4' },
    ]);
  });

  it('publishes no band when the headword has zero corpus frequency', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      if (String(input).includes('md=f')) return jsonResponse([hit('piece of cake', '0.000000')]);
      return jsonResponse([]);
    });

    const result = await datamuseSource.enrich('piece of cake', ctx);

    expect(result.frequencyEvidence).toBeUndefined();
  });

  it('keeps filling relations even when the frequency query fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes('md=f')) throw new Error('network down');
      if (url.includes('rel_syn')) return jsonResponse([hit('fast'), hit('sprint')]);
      return jsonResponse([]);
    });

    const result = await datamuseSource.enrich('run', ctx);

    expect(result.frequencyEvidence).toBeUndefined();
    expect(result.synonyms).toEqual(['fast', 'sprint']);
  });
});
