/** Floating panel position, reserved width of an open rail subtracted so the
 * popup never opens on top of the transcript (ported from the prototype). */
const POPUP_WIDTH = 440;
const POPUP_HEIGHT = 620;
const EDGE = 16;

export interface PanelPosition { top: number; left: number; width: number; height: number }

export function defaultPopupPosition(reserveRight = 0): PanelPosition {
  if (typeof window === 'undefined') {
    return { top: EDGE, left: EDGE, width: POPUP_WIDTH, height: POPUP_HEIGHT };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gap = reserveRight > 0 ? 16 : 32;
  const available = Math.max(0, vw - reserveRight - POPUP_WIDTH - gap);
  return {
    top: Math.max(EDGE, Math.round((vh - POPUP_HEIGHT) / 2)),
    left: Math.max(EDGE, Math.round(available)),
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
  };
}
