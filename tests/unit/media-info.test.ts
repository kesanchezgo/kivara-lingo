/**
 * F4 `getMediaInfo()` parsing (docs/REDESIGN-V2.md §4.5).
 *
 * The selectors belong to each platform adapter; this covers the shared
 * best-effort parser and the two simplest shapes (DOM + YouTube player
 * response) so a series/episode code cannot silently stop reaching the tags.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getDomMediaInfo, getYouTubeMediaInfo, parseEpisode } from '../../src/content/platform-adapters/media-info';

beforeEach(() => {
  document.body.innerHTML = '';
  document.title = '';
});

describe('parseEpisode', () => {
  it('understands the streaming spellings', () => {
    for (const text of ['S01E02', 's1 e2', 'S1:E2', 'Season 1 Episode 2', 'Temporada 1 Episodio 2', '1x02']) {
      expect(parseEpisode(text), text).toMatchObject({ season: 1, episode: 2 });
    }
  });

  it('ignores text without an episode code', () => {
    expect(parseEpisode('Game of Thrones')).toBeUndefined();
    expect(parseEpisode('Season 1')).toBeUndefined();
  });
});

describe('getDomMediaInfo', () => {
  it('reads title, series and the episode code from the adapter selectors', () => {
    document.body.innerHTML = '<div id="s">Game of Thrones</div><div id="t">Winter is Coming</div><div id="e">S01 E01</div>';
    expect(getDomMediaInfo('netflix', {
      titleSelectors: ['#t'],
      seriesSelectors: ['#s'],
      episodeSelectors: ['#e'],
    })).toMatchObject({
      platform: 'netflix',
      title: 'Winter is Coming',
      series: 'Game of Thrones',
      season: 1,
      episode: 1,
    });
  });

  it('falls back to the cleaned document title', () => {
    document.title = 'Watch Inception | Netflix';
    expect(getDomMediaInfo('netflix', {
      titlePrefixes: ['Watch '],
      titleSuffixes: [' | Netflix'],
    })).toMatchObject({ title: 'Inception', platform: 'netflix' });
  });

  it('never throws when a selector is invalid', () => {
    expect(() => getDomMediaInfo('generic', { titleSelectors: ['['] })).not.toThrow();
  });
});

describe('getYouTubeMediaInfo', () => {
  it('reads ytInitialPlayerResponse.videoDetails', () => {
    (globalThis as { ytInitialPlayerResponse?: unknown }).ytInitialPlayerResponse = {
      videoDetails: { title: 'How to cook rice', videoId: 'abc' },
    };
    expect(getYouTubeMediaInfo()).toMatchObject({ platform: 'youtube', title: 'How to cook rice' });
    delete (globalThis as { ytInitialPlayerResponse?: unknown }).ytInitialPlayerResponse;
  });

  it('falls back to the page title', () => {
    document.title = 'How to cook rice - YouTube';
    expect(getYouTubeMediaInfo()).toMatchObject({ platform: 'youtube', title: 'How to cook rice' });
  });
});