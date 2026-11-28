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

const NL = String.fromCharCode(10);

/**
 * Rule separator for a selector LIST. A CSS selector list needs a COMMA
 * between its selectors: joined with a newline alone, `A\nB\nC { … }` is ONE
 * descendant selector ("C inside B inside A") that matches nothing at all —
 * the whole cleanup sheet was inert on every platform until this was fixed.
 */
const SEP = ',' + NL;

/**
 * Native player surfaces that live INSIDE the chrome we hide, or in portals
 * anchored to it. ONE canonical list: the cleanup sheet exempts them and the
 * owned bar uses the same list to decide when to yield the pointer.
 *
 * `[role="menu"]` / `[role="dialog"]` are deliberately NOT here — they match
 * unrelated page nodes. The runtime check scopes those two to the player root.
 */
export const NATIVE_POPUP_SELECTORS: readonly string[] = [
  '[data-uia="selector-audio-subtitle"]',
  '[data-uia="selector-audio"]',
  '[data-uia="selector-subtitle"]',
  '[data-uia="episodes-selector"]',
  '[data-uia="episode-selector"]',
  '[data-uia="player-episodes"]',
  '[data-uia="player-menu"]',
];

/** Generic menu/dialog containers, only meaningful INSIDE the player. */
const SCOPED_POPUP_SELECTORS: readonly string[] = ['[role="menu"]', '[role="dialog"]'];

/**
 * The native popups BOTH Netflix sheets must keep usable — ONE list.
 *
 * `#kivara-owned-bar-netflix` (`App.tsx:552`) and `#kivara-cleanup-netflix`
 * (`App.tsx:614`) target the same row, and the cleanup sheet mounts LAST, so
 * it wins every `!important` tie. A shorter or differently scoped list there
 * silently re-hides a popup the owned bar had just exempted.
 *
 * The generic role containers are SCOPED to the player subtree: a bare
 * `[role="menu"]` would also match unrelated menus elsewhere on the page.
 * The runtime check (`nativePopupOpen`) scopes the same two to the player root.
 */
export const NETFLIX_POPUP_CSS_SELECTORS: readonly string[] = [
  ...NATIVE_POPUP_SELECTORS,
  '.watch-video [role="menu"]',
  '.watch-video [role="dialog"]',
  '[data-uia="watch-video"] [role="menu"]',
  '[data-uia="watch-video"] [role="dialog"]',
];

/**
 * Is a native popup open? The scoped selectors are matched under `scope`
 * (the player root) so a page-level dialog never makes the bar yield.
 */
export function nativePopupOpen(scope: ParentNode | null = document): boolean {
  const root = scope ?? document;
  return NATIVE_POPUP_SELECTORS.some((selector) => !!document.querySelector(selector))
    || SCOPED_POPUP_SELECTORS.some((selector) => !!root.querySelector(selector));
}

/**
 * Wake the site's detached control row without touching our stylesheet.
 *
 * Netflix removes its buttons after a few idle seconds; synthetic activity
 * makes it remount them. The previous implementation removed
 * `#kivara-owned-bar-*` for 400 ms so the native row could be clicked — that
 * showed BOTH bars on top of each other. Our row is `visibility: hidden`, so
 * the native node is clickable either way.
 */
export function wakeNativeRow(root: HTMLElement | null, video: HTMLVideoElement | null): void {
  const target = root ?? video;
  if (!target) return;
  const init: MouseEventInit = { bubbles: true, clientX: 320, clientY: 200 };
  try {
    target.dispatchEvent(new MouseEvent('pointermove', init));
    target.dispatchEvent(new MouseEvent('mousemove', init));
  } catch {
    /* a detached node: the caller's click is still attempted */
  }
}

