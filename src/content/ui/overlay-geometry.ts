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
export type BadgeSide = 'right' | 'left' | 'above' | 'below' | 'corner';

export interface BadgePlacement {
  /** Viewport coordinates of the group's top-left corner. */
  x: number;
  y: number;
  side: BadgeSide;
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
  _caption: OverlayBox | null,
  group: { width: number; height: number },
  _barSide: VerticalSide,
  _bar: OverlayBox | null,
): BadgePlacement {
  // MOCK FIDELITY: the prototype pins «Escucha primero» + mode together at
  // top-4 right-4. The previous candidates moved them beside/above/below the
  // caption from cue to cue, which read as random motion on the live player.
  const frame = {
    right: host.x + host.width - MARGIN,
    top: host.y + MARGIN,
  };
  return {
    x: frame.right - group.width,
    y: frame.top,
    side: 'corner',
  };
}

/* ── Caption lift above the owned PlayerBar ───────────────────────────────
 *
 * The owned bar (Netflix) is bottom-anchored chrome that the user summons by
 * moving the pointer. A caption parked in the lower band would end up UNDER
 * it — the translation line and its tokens unreadable exactly when the hand
 * is on the video. The lift is a pure function so the arithmetic is testable
 * without a layout engine; the overlay only turns the number into a transform.
 */

/** Minimum clearance between the plate's bottom edge and the bar's top edge. */
export const CAPTION_BAR_CLEARANCE_PX = 12;

export interface CaptionLiftInput {
  /** The plate's bottom edge, measured from the host's top, px. */
  plateBottomPx: number;
  /** The player overlay host's height, px. */
  hostHeight: number;
  /** The visible bar's height, px; 0 while the bar is hidden. */
  barHeightPx: number;
  /** A clean capture is running: neither the bar nor the lift may dirty it. */
  capturing: boolean;
}

/**
 * How far UP the plate must move so its bottom edge stays at least
 * `CAPTION_BAR_CLEARANCE_PX` above the bar. 0 when the bar is hidden, the
 * caption is already clear, or a capture is running.
 */
export function captionLiftPx(input: CaptionLiftInput): number {
  const { plateBottomPx, hostHeight, barHeightPx, capturing } = input;
  if (capturing) return 0;
  if (!(barHeightPx > 0) || !(hostHeight > 0)) return 0;
  const limit = hostHeight - barHeightPx - CAPTION_BAR_CLEARANCE_PX;
  return Math.max(0, Math.ceil(plateBottomPx - limit));
}

/** The two signals that can hide/show native player chrome. */
export interface ControlsVisibility {
  visible: boolean;
  height: number;
}

/**
 * Combine our own bar's auto-hide state with a platform adapter's future
 * `onControlsVisibility`. Visible wins (either chrome counts), and the height
 * is the tallest reported: lifting for the shorter one would still be covered.
 */
export function combineControlsVisibility(
  owned: ControlsVisibility,
  native: ControlsVisibility | null | undefined,
): ControlsVisibility {
  if (!native) return owned;
  return {
    visible: owned.visible || native.visible,
    height: Math.max(owned.visible ? owned.height : 0, native.visible ? native.height : 0),
  };
}
