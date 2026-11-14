/**
 * Point 1 — Kivara mounts ONLY on the real playback route and container.
 *
 * Before: `findVideoContainer` fell back to "any <video>" on every host, so
 * on Netflix /browse the trailer a storefront row autoplayed got the overlay,
 * and YouTube's home-feed previews were eligible too. The user saw Kivara
 * mounted over the storefront instead of the player.
 *
 * The gating itself lives in `src/content/mount-gate.ts` (pure, table-driven).
 * These tests walk the four scenarios the owner listed, over the same helpers
 * the content script uses.
 */
import { describe, expect, it } from 'vitest';
import { mountDenied, mountGateFor } from '../../src/content/mount-gate';
import { findVideoContainerIn } from '../../src/content/video-container';

/** A <video> inside the element `containerHtml` produces. */
function withDom(containerHtml: string, withVideo = true): Document {
  const doc = new DOMParser().parseFromString(
    `<!doctype html><html><body>${withVideo ? containerHtml : containerHtml.replace('<video ', '<audio ').replace('</video>', '</audio>')}</body></html>`,
    'text/html',
  );
  return doc;
}

const NETFLIX_WATCH = '<div class="watch-video"><video src="x"></video></div>';
const YT_PLAYER = '<div class="html5-video-player"><video src="x"></video></div>';

describe('mount gate: route truth table', () => {
  it('netflix: /watch/<id> is playback, the storefront is not', () => {
    expect(mountDenied('www.netflix.com', '/browse')).toBe(true);
    expect(mountDenied('www.netflix.com', '/')).toBe(true);
    expect(mountDenied('www.netflix.com', '/watch/70196252')).toBe(false);
    expect(mountGateFor('www.netflix.com')?.platform).toBe('netflix');
  });

  it('youtube: /watch and /shorts are playback; home previews and embeds are not', () => {
    expect(mountDenied('www.youtube.com', '/')).toBe(true);
    expect(mountDenied('www.youtube.com', '/results')).toBe(true);
    expect(mountDenied('www.youtube.com', '/embed/dQw4w9WgXcQ')).toBe(true);
    expect(mountDenied('www.youtube.com', '/watch?v=x')).toBe(false);
    expect(mountDenied('www.youtube.com', '/shorts/abc')).toBe(false);
  });

  it('disney: /video/<id> is playback, the home page is not', () => {
    expect(mountDenied('www.disneyplus.com', '/')).toBe(true);
    expect(mountDenied('www.disneyplus.com', '/video/2b3c')).toBe(false);
  });

  it('max: /episode and /movie are playback, the rest is not', () => {
    expect(mountDenied('play.max.com', '/search')).toBe(true);
    expect(mountDenied('play.max.com', '/episode/abc')).toBe(false);
    expect(mountDenied('play.max.com', '/movie/xyz')).toBe(false);
  });

  it('prime: primevideo anywhere, amazon only under /gp/video', () => {
    expect(mountDenied('www.primevideo.com', '/')).toBe(false);
    expect(mountDenied('www.primevideo.com', '/detail/abc')).toBe(false);
    expect(mountDenied('www.amazon.com', '/dp/B0X')).toBe(true);
    expect(mountDenied('www.amazon.com', '/gp/video/detail/B0X')).toBe(false);
    expect(mountDenied('www.amazon.es', '/gp/video/detail/B0X')).toBe(false);
  });

  it('unknown hosts keep the generic fallback (nothing denied)', () => {
    expect(mountDenied('vimeo.com', '/123')).toBe(false);
    expect(mountGateFor('vimeo.com')).toBeNull();
  });
});

