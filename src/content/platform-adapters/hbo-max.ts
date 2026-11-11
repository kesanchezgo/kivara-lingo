/**
 * HBO Max / Max adapter.
 *
 * Max uses an HLS player that pulls external WebVTT segments. The
 * MAIN-world interceptor catches `.vtt` GETs; this adapter focuses on
 * anchoring the overlay over the player and hiding the native captions.
 */
import { createInterceptedAdapter } from './intercepted-adapter';
import { getDomMediaInfo } from './media-info';
import type { SubtitleSource } from './types';

/**
 * The boxes Max lays the PICTURE in — the only elements the column
 * reservation (`content/ui/columns-css.ts`) is allowed to shrink.
 *
 * `#root` is deliberately absent: it is Max's whole app shell (header, side
 * rails, modals), so writing `right` on it moves the entire page instead of
 * the player. `Fuse-Web-Play` is the styled-components wrapper that owns the
 * player layer, and `PlayerContainer` is the release-stable class fragment
 * both older and current Max builds expose. The live page is reverse-engineered
 * by this adapter, so the anchors live beside it and the CSS module imports
 * them instead of keeping a second, drifting copy.
 */
export const HBO_PLAYER_CONTAINER_SELECTORS: readonly string[] = [
  '[data-testid="player-container"]',
  '[class*="Fuse-Web-Play"]',
  '[class*="PlayerContainer"]',
];

/**
 * Max ships subtitles in two ways:
 *  1. As real HTML5 `::cue` tracks. Those are reliably hidden with the
 *     `video::cue` / `video::-webkit-media-text-track-*` rules below.
 *  2. As DOM-rendered overlays whose class names change per release. To stay
 *     resilient we match anything that *looks* like a subtitle/caption
 *     container — substring matches on common class fragments plus known
 *     `data-testid`s. Kivara's own UI is inside Shadow DOM, so these broad
 *     selectors can't accidentally hide it.
 */
const HIDE_NATIVE_CSS = `
  video::cue,
  video::-webkit-media-text-track-display,
  video::-webkit-media-text-track-container,
  video::-webkit-media-text-track-display-backdrop,
  [class*="SubtitleRenderer"],
  [class*="subtitleRenderer"],
  [class*="SubtitleOverlay"],
  [class*="subtitleOverlay"],
  [class*="subtitle-overlay"],
  [class*="CaptionsRenderer"],
  [class*="captionsRenderer"],
  [class*="CaptionContainer"],
  [class*="captionContainer"],
  [class*="caption-container"],
  [class*="captions-container"],
  [class*="CaptionsContainer"],
  [class*="captionsContainer"],
  [class*="CaptionWindow"],
  [class*="caption-window"],
  [class*="CaptionLine"],
  [class*="caption-line"],
  [class*="CaptionText"],
  [class*="caption-text"],
  [class*="captionText"],
  [data-testid="captions-container"],
  [data-testid*="caption" i],
  [data-testid*="subtitle" i],
  .bmpui-ui-subtitle-overlay,
  .bmpui-subtitle-overlay,
  .bmpui-ui-subtitle-label {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
  }
`;

export function createHboMaxAdapter(): SubtitleSource {
  return createInterceptedAdapter({
    platform: 'hbo',
    language: 'en',
    hideNativeCss: HIDE_NATIVE_CSS,
    getVideo: () => document.querySelector<HTMLVideoElement>('video'),
    getMediaInfo: () => getDomMediaInfo('hbo', {
      titleSelectors: [
        '[data-testid="player-ux-title"]',
        '[data-testid="video-title"]',
        '.player-title',
        'h1',
      ],
      seriesSelectors: ['[data-testid="player-ux-series-title"]', '.series-title'],
      episodeSelectors: ['[data-testid="player-ux-episode-title"]', '.episode-title'],
      titleSuffixes: [' | HBO Max', ' | Max'],
    }),
  });
}
