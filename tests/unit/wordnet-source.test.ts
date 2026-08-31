import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { wordnetSource } from '../../src/background/enrichment/sources/wordnet';
import type { EnrichmentContext } from '../../src/background/enrichment/types';

const ctx: EnrichmentContext = {
  sourceLang: 'en',
  targetLang: 'es',
  timeoutMs: 8000,
};

// The source loads shards via `fetch(assetUrl)`. In the bundled MV3 service
// worker those URLs are extension-absolute and served by the browser, but
// happy-dom does not serve Vite's build output — so we stub `fetch` to read
// the shard files straight from disk. The stub maps any URL containing
// `wordnet/<shard>.json` to the real file, keeping the tests aligned with
// the source's SHARD_URLS without duplicating Vite's hashed filenames.
const SHARD_DIR = join(process.cwd(), 'src', 'assets', 'wordnet');

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
    const url = String(input);
    const match = /wordnet\/([a-z]+)\.json/.exec(url);
    if (!match) return new Response('', { status: 404 });
    try {
      const body = readFileSync(join(SHARD_DIR, `${match[1]}.json`), 'utf8');
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    } catch {
      return new Response('', { status: 404 });
    }
  });
});

describe('wordnet source (bundled OEWN 2025)', () => {
  it('is English-only', async () => {
    const result = await wordnetSource.enrich('casa', { ...ctx, sourceLang: 'es' });
    expect(result).toEqual({});
  });

  it('publishes sense-bound relation groups for the literal headword', async () => {
    const result = await wordnetSource.enrich('run', ctx);

    expect(result.relationGroups).toBeDefined();
    expect(result.relationGroups!.length).toBeGreaterThan(0);
    // OEWN 2025 sense order is preserved among the published groups: the
    // first sense with relations for the noun (baseball score) comes
    // before the motion verb group.
    const definitions = result.relationGroups!.map((group) => group.definition);
    expect(definitions.some((definition) => /score in baseball/i.test(definition ?? ''))).toBe(true);
    expect(definitions.some((definition) => /take to one's heels/i.test(definition ?? ''))).toBe(true);
  });

  it('resolves an inflected hover form through the lemmatizer', async () => {
    // "running" has its own adjective entry in OEWN, but the verb lemma
    // "run" must be reachable so the motion definition surfaces.
    const result = await wordnetSource.enrich('running', ctx);

    expect(result.definitions).toBeDefined();
    expect(
      result.definitions!.some((definition) => /move fast by using one's feet/i.test(definition)),
    ).toBe(true);
  });

  it('publishes WordNet usage examples for the resolved lemma', async () => {
    const result = await wordnetSource.enrich('know', ctx);

    expect(result.examples).toBeDefined();
    expect(result.examples!.length).toBeGreaterThan(0);
    expect(
      result.examples!.some((example) => /I know that the President lied/i.test(example.text)),
    ).toBe(true);
  });

  it('keeps the relational break-up sense alongside the literal ones', async () => {
    const result = await wordnetSource.enrich('break up', ctx);

    expect(result.relationGroups).toBeDefined();
    const groups = result.relationGroups!;
    // The relationship sense must exist in the published groups with its
    // own synonyms so the contextual selector can pick it for a romantic
    // sentence.
    const relational = groups.find((group) =>
      /association or relation/i.test(group.definition ?? ''),
    );
    expect(relational).toBeDefined();
    expect(relational!.synonyms).toContain('separate');
  });

  it('returns the idiom synset for a multi-word expression', async () => {
    const result = await wordnetSource.enrich('piece of cake', ctx);

    expect(result.definitions).toEqual(['any undertaking that is easy to do']);
    const group = result.relationGroups![0];
    expect(group.synonyms).toContain('cinch');
    expect(group.synonyms).toContain('breeze');
  });

  it('returns nothing for an unknown token', async () => {
    const result = await wordnetSource.enrich('zzzqqqxyzzy', ctx);
    expect(result).toEqual({});
  });

  it('caps the number of published sense groups, definitions and examples', async () => {
    // 'run' has 57 senses in OEWN 2025 — the source must not publish all.
    // The cap is 20 (not 12) because the manage synset (02448714-v,
    // "direct or control; projects, businesses, etc.") is the 13th group
    // with relations in OEWN sense order; a cap of 12 cut it off and
    // "She runs the company" could never publish manage/operate.
    const result = await wordnetSource.enrich('run', ctx);

    expect(result.relationGroups!.length).toBeLessThanOrEqual(20);
    expect(result.relationGroups!.length).toBeGreaterThan(12);
    expect(result.definitions!.length).toBeLessThanOrEqual(20);
    expect((result.examples?.length ?? 0)).toBeLessThanOrEqual(4);

    // The manage sense must be among the published groups — this is the
    // regression guard for the WSD-by-sense contract in the Standard tier.
    const definitions = result.relationGroups!.map((group) => group.definition);
    expect(definitions.some((definition) => /direct or control; projects, businesses/i.test(definition ?? ''))).toBe(true);
    expect(result.relationGroups!.some((group) => group.synonyms?.includes('operate'))).toBe(true);
  });

  it('carries direct antonyms recorded on the sense', async () => {
    const result = await wordnetSource.enrich('give', ctx);

    expect(result.relationGroups).toBeDefined();
    const withAntonyms = result.relationGroups!.filter((group) => (group.antonyms?.length ?? 0) > 0);
    expect(withAntonyms.length).toBeGreaterThan(0);
    expect(withAntonyms.some((group) => group.antonyms!.includes('take'))).toBe(true);
  });
});
