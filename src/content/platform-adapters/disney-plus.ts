/**
 * Disney+ adapter.
 *
 * Disney+ uses Shaka player and serves WebVTT subtitle segments referenced
 * from a DASH/HLS manifest. The MAIN-world interceptor catches the `.vtt`
 * GETs; this file just owns the video anchor and the native-track hide.
 */
import { createInterceptedAdapter } from './intercepted-adapter';
import { getDomMediaInfo } from './media-info';
import type { SubtitleSource } from './types';

const HIDE_NATIVE_CSS = `
  .dss-subtitle-renderer-wrapper,
  .dss-subtitle-renderer-wrapper *,
  video::cue,
  video::-webkit-media-text-track-display,
  video::-webkit-media-text-track-container,
  .btm-media-overlays { display: none !important; }
`;

export function createDisneyPlusAdapter(): SubtitleSource {
  return createInterceptedAdapter({
    platform: 'disney',
    language: 'en',
    hideNativeCss: HIDE_NATIVE_CSS,
    getVideo: () => {
      const playerWrap = document.querySelector('.btm-media-player') ?? document.querySelector('.btm-media-overlays');
      return (
        playerWrap?.querySelector<HTMLVideoElement>('video') ??
        document.querySelector<HTMLVideoElement>('video')
      );
    },
    getMediaInfo: () => getDomMediaInfo('disney', {
      titleSelectors: [
        '[data-testid="title-field"]',
        '.title-field',
        '.btm-media-player .title',
      ],
      seriesSelectors: ['[data-testid="series-title"]', '.series-title'],
      episodeSelectors: ['[data-testid="subtitle-field"]', '.subtitle-field'],
      titleSuffixes: [' | Disney+', ' - Disney+'],
    }),
  });
}
