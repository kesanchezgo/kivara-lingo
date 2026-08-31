import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openverseSource } from '../../src/background/enrichment/sources/openverse';
import { wikimediaCommonsSource } from '../../src/background/enrichment/sources/wikimedia-commons';

const ctx = { sourceLang: 'en', targetLang: 'es', timeoutMs: 8000 };

const openverseFixture = {
  results: [
    {
      url: 'https://images.example/apple.jpg',
      thumbnail: 'https://images.example/apple-thumb.jpg',
      title: 'Red apple on a table',
      foreign_landing_url: 'https://provider.example/apple',
      width: 1200,
      height: 800,
      tags: [{ name: 'apple' }, { name: 'fruit' }, { name: 'fruit' }],
    },
    {
      thumbnail: 'https://images.example/orchard.jpg',
      title: 'Apple orchard',
      detail_url: 'https://openverse.org/image/orchard',
      tags: ['orchard'],
    },
    ...Array.from({ length: 4 }, (_, index) => ({
      url: `https://images.example/extra-${index}.jpg`,
      title: `Extra apple ${index}`,
    })),
  ],
};

/** Concept lookup: the fruit (Q89) must win over the company (Q312)
 * even though the company ranks first in wbsearchentities. */
const wikidataConceptFixture = {
  search: [
    { id: 'Q312', label: 'Apple Inc.', description: 'American multinational technology company' },
    { id: 'Q213710', label: 'Apple Records', description: 'UK international record label' },
    { id: 'Q89', label: 'apple', description: 'edible fruit of the apple tree' },
  ],
};

/** A lookup dominated by disambiguation-style entities must yield NO
 * concept at all — the source returns {} instead of a wrong image. */
const wikidataAbstractFixture = {
  search: [
    { id: 'Q63565252', label: 'brook', description: 'small stream' },
    { id: 'Q1508815', label: 'Run', description: '2004 song by Snow Patrol' },
    { id: 'Q37438975', label: 'Run', description: 'family name' },
  ],
};

const commonsSearchFixture = {
  query: {
    search: Array.from({ length: 5 }, (_, index) => ({ title: `File:Apple ${index + 1}.jpg` })),
  },
};

const commonsInfoFixture = {
  query: {
    pages: {
      '1': {
        title: 'File:Apple blossom.jpg',
        imageinfo: [{
          url: 'https://upload.wikimedia.org/apple-original.jpg',
          thumburl: 'https://upload.wikimedia.org/apple-thumb.jpg',
          descriptionurl: 'https://commons.wikimedia.org/wiki/File:Apple_blossom.jpg',
          width: 3000,
          height: 2000,
          thumbwidth: 600,
          thumbheight: 400,
          extmetadata: {
            ImageDescription: { value: '<p>Apple blossom in spring</p>' },
            Categories: { value: 'Apple trees|Blossoms' },
            LicenseShortName: { value: 'CC BY-SA 4.0' },
          },
        }],
      },
      '2': {
        title: 'File:Green apple.png',
        imageinfo: [{
          url: 'https://upload.wikimedia.org/green-apple.png',
          descriptionurl: 'https://commons.wikimedia.org/wiki/File:Green_apple.png',
          width: 900,
          height: 900,
          extmetadata: { LicenseShortName: { value: 'Public domain' } },
        }],
      },
    },
  },
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

describe('standard image source candidates', () => {
  it('maps up to five Openverse results and keeps the legacy image URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(openverseFixture));

    const result = await openverseSource.enrich('apple', ctx);

    expect(result.imageCandidates).toHaveLength(5);
    expect(result.imageUrl).toBe('https://images.example/apple.jpg');
    expect(result.imageCandidates?.[0]).toEqual({
      url: 'https://images.example/apple.jpg',
      title: 'Red apple on a table',
      sourcePageUrl: 'https://provider.example/apple',
      width: 1200,
      height: 800,
      tags: ['apple', 'fruit'],
    });
    expect(result.imageCandidates?.[1]).toEqual({
      url: 'https://images.example/orchard.jpg',
      title: 'Apple orchard',
      sourcePageUrl: 'https://openverse.org/image/orchard',
      tags: ['orchard'],
    });
  });

  it('anchors the search on the depictable concept and queries P180', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(wikidataConceptFixture))
      .mockResolvedValueOnce(jsonResponse(commonsSearchFixture))
      .mockResolvedValueOnce(jsonResponse(commonsInfoFixture));

    const result = await wikimediaCommonsSource.enrich('apple', ctx);

    // Stage 1 resolved the fruit, not the company.
    const conceptUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(conceptUrl).toContain('wbsearchentities');
    // Stage 2 searched for files DEPICTING the concept.
    const searchUrl = decodeURIComponent(String(fetchMock.mock.calls[1]?.[0]));
    expect(searchUrl).toContain('haswbstatement:P180=Q89');

    const infoUrl = decodeURIComponent(String(fetchMock.mock.calls[2]?.[0]));
    expect(infoUrl).toContain('iiprop=url|size|extmetadata');
    expect(infoUrl).toContain('File:Apple 1.jpg|File:Apple 2.jpg|File:Apple 3.jpg|File:Apple 4.jpg');
    expect(infoUrl).not.toContain('File:Apple 5.jpg');
    expect(result.imageUrl).toBe('https://upload.wikimedia.org/apple-thumb.jpg');
    expect(result.imageCandidates).toEqual([
      {
        url: 'https://upload.wikimedia.org/apple-thumb.jpg',
        title: 'File:Apple blossom.jpg',
        sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:Apple_blossom.jpg',
        width: 600,
        height: 400,
        tags: ['Apple blossom in spring', 'Apple trees', 'Blossoms', 'CC BY-SA 4.0'],
      },
      {
        url: 'https://upload.wikimedia.org/green-apple.png',
        title: 'File:Green apple.png',
        sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:Green_apple.png',
        width: 900,
        height: 900,
        tags: ['Public domain'],
      },
    ]);
  });

  it('returns no image when every candidate entity is disambiguation noise', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(wikidataAbstractFixture));

    const result = await wikimediaCommonsSource.enrich('run', ctx);

    expect(result).toEqual({});
    // No Commons call was made — the concept gate stopped the search.
    expect(fetchMock.mock.calls).toHaveLength(1);
  });

  it('fails silently when providers return no usable data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({}));

    await expect(openverseSource.enrich('apple', ctx)).resolves.toEqual({});
    await expect(wikimediaCommonsSource.enrich('apple', ctx)).resolves.toEqual({});
  });
});
