/**
 * Per-platform CSS for the "Limpieza visual" toggles in Settings:
 *  - `hideUI`     → hide chrome (controls, top bar, hover scrim).
 *  - `hideShadows` → hide the gradient overlays players draw on top/bottom of
 *                    the video to make their UI readable. These re-appear on
 *                    pointermove and are the "sombra cuando se pasa el mouse"
 *                    the user reports on HBO Max.
 *
 * Selectors are intentionally broad — players ship class-name suffix hashes
 * on every release, so we anchor on stable substrings and `data-testid`s.
 * Kivara's UI is inside Shadow DOM, so the broad selectors can't reach it.
 */
import type { SubtitleSource } from '../platform-adapters/types';

type Platform = SubtitleSource['platform'] | 'generic';

interface PlatformRules {
  hideUI: string[];
  hideShadows: string[];
}

// Common selectors to add ON TOP of the per-platform list when the user
// enables the toggle. Kept conservative because broad attribute selectors
// like `[class*="Gradient" i]` can match unintended elements on
// platforms (e.g. YouTube has gradient styles on thumbnails sidebar).
//
// Empty by default — every platform should opt-in to its own selectors
// rather than relying on these broad matches that have caused YouTube
// videos to render as black rectangles in the past.
const COMMON_HIDE_UI: string[] = [];

const COMMON_HIDE_SHADOWS: string[] = [];

const RULES: Record<Platform, PlatformRules> = {
  youtube: {
    hideUI: [
      '.ytp-chrome-top',
      '.ytp-chrome-bottom',
      '.ytp-gradient-top',
      '.ytp-gradient-bottom',
      '.ytp-pause-overlay',
      '.ytp-ce-element',
      '.ytp-iv-player-content',
      '.ytp-suggested-action',
    ],
    hideShadows: [
      '.ytp-gradient-top',
      '.ytp-gradient-bottom',
      '.ytp-shadow-content',
    ],
  },
  netflix: {
    hideUI: [
      '[data-uia="player-controls"]',
      '[data-uia="watch-video-bottom-controls"]',
      '.PlayerControlsNeo__bottom-controls',
      '.PlayerControlsNeo__top-controls',
      '.watch-video--bottom-controls-container',
    ],
    hideShadows: [
      '.watch-video--bottom-gradient',
      '.watch-video--top-gradient',
      '[class*="Gradient" i][class*="player" i]',
    ],
  },
  disney: {
    hideUI: [
      '.controls__container',
      '.controls__wrap',
      '.controls__bg-overlay',
      '.controls-bottom-wrap',
      '.controls-top-wrap',
    ],
    hideShadows: [
      '.controls__bg-overlay',
      '[class*="gradient" i][class*="controls" i]',
    ],
  },
  hbo: {
    // Max's player is a styled-components tree under `Fuse-Web-Play`. We
    // only target VISUAL chrome — control bars, headers, footers and the
    // autohider — never the root containers (`LayerContainer`,
    // `OverlayRootContainer`, `OverlayContainer-Fuse-Web-Play`). Hiding
    // those breaks the keyboard listeners HBO Max attaches at the player
    // root, which is why Space stopped pausing the video as soon as the
    // user toggled "Ocultar UI". Anchor strings here are stable across
    // releases.
    hideUI: [
      // Generic testid-style fallbacks (older Max builds expose these).
      '[data-testid="player-overlay"]',
      '[data-testid="player-controls"]',
      '[data-testid="controls-container"]',
      // Current Max/HBO chrome containers.
      '[class*="ControlsContainer"]',
      '[class*="ControlsHeader"]',
      '[class*="ControlsCenter"]',
      '[class*="ControlsCenterInfoContainer"]',
      '[class*="ControlsFooter"]',
      '[class*="ControlsFooterTop"]',
      '[class*="ControlsFooterBottom"]',
      // AutohiderContainer is the visual fade wrapper for the chrome —
      // hiding it is fine because the underlying root containers
      // (LayerContainer, OverlayRootContainer) keep the keyboard
      // listeners alive.
      '[class*="AutohiderContainer"]',
      '[class*="PlayerDrawer"]',
      '[class*="PlayerButton"]',
      '[class*="ScrubberContainer"]',
      '[class*="ScrubberInput"]',
      '[class*="ScrubberTime"]',
      '[class*="ScrubberTopInfo"]',
      '[class*="BottomTrinity"]',
      '[class*="CenterTrinity"]',
      '[class*="CastTrinity"]',
      '[class*="CastContainer"]',
      '[class*="DiscoveryTabsContainer"]',
      '[class*="ContentDiscoveryContainer"]',
      // Older variant names kept for safety.
      '[class*="PlayerControls"]',
      '[class*="player-controls"]',
      '[class*="ControlsOverlay"]',
      '[class*="controls-overlay"]',
      '[class*="ControlBar"]',
      '[class*="control-bar"]',
      '[class*="TopBar"][class*="player" i]',
    ],
    hideShadows: [
      // Targeted: only the named gradient containers. Broad `[class*="gradient"]`
      // matches accidentally on stable styled-components hashes — caused
      // black-screen reports on YouTube and unwanted hits on Max overlays.
      '[class*="TopGradient"]',
      '[class*="BottomGradient"]',
      '[class*="ControlsCenterGradient"]',
      '[class*="HoverOverlay"]',
      '[class*="hover-overlay"]',
    ],
  },
  prime: {
    hideUI: [
      '.atvwebplayersdk-overlays-container',
      '.atvwebplayersdk-bottompanel-container',
      '.atvwebplayersdk-toppanel-container',
      '.atvwebplayersdk-hideabletopbuttons-container',
    ],
    hideShadows: [
      '.atvwebplayersdk-gradient',
      '[class*="atvwebplayersdk"][class*="gradient" i]',
    ],
  },
  generic: { hideUI: [], hideShadows: [] },
};

