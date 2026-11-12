/**
 * E2E hit-map for controls inside a CLOSED shadow root (test-only).
 *
 * The panel and the video overlay attach `mode: 'closed'` roots, so Playwright
 * locators cannot reach their buttons, and an E2E handle stored on `window`
 * would not help either: a content script runs in an ISOLATED world, so its
 * globals are not the page's `window`. DOM ATTRIBUTES are the one thing both
 * worlds share.
 *
 * This module writes each control's CENTER (viewport coordinates, where the
 * host page can click) into an attribute on the shadow host, refreshed while
 * the bar is visible. The Playwright suite reads that attribute and clicks the
 * coordinates with the mouse: a real gesture on the real button.
 *
 * Ship safety: only `StudyBar` calls this, inside `if (__E2E__)`, and the
 * production build compiles that branch out — rollup then drops the module and
 * `dist-artifacts.test.ts` forbids the attribute name in `dist/`.
 */
export const E2E_HITMAP_ATTR = 'data-kivara-e2e-hits';

/**
 * Second channel: the BAR's own box and every subtitle token's box, in
 * viewport coordinates. The e2e suite asserts the bar never covers a token by
 * comparing rectangles — it cannot call `elementFromPoint` on a token, because
 * a closed root answers with the host for anything inside it.
 */
export const E2E_BOXES_ATTR = 'data-kivara-e2e-boxes';

export interface E2EBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface E2EHit {
  /** Accessible name of the control. */
  label: string;
  /** Viewport coordinates of its center. */
  x: number;
  y: number;
  /** aria-pressed / aria-checked, when the control carries one. */
  pressed?: string;
}

/**
 * Snapshot every `[aria-label]` (plus role=radio) inside `container`, in
 * viewport coordinates. A hidden container (opacity transition) still reports
 * rects; the caller decides whether the bar is worth publishing.
 */
export function collectHits(container: HTMLElement): E2EHit[] {
  const hits: E2EHit[] = [];
  const nodes = container.querySelectorAll<HTMLElement>('[aria-label], [role="radio"]');
  for (const el of nodes) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const pressed = el.getAttribute('aria-pressed') ?? el.getAttribute('aria-checked');
    const label = el.getAttribute('aria-label')
      ?? el.textContent?.trim()
      ?? '';
    if (!label) continue;
    hits.push({
      label,
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      ...(pressed === null ? {} : { pressed }),
    });
  }
  return hits;
}

/**
 * Publish the hit map onto the element's shadow host. Called from the bar's
 * own effect; returns the cleanup that removes the attribute.
 */
export function publishHits(container: HTMLElement): () => void {
  const root = container.getRootNode();
  const host = root instanceof ShadowRoot ? root.host : null;
  if (!(host instanceof HTMLElement)) return () => {};
  const write = () => {
    try {
      host.setAttribute(E2E_HITMAP_ATTR, JSON.stringify(collectHits(container)));
      const root = container.getRootNode();
      const scope = root instanceof ShadowRoot ? root : document;
      const bar = container.getBoundingClientRect();
      const tokens = [...scope.querySelectorAll<HTMLElement>('[data-tok-idx]')].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      host.setAttribute(E2E_BOXES_ATTR, JSON.stringify({
        bar: { x: bar.x, y: bar.y, width: bar.width, height: bar.height },
        tokens,
      }));
    } catch {
      /* serialization of a detached node: nothing to publish */
    }
  };
  write();
  const id = window.setInterval(write, 400);
  return () => {
    window.clearInterval(id);
    host.removeAttribute(E2E_HITMAP_ATTR);
    host.removeAttribute(E2E_BOXES_ATTR);
  };
}
