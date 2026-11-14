/**
 * Netflix adapter.
 *
 * Netflix serves subtitles as TTML/DFXP from `*.nflxvideo.net` URLs with a
 * `?o=...` query string. The MAIN-world interceptor catches them; this
 * adapter wires up the video element + native subtitle hiding.
 *
 * Tested anchor selectors:
 *  - `.watch-video` — the modern Netflix watch page wrapper
 *  - `.player-timedtext` / `.player-timedtext-text-container` — native
 *    subtitle rendering containers
 */
import { createInterceptedAdapter } from './intercepted-adapter';
import { mediaThroughMainWorld } from './netflix-main-bridge';
import { getDomMediaInfo } from './media-info';
import type { MediaInfo } from '../../shared/types';
import type { SubtitleSource } from './types';

const HIDE_NATIVE_CSS = `
  .player-timedtext,
  .player-timedtext-text-container,
  .player-timedtext-text-container > *,
  [class^="watch-video--player-view"] .player-timedtext { display: none !important; }
`;

/**
 * Netflix only renders the watch-page title while the controls are visible;
 * once they auto-hide the DOM (and `document.title`) degrade to "Netflix",
 * and a tag built from that would be `kivara::netflix` for every show. The
 * last real title is therefore cached per `<video>` and reused while the same
 * element plays the same URL; a new element or a new watch URL starts empty,
 * so a wrong title never leaks into the next episode.
 */

/**
 * Point 5 — the real title.
 *
 * `readNetflixMedia` trusted the first DOM selector that answered. On the QA
 * build that was interface copy ("Así aprenderás"), and the wrong title went
 * into `source.title` and into the Anki tags (`kivara::asi_aprenderas`).
 *
 * Netflix's own title lives in `document.title` ("<Título> | Netflix"), so
 * that is the truth. DOM candidates are accepted only when they agree with
 * it; the MAIN-world player metadata (video id + title) is asked first
 * because it belongs to the player, not to the page chrome.
 */
export function officialTitleFrom(documentTitle: string): string {
  const cleaned = (documentTitle ?? '').replace(/\s*[|·-]\s*Netflix\s*$/i, '').trim();
  return /^netflix$/i.test(cleaned) ? '' : cleaned;
}

/** Metadata the MAIN world can report about the current video. */
export interface NetflixMainMedia {
  videoId?: string;
  title?: string;
}

const normTitle = (value: string | undefined): string =>
  (value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Pick the title, preferring the player's metadata, then a DOM candidate that
 * the document title corroborates, then the document title itself.
 */
export function netflixTitleFrom(
  documentTitle: string,
  dom: { title?: string; series?: string },
  main?: NetflixMainMedia | null,
): { title?: string; series?: string } {
  const official = officialTitleFrom(documentTitle);
  const agrees = (candidate: string | undefined): boolean => {
    const c = normTitle(candidate);
    if (!c || c.length < 2) return false;
    if (!official) return true; // nothing to contradict it
    const o = normTitle(official);
    return o.includes(c) || c.includes(o);
  };
  const fromMain = agrees(main?.title) ? main?.title : '';
  const fromDom = agrees(dom.title) ? dom.title : '';
  const title = fromMain || fromDom || official;
  const series = agrees(dom.series) ? dom.series : undefined;
  return series ? { title, series } : { title };
}

interface CachedNetflixMedia {
  /** Watch URL the title belongs to (`/watch/<id>` changes per episode). */
  url: string;
  title: string;
  series?: string;
  season?: number;
  episode?: number;
}

const mediaByVideo = new WeakMap<HTMLVideoElement, CachedNetflixMedia>();

/** Player metadata from the MAIN world, refreshed once per adapter mount. */
let mainMedia: NetflixMainMedia | null = null;
const mainMediaByVideo = new WeakMap<HTMLVideoElement, NetflixMainMedia>();

function findNetflixVideo(): HTMLVideoElement | null {
  // Prefer the in-watch container video; fall back to the first <video>.
  const watch = document.querySelector('.watch-video');
  return (
    watch?.querySelector<HTMLVideoElement>('video') ??
    document.querySelector<HTMLVideoElement>('video')
  );
}

function readNetflixMedia(): MediaInfo {
  const dom = getDomMediaInfo('netflix', {
    titleSelectors: [
      '[data-uia="video-title"] h4',
      '.video-title h4',
      '.ellipsize-text h4',
      '[data-uia="video-title"]',
    ],
    seriesSelectors: ['.video-title h4', '.ellipsize-text h4'],
    episodeSelectors: ['[data-uia="video-title"] span', '.video-title span'],
    titlePrefixes: ['Watch '],
    titleSuffixes: [' | Netflix', ' - Netflix'],
    genericTitles: ['Netflix'],
  });

  const video = findNetflixVideo();
  const guarded = netflixTitleFrom(
    typeof document === 'undefined' ? '' : document.title,
    { title: dom.title, series: dom.series },
    video ? mainMediaByVideo.get(video) : mainMedia,
  );
  const info: MediaInfo = {
    ...dom,
    ...(guarded.title ? { title: guarded.title } : {}),
    series: guarded.series,
  };
  if (!video) return info;

  // A different watch URL means a different episode/movie on the same
  // element — the previous title is no longer valid.
  const previous = mediaByVideo.get(video);
  const sameUrl = previous?.url === info.url;
  if (previous && !sameUrl) mediaByVideo.delete(video);
  const cached = sameUrl ? previous : undefined;

  if (info.title) {
    const merged: CachedNetflixMedia = {
      url: info.url,
      title: info.title,
      series: info.series ?? cached?.series,
      season: info.season ?? cached?.season,
      episode: info.episode ?? cached?.episode,
    };
    mediaByVideo.set(video, merged);
    return { ...info, series: merged.series, season: merged.season, episode: merged.episode };
  }

  if (!cached) return info;
  return {
    ...info,
    title: cached.title,
    series: cached.series,
    season: cached.season,
    episode: cached.episode,
  };
}

export function createNetflixAdapter(): SubtitleSource {
  // One shot per mount: the player's own title/id, used as the first choice
  // for `readNetflixMedia`. Failure is silent — document.title still answers.
  void mediaThroughMainWorld()
    .then((media) => {
      mainMedia = media;
      const video = findNetflixVideo();
      if (video) mainMediaByVideo.set(video, media);
    })
    .catch(() => {});
  return createInterceptedAdapter({
    platform: 'netflix',
    // Netflix doesn't expose the cue language in the URL; the shared factory
    // resolves the source track from the user's `translate.sourceLang` — the
    // panel override this file used to promise — instead of a hardcoded 'en'.
    hideNativeCss: HIDE_NATIVE_CSS,
    // Never `video.currentTime` on Netflix (error M7375): seeks go through the
    // player API in the MAIN world (F6 · docs/REDESIGN-V2.md §4.5).
    playback: 'netflix',
    getVideo: findNetflixVideo,
    getMediaInfo: readNetflixMedia,
  });
}