describe('findVideoContainerIn: the four owner scenarios', () => {
  it('/browse with an autoplaying trailer <video> → NO mount', () => {
    const doc = withDom('<div class="row"><video src="trailer"></video></div>');
    // The gate denies the route, so the finder must not fall back to the video.
    expect(mountDenied('www.netflix.com', '/browse')).toBe(true);
    expect(findVideoContainerIn(doc, 'www.netflix.com', '/browse')).toEqual({
      video: null,
      container: null,
    });
  });

  it('/watch → mounts exactly once (same element and container each call)', () => {
    const doc = withDom(NETFLIX_WATCH);
    const first = findVideoContainerIn(doc, 'www.netflix.com', '/watch/70196252');
    const second = findVideoContainerIn(doc, 'www.netflix.com', '/watch/70196252');
    expect(first.video?.tagName).toBe('VIDEO');
    expect(first.container?.className).toBe('watch-video');
    expect(second.container).toBe(first.container);
    expect(second.video).toBe(first.video);
  });

  it('/watch → /browse (SPA) → the gate denies: the caller unmounts', () => {
    const doc = withDom('<div class="row"><video src="trailer"></video></div>');
    // After the SPA lands on /browse, findVideoContainer yields nothing, which
    // is exactly what handleNavigation treats as "unmount + clear the bus".
    expect(mountDenied('www.netflix.com', '/browse')).toBe(true);
    expect(findVideoContainerIn(doc, 'www.netflix.com', '/browse').container).toBeNull();
  });

  it('/browse → /watch without reload → mounts (the finder answers again)', () => {
    const doc = withDom(NETFLIX_WATCH);
    // While on /browse the finder denies.
    expect(findVideoContainerIn(doc, 'www.netflix.com', '/browse').container).toBeNull();
    // Same document, SPA landed on /watch: the finder answers, and the
    // mount-queue's sameMedia logic mounts once.
    const found = findVideoContainerIn(doc, 'www.netflix.com', '/watch/70196252');
    expect(found.container?.className).toBe('watch-video');
    expect(found.video?.tagName).toBe('VIDEO');
  });

  it('youtube: the home-feed preview video is not eligible even with a player class', () => {
    // A home preview that happens to carry the player class is still denied:
    // the ROUTE is what gates, not just the container.
    const doc = withDom(YT_PLAYER);
    expect(mountDenied('www.youtube.com', '/')).toBe(true);
    expect(findVideoContainerIn(doc, 'www.youtube.com', '/')).toEqual({ video: null, container: null });
    expect(findVideoContainerIn(doc, 'www.youtube.com', '/watch?v=x').container?.className).toBe('html5-video-player');
  });

  it('play route with a video outside the platform container → still mounts', () => {
    const doc = withDom('<div class="row"><video src="movie"></video></div>');
    // The route is the hard gate; the container selector is a preference.
    // Platforms rename their player DOM (Netflix did), and the fixture pages
    // of the e2e suite carry no .html5-video-player either — robustness wins.
    const found = findVideoContainerIn(doc, 'www.netflix.com', '/watch/70196252');
    expect(found.video?.getAttribute('src')).toBe('movie');
    expect(found.container?.className).toBe('row');
  });

  it('unknown hosts keep the any-video fallback', () => {
    const doc = withDom('<div><video src="x"></video></div>');
    const found = findVideoContainerIn(doc, 'vimeo.com', '/123');
    expect(found.video?.tagName).toBe('VIDEO');
    expect(found.container?.tagName).toBe('DIV');
  });

  it('a page without any video stays null everywhere', () => {
    const doc = withDom('<div class="watch-video"></div>', false);
    expect(findVideoContainerIn(doc, 'www.netflix.com', '/watch/1')).toEqual({ video: null, container: null });
  });
});

/**
 * Point 1 follow-up — the routes each platform actually uses.
 *
 * Evidence-driven corrections after the Netflix QA: Max plays under /video/
 * (docs/SUBTITLE-INTERCEPTION.md documents play.max.com/video/... with a real
 * session), Disney+ prefixes the locale and also plays under /play/, and Prime
 * lives on eleven Amazon domains, not just .com.
 */
