/**
 * The MAIN world's JSON.parse hook: Netflix's manifest arrives DECRYPTED only
 * through that parse (the MSL wire body is opaque), and the hook extracts the
 * timedtexttracks with their download URLs so the bus can fetch the
 * native-language track (the MPD flow's Netflix counterpart).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  extractManifestTracks,
  installNetflixManifestHook,
  maybeInstallNetflixManifestHook,
  pickNetflixManifestTrack,
} from '../../src/content/platform-adapters/netflix-manifest-hook';

const MANIFEST = {
  timedtexttracks: [
    {
      ttId: 'tt-en',
      bcp47: 'en',
      isNoneTrack: false,
      ttDownload: [{ url: 'https://tt/en.ttml' }],
    },
    {
      ttId: 'tt-es',
      bcp47: 'es',
      isNoneTrack: false,
      isImageBased: false,
      ttDownload: [{ cdnlist: [{ url: 'https://tt/es.ttml' }] }],
    },
    { bcp47: 'xx', downloadUrl: 'https://tt/xx.ttml' },
  ],
};

describe('extractManifestTracks', () => {
  it('extracts the tracks with every known URL carrier', () => {
    const tracks = extractManifestTracks(MANIFEST);
    expect(tracks).toHaveLength(3);
    expect(tracks?.[0]).toMatchObject({ bcp47: 'en', ttDownloadUrl: 'https://tt/en.ttml' });
    expect(tracks?.[1]).toMatchObject({ bcp47: 'es', ttDownloadUrl: 'https://tt/es.ttml' });
    expect(tracks?.[2]).toMatchObject({ bcp47: 'xx', ttDownloadUrl: 'https://tt/xx.ttml' });
  });

  it('flags the none / forced / image-based tracks for the caller to skip', () => {
    const value = {
      timedtexttracks: [
        { bcp47: 'es', isNoneTrack: true },
        { bcp47: 'es', isForcedNarrative: true },
        { bcp47: 'es', isImageBased: true },
      ],
    };
    const tracks = extractManifestTracks(value);
    expect(tracks?.every((t) => t.isNoneTrack || t.isForcedNarrative || t.isImageBased)).toBe(true);
  });

  it('answers null for values that are not a manifest', () => {
    expect(extractManifestTracks(null)).toBeNull();
    expect(extractManifestTracks({})).toBeNull();
    expect(extractManifestTracks({ timedtexttracks: [] })).toBeNull();
    expect(extractManifestTracks({ timedtexttracks: [{ noLang: true }] })).toBeNull();
    expect(extractManifestTracks('manifest')).toBeNull();
  });
});

describe('pickNetflixManifestTrack', () => {
  // The real episode lists the FORCED es track first. Taking it gives a
  // near-empty "native" line, which is exactly the B8/D5 failure.
  const REAL_MANIFEST = [
    { bcp47: 'es', isForcedNarrative: true, ttDownloadUrl: 'https://tt/es-forced.ttml' },
    { bcp47: 'es', ttDownloadUrl: 'https://tt/es-normal.ttml' },
    { bcp47: 'en', ttDownloadUrl: 'https://tt/en-cc.ttml' },
  ];

  it('never picks the forced track — it prefers the normal one of the same language', () => {
    expect(pickNetflixManifestTrack(REAL_MANIFEST, 'es')?.ttDownloadUrl)
      .toBe('https://tt/es-normal.ttml');
  });

  it('returns null (keeping the MT fallback) when only a forced track is offered', () => {
    expect(pickNetflixManifestTrack([REAL_MANIFEST[0]], 'es')).toBeNull();
  });

  it('excludes none / image-based / empty-url tracks', () => {
    expect(pickNetflixManifestTrack([
      { bcp47: 'es', isNoneTrack: true, ttDownloadUrl: 'https://tt/es.ttml' },
      { bcp47: 'es', isImageBased: true, ttDownloadUrl: 'https://tt/es.ttml' },
      { bcp47: 'es' },
    ], 'es')).toBeNull();
  });

  it('matches the primary subtag and answers null for a missing language', () => {
    expect(pickNetflixManifestTrack([{ bcp47: 'es-ES', ttDownloadUrl: 'u' }], 'es-MX')?.ttDownloadUrl).toBe('u');
    expect(pickNetflixManifestTrack(REAL_MANIFEST, '')).toBeNull();
  });
});

describe('maybeInstallNetflixManifestHook', () => {
  function fakeWin(host: string) {
    return {
      JSON: { parse: (text: string) => globalThis.JSON.parse(text) } as JSON,
      location: { hostname: host },
    } as unknown as Window & { JSON: JSON };
  }

  it('leaves JSON.parse untouched on a non-Netflix host', () => {
    const win = fakeWin('youtube.com');
    const original = win.JSON.parse;
    const unhook = maybeInstallNetflixManifestHook(win, () => {});
    expect(win.JSON.parse).toBe(original);
    unhook();
  });

  it('patches and fires only on netflix.com (exact or subdomain)', () => {
    for (const host of ['netflix.com', 'www.netflix.com']) {
      const win = fakeWin(host);
      const original = win.JSON.parse;
      const seen: unknown[] = [];
      const unhook = maybeInstallNetflixManifestHook(win, (tracks) => seen.push(tracks));
      expect(win.JSON.parse).not.toBe(original);
      win.JSON.parse(JSON.stringify(MANIFEST));
      expect(seen).toHaveLength(1);
      unhook();
      expect(win.JSON.parse('{"hello":"world"}')).toEqual({ hello: 'world' });
    }
  });

  it('does not patch a host that merely contains the word netflix', () => {
    const win = fakeWin('netflix.com.evil.test');
    const original = win.JSON.parse;
    maybeInstallNetflixManifestHook(win, () => {})();
    expect(win.JSON.parse).toBe(original);
  });
});

describe('installNetflixManifestHook', () => {
  it('fires the callback when a manifest is parsed and preserves the result', () => {
    const win = { JSON: { parse: (text: string) => globalThis.JSON.parse(text) } as JSON } as unknown as Window & { JSON: JSON };
    const seen: unknown[] = [];
    const unhook = installNetflixManifestHook(win, (tracks) => seen.push(tracks));
    const parsed = win.JSON.parse(JSON.stringify(MANIFEST)) as { timedtexttracks: unknown[] };
    expect(parsed.timedtexttracks).toHaveLength(3);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(3);
    unhook();
  });

  it('does not fire for ordinary parses', () => {
    const win = { JSON: { parse: (text: string) => globalThis.JSON.parse(text) } as JSON } as unknown as Window & { JSON: JSON };
    const seen: unknown[] = [];
    const unhook = installNetflixManifestHook(win, (tracks) => seen.push(tracks));
    expect((win.JSON.parse('{"hello":"world"}') as { hello: string }).hello).toBe('world');
    expect(win.JSON.parse('[1,2,3]')).toEqual([1, 2, 3]);
    expect(seen).toHaveLength(0);
    unhook();
  });

  it('is idempotent and restores the original parse on cleanup', () => {
    const win = { JSON: { parse: (text: string) => globalThis.JSON.parse(text) } as JSON } as unknown as Window & { JSON: JSON };
    const unhook1 = installNetflixManifestHook(win, () => {});
    const unhook2 = installNetflixManifestHook(win, () => {});
    unhook2();
    // The first hook's cleanup also restores; the flag is cleared either way.
    unhook1();
    const parsed = win.JSON.parse('{"timedtexttracks":[{"bcp47":"es"}]}') as { timedtexttracks: unknown[] };
    expect(parsed.timedtexttracks).toHaveLength(1);
  });
});

describe('extractManifestTracks — real Cadmium shapes (round 10)', () => {
  const MSL_MANIFEST = {
    result: {
      timedtexttracks: [
        {
          ttId: 'tt-es-imsc',
          bcp47: 'es',
          isNoneTrack: false,
          isForcedNarrative: false,
          isImageBased: false,
          ttDownloadables: {
            'nflx-cmisc': { isImage: true, urls: [{ url: 'https://tt/es-cmisc' }] },
            'imsc1.1': { isImage: false, urls: [{ url: 'https://tt/es-imsc1.1' }] },
            'webvtt-lssdh-ios8': { downloadUrls: { '1': 'https://tt/es-webvtt' } },
          },
        },
      ],
    },
  };

  it('unwraps the MSL result envelope (result.timedtexttracks)', () => {
    const tracks = extractManifestTracks(MSL_MANIFEST);
    expect(tracks).toHaveLength(1);
    expect(tracks?.[0]).toMatchObject({ bcp47: 'es', ttDownloadUrl: 'https://tt/es-imsc1.1' });
  });

  it('unwraps arrays of envelopes/results down to depth 3', () => {
    const tracks = extractManifestTracks([
      { result: MSL_MANIFEST.result },
      { timedtexttracks: [{ bcp47: 'en', ttDownload: [{ url: 'https://tt/en.ttml' }] }] },
    ]);
    expect(tracks?.map((t) => t.bcp47).sort()).toEqual(['en', 'es']);
  });

  it('does not dig past depth 3', () => {
    const deep = { a: { b: { c: { timedtexttracks: [{ bcp47: 'es' }] } } } };
    expect(extractManifestTracks(deep)).toBeNull();
  });

  it('ttDownloadables prefers XML/VTT profiles and skips image/cmisc profiles', () => {
    const tracks = extractManifestTracks(MSL_MANIFEST);
    expect(tracks?.[0]?.ttDownloadUrl).toBe('https://tt/es-imsc1.1');
    const webvttOnly = {
      timedtexttracks: [{
        bcp47: 'pt',
        ttDownloadables: {
          'nflx-cmisc': { isImage: true, urls: [{ url: 'https://tt/pt-cmisc' }] },
          'webvtt-lssdh-ios8': { downloadUrls: { '1': 'https://tt/pt-webvtt' } },
        },
      }],
    };
    const pt = extractManifestTracks(webvttOnly);
    expect(pt?.[0]?.ttDownloadUrl).toBe('https://tt/pt-webvtt');
    const imageOnly = {
      timedtexttracks: [{ bcp47: 'pt', ttDownloadables: { 'nflx-cmisc': { isImage: true, urls: [{ url: 'https://tt/x' }] } } }],
    };
    expect(extractManifestTracks(imageOnly)?.[0]?.ttDownloadUrl).toBeUndefined();
  });
});
