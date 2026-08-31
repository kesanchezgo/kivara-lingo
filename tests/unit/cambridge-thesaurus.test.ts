import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cambridgeSource,
  parseCambridgeThesaurus,
} from '../../src/background/enrichment/sources/cambridge';

const dictionaryHtml = `
  <div class="di-title"><span class="hw dhw">run</span></div>
  <div class="def ddef_d">to move quickly on foot:</div>
`;

const thesaurusHtml = `
  <div class="di-title"><h2><b class="tb ttn">run</b> | American Thesaurus</h2></div>
  <div class="pr dsense">
    <span class="guideword dsense_gw">MOVE FAST</span>
    <div class="eg deg">She can run very fast.</div>
    <span class="synonym"><a>dash</a></span>
    <span class="synonym">sprint</span>
    <span class="synonym">Dash</span>
    <span class="synonym">run</span>
    <span class="opposite">walk</span>
  </div>
  <div class="pr dsense">
    <span class="guideword dsense_gw">OPERATE</span>
    <div class="eg deg">He runs the family business.</div>
    <span class="synonym">manage</span>
    <span class="synonym">operate</span>
    <span class="opposite">close down</span>
  </div>
`;

const ctx = {
  sourceLang: 'en',
  targetLang: 'es',
  timeoutMs: 8000,
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('parseCambridgeThesaurus', () => {
  it('keeps multiple senses of run in separate relation groups', () => {
    const groups = parseCambridgeThesaurus(thesaurusHtml, 'run');

    expect(groups).toEqual([
      {
        guide: 'MOVE FAST',
        example: 'She can run very fast.',
        synonyms: ['dash', 'sprint'],
        antonyms: ['walk'],
      },
      {
        guide: 'OPERATE',
        example: 'He runs the family business.',
        synonyms: ['manage', 'operate'],
        antonyms: ['close down'],
      },
    ]);
    expect(groups[0]?.synonyms).not.toContain('operate');
    expect(groups[1]?.synonyms).not.toContain('dash');
  });

  it('rejects relations when the thesaurus headword is not an exact match', () => {
    expect(parseCambridgeThesaurus(thesaurusHtml, 'runner')).toEqual([]);
  });
});

describe('Cambridge thesaurus enrichment', () => {
  it('starts dictionary and thesaurus requests in parallel for English', async () => {
    let resolveDictionary: ((response: Response) => void) | undefined;
    const pendingDictionary = new Promise<Response>((resolve) => {
      resolveDictionary = resolve;
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      return url.includes('/thesaurus/')
        ? Promise.resolve(new Response(thesaurusHtml, { status: 200 }))
        : pendingDictionary;
    });

    const resultPromise = cambridgeSource.enrich('run', ctx);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      'https://dictionary.cambridge.org/dictionary/english-spanish/run',
      'https://dictionary.cambridge.org/thesaurus/run',
    ]);

    resolveDictionary?.(new Response(dictionaryHtml, { status: 200 }));
    const result = await resultPromise;

    expect(result.definitions).toEqual(['to move quickly on foot']);
    expect(result.relationGroups).toHaveLength(2);
  });

  it('keeps the dictionary payload when the thesaurus request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/thesaurus/')) return Promise.reject(new Error('thesaurus unavailable'));
      return Promise.resolve(new Response(dictionaryHtml, { status: 200 }));
    });

    const result = await cambridgeSource.enrich('run', ctx);

    expect(result.definitions).toEqual(['to move quickly on foot']);
    expect(result.relationGroups).toBeUndefined();
  });

  it('does not request the thesaurus for non-English source languages', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(dictionaryHtml, { status: 200 }),
    );

    await cambridgeSource.enrich('run', { ...ctx, sourceLang: 'es' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('/thesaurus/');
  });
});
