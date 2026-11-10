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
import type { SubtitleSource } from './types';

const HIDE_NATIVE_CSS = `
  .player-timedtext,
  .player-timedtext-text-container,
  .player-timedtext-text-container > *,
  [class^="watch-video--player-view"] .player-timedtext { display: none !important; }
`;

export function createNetflixAdapter(): SubtitleSource {
  return createInterceptedAdapter({
    platform: 'netflix',
    // Netflix doesn't expose the cue language in the URL — most casual users
    // pick English; the user can override in the panel.
    language: 'en',
    hideNativeCss: HIDE_NATIVE_CSS,
    getVideo: () => {
      // Prefer the in-watch container video; fall back to the first <video>.
      const watch = document.querySelector('.watch-video');
      return (
        watch?.querySelector<HTMLVideoElement>('video') ??
        document.querySelector<HTMLVideoElement>('video')
      );
    },
    getMediaInfo: () => getDomMediaInfo('netflix', {
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
    }),
  });
}
