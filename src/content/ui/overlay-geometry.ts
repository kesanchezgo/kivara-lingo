/**
 * The one place that knows where the caption plate is.
 *
 * Three consumers have to agree on it:
 *
 *   • `StudyBar` parks on the half of the player the caption does NOT occupy;
 *   • the corner icons (Listen-first / mode) hang off the plate's outer edge,
 *     clear of the bar and of the sentence toolbar that opens above it;
 *   • the E2E hit map publishes the bar, the icons and every token box.
 *
 * All three read the plate rect from the same marker (`[data-kivara-caption-box]`,
 * published by `SubtitleOverlay`) and the same host rect, and all three use
 * `oppositeSide` — so "the other side" means the same thing everywhere.
 *
 * Change notification: the plate can MOVE without resizing (a new cue, a
 * different `verticalOffset`), which no ResizeObserver can see. `SubtitleOverlay`
 * is the only component that knows when the cue changed, so it calls
 * `notifyCaptionGeometryChange()` from a layout effect; `StudyBar` and the E2E
 * publisher subscribe. Resizes are covered by ResizeObserver on the host and on
 * the plate itself.
 */

/** Marker `SubtitleOverlay` puts on the caption plate (the text box only). */
export const CAPTION_BOX_ATTR = 'data-kivara-caption-box';

/** Half of the player, as used by the bar and the icons. */
export type VerticalSide = 'top' | 'bottom';

export interface OverlayBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function toBox(rect: DOMRect): OverlayBox {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

export function intersects(a: OverlayBox, b: OverlayBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width
    && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function expand(box: OverlayBox, by: number): OverlayBox {
  return { x: box.x - by, y: box.y - by, width: box.width + by * 2, height: box.height + by * 2 };
}

const listeners = new Set<() => void>();

/**
 * Announce that the caption plate moved or changed content. Called by
 * `SubtitleOverlay` after every commit (it is the component that owns the
 * cue); every subscriber recomputes from live rects, so the order in which
 * subscribers run does not matter.
 */
export function notifyCaptionGeometryChange(): void {
  for (const listener of listeners) listener();
}

export function onCaptionGeometryChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The host element of the closed root the overlay lives in. */
export function hostOf(node: Node | null | undefined): HTMLElement | null {
  const root = node?.getRootNode();
  return root instanceof ShadowRoot && root.host instanceof HTMLElement ? root.host : null;
}

/** The tree that holds the overlay UI: the shadow root, or the document. */
export function scopeOf(node: Node | null | undefined): ParentNode {
  const root = node?.getRootNode();
  return root instanceof ShadowRoot ? root : document;
}

/** The caption plate's box, or null while no cue is painted. */
export function captionRect(scope: ParentNode): DOMRect | null {
  const plate = scope.querySelector<HTMLElement>(`[${CAPTION_BOX_ATTR}]`);
  const rect = plate?.getBoundingClientRect();
  return rect && rect.width > 0 && rect.height > 0 ? rect : null;
}

/** The StudyBar's box, if it is mounted in this tree. */
export function barRect(scope: ParentNode): DOMRect | null {
  const bar = scope.querySelector<HTMLElement>('[role="toolbar"]');
  const rect = bar?.getBoundingClientRect();
  return rect && rect.width > 0 && rect.height > 0 ? rect : null;
}

/**
 * The half of the player the caption does NOT occupy — where the bar goes.
 * `StudyBar` and the corner icons both call this, so they never pick opposite
 * ends for the same caption.
 */
export function oppositeSide(caption: DOMRect, host: DOMRect): VerticalSide {
  const center = caption.top + caption.height / 2 - host.top;
  return center > host.height / 2 ? 'top' : 'bottom';
}

/** Distance from the player's edge that the bar and the icons respect. */
const MARGIN = 16;
/** Air between the plate and the icons. */
const GAP = 12;
/**
 * The sentence toolbar opens 48 px above the plate (`-top-12`) and is about
 * 36 px tall, so a badge above the plate has to clear the toolbar before it
 * clears the plate itself.
 */
const TOOLBAR_CLEARANCE = 48 + 8;

export type BadgeSide = 'right' | 'left' | 'above' | 'below' | 'corner';

export interface BadgePlacement {
  /** Viewport coordinates of the group's top-left corner. */
  x: number;
  y: number;
  side: BadgeSide;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Where the corner icons hang: just outside the caption plate, never on it and
 * never on the bar.
 *
 * Order: the plate's right side, its left side, above it (clear of the
 * sentence toolbar) and finally below it. Each candidate is validated against
 * the player's frame and rejected if it touches the bar (the bar is measured
 * too — "opposite" is the intent, a real rect is the proof). A caption so tall
 * that nothing fits falls back to the player corner opposite the bar, which is
 * the one place both the bar and a normally-placed caption stay away from.
 */
export function placeBadgeGroup(
  host: OverlayBox,
  caption: OverlayBox | null,
  group: { width: number; height: number },
  barSide: VerticalSide,
  bar: OverlayBox | null,
): BadgePlacement {
  const frame = {
    left: host.x + MARGIN,
    top: host.y + MARGIN,
    right: host.x + host.width - MARGIN,
    bottom: host.y + host.height - MARGIN,
  };

  const corner: BadgePlacement = {
    x: frame.right - group.width,
    y: barSide === 'bottom' ? frame.top : frame.bottom - group.height,
    side: 'corner',
  };

  const accept = (candidate: BadgePlacement): boolean => {
    if (candidate.x < frame.left || candidate.x + group.width > frame.right) return false;
    if (candidate.y < frame.top || candidate.y + group.height > frame.bottom) return false;
    if (bar && intersects(
      { x: candidate.x, y: candidate.y, width: group.width, height: group.height },
      expand(bar, 4),
    )) return false;
    return true;
  };

  if (caption) {
    // Vertically centred on the plate, but never above its top edge: the
    // sentence toolbar lives 12 px over that edge.
    const top = clamp(
      caption.y + (caption.height - group.height) / 2,
      caption.y,
      frame.bottom - group.height,
    );
    const inlineX = clamp(
      caption.x + caption.width - group.width,
      frame.left,
      frame.right - group.width,
    );
    const candidates: BadgePlacement[] = [
      { x: caption.x + caption.width + GAP, y: top, side: 'right' },
      { x: caption.x - GAP - group.width, y: top, side: 'left' },
      { x: inlineX, y: caption.y - TOOLBAR_CLEARANCE - group.height, side: 'above' },
      { x: inlineX, y: caption.y + caption.height + GAP, side: 'below' },
    ];
    for (const candidate of candidates) {
      if (accept(candidate)) return candidate;
    }
  }

  return corner;
}
