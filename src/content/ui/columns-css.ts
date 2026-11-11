/**
 * Right-side reservation per platform (F6 · docs/REDESIGN-V2.md §3 H11,
 * decision D1).
 *
 * Netflix and Max paint their player as a fixed layer over the whole viewport:
 * a transcript column drawn on top would hide the picture. The prototype's
 * answer — and v2's — is to SHRINK the player by the width of the columns.
 * This module is the ONE place that computes that width: `App.tsx` sizes the
 * two column wrappers from `ColumnLayout` and `applyColumnsCss` writes the same
 * number into the injected stylesheet, so the picture and the columns can
 * never disagree about how much room was handed over.
 *
 * Both columns can be on screen at once (#38): the transcript rail and the
 * docked panel are neighbours, and the player gives up the width of BOTH plus
 * the gap between them. The floating (popup) panel is not a column — it never
 * reserves anything and can be dragged anywhere.
 *
 * ── Width math and the cap ─────────────────────────────────────────────────
 *
 *   required = (rail open ? RAIL_WIDTH_PX : 0)
 *            + (panel docked ? PANEL_WIDTH_PX : 0)
 *            + (both ? COLUMN_GAP_PX : 0)
 *   cap      = floor(viewport * MAX_RESERVED_FRACTION)      // 40 %
 *
 * When `required` fits under the cap the columns get their preferred widths.
 * When it does not, both shrink proportionally, but never below their
 * minimums (280 / 360 px — below that the line list and the panel tabs stop
 * being usable). Below the combined minimum, or with no measurable viewport,
 * the layout degrades to OVERLAY: nothing is reserved and the columns paint
 * over the player, exactly like the sites whose player cannot be resized.
 *
 * With these numbers the breakpoints are:
 *
 *   - rail alone             → 400 px reserved, needs viewport ≥ 700 px
 *   - panel alone            → 440 px reserved, needs viewport ≥ 900 px
 *   - rail + panel           → 840 px reserved, needs viewport ≥ 1715 px
 *                              (their combined minimum is 640 px, i.e. 1600 px
 *                              of viewport; the proportional rule lands the
 *                              practical threshold at 1715 px)
 *
 * Between those thresholds the reservation is scaled (e.g. 1920 px with both
 * columns open reserves 767 px: rail 365, panel 402). Narrower than the
 * threshold the columns float over the video. Fullscreen reuses the same
 * numbers: `fullscreen-overlay-core.ts` moves the overlay hosts inside the
 * fullscreen element, and the `:fullscreen` rule below caps the video there.
 */
import type { SubtitleSource } from '../platform-adapters/types';
import { HBO_PLAYER_CONTAINER_SELECTORS } from '../platform-adapters/hbo-max';

type Platform = SubtitleSource['platform'];

/** Preferred width of the transcript column. */
export const RAIL_WIDTH_PX = 400;
/** Below this the rail's line list is no longer readable. */
export const RAIL_MIN_WIDTH_PX = 280;
/** Preferred width of the docked side panel (matches its floating width). */
export const PANEL_WIDTH_PX = 440;
/** Below this the panel's tab bar stops fitting. */
export const PANEL_MIN_WIDTH_PX = 360;
/** Separator between the two columns; they butt together, the borders split them. */
export const COLUMN_GAP_PX = 0;
/** Hard ceiling for everything reserved on the right, as a viewport fraction. */
export const MAX_RESERVED_FRACTION = 0.4;

/**
 * Which columns the user currently has open. `panel` means a DOCKED panel: a
 * floating one is not a column, so it never reserves width.
 */
export interface ColumnVisibility {
  rail: boolean;
  panel: boolean;
}

export interface ColumnsUiState {
  enabled: boolean;
  railOpen: boolean;
  panelOpen: boolean;
  isPopupMode: boolean;
}

/**
 * The rail + panel visibility rule (#38), in one testable place.
 *
 * The two are independent: a docked panel is a second column BESIDE the
 * transcript, not a replacement for it. Before #38 the rail was forced hidden
 * whenever the panel was docked, which is the bug this function exists to
 * prevent from coming back.
 */
