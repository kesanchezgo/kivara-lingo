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
const E2E_HITMAP_ATTR = 'data-kivara-e2e-hits';

/**
 * Second channel: the BAR's own box, the corner icons' boxes and every subtitle
 * token's box, in viewport coordinates. The e2e suite asserts the bar and the
 * icons never cover a token by comparing rectangles — it cannot call
 * `elementFromPoint` on a token, because a closed root answers with the host
 * for anything inside it.
 */
const E2E_BOXES_ATTR = 'data-kivara-e2e-boxes';

/**
 * Third channel: the parts of the UI that are READ, not clicked.
 *
 * The rail's transcript rows, the translated line under each row and the
 * overlay's translated caption carry no accessible name, so the hit map above
 * cannot see them, and Playwright cannot read a closed root. This attribute
 * publishes them as data — presence, text and whether the blur filter is on —
 * so the suite can assert what the user sees without poking at internals.
 */
const E2E_STATE_ATTR = 'data-kivara-e2e-state';

export interface E2EBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One transcript row, as the rail rendered it. */
export interface E2ERow extends E2EBox {
  /** Cue index (`data-kvl-cue`). */
  index: number;
  /** The source line's text. */
  text: string;
  /** The platform's translated line under it, or '' when none is rendered. */
  native: string;
  /** The translated line is blurred (translation mode `blur`, or listen-first). */
  nativeFiltered: boolean;
}

/** The overlay's translated caption under the source line. */
export interface E2ETranslation {
  text: string;
  /** The caption is blurred right now (`translation: 'blur'`, listen-first). */
  filtered: boolean;
}

export interface E2EState {
  /** Lines of the open transcript, in rail order. */
  rows: E2ERow[];
  /** Overlay's translated caption, or null while none is rendered. */
  translation: E2ETranslation | null;
  /** Every `[aria-live]` region's text (search count, status announcements). */
  live: string[];
  /** Text of the VISIBLE tab panels only (the rail and the open panel tab). */
  text: string;
}

export interface E2EHit {
  /** Accessible name of the control (aria-label, else title, else its text). */
  label: string;
  /** Visible text inside the control ('' when it renders icon-only). */
  text: string;
  /** Viewport coordinates of its center. */
  x: number;
  y: number;
  /** aria-pressed / aria-checked, when the control carries one. */
  pressed?: string;
}

/** Longest text payload published; the panel can hold a lot of copy. */
const TEXT_CAP = 20_000;

/**
 * Snapshot every `[aria-label]`, `[role="radio"]` and `button` inside
 * `container`, in viewport coordinates. A hidden container (opacity
 * transition) still reports rects; the caller decides whether the bar is worth
 * publishing.
 *
 * Buttons without an aria-label are included (the word card's «Guardar» and
 * the selection toolbar's save action are text-only): the name falls back to
 * `title` and then to the visible text, so every control the suite clicks is
 * reachable by the same name a user would read.
 */
