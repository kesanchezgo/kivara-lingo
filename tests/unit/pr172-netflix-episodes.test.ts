/**
 * PR #172 — the episodes catalog, extracted from the page's own graph.
 *
 * Netflix keeps the season/episode data in `window.netflix.falcorCache` in the
 * MAIN world, wrapped in Falcor atoms and refs. Reading it from the ISOLATED
 * world is impossible, and the shapes change between builds, so the extractor is
 * pure, bounded and total: it never throws, never hangs and answers `null` for a
 * film (or for any shape it does not recognise) instead of guessing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractNetflixEpisodesCatalog } from '../../src/content/platform-adapters/netflix-episodes';

const atom = (value: unknown) => ({ $type: 'atom', value });
const ref = (...path: Array<string | number>) => ({ $type: 'ref', value: path });

/** Two seasons, four episodes, the second one playing. */
function cache() {
  return {
    videos: {
      '80000001': { summary: atom({ id: 80000001, type: 'episode', title: 'Chapter One', seasonId: 9001, seriesId: 7000, episodeNumber: 1, runtime: 2820, synopsis: 'Un pueblo, una desaparición.' }) },
      '80000002': { summary: atom({ id: 80000002, type: 'episode', title: 'Chapter Two', seasonId: 9001, seriesId: 7000, episodeNumber: 2, runtime: 2940 }) },
      '80000003': { summary: atom({ id: 80000003, type: 'episode', title: 'Chapter Three', seasonId: 9002, seriesId: 7000, episodeNumber: 1, runtime: 3300 }) },
      '99999999': { summary: atom({ id: 99999999, type: 'episode', title: 'Otra serie', seasonId: 8001, seriesId: 1234, episodeNumber: 1 }) },
      '55555555': { summary: atom({ id: 55555555, type: 'movie', title: 'Una película', runtime: 6000 }) },
    },
    seasons: {
      '9001': { summary: atom({ id: 9001, title: 'Temporada 1', seq: 1 }) },
      '9002': { summary: atom({ id: 9002, title: 'Temporada 2', seq: 2 }) },
    },
  };
}

const win = (falcorCache?: unknown) => ({ netflix: { falcorCache } });

afterEach(() => vi.restoreAllMocks());

describe('PR #172 · extractNetflixEpisodesCatalog', () => {
  it('groups the episodes of the CURRENT series into seasons, marking the one playing', () => {
    const catalog = extractNetflixEpisodesCatalog(win(cache()), '80000002');
    expect(catalog).not.toBeNull();
    expect(catalog!.currentVideoId).toBe('80000002');
    expect(catalog!.seasons.map((season) => season.number)).toEqual([1, 2]);
    expect(catalog!.seasons[0].title).toBe('Temporada 1');
    expect(catalog!.seasons[0].episodes.map((episode) => episode.number)).toEqual([1, 2]);
    expect(catalog!.seasons[1].episodes.map((episode) => episode.number)).toEqual([1]);
    // The other series and the film are not part of this catalog.
    const titles = catalog!.seasons.flatMap((season) => season.episodes.map((episode) => episode.title));
    expect(titles).toEqual(['Chapter One', 'Chapter Two', 'Chapter Three']);
    const playing = catalog!.seasons.flatMap((season) => season.episodes).filter((episode) => episode.current);
    expect(playing).toHaveLength(1);
    expect(playing[0].id).toBe('80000002');
    // Numbers are usable as-is, and the runtime rides along.
    expect(catalog!.seasons[0].episodes[1].durationSec).toBe(2940);
    expect(catalog!.seasons[0].episodes[0].synopsis).toContain('desaparición');
  });

  it('follows refs and atoms wherever they are', () => {
    const graph = {
      videos: {
        '80000010': {
          summary: ref('videos', '80000010', 'detail'),
          detail: atom({ id: 80000010, type: 'episode', title: 'Deep One', seasonId: 9100, seriesId: 7200, episodeNumber: 1 }),
        },
      },
      seasons: { '9100': { summary: atom({ id: 9100, title: 'Temporada única', seq: 1 }) } },
    };
    const catalog = extractNetflixEpisodesCatalog(win(graph), '80000010');
    expect(catalog?.seasons[0].episodes.map((episode) => episode.title)).toEqual(['Deep One']);
  });

  it('answers null for a film, for an empty graph and for a graph without episodes', () => {
    expect(extractNetflixEpisodesCatalog(win(cache()), '55555555')).toBeNull();
    expect(extractNetflixEpisodesCatalog(win({}), '80000002')).toBeNull();
    expect(extractNetflixEpisodesCatalog(win(undefined), '80000002')).toBeNull();
    expect(extractNetflixEpisodesCatalog(undefined, '80000002')).toBeNull();
    expect(extractNetflixEpisodesCatalog(win({ videos: { a: { summary: atom({ id: 'a', type: 'episode' }) } } }), undefined)).toBeNull();
  });

  it('never hangs on a cyclic graph, an over-deep one, or a huge one', () => {
    const cyclic: Record<string, unknown> = { videos: {} };
    const deep: Record<string, unknown> = { videos: {} };
    let cursor: Record<string, unknown> = deep;
    for (let i = 0; i < 40; i += 1) {
      cursor.child = { next: atom({ id: `n${i}`, type: 'episode', seasonId: 1, episodeNumber: i }) };
      cursor = cursor.child as Record<string, unknown>;
    }
    (cyclic as { self?: unknown }).self = cyclic;
    (cyclic.videos as Record<string, unknown>)['1'] = { summary: cyclic };

    const huge: Record<string, unknown> = { videos: {} };
    for (let i = 0; i < 5_000; i += 1) {
      (huge.videos as Record<string, unknown>)[`x${i}`] = { summary: atom({ id: `x${i}`, type: 'episode', seasonId: 1, seriesId: 42, episodeNumber: i }) };
    }

    const started = Date.now();
    expect(extractNetflixEpisodesCatalog(win(cyclic), '1')).toBeNull();
    expect(() => extractNetflixEpisodesCatalog(win(deep), 'n0')).not.toThrow();
    const big = extractNetflixEpisodesCatalog(win(huge), 'x0');
    expect(Date.now() - started, 'the walk is bounded, not exhaustive').toBeLessThan(1_000);
    expect(big?.seasons[0].episodes.length ?? 0, 'and it stops at the node budget').toBeLessThanOrEqual(2_500);
  });

  it('survives a hostile graph without printing anything', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const throwing = {
      get videos(): never {
        throw new Error('boom');
      },
    };
    expect(extractNetflixEpisodesCatalog(win(throwing), '1')).toBeNull();
    // A getter that throws inside a recognised node must not escape either.
    expect(extractNetflixEpisodesCatalog(win({ videos: { a: { get summary(): never { throw new Error('boom'); } } } }), 'a')).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
