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
