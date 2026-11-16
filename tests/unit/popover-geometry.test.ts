/**
 * The word card's position is decided ONCE at open, from the FRAME alone.
 *
 * C2's real cause: the card grew with the enrichment (height 320 → 571) while
 * it hung from its bottom edge, so the header — and the pronunciation button —
 * jumped up to 250 px and the trusted click fell outside the button. The
 * geometry is now a pure function of the frame: it reserves the max height
 * available on the chosen side from the first paint, and the content can only
 * scroll INSIDE the card. There is no content input, so nothing that arrives
 * later can move it.
 */
import { describe, expect, it } from 'vitest';
import { computePopoverPlacement, type PopoverFrame } from '../../src/content/ui/popover-geometry';

const BOUNDARY = { top: 0, bottom: 720, left: 0, right: 1280 };

const frame = (over: Partial<PopoverFrame> = {}): PopoverFrame => ({
  parent: { top: 560, bottom: 600, left: 400, width: 120, height: 40, offsetHeight: 40 },
  boundary: BOUNDARY,
  cardWidth: 340,
  chrome: 96,
  scale: 1,
  pad: 8,
  gap: 12,
  maxBody: 420,
  ...over,
});

describe('computePopoverPlacement — decided once, from the frame alone', () => {
  it('picks the roomier side and reserves ALL of it (content-free)', () => {
    // Token near the bottom: 444 px of body room above, 504 below? No —
    // above = 560−8−12−96 = 444, below = 720−600−8−12−96 = 4 … the roomier
    // side is above → opens upward.
    const p = computePopoverPlacement(frame());
    expect(p.side).toBe('top');
    // The reserved body is capped by maxBody; the room above is 444.
    expect(p.bodyMaxHeight).toBe(420);
    // Bottom-anchored card: with the cap, the top edge sits 32 px inside.
    expect(p.topOffset).toBeCloseTo(32, 5);
  });

  it('returns the same placement no matter how much content arrived', () => {
    // The function has no content input: calling it again for the SAME frame
    // (what a resize would do) yields the same numbers, and the reserved
    // height does not depend on the body's scrollHeight at all.
    const a = computePopoverPlacement(frame());
    const b = computePopoverPlacement(frame());
    expect(b).toEqual(a);
    expect(b.bodyMaxHeight).toBe(a.bodyMaxHeight);
  });

  it('opens downward when the room below is the bigger one', () => {
    const p = computePopoverPlacement(frame({
      parent: { top: 60, bottom: 100, left: 400, width: 120, height: 40, offsetHeight: 40 },
    }));
    expect(p.side).toBe('bottom');
    expect(p.bodyMaxHeight).toBe(420);
    expect(p.topOffset).toBeCloseTo(112, 5);
  });

  it('never leaves the frame, even with a tight boundary', () => {
    // Both sides small: the card shrinks its reserved body to fit.
    const p = computePopoverPlacement(frame({
      boundary: { top: 0, bottom: 200, left: 0, right: 1280 },
      parent: { top: 100, bottom: 120, left: 400, width: 120, height: 20, offsetHeight: 20 },
      chrome: 40,
    }));
    expect(p.side).toBe('top');
    expect(p.topOffset).toBeGreaterThanOrEqual(0);
    expect(p.topOffset + 40 + p.bodyMaxHeight).toBeLessThanOrEqual(200 - 8);
  });

  it('caps the reserved body at maxBody even with room to spare', () => {
    const p = computePopoverPlacement(frame({ maxBody: 60 }));
    // Room above is 444 px; the cap keeps the body at 60.
    expect(p.bodyMaxHeight).toBe(60);
    expect(p.topOffset).toBeCloseTo(560 - 12 - 96 - 60, 5);
    expect(p.topOffset).toBeGreaterThan(0);
  });

  it('shifts horizontally to stay inside the boundary', () => {
    // Token at the right edge: the card would overflow → pulled left.
    const p = computePopoverPlacement(frame({
      parent: { top: 300, bottom: 340, left: 1100, width: 120, height: 40, offsetHeight: 40 },
    }));
    expect(p.marginLeft).toBeLessThan(0);
    // Token at the left edge → pushed right.
    const q = computePopoverPlacement(frame({
      parent: { top: 300, bottom: 340, left: 10, width: 120, height: 40, offsetHeight: 40 },
    }));
    expect(q.marginLeft).toBeGreaterThan(0);
  });

  it('works on a scaled plate: rooms are screen px, the reserved body is layout px', () => {
    const scale = 1.5;
    const p = computePopoverPlacement(frame({ scale }));
    // Room above, screen px: 560 − 8 − 12×1.5 − 96×1.5 = 390 → body 260.
    expect(p.bodyMaxHeight).toBeCloseTo(260, 5);
    // With the reservation the top edge sits exactly pad inside the frame.
    expect(p.topOffset).toBeCloseTo(8, 5);
  });
});