export function buildCleanupCss({ hideUI, hideShadows, controlsIdle = true, platform }: BuildOpts): string {
  if (!hideUI && !hideShadows) return '';

  const rules = RULES[platform ?? 'generic'] ?? RULES.generic;

  // The two toggles are two RULES with different declarations, so their
  // selector lists are built SEPARATELY, from the list each selector comes
  // from. The previous version merged them and re-sorted the result by a guess
  // about the selector's NAME (`/gradient/i`), which left every real shadow
  // whose name has no "gradient" in it — `.ytp-shadow-content`,
  // `.controls__bg-overlay`, `[class*="HoverOverlay"]` — without `opacity: 0`.
  const uiSelectors = Array.from(new Set(
    hideUI && controlsIdle ? [...rules.hideUI, ...COMMON_HIDE_UI] : [],
  ));
  // A selector the chrome rule already hides does not need a second rule: the
  // chrome's `visibility` wins, and `opacity: 0` there would make an
  // interactive descendant impossible to restore.
  const shadowSelectors = Array.from(new Set(
    hideShadows ? [...rules.hideShadows, ...COMMON_HIDE_SHADOWS] : [],
  )).filter((selector) => !uiSelectors.includes(selector));

  // We use `visibility: hidden` instead of `display: none` on purpose:
  // hiding the chrome should never tear down its DOM subtree, because some
  // players (notably HBO Max) attach keyboard listeners on the controls or
  // their parents. With `display: none` the listeners never fire — Space
  // stops pausing, F stops fullscreening, etc.
  //
  // `opacity: 0` is NOT used on chrome: an ancestor at zero opacity makes
  // every descendant invisible no matter what the descendant declares, so a
  // native CC / episodes menu opened while the chrome is idle disappeared.
  // `visibility` is overridable, which is what the popup exemptions do.
  // Shadows keep their fade: they have no interactive descendants and the
  // fade is the effect the setting exists for.
  const blocks: string[] = [];
  if (uiSelectors.length > 0) {
    blocks.push(`${uiSelectors.join(SEP)} {
    visibility: hidden !important;
    pointer-events: none !important;
  }`);
  }
  if (shadowSelectors.length > 0) {
    blocks.push(`${shadowSelectors.join(SEP)} {
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
  }`);
  }
  if (platform === 'netflix' && uiSelectors.length > 0) {
    // The chrome is hidden but its native popups must stay usable.
    blocks.push(`${NETFLIX_POPUP_CSS_SELECTORS.join(SEP)} {
    visibility: visible !important;
    opacity: 1 !important;
    pointer-events: auto !important;
  }`);
  }
  return blocks.join(NL + NL);
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

/**
 * EVERY bit of Netflix's own player chrome the owned bar replaces.
 *
 * The owner's live test still saw the ← back arrow, the ⚑ flag, the red
 * timeline, the pause screen and the contextual skip buttons: three legacy
 * selectors could not cover a player that ships several generations of
 * class names at once. Exported so the unit suite can prove, selector by
 * selector, that CSS actually applies (see pr171-owned-chrome).
 *
 * Hidden with `visibility: hidden` + `pointer-events: none` and NEVER
 * `opacity: 0`: these nodes have interactive descendants (the native CC and
 * episodes menus), and an ancestor at zero opacity cannot be undone — the
 * popup exemption list depends on being overridable. The gradients are in
 * THIS list for the same reason: `visibility` already makes them invisible.
 */
export const NETFLIX_OWNED_HIDE_SELECTORS: readonly string[] = [
  // Bottom chrome and the red timeline.
  '.watch-video--bottom-controls-container',
  '[data-uia="controls-standard"]',
  '[data-uia="watch-video-bottom-controls"]',
  '[data-uia="player-controls"]',
  '.PlayerControlsNeo__bottom-controls',
  '[data-uia="timeline-bar"]',
  '[data-uia="timeline"]',
  // Top chrome: the back arrow and the flag.
  '.watch-video--back-container',
  '.watch-video--flag-container',
  '.PlayerControlsNeo__top-controls',
  '[data-uia="control-nav-back"]',
  '[data-uia="control-flag-button"]',
  // The pause screen and the contextual buttons we re-render ourselves.
  '.watch-video--evidence-overlay-container',
  '[data-uia="evidence-overlay"]',
  '[data-uia="pause-overlay"]',
  '[data-uia="player-skip-intro"]',
  '[data-uia="player-skip-recap"]',
  '[data-uia="player-skip-preplay"]',
  '[data-uia="next-episode-seamless-button"]',
  '[data-uia="next-episode-seamless-button-draining"]',
  // Native gradients.
  '.watch-video--bottom-gradient',
  '.watch-video--top-gradient',
  '[class*="watch-video--"][class*="gradient" i]',
];

/**
 * Which native containers the owned bar hides, per platform. Always-on: our
 * bar replaces this chrome for the whole session, so it does not wait for
 * the pointer to go idle the way the cleanup sheet does.
 */
const OWNED_BAR_SELECTORS: Partial<Record<Platform, string[]>> = {
  netflix: [...NETFLIX_OWNED_HIDE_SELECTORS],
};

/**
 * Native Netflix surfaces that live INSIDE the row we hide, or in portals
 * anchored to it. Hiding the row must not hide them: the user clicks our CC /
 * Episodes buttons and Netflix opens these. `visibility: hidden` is
 * inheritable, so every popup needs an explicit `visible`; `pointer-events`
 * and `opacity` need the same treatment or the menu renders but cannot be
 * clicked.
 *
 * The list itself is `NETFLIX_POPUP_CSS_SELECTORS`: the cleanup sheet hides
 * the same row and mounts AFTER this one, so both sheets must carry the exact
 * same exemptions.
 */
export function applyOwnedBarCss(enabled: boolean, platform?: Platform): void {
  const id = `kivara-owned-bar-${platform ?? 'generic'}`;
  const existing = document.getElementById(id) as HTMLStyleElement | null;
  const selectors = OWNED_BAR_SELECTORS[platform ?? 'generic'] ?? [];
  if (!enabled || selectors.length === 0) {
    existing?.remove();
    return;
  }
  const style = existing ?? document.createElement('style');
  style.id = id;
  style.textContent = `${selectors.join(SEP)} {
  visibility: hidden !important;
  pointer-events: none !important;
}

${NETFLIX_POPUP_CSS_SELECTORS.join(SEP)} {
  visibility: visible !important;
  opacity: 1 !important;
  pointer-events: auto !important;
}`;
  if (!existing) document.documentElement.appendChild(style);
}
