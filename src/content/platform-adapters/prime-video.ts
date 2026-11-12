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

/**
 * Hide ONLY the caption text box, never player chrome.
 *
 * Prime's own "subtitle" classes (`.atvwebplayersdk-subtitle-text`,
 * `[data-testid="subtitle"]`) name the EPISODE subtitle shown under the
 * title, and the SDK's subtitle/caption settings menus carry "caption"
 * in their class names too — a `[class*="caption"]`-style wildcard
 * swallowed all of them. Every rule below is an exact hook for the box
 * that renders caption text; `.atvwebplayersdk-captions-overlay` wraps
 * only that text (the `<video>` and the controls are siblings in the
 * player container, never inside it).
 */
const HIDE_NATIVE_CSS = `
  .atvwebplayersdk-captions-text,
  .atvwebplayersdk-captions-overlay,
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
