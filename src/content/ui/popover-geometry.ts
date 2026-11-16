/**
 * The word card's position, decided ONCE at open from the frame alone.
 *
 * C2's real cause: the card hung from its bottom edge and GREW with the
 * progressive enrichment (height 320 → 570 → 542 → 571), so the header — and
 * the pronunciation button — jumped up to 250 px and a trusted click fell
 * outside the button.
 *
 * This calculation has NO content input: the side is chosen from the room on
 * each side of the token, the body reserves the max that side can hold from
 * the first paint, and the card's top edge is clamped so it never leaves the
 * forced boundary. Content that arrives later can only scroll INSIDE the card.
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
  /** Cap on the reserved scrollable body, layout px. */
  maxBody: number;
}

interface PopoverPlacement {
  side: 'top' | 'bottom';
  /** Horizontal shift so the card stays inside the boundary, layout px. */
  marginLeft: number;
  /**
   * Reserved scrollable-body height, layout px. Constant for the card's whole
   * life: the body scrolls inside it, the header never moves.
   */
  bodyMaxHeight: number;
  /** The card's top edge from the boundary's top, screen px — never negative. */
  topOffset: number;
}

export function computePopoverPlacement(frame: PopoverFrame): PopoverPlacement {
  const { parent, boundary, cardWidth, chrome, scale, pad, gap, maxBody } = frame;

  // Room for the BODY on each side, SCREEN px, chrome excluded: the card hangs
  // gap×scale away from the token and must keep pad inside the frame.
  const roomAbove = parent.top - boundary.top - pad - gap * scale - chrome * scale;
  const roomBelow = boundary.bottom - parent.bottom - pad - gap * scale - chrome * scale;
  // The side is a function of the frame only — content can never flip it.
  const side: 'top' | 'bottom' = roomAbove >= roomBelow ? 'top' : 'bottom';
  const room = side === 'top' ? roomAbove : roomBelow;

  // THE reservation: the max this side can hold, from the first paint.
  let bodyMax = Math.max(0, Math.min(maxBody, room / scale));

  let topOffset = side === 'top'
    ? parent.top - boundary.top - gap * scale - (chrome + bodyMax) * scale
    : parent.bottom - boundary.top + gap * scale;

  // Pathologically small frame: give the body back the deficit (floor 0)
  // before letting the card leave the frame.
  if (side === 'top' && topOffset < 0) {
    bodyMax = Math.max(0, bodyMax + topOffset / scale);
    topOffset = parent.top - boundary.top - gap * scale - (chrome + bodyMax) * scale;
  }
  if (side === 'bottom') {
    const cardBottom = topOffset + (chrome + bodyMax) * scale;
    const limit = boundary.bottom - boundary.top - pad;
    if (cardBottom > limit) {
      bodyMax = Math.max(0, bodyMax - (cardBottom - limit) / scale);
    }
  }

  // Horizontal clamp, screen px; the layout shift is dx / scale.
  const centerX = parent.left + parent.width / 2;
  const halfW = (cardWidth / 2) * scale;
  let dx = 0;
  if (centerX + halfW > boundary.right - pad) dx = boundary.right - pad - (centerX + halfW);
  else if (centerX - halfW < boundary.left + pad) dx = boundary.left + pad - (centerX - halfW);

  return { side, marginLeft: dx / scale, bodyMaxHeight: bodyMax, topOffset };
}