describe('mount gate: platform routes (evidence-driven)', () => {
  it('HBO/Max: /video/ is playback (documented), plus the episode/movie routes', () => {
    expect(mountGateFor('play.max.com')?.platform).toBe('hbo');
    expect(mountDenied('play.max.com', '/video/watch/8f3a/2b1c')).toBe(false);
    expect(mountDenied('play.max.com', '/video/abc')).toBe(false);
    expect(mountDenied('play.max.com', '/episode/abc')).toBe(false);
    expect(mountDenied('play.max.com', '/movie/xyz')).toBe(false);
    expect(mountDenied('play.max.com', '/search')).toBe(true);
    expect(mountDenied('play.max.com', '/')).toBe(true);
  });

  it('Disney+: optional locale prefix, and both /video/ and /play/', () => {
    expect(mountDenied('www.disneyplus.com', '/video/2b3c')).toBe(false);
    expect(mountDenied('www.disneyplus.com', '/play/2b3c')).toBe(false);
    expect(mountDenied('www.disneyplus.com', '/es-es/video/2b3c')).toBe(false);
    expect(mountDenied('www.disneyplus.com', '/es-ar/play/2b3c')).toBe(false);
    expect(mountDenied('www.disneyplus.com', '/es/video/2b3c')).toBe(false);
    // The home page, a series page and a locale-only URL are not playback.
    expect(mountDenied('www.disneyplus.com', '/es-es')).toBe(true);
    expect(mountDenied('www.disneyplus.com', '/es-es/series/abc')).toBe(true);
  });

  it('Prime: the eleven Amazon domains, not just .com', () => {
    for (const host of [
      'www.amazon.com', 'www.amazon.co.uk', 'www.amazon.de', 'www.amazon.es',
      'www.amazon.fr', 'www.amazon.it', 'www.amazon.co.jp', 'www.amazon.ca',
      'www.amazon.com.mx', 'www.amazon.com.br', 'www.amazon.in',
    ]) {
      expect(mountGateFor(host)?.platform, host).toBe('prime');
      expect(mountDenied(host, '/gp/video/detail/B0X'), host).toBe(false);
    }
    // Amazon domains outside /gp/video/ stay out of scope.
    expect(mountDenied('www.amazon.de', '/dp/B0X')).toBe(true);
    expect(mountDenied('www.amazon.fr', '/gp/help')).toBe(true);
    // primevideo.com sigue siendo Prime en cualquier ruta.
    expect(mountDenied('www.primevideo.com', '/')).toBe(false);
  });

  it('amazon.de /gp/video mounts on the Prime player container', () => {
    const doc = withDom('<div class="webPlayerSDKContainer"><video src="x"></video></div>');
    const found = findVideoContainerIn(doc, 'www.amazon.de', '/gp/video/detail/B0X');
    expect(found.container?.className).toBe('webPlayerSDKContainer');
    expect(found.video?.tagName).toBe('VIDEO');
    // Leaving the route demounts even though the page still has a <video>.
    expect(findVideoContainerIn(doc, 'www.amazon.de', '/dp/B0X')).toEqual({ video: null, container: null });
  });

  it('HBO/Disney: an unrecognised path still mounts if the player container is there', () => {
    const hbo = withDom('<div data-testid="player-container"><video src="x"></video></div>');
    const disney = withDom('<div class="btm-media-player"><video src="x"></video></div>');
    // The route table is not gospel: when the platform ships a new path, the
    // player container IS the evidence, and staying idle would leave the user
    // without Kivara. The route stays recorded as unrecognised for devLog.
    expect(mountDenied('play.max.com', '/watch/unknown')).toBe(true);
    const foundHbo = findVideoContainerIn(hbo, 'play.max.com', '/watch/unknown');
    expect(foundHbo.container?.getAttribute('data-testid')).toBe('player-container');
    expect(foundHbo.video?.tagName).toBe('VIDEO');

    expect(mountDenied('www.disneyplus.com', '/somewhere/else')).toBe(true);
    const foundDisney = findVideoContainerIn(disney, 'www.disneyplus.com', '/somewhere/else');
    expect(foundDisney.container?.className).toBe('btm-media-player');
  });

  it('the override is HBO/Disney only: Netflix keeps its hard gate', () => {
    const doc = withDom('<div class="watch-video"><video src="trailer"></video></div>');
    expect(findVideoContainerIn(doc, 'www.netflix.com', '/browse')).toEqual({ video: null, container: null });
  });
});
