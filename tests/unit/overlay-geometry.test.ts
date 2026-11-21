/**
 * Where the corner icons hang (B6): the pure geometry that keeps Listen-first
 * and the mode toggle off the caption plate, off the sentence toolbar and off
 * the study bar.
 *
 * The bug this pins: at 640×360 the icons lived at `top-4 right-4` of the
 * caption band, and a two-line caption that reaches the right edge ran UNDER
 * them. `placeBadgeGroup` is the replacement — it is handed the same plate rect
 * and player rect StudyBar measures, so the two controls never pick sides
 * independently.
 */
import { describe, expect, it } from 'vitest';
import {
  intersects,
  oppositeSide,
  placeBadgeGroup,
  type OverlayBox,
} from '../../src/content/ui/overlay-geometry';

const player: OverlayBox = { x: 0, y: 0, width: 640, height: 360 };
const group = { width: 70, height: 32 };

function placed(caption: OverlayBox, bar: OverlayBox | null = null, host = player) {
  const captionRect = {
    ...caption,
    top: caption.y,
    left: caption.x,
    bottom: caption.y + caption.height,
    right: caption.x + caption.width,
  } as unknown as DOMRect;
  const hostRect = {
    ...host,
    top: host.y,
    left: host.x,
    bottom: host.y + host.height,
    right: host.x + host.width,
  } as unknown as DOMRect;
  return placeBadgeGroup(host, caption, group, oppositeSide(captionRect, hostRect), bar);
}

function box(placement: { x: number; y: number }): OverlayBox {
  return { x: placement.x, y: placement.y, width: group.width, height: group.height };
}

describe('placeBadgeGroup', () => {
  it('never follows the caption to its side', () => {
    const caption: OverlayBox = { x: 170, y: 300, width: 300, height: 40 };
    const placement = placed(caption);
    expect(placement.side).toBe('corner');
    expect(placement.y).toBeLessThanOrEqual(20);
  });

  it('never climbs over a two-line caption either', () => {
    const caption: OverlayBox = { x: 32, y: 244, width: 576, height: 124 };
    const bar: OverlayBox = { x: 320, y: 12, width: 300, height: 30 };
    const placement = placed(caption, bar);
    expect(placement.side).toBe('corner');
    expect(intersects(box(placement), caption)).toBe(false);
  });

  it('stays at the mock top-right corner even with a caption filling the frame', () => {
    const caption: OverlayBox = { x: 32, y: 8, width: 576, height: 60 };
    const bar: OverlayBox = { x: 320, y: 318, width: 300, height: 30 };
    const placement = placed(caption, bar);
    expect(placement.side).toBe('corner');
    expect(placement.y).toBeLessThanOrEqual(20);
    expect(placement.x).toBeGreaterThanOrEqual(player.width - group.width - 20);
  });

  it('does not roam to the bar or the caption side from cue to cue', () => {
    const caption: OverlayBox = { x: 32, y: 100, width: 576, height: 60 };
    const bar: OverlayBox = { x: 500, y: 12, width: 124, height: 120 };
    const placement = placed(caption, bar);
    expect(placement.side).toBe('corner');
    expect(placement.y).toBeLessThanOrEqual(20);
  });

  it('keeps the icons inside the player when nothing else fits', () => {
    // A caption that fills the frame: every side candidate fails, so the
    // fallback is the corner opposite the bar.
    const caption: OverlayBox = { x: 0, y: 0, width: 640, height: 360 };
    const behind: OverlayBox = { x: 300, y: 320, width: 330, height: 30 };
    const placement = placed(caption, behind);
    expect(placement.side).toBe('corner');
    expect(placement.x).toBeGreaterThanOrEqual(0);
    expect(placement.y).toBeGreaterThanOrEqual(0);
    expect(placement.x + group.width).toBeLessThanOrEqual(player.width);
    expect(placement.y + group.height).toBeLessThanOrEqual(player.height);
  });
});

describe('oppositeSide', () => {
  it('names the half the caption does not occupy', () => {
    const captionLow = { top: 300, height: 40 } as unknown as DOMRect;
    const captionHigh = { top: 20, height: 40 } as unknown as DOMRect;
    const host = { top: 0, height: 360 } as unknown as DOMRect;
    expect(oppositeSide(captionLow, host)).toBe('top');
    expect(oppositeSide(captionHigh, host)).toBe('bottom');
  });
});
