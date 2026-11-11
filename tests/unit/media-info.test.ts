/**
 * F4 `getMediaInfo()` parsing (docs/REDESIGN-V2.md §4.5).
 *
 * The selectors belong to each platform adapter; this covers the shared
 * best-effort parser and the YouTube metadata sources. YouTube's player
 * response lives in the MAIN world, so the adapter reads the DOM and the
 * postMessage bridge — never an ISOLATED-world global.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MEDIA_INFO_RESULT,
  getDomMediaInfo,
  getYouTubeMediaInfo,
  parseEpisode,
  resetYoutubeMediaInfoBridgeForTests,
} from '../../src/content/platform-adapters/media-info';

const NONCE = 'test-nonce';

/** Deliver a MAIN-world answer the way `main-world-interceptor.ts` does. */
function deliverMediaInfo(details: unknown, nonce = NONCE): void {
  window.dispatchEvent(new MessageEvent('message', {
    source: window,
    data: { source: MEDIA_INFO_RESULT, nonce, details },
  }));
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.title = '';
  document.documentElement.setAttribute('data-kivara-nonce', NONCE);
  resetYoutubeMediaInfoBridgeForTests();
});

afterEach(() => {
  document.documentElement.removeAttribute('data-kivara-nonce');
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

  it('drops a title that only names the platform', () => {
    document.title = 'Netflix';
    expect(getDomMediaInfo('netflix', { genericTitles: ['Netflix'] })).toMatchObject({ title: '' });
  });

  it('never throws when a selector is invalid', () => {
    expect(() => getDomMediaInfo('generic', { titleSelectors: ['['] })).not.toThrow();
  });
});

describe('getYouTubeMediaInfo', () => {
  it('reads the watch-page heading from the DOM', () => {
    document.body.innerHTML = '<ytd-watch-metadata><div id="title"><h1>How to cook rice</h1></div></ytd-watch-metadata>';
    expect(getYouTubeMediaInfo()).toMatchObject({ platform: 'youtube', title: 'How to cook rice' });
  });

  it('uses the MAIN-world player response over the DOM heading', () => {
    document.body.innerHTML = '<ytd-watch-metadata><div id="title"><h1>Truncated heading</h1></div></ytd-watch-metadata>';
    deliverMediaInfo({ title: 'How to cook rice', videoId: 'abc', author: 'Chef' });
    expect(getYouTubeMediaInfo()).toMatchObject({ platform: 'youtube', title: 'How to cook rice' });
  });

  it('ignores a bridge answer with the wrong nonce', () => {
    document.title = 'How to cook rice - YouTube';
    deliverMediaInfo({ title: 'Spoofed title', videoId: 'abc' }, 'wrong-nonce');
    expect(getYouTubeMediaInfo().title).toBe('How to cook rice');
  });

  it('never reads the isolated-world ytInitialPlayerResponse global', () => {
    (globalThis as { ytInitialPlayerResponse?: unknown }).ytInitialPlayerResponse = {
      videoDetails: { title: 'Dead global title', videoId: 'abc' },
    };
    document.title = 'How to cook rice - YouTube';
    expect(getYouTubeMediaInfo().title).toBe('How to cook rice');
    delete (globalThis as { ytInitialPlayerResponse?: unknown }).ytInitialPlayerResponse;
  });

  it('never yields a title that is only the platform name', () => {
    document.title = 'YouTube';
    expect(getYouTubeMediaInfo().title).toBe('');
  });

  it('falls back to the page title', () => {
    document.title = 'How to cook rice - YouTube';
    expect(getYouTubeMediaInfo()).toMatchObject({ platform: 'youtube', title: 'How to cook rice' });
  });
});
