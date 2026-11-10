/**
 * Prime Video adapter.
 *
 * Prime Video ships timed text as DFXP/TTML hosted on Cloudfront. The
 * MAIN-world interceptor catches those responses; this adapter handles the
 * video anchor + native subtitle hide.
 */
import { createInterceptedAdapter } from './intercepted-adapter';
import { getDomMediaInfo } from './media-info';
import type { SubtitleSource } from './types';

const HIDE_NATIVE_CSS = `
  .atvwebplayersdk-captions-text,
  .atvwebplayersdk-captions-overlay,
  [class*="captions"],
  [class*="caption"],
  video::cue,
  video::-webkit-media-text-track-display,
  video::-webkit-media-text-track-container { display: none !important; }
`;

export function createPrimeVideoAdapter(): SubtitleSource {
  return createInterceptedAdapter({
    platform: 'prime',
    language: 'en',
    hideNativeCss: HIDE_NATIVE_CSS,
    getVideo: () => {
      const player =
        document.querySelector('.webPlayerSDKContainer') ??
        document.querySelector('.atvwebplayersdk-player-container');
      return (
        player?.querySelector<HTMLVideoElement>('video') ??
        document.querySelector<HTMLVideoElement>('video')
      );
    },
    getMediaInfo: () => getDomMediaInfo('prime', {
      titleSelectors: [
        '.atvwebplayersdk-title-text',
        '[data-testid="title"]',
        '.webPlayerSDKContainer h1',
      ],
      seriesSelectors: ['.atvwebplayersdk-title-text', '[data-testid="series-title"]'],
      episodeSelectors: ['.atvwebplayersdk-subtitle-text', '[data-testid="subtitle"]'],
      titleSuffixes: [' | Prime Video', ' - Prime Video', ' | Amazon.com'],
    }),
  });
}
