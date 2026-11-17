/**
 * The word card's position, decided ONCE at open from the frame alone.
 *
 * The C2 regression (measured with a 15-step human mouse path from the word
 * to the card): the card opened 42 px away from the word, right-aligned to
 * it, at a fixed 543 px height — and it CLOSED before the pointer arrived,
 * because nothing between the word and the card counted as "inside".
 *
 * This calculation has NO content input: the side is chosen from the room on
 * each side of the token, the card's height is min(available, ~380 px) with
 * the body scrolling inside, the card is CENTRED on the word (clamped to the
 * frame), and the word↔card gap the hover bridge must span is measured here
 * so the close timer treats the whole hand path as "inside".
 */

export interface PopoverFrame {
  /** The token's rect, screen px (getBoundingClientRect). */
  parent: { top: number; bottom: number; left: number; width: number; height: number; offsetHeight: number };
  /** The forced boundary rect, screen px (`[data-popover-boundary]`). */
  boundary: { top: number; bottom: number; left: number; right: number };
  /** Card width, layout px (offsetWidth — the card is mid-entry when measured). */
  cardWidth: number;
  /** Card height minus the scrollable body, measured once at open. */
  chrome: number;
  /** The subtitle plate's ancestor scale (rects are screen units). */
  scale: number;
  /** Inside padding from the boundary edges, screen px. */
  pad: number;
  /** Token↔card gap, LAYOUT px (the CSS margin lives on the scaled plate). */
  gap: number;
  /** Cap on the card's TOTAL height, layout px (~380). */
  cardCap: number;
}

interface PopoverPlacement {
  side: 'top' | 'bottom';
  /** The card's left edge, boundary-local px — centred on the word, clamped. */
  leftEdge: number;
  /**
   * Reserved scrollable-body height, layout px. Constant while the card
   * fills: the body scrolls inside it, the header never moves.
   */
  bodyMaxHeight: number;
  /** The card's top edge from the boundary's top, screen px — never negative. */
  topOffset: number;
  /** The word↔card gap the hover bridge must span, screen px. */
  gapPx: number;
  /** Hover-bridge geometry, relative to the card's own box (layout px). */
  bridgeLeft: number;
  bridgeWidth: number;
}

export function computePopoverPlacement(frame: PopoverFrame): PopoverPlacement {
  const { parent, boundary, cardWidth, chrome, scale, pad, gap, cardCap } = frame;
  const bWidth = boundary.right - boundary.left;
  const gapScreen = gap * scale;

  // Room for the WHOLE card on each side, screen px (chrome included): the
  // card hangs gap×scale away from the token and must keep pad inside the
  // frame.
  const roomAbove = parent.top - boundary.top - pad - gapScreen;
  const roomBelow = boundary.bottom - parent.bottom - pad - gapScreen;
  // The side is a function of the frame only — content can never flip it.
  const side: 'top' | 'bottom' = roomAbove >= roomBelow ? 'top' : 'bottom';
  const room = side === 'top' ? roomAbove : roomBelow;

  // THE reservation: the card is as tall as the side allows, capped at
  // ~380 px, from the first paint. The body scrolls inside whatever is left
  // after the chrome.
  let cardHeight = Math.max(chrome, Math.min(cardCap, room / scale));

  let topOffset = side === 'top'
    ? parent.top - boundary.top - gapScreen - cardHeight * scale
    : parent.bottom - boundary.top + gapScreen;

  // Pathologically small frame: shrink the card (floor at the chrome) before
  // letting it leave the frame.
  if (side === 'top' && topOffset < 0) {
    cardHeight = Math.min(cardHeight, Math.max(chrome, (parent.top - boundary.top - gapScreen) / scale));
    topOffset = Math.max(0, parent.top - boundary.top - gapScreen - cardHeight * scale);
  }
  if (side === 'bottom' && topOffset + cardHeight * scale > boundary.bottom - boundary.top - pad) {
    cardHeight = Math.min(cardHeight, Math.max(chrome, (boundary.bottom - boundary.top - pad - topOffset) / scale));
  }

  // Centred on the word; clamped so the card stays inside the frame.
  const centerX = parent.left - boundary.left + parent.width / 2;
  const leftEdge = Math.max(pad, Math.min(bWidth - pad - cardWidth, centerX - cardWidth / 2));

  // The hover bridge spans the word↔card gap, covering the straight path a
  // hand travels. It must reach the word even when the clamp shifted the
  // card: from the card's near edge across to the word's centre (± 24 px).
  const tokenCenterLocal = parent.left - boundary.left + parent.width / 2 - leftEdge;
  const bridgeLeft = Math.min(0, tokenCenterLocal - 40);
  const bridgeWidth = Math.max(cardWidth, tokenCenterLocal + 40) - bridgeLeft;

  // The bridge spans exactly the current word↔card gap (screen px).
  const cardTopScreen = boundary.top + topOffset;
  const gapPx = side === 'top'
    ? Math.max(0, parent.top - (cardTopScreen + cardHeight * scale))
    : Math.max(0, cardTopScreen - parent.bottom);

  return { side, leftEdge, bodyMaxHeight: Math.max(0, cardHeight - chrome), topOffset, gapPx, bridgeLeft, bridgeWidth };
}
