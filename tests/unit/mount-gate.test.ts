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
