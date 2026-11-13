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
interface CachedNetflixMedia {
  /** Watch URL the title belongs to (`/watch/<id>` changes per episode). */
  url: string;
  title: string;
  series?: string;
  season?: number;
  episode?: number;
}

const mediaByVideo = new WeakMap<HTMLVideoElement, CachedNetflixMedia>();

function findNetflixVideo(): HTMLVideoElement | null {
  // Prefer the in-watch container video; fall back to the first <video>.
  const watch = document.querySelector('.watch-video');
  return (
    watch?.querySelector<HTMLVideoElement>('video') ??
    document.querySelector<HTMLVideoElement>('video')
  );
}

function readNetflixMedia(): MediaInfo {
  const info = getDomMediaInfo('netflix', {
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
