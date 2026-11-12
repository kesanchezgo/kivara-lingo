import { getShadowRoot } from '../shadow-host';
import { CAPTION_BOX_ATTR, onCaptionGeometryChange } from './overlay-geometry';

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
 * host page can click) into an attribute on the shadow host. The Playwright
 * suite reads that attribute and clicks the coordinates with the mouse: a real
 * gesture on the real button.
 *
 * Ship safety: `App` mounts this inside `if (__E2E__)` (and the badge markers in
 * `SubtitleOverlay` are written under the same constant), and the production
 * build compiles that branch out — rollup then drops the module and
 * `dist-artifacts.test.ts` forbids the attribute names in `dist/`.
 */
export const E2E_HITMAP_ATTR = 'data-kivara-e2e-hits';

/**
 * Second channel: the BAR's own box, the corner icons' boxes and every subtitle
 * token's box, in viewport coordinates. The e2e suite asserts the bar and the
 * icons never cover a token by comparing rectangles — it cannot call
 * `elementFromPoint` on a token, because a closed root answers with the host
 * for anything inside it.
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
  /** Visible text inside the control ('' when it renders icon-only). */
  text: string;
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
export function collectHits(container: ParentNode): E2EHit[] {
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
      text: el.textContent?.trim() ?? '',
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      ...(pressed === null ? {} : { pressed }),
    });
  }
  return hits;
}

function boxOf(el: Element | null): E2EBox | null {
  const rect = el?.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) return null;
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

/**
 * Mount the map for BOTH hosts (video overlay and panel).
 *
 * The two hosts mount at different times (the video overlay appears with the
 * player, the panel with the first pointer move), so host discovery is a
 * `MutationObserver` on the document — the DOM already fires the event the old
 * 200 ms watcher was polling for.
 *
 * Returns the cleanup that stops every observer and removes the attributes.
 */
export function publishAllRoots(): () => void {
  const cleanups: Array<() => void> = [];
  const started = new Set<string>();
  const HOST_IDS = ['kivara-lingo-video-host', 'kivara-lingo-host'];
  const attach = () => {
    for (const id of HOST_IDS) {
      if (started.has(id)) continue;
      const host = document.getElementById(id);
      if (host) {
        started.add(id);
        cleanups.push(publishHost(host));
      }
    }
  };
  const watcher = new MutationObserver(attach);
  watcher.observe(document.documentElement, { childList: true, subtree: true });
  attach();
  return () => {
    watcher.disconnect();
    cleanups.forEach((fn) => fn());
  };
}

/**
 * One host's writer.
 *
 * Nothing here polls. The three things that move a box are three events:
 *
 *   • the player resizes          → ResizeObserver on the host;
 *   • the plate resizes           → ResizeObserver on the plate;
 *   • a cue swaps / text changes  → `SubtitleOverlay`'s geometry notification
 *                                   (the plate can MOVE without resizing) plus
 *                                   a MutationObserver on the root for token
 *                                   text and `aria-pressed` flips, which are
 *                                   attribute/character writes, not geometry.
 *
 * Writes are coalesced into one microtask so a cue that mutates twenty token
 * nodes publishes once.
 */
function publishHost(host: HTMLElement): () => void {
  const root = getShadowRoot(host);
  if (!root) return () => {};

  let queued = false;
  const write = () => {
    try {
      host.setAttribute(E2E_HITMAP_ATTR, JSON.stringify(collectHits(root)));
      const bar = boxOf(root.querySelector('[role="toolbar"]'));
      const badges = [...root.querySelectorAll<HTMLElement>('[data-kivara-badge]')]
        .map((el) => boxOf(el))
        .filter((box): box is E2EBox => box !== null);
      const tokens = [...root.querySelectorAll<HTMLElement>('[data-tok-idx]')].map((el) => {
        const r = el.getBoundingClientRect();
        // The text rides along so the suite can assert WHAT the line says
        // (the translated caption) without reading a closed root.
        return { x: r.x, y: r.y, width: r.width, height: r.height, text: el.textContent?.trim() ?? '' };
      });
      host.setAttribute(E2E_BOXES_ATTR, JSON.stringify({ bar, badges, tokens }));
    } catch {
      /* a detached root: nothing to publish */
    }
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      write();
    });
  };

  write();

  const resize = typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver(schedule);
  if (resize) resize.observe(host);
  const observePlate = () => {
    if (!resize) return;
    const plate = root.querySelector<HTMLElement>(`[${CAPTION_BOX_ATTR}]`);
    if (plate) resize.observe(plate);
  };
  observePlate();

  const offGeometry = onCaptionGeometryChange(() => {
    observePlate();
    schedule();
  });

  const mutations = new MutationObserver(schedule);
  mutations.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['aria-pressed', 'aria-checked', 'aria-label', 'data-tok-idx'],
  });

  return () => {
    offGeometry();
    resize?.disconnect();
    mutations.disconnect();
    host.removeAttribute(E2E_HITMAP_ATTR);
    host.removeAttribute(E2E_BOXES_ATTR);
  };
}