interface BuildOpts {
  hideUI: boolean;
  hideShadows: boolean;
  platform?: SubtitleSource['platform'];
  /**
   * Point 4: TRUE while the pointer is idle over the video (the chrome hides),
   * FALSE on pointer activity (the chrome shows again). Defaults to true so
   * callers that don't track the pointer keep the previous always-hidden
   * behavior.
   */
  controlsIdle?: boolean;
}

export function buildCleanupCss({ hideUI, hideShadows, controlsIdle = true, platform }: BuildOpts): string {
  if (!hideUI && !hideShadows) return '';

  const rules = RULES[platform ?? 'generic'] ?? RULES.generic;
  const selectors: string[] = [];

  if (hideUI && controlsIdle) {
    selectors.push(...rules.hideUI, ...COMMON_HIDE_UI);
  }
  if (hideShadows) {
    selectors.push(...rules.hideShadows, ...COMMON_HIDE_SHADOWS);
  }
  if (selectors.length === 0) return '';

  // We use `visibility: hidden` + `opacity: 0` instead of `display: none`
  // on purpose: hiding the chrome should never tear down its DOM subtree,
  // because some players (notably HBO Max) attach keyboard listeners on
  // the controls or their parents. With `display: none` the listeners
  // never fire — Space stops pausing, F stops fullscreening, etc. With
  // `visibility: hidden` the elements still exist, still receive events
  // they were going to receive (we kill `pointer-events` separately so
  // the user can't click invisible chrome by accident), but they're
  // invisible and don't block the cursor.
  return `${Array.from(new Set(selectors)).join(',\n')} {
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
  }`;
}

/**
 * Injects (or removes) a cleanup `<style>` element keyed off `platform`. Idempotent.
 */
export function applyCleanupCss(opts: BuildOpts): void {
  const id = `kivara-cleanup-${opts.platform ?? 'generic'}`;
  const existing = document.getElementById(id) as HTMLStyleElement | null;
  const css = buildCleanupCss(opts);
  if (!css) {
    existing?.remove();
    return;
  }
  const style = existing ?? document.createElement('style');
  style.id = id;
  style.textContent = css;
  if (!existing) document.documentElement.appendChild(style);
}
