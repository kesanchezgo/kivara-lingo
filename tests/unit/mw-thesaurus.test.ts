import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';
import { merriamWebsterThesaurusSource } from '../../src/background/enrichment/sources/mw-thesaurus';
import type { EnrichmentContext } from '../../src/background/enrichment/types';

const FIXTURES = join(process.cwd(), 'docs', 'reports', 'runtime', 'fixtures', 'mw-thesaurus');

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

function mockFixture(html: string) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }),
  );
}

const ctx: EnrichmentContext = { sourceLang: 'en', targetLang: 'es', timeoutMs: 8000 };

describe('merriam-webster thesaurus source (real MV3 fixtures)', () => {
  it('is English-only', async () => {
    const result = await merriamWebsterThesaurusSource.enrich('correr', { ...ctx, sourceLang: 'es' });
    expect(result).toEqual({});
  });

  it('publishes sense-scoped synonym and antonym groups for run', async () => {
    mockFixture(fixture('run.html'));
    const result = await merriamWebsterThesaurusSource.enrich('run', ctx);

    expect(result.relationGroups).toBeDefined();
    const groups = result.relationGroups!;
    expect(groups.length).toBeGreaterThan(4);
    expect(groups.length).toBeLessThanOrEqual(16);

    // The first motion sense carries the "as in to jog" guide.
    expect(groups[0].guide).toBe('to jog');
    expect(groups[0].definition).toContain('pace faster than a walk');
    expect(groups[0].synonyms).toContain('jog');
    expect(groups[0].synonyms).toContain('trot');

    // The operate sense must be present so the contextual selector can
    // pick it for "She runs the company".
    const operate = groups.find((group) => /to operate|make decisions about/i.test(
      `${group.guide ?? ''} ${group.definition ?? ''}`,
    ));
    expect(operate).toBeDefined();
  });

  it('publishes direct antonyms for support', async () => {
    mockFixture(fixture('support.html'));
    const result = await merriamWebsterThesaurusSource.enrich('support', ctx);

    const groups = result.relationGroups!;
    expect(groups.length).toBeGreaterThanOrEqual(2);
    const withAntonyms = groups.filter((group) => (group.antonyms?.length ?? 0) > 0);
    expect(withAntonyms.length).toBeGreaterThan(0);
    // Sense 1 (reinforcement) carries obstruction-side antonyms; sense 2
    // (advocate) carries oppose-side antonyms.
    expect(withAntonyms.some((group) => group.antonyms!.includes('interference'))).toBe(true);
    expect(withAntonyms.some((group) => group.antonyms!.includes('oppose'))).toBe(true);
  });

  it('keeps the slang sense of lit separable from the light sense', async () => {
    mockFixture(fixture('lit.html'));
    const result = await merriamWebsterThesaurusSource.enrich('lit', ctx);

    const groups = result.relationGroups!;
    expect(groups.length).toBeGreaterThanOrEqual(3);
    // The illuminated cluster (bright, alight) and the drunk/slang cluster
    // (drunk, fried) must survive as separate sense groups.
    const guides = groups.map((group) => `${group.guide ?? ''} ${group.definition ?? ''}`);
    expect(guides.some((text) => /much light|illuminated/i.test(text))).toBe(true);
    expect(guides.some((text) => /drunk/i.test(text) || (groups.find((g) => g.synonyms?.includes('drunk')) && text.includes('drunk')))).toBe(true);
    const drunkGroup = groups.find((group) => group.synonyms?.includes('drunk'));
    expect(drunkGroup).toBeDefined();
    expect(drunkGroup!.antonyms).toContain('sober');
  });

  it('returns the idiom cluster for piece of cake', async () => {
    mockFixture(fixture('piece-of-cake.html'));
    const result = await merriamWebsterThesaurusSource.enrich('piece of cake', ctx);

    expect(result.relationGroups!.length).toBeGreaterThan(0);
    const group = result.relationGroups![0];
    expect(group.definition).toContain('easy to do');
    expect(group.synonyms!.length).toBeGreaterThan(4);
    // Direct antonyms of the idiom cluster.
    expect(group.antonyms).toContain('pain');
  });

  it('caps relations per group and total groups', async () => {
    mockFixture(fixture('run.html'));
    const result = await merriamWebsterThesaurusSource.enrich('run', ctx);

    expect(result.relationGroups!.length).toBeLessThanOrEqual(16);
    for (const group of result.relationGroups!) {
      expect(group.synonyms?.length ?? 0).toBeLessThanOrEqual(12);
      expect(group.antonyms?.length ?? 0).toBeLessThanOrEqual(12);
    }
  });

  it('keeps the relevance head of the idiom list, not the drift tail', async () => {
    // MW's raw order carries noise high (nothing #3, cake #5, roses #6)
    // so the parser drops literal components + empty quantifiers up
    // front. Verified live 2026-09-10: `piece of cake` vip syn ended
    // with roses/nothing.
    mockFixture(fixture('piece-of-cake.html'));
    const result = await merriamWebsterThesaurusSource.enrich('piece of cake', ctx);

    const group = result.relationGroups![0];
    expect(group.synonyms).toContain('breeze');
    expect(group.synonyms).toContain('duck soup');
    expect(group.synonyms).not.toContain('cake');
    expect(group.synonyms).not.toContain('roses');
    expect(group.synonyms).not.toContain('nothing');
  });

  it('caps published sense examples', async () => {
    mockFixture(fixture('run.html'));
    const result = await merriamWebsterThesaurusSource.enrich('run', ctx);

    expect((result.examples?.length ?? 0)).toBeLessThanOrEqual(2);
    if (result.examples?.length) {
      for (const example of result.examples) {
        // Every published example comes from a run sense block, so it must
        // feature some form of the headword (run/ran/running/running).
        expect(example.text).toMatch(/\brun\b|\bran\b|\brunning\b|\bruns\b/i);
      }
    }
  });

  it('returns nothing when the page has no sense markup', async () => {
    mockFixture('<html><body><p>not a thesaurus page</p></body></html>');
    const result = await merriamWebsterThesaurusSource.enrich('run', ctx);
    expect(result).toEqual({});
  });

  it('returns nothing on a non-200 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    const result = await merriamWebsterThesaurusSource.enrich('run', ctx);
    expect(result).toEqual({});
  });
});