export function computeColumnVisibility({
  enabled,
  railOpen,
  panelOpen,
  isPopupMode,
}: ColumnsUiState): ColumnVisibility {
  if (!enabled) return { rail: false, panel: false };
  return { rail: railOpen, panel: panelOpen && !isPopupMode };
}

export interface ColumnLayout extends ColumnVisibility {
  /** Width the rail wrapper renders at (0 when closed). */
  railWidth: number;
  /** Width the panel wrapper renders at (0 when closed or floating). */
  panelWidth: number;
  /** Space between the two columns (0 when only one is open). */
  gap: number;
  /** Width the player must give up. 0 in overlay mode. */
  reserved: number;
  /** What the columns asked for before the cap was applied. */
  required: number;
  /** 40 % of the viewport — the ceiling `reserved` can never exceed. */
  cap: number;
  /** True when the columns float over the player instead of shrinking it. */
  overlay: boolean;
}

function emptyLayout(state: ColumnVisibility, cap: number): ColumnLayout {
  return {
    rail: state.rail,
    panel: state.panel,
    railWidth: 0,
    panelWidth: 0,
    gap: 0,
    reserved: 0,
    required: 0,
    cap,
    overlay: false,
  };
}

function preferredLayout(state: ColumnVisibility, required: number, gap: number, cap: number): ColumnLayout {
  return {
    rail: state.rail,
    panel: state.panel,
    railWidth: state.rail ? RAIL_WIDTH_PX : 0,
    panelWidth: state.panel ? PANEL_WIDTH_PX : 0,
    gap,
    reserved: required,
    required,
    cap,
    overlay: false,
  };
}

/**
 * The columns keep their preferred widths but reserve NOTHING: they paint over
 * the player. `reserved` is 0 on purpose — it is the number both consumers
 * read, so no stylesheet and no inline offset may claim space.
 */
function overlayLayout(state: ColumnVisibility, required: number, gap: number, cap: number): ColumnLayout {
  return { ...preferredLayout(state, required, gap, cap), reserved: 0, overlay: true };
}

/**
 * Pure: given the open columns and a viewport width, everything the two
 * consumers (the App's inline styles and the injected CSS) need.
 */
export function computeColumnLayout(state: ColumnVisibility, viewportWidth: number): ColumnLayout {
  const width = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 0;
  const cap = Math.floor(width * MAX_RESERVED_FRACTION);
  const gap = state.rail && state.panel ? COLUMN_GAP_PX : 0;
  const required =
    (state.rail ? RAIL_WIDTH_PX : 0) + (state.panel ? PANEL_WIDTH_PX : 0) + gap;

  if (required === 0) return emptyLayout(state, cap);
  // No measurable viewport (SSR, a hidden tab): reserving blind would be a
  // guess, so the columns overlay instead and the video is never clipped.
  if (width === 0) return overlayLayout(state, required, gap, cap);
  if (required <= cap) return preferredLayout(state, required, gap, cap);

  // Over the cap: scale both columns proportionally, but respect the minimums.
  const factor = cap / required;
  const railWidth = state.rail
    ? Math.max(RAIL_MIN_WIDTH_PX, Math.floor(RAIL_WIDTH_PX * factor))
    : 0;
  const panelWidth = state.panel
    ? Math.max(PANEL_MIN_WIDTH_PX, Math.floor(PANEL_WIDTH_PX * factor))
    : 0;
  const scaled = railWidth + panelWidth + gap;
  if (scaled > cap) {
    // Even the minimums do not fit: overlay at the preferred widths.
    return overlayLayout(state, required, gap, cap);
  }
  return {
    rail: state.rail,
    panel: state.panel,
    railWidth,
    panelWidth,
    gap,
    reserved: scaled,
    required,
    cap,
    overlay: false,
  };
}

interface ColumnsRules {
  /** Windowed: the player root that must give up `reserved` on the right. */
  shrink: readonly string[];
  /** Roots positioned with `width` instead of `right`. */
  resize: readonly string[];
}