function collectHits(container: ParentNode): E2EHit[] {
  const hits: E2EHit[] = [];
  const nodes = container.querySelectorAll<HTMLElement>(
    '[aria-label], [role="radio"], button',
  );
  for (const el of nodes) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const pressed = el.getAttribute('aria-pressed') ?? el.getAttribute('aria-checked');
    const label = el.getAttribute('aria-label')
      ?? el.getAttribute('title')?.split('\n')[0]
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

/** `true` when `el` carries a CSS filter (the translation blur). */
function isFiltered(el: Element): boolean {
  try {
    const filter = window.getComputedStyle(el).filter;
    return filter !== '' && filter !== 'none';
  } catch {
    return false;
  }
}

/**
 * The read-only surface of one root: rail rows (source + translated line),
 * the overlay's translated caption and every live region.
 */
function collectState(root: ParentNode): E2EState {
  const rows: E2ERow[] = [];
  for (const row of root.querySelectorAll<HTMLElement>('[data-kvl-cue]')) {
    const raw = row.getAttribute('data-kvl-cue');
    const index = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    if (!Number.isFinite(index)) continue;
    // The clickable row body carries the source text; the translated line is
    // a SIBLING of it, exactly the structure `alignNativeLines` feeds. The
    // body also holds the timestamp chip — the LINE is its paragraph.
    const body = row.querySelector<HTMLElement>('[role="button"]') ?? row;
    const source = body.querySelector<HTMLElement>('p') ?? body;
    const rect = body.getBoundingClientRect();
    const fallback = row.getBoundingClientRect();
    const native = row.querySelector<HTMLElement>('[data-kvl-native]');
    rows.push({
      index,
      text: source.textContent?.trim() ?? '',
      native: native?.textContent?.trim() ?? '',
      nativeFiltered: native ? isFiltered(native) : false,
      x: rect.width > 0 ? rect.x : fallback.x,
      y: rect.height > 0 ? rect.y : fallback.y,
      width: rect.width > 0 ? rect.width : fallback.width,
      height: rect.height > 0 ? rect.height : fallback.height,
    });
  }

  // The overlay caption plate: the token span is the first child, the
  // translated line (when rendered) is the second. A caption with no
  // translation has no second element — that absence is the `hidden` state.
  const plate = root.querySelector<HTMLElement>('[data-kivara-caption-box]');
  const translationEl = plate?.querySelector<HTMLElement>(':scope > div');
  const translationText = translationEl?.textContent?.trim() ?? '';
  const translation: E2ETranslation | null = translationEl && translationText
    ? { text: translationText, filtered: isFiltered(translationEl) }
    : null;

  const live = [...root.querySelectorAll<HTMLElement>('[aria-live]')]
    .map((el) => el.textContent?.trim() ?? '')
    .filter(Boolean);

  // Visible tab panels only: the rail's lines body and the panel tab the user
  // is looking at. Inactive panel tabs stay mounted (`hidden`), so their copy
  // must not be mistaken for what is on screen.
  const text = [...root.querySelectorAll<HTMLElement>('[role="tabpanel"]:not([hidden])')]
    .map((el) => el.textContent?.trim() ?? '')
    .filter(Boolean)
    .join('\n')
    .slice(0, TEXT_CAP);

  return { rows, translation, live, text };
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
        // (the translated caption) without reading a closed root; `data-ws`
        // is the word mark, which is how a status change becomes observable.
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          text: el.textContent?.trim() ?? '',
          status: el.getAttribute('data-ws') ?? '',
        };
      });
      // The native-language line (the dual caption) rides along: the specs
      // assert the translated text, which lives in the same closed root as
      // the tokens.
      const dual = root.querySelector<HTMLElement>('[data-kivara-dual]')
        ?.textContent?.trim() ?? '';
      host.setAttribute(E2E_BOXES_ATTR, JSON.stringify({ bar, badges, tokens, dual }));
      host.setAttribute(E2E_STATE_ATTR, JSON.stringify(collectState(root)));
      watchToasts();
    } catch {
      /* a detached root: nothing to publish */
    }
  };

  /**
   * A toast enters with a CSS transition: it MOVES for 400 ms without a
   * mutation and without a resize, so no observer sees the settled position
   * and a click would use the coordinates from the first frame. While one is
   * on screen, publish on a short tick — the same honesty the rects demand,
   * bounded to the animation's lifetime.
   */
  let toastTimer: number | null = null;
  const watchToasts = () => {
    const present = root.querySelector('[data-sonner-toast]') !== null;
    if (present && toastTimer === null) {
      toastTimer = window.setInterval(schedule, 100);
    } else if (!present && toastTimer !== null) {
      window.clearInterval(toastTimer);
      toastTimer = null;
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
    attributeFilter: [
      'aria-pressed', 'aria-checked', 'aria-label', 'data-tok-idx',
      // Word status (the "know the rest" marks) and the mobile blur filter
      // are attribute writes; the panel tab the user just opened flips
      // `hidden`. `style` covers the StudyBar choosing its side and the word
      // card clamping itself: both MOVE without resizing, and a click must
      // never use the coordinates from before that move.
      'data-ws', 'data-kvl-native', 'hidden', 'style',
    ],
  });

  return () => {
    offGeometry();
    resize?.disconnect();
    mutations.disconnect();
    if (toastTimer !== null) window.clearInterval(toastTimer);
    host.removeAttribute(E2E_HITMAP_ATTR);
    host.removeAttribute(E2E_BOXES_ATTR);
    host.removeAttribute(E2E_STATE_ATTR);
  };
}
