/**
 * The word card's position is decided ONCE at open, from the frame alone.
 *
 * The C2 regression (a 15-step human path from the word to the card): the
 * rebuilt card opened 42 px away from the word, right-aligned to it, at a
 * fixed 543 px height - and it CLOSED before the pointer arrived. The
 * geometry below pins the contract that fixes it: centred on the word
 * (clamped to the frame), a small word-card gap with a hover bridge that
 * spans it, and a total height capped at ~380 px with the body scrolling
 * inside. No content input - nothing that arrives later can move the card.
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
  gap: 8,
  cardCap: 380,
  ...over,
});

describe('computePopoverPlacement - decided once, from the frame alone', () => {
  it('picks the roomier side, caps the card at ~380 px and leaves a <= 8 px gap', () => {
    // Token near the bottom: 544 px of card room above, 104 below -> opens
    // upward, capped at 380.
    const p = computePopoverPlacement(frame());
    expect(p.side).toBe('top');
    expect(p.bodyMaxHeight).toBe(380 - 96);
    // Bottom-anchored card: the gap to the word is exactly the 8 px asked.
    expect(p.topOffset).toBe(560 - 8 - 380);
    expect(p.gapPx).toBe(8);
  });

  it('returns the same placement no matter how much content arrived', () => {
    const a = computePopoverPlacement(frame());
    const b = computePopoverPlacement(frame());
    expect(b).toEqual(a);
  });

  it('opens downward when the room below is the bigger one', () => {
    const p = computePopoverPlacement(frame({
      parent: { top: 60, bottom: 100, left: 400, width: 120, height: 40, offsetHeight: 40 },
    }));
    expect(p.side).toBe('bottom');
    expect(p.bodyMaxHeight).toBe(380 - 96);
    expect(p.topOffset).toBe(108);
    expect(p.gapPx).toBe(8);
  });

  it('never leaves the frame, even with a tight boundary', () => {
    const p = computePopoverPlacement(frame({
      boundary: { top: 0, bottom: 200, left: 0, right: 1280 },
      parent: { top: 100, bottom: 120, left: 400, width: 120, height: 20, offsetHeight: 20 },
      chrome: 40,
    }));
    expect(p.side).toBe('top');
    expect(p.topOffset).toBeGreaterThanOrEqual(0);
    expect(p.topOffset + 40 + p.bodyMaxHeight).toBeLessThanOrEqual(200 - 8);
  });

  it('centres the card on the word when the frame allows it', () => {
    const p = computePopoverPlacement(frame());
    // The token centre at 460; the card left edge = 460 - 170 = 290.
    expect(p.leftEdge).toBe(290);
  });

  it('clamps the card inside the frame when the word sits near an edge', () => {
    // Token at the right edge: centred would overflow -> pulled left, and
    // the hover bridge still reaches the word.
    const p = computePopoverPlacement(frame({
      parent: { top: 560, bottom: 600, left: 1100, width: 120, height: 40, offsetHeight: 40 },
    }));
    expect(p.leftEdge).toBe(1280 - 8 - 340);
    const tokenCenterLocal = 1100 + 60 - p.leftEdge;
    expect(p.bridgeLeft).toBeLessThanOrEqual(tokenCenterLocal - 24);
    expect(p.bridgeLeft + p.bridgeWidth).toBeGreaterThanOrEqual(tokenCenterLocal + 24);
    // Token at the left edge -> pushed right.
    const q = computePopoverPlacement(frame({
      parent: { top: 560, bottom: 600, left: 10, width: 120, height: 40, offsetHeight: 40 },
    }));
    expect(q.leftEdge).toBe(8);
  });

  it('works on a scaled plate: rooms are screen px, the reserved card is layout px', () => {
    const p = computePopoverPlacement(frame({ scale: 1.5 }));
    // Room above, screen px: 560 - 8 - 8x1.5 = 540 -> 360 layout px, capped.
    expect(p.bodyMaxHeight).toBe(360 - 96);
    // The gap stays 8 SCREEN px: top = 560 - 12 - 380x1.5 = 8.
    expect(p.topOffset).toBe(8);
    expect(p.gapPx).toBe(12);
  });

  it('measures the bridge across the word-card gap', () => {
    const p = computePopoverPlacement(frame());
    const tokenCenterLocal = 400 + 60 - p.leftEdge;
    expect(p.bridgeLeft).toBeLessThanOrEqual(tokenCenterLocal);
    expect(p.bridgeLeft + p.bridgeWidth).toBeGreaterThanOrEqual(tokenCenterLocal);
    expect(p.gapPx).toBeGreaterThan(0);
  });
});