const RULES: Record<Platform, ColumnsRules> = {
  youtube: {
    // The watch page lays the player inside a flex column; `width` is what
    // actually moves the right edge. `right` would do nothing on a static box.
    shrink: [],
    resize: ['.html5-video-player', '#movie_player'],
  },
  netflix: {
    shrink: ['.watch-video', '.watch-video--player-view', '[data-uia="watch-video"]'],
    resize: [],
  },
  hbo: {
    // Never `#root` (the whole app shell). The player container comes from the
    // adapter that reverse-engineered Max's DOM, so both stay in sync.
    shrink: HBO_PLAYER_CONTAINER_SELECTORS,
    resize: [],
  },
  disney: {
    shrink: ['.btm-media-player', '.btm-media-overlays'],
    resize: [],
  },
  prime: {
    shrink: ['.webPlayerSDKContainer', '.atvwebplayersdk-player-container'],
    resize: [],
  },
  generic: { shrink: [], resize: [] },
};

export interface ColumnsCssOptions {
  platform?: Platform;
  /** Which columns are open — pass `computeColumnVisibility(...)`. */
  state: ColumnVisibility;
  /** Viewport width the cap is measured against; defaults to `window.innerWidth`. */
  viewportWidth?: number;
}

function resolveViewportWidth(explicit?: number): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit;
  return typeof window === 'undefined' ? 0 : window.innerWidth;
}

export function buildColumnsCss(options: ColumnsCssOptions): string {
  const platform = options.platform ?? 'generic';
  const layout = computeColumnLayout(options.state, resolveViewportWidth(options.viewportWidth));
  if (layout.reserved <= 0) return '';
  const rules = RULES[platform] ?? RULES.generic;
  const width = layout.reserved;
  const blocks: string[] = [];

  if (rules.shrink.length > 0) {
    blocks.push(`${Array.from(new Set(rules.shrink)).join(',\n')} {
      right: ${width}px !important;
    }`);
  }
  if (rules.resize.length > 0) {
    // `calc(100% - width)` keeps the player's own aspect handling; only the
    // right edge moves, so the native controls stay where the site drew them.
    blocks.push(`${Array.from(new Set(rules.resize)).join(',\n')} {
      width: calc(100% - ${width}px) !important;
      max-width: calc(100vw - ${width}px) !important;
    }`);
  }
  if (blocks.length === 0) return '';
  // Fullscreen: the overlay hosts live inside the fullscreen element, so the
  // video gives up the same strip instead of being covered.
  blocks.push(`:fullscreen video {
    max-width: calc(100% - ${width}px) !important;
  }`);
  return blocks.join('\n\n');
}

/**
 * Platforms whose player sizes the video INLINE and does not observe a
 * stylesheet change on its own. YouTube caches the measured width, so a rule
 * that moves the right edge leaves the `<video>` at its old size — cropped,
 * not shrunk — until the player re-measures. A synthetic `resize` is the
 * site's own re-measure path.
 */
const NEEDS_RESIZE_EVENT: ReadonlySet<Platform> = new Set<Platform>(['youtube']);

function notifyPlayerResize(platform: Platform): void {
  if (!NEEDS_RESIZE_EVENT.has(platform)) return;
  if (typeof window === 'undefined') return;
  // Dispatched AFTER the <style> is in (or out of) the document: a listener
  // that reads `offsetWidth` in its handler forces layout with the new rule,
  // so no animation frame is needed. App's own resize handler runs here too
  // and re-reads `innerWidth`, which has not changed — React bails out, so
  // there is no apply → dispatch → apply loop.
  window.dispatchEvent(new Event('resize'));
}

/** Inject (or remove) the reservation style. Idempotent per platform. */
export function applyColumnsCss(options: ColumnsCssOptions): void {
  const platform = options.platform ?? 'generic';
  const id = `kivara-columns-${platform}`;
  const existing = document.getElementById(id) as HTMLStyleElement | null;
  const css = buildColumnsCss(options);
  if (!css) {
    const removed = existing !== null;
    existing?.remove();
    document.documentElement.removeAttribute('data-kvl-columns');
    // The player was shrunk and is back to its own layout: same nudge, so
    // YouTube re-measures instead of keeping the narrow box.
    if (removed) notifyPlayerResize(platform);
    return;
  }
  const style = existing ?? document.createElement('style');
  style.id = id;
  style.textContent = css;
  if (!existing) document.documentElement.appendChild(style);
  document.documentElement.setAttribute('data-kvl-columns', '1');
  notifyPlayerResize(platform);
}
