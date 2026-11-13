/**
 * Point 5 — the StudyBar's SAFE ZONE per platform.
 *
 * The bar already parks on the half of the player the caption does not occupy
 * (`oppositeSide`). What it never knew about is the platform's OWN chrome: the
 * top bar and bottom controls (Netflix), the icon cluster top-right (Prime),
 * «Saltar intro» / «Siguiente episodio», YouTube's control row. This module
 * adds, per platform:
 *
 *  - STATIC margins the bar keeps from the player frame;
 *  - a list of native-control selectors whose LIVE rects the bar avoids —
 *    if the bar's default slot intersects one, it shifts vertically within
 *    the same half, and only then flips to the other half.
 *
 * The caption guarantee (B3/B6) stays: the caption plate rect is also avoided,
 * so the bar can never land on the words it is supposed to be reading.
 *
 * All geometry is pure here: `StudyBar` feeds live rects (host, plate, native
 * controls via `document.querySelectorAll`) and gets offsets RELATIVE TO THE
 * HOST, ready for `style={{ top }} / style={{ bottom }}`.
 */
import type { SubtitleSource } from '../platform-adapters/types';
import { intersects, type OverlayBox } from './overlay-geometry';

type Platform = SubtitleSource['platform'];

export interface SafeZone {
  /** Static margins the bar keeps from the player frame (px). */
  margins: { top: number; bottom: number; right: number };
  /**
   * Native chrome the bar must not touch, queried on the DOCUMENT (these are
   * the platform's own elements, outside our shadow roots). Best effort: the
   * dynamic avoidance works with whatever the selectors find today.
   */
  controls: readonly string[];
}

const STUDY_BAR_SAFE_ZONES: Record<Platform, SafeZone> = {
  youtube: {
    margins: { top: 8, bottom: 64, right: 12 },
    controls: ['.ytp-chrome-bottom', '.ytp-chrome-top', '.ytp-pause-overlay', '.ytp-gradient-bottom'],
  },
  netflix: {
    // Top bar + the bottom control row; «Saltar intro» / «Siguiente episodio»
    // float mid-frame (their selectors below, best effort per build).
    margins: { top: 72, bottom: 110, right: 24 },
    controls: [
      '[data-uia="player-controls"]',
      '.PlayerControlsNeo__bottom-controls',
      '.PlayerControlsNeo__top-controls',
      '[data-uia="skip-intro"]',
      '[data-uia="next-episode"]',
    ],
  },
  disney: {
    margins: { top: 8, bottom: 72, right: 12 },
    controls: ['.controls__container', '.controls__wrap', '.controls-bottom-wrap', '.controls-top-wrap'],
  },
  hbo: {
    margins: { top: 8, bottom: 64, right: 12 },
    controls: ['[class*="ControlsContainer"]', '[class*="ControlsFooter"]', '[class*="AutohiderContainer"]'],
  },
  prime: {
    // Prime's icon cluster hangs top-RIGHT — the bar's corner is exactly
    // there, hence the wide right margin.
    margins: { top: 8, bottom: 64, right: 140 },
    controls: ['.atvwebplayersdk-overlays-container'],
  },
  generic: {
    margins: { top: 12, bottom: 12, right: 12 },
    controls: [],
  },
};

export function safeZoneFor(platform: Platform | undefined): SafeZone {
  return STUDY_BAR_SAFE_ZONES[platform ?? 'generic'] ?? STUDY_BAR_SAFE_ZONES.generic;
}

export interface BarPlacement {
  side: 'top' | 'bottom';
  /** Offset from the host's top edge, or null when the bar parks at the bottom. */
  top: number | null;
  /** Offset from the host's bottom edge, or null when the bar parks at the top. */
  bottom: number | null;
}

const STEP = 8;
const HALF_LIMIT = 0.5;

/** Lift a DOM-style rect into the OverlayBox the geometry helpers use. */
function box(x: number, y: number, w: number, h: number): OverlayBox {
  return { x, y, width: w, height: h };
}

function overlaps(box1: OverlayBox, box2: OverlayBox): boolean {
  return intersects(box1, box2) || intersects(box2, box1);
}

/**
 * Where the bar goes: the caption's opposite half first (the caption plate is
 * a hard no-go), then clear of every native control rect — shifting vertically
 * within the half before giving up and flipping halves. Falls back to the
 * plain margins when a frame is so crowded that nothing fits.
 */
export function placeStudyBar(o: {
  host: OverlayBox;
  caption: OverlayBox | null;
  bar: { width: number; height: number };
  zone: SafeZone;
  controls: readonly OverlayBox[];
}): BarPlacement {
  const { host, bar, zone, controls } = o;
  const caption = o.caption;

  // Same rule as `oppositeSide`, on plain boxes.
  let side: 'top' | 'bottom' = 'bottom';
  if (caption) {
    const center = caption.y + caption.height / 2 - host.y;
    side = center > host.height / 2 ? 'top' : 'bottom';
  }

  const x = host.x + host.width - zone.margins.right - bar.width;
  const midY = host.y + host.height * HALF_LIMIT;

  const trySide = (s: 'top' | 'bottom'): BarPlacement | null => {
    const margin = s === 'top' ? zone.margins.top : zone.margins.bottom;
    const startTop = s === 'top' ? host.y + margin : host.y + host.height - margin - bar.height;
    const dir = s === 'top' ? 1 : -1;
    let top = startTop;
    for (let step = 0; step < 60; step += 1) {
      const rect = box(x, top, bar.width, bar.height);
      const clearControls = controls.every((c) => !overlaps(rect, c));
      const clearCaption = !caption || !overlaps(rect, caption);
      if (clearControls && clearCaption) {
        const bottom = host.y + host.height - top - bar.height;
        return { side: s, top: Math.round(top - host.y), bottom: Math.round(bottom - host.y) };
      }
      top += dir * STEP;
      // Stay on this half: the caption lives on the other one.
      if (s === 'top' && top + bar.height > midY) return null;
      if (s === 'bottom' && top < midY) return null;
    }
    return null;
  };

  const first = trySide(side);
  if (first) return first;
  const other: 'top' | 'bottom' = side === 'top' ? 'bottom' : 'top';
  const alt = trySide(other);
  if (alt) return alt;

  // Crowded frame: the previous behavior (plain margins) is the last resort.
  return side === 'top'
    ? { side, top: zone.margins.top, bottom: null }
    : { side, top: null, bottom: zone.margins.bottom };
}
