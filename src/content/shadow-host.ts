/**
 * ShadowHost — hardened mount point for Kivara Lingo's UI inside a host page.
 *
 * The host page (YouTube, Netflix, Disney+, etc.) is treated as adversarial:
 *
 *   1. Its `<html>` font-size is unpredictable (YouTube uses 10px so its own
 *      design system can do simple `rem` math) which silently shrinks every
 *      `rem`-based Tailwind utility — including text sizes, padding, gap,
 *      space-y, border-radius, etc.
 *   2. It can inject heavy global styles (Material Web, Material 3, custom
 *      Roboto stack with tight line-heights) that leak into the shadow tree
 *      via inheritable properties (`color`, `font-family`, `text-shadow`,
 *      `font-variant`, `letter-spacing`, …).
 *   3. Browser extensions running in the same page (Dark Reader, Stylus,
 *      etc.) repaint our colours unless we explicitly opt-out.
 *   4. SPA navigation can rip our host element from the document if we
 *      attach it under `body`.
 *   5. Tailwind v4 registers per-utility defaults via `@property` at the
 *      document level — these don't always propagate into a Shadow Root,
 *      so utilities like `space-y-2`, `shadow-md`, `ring-1`, `border` (which
 *      depends on `--tw-border-style: solid`) silently break.
 *
 * Defence in depth:
 *
 *   - **Frontier**: ShadowRoot with `mode: 'open'`.
 *   - **Inheritance cut**: `all: initial` on `:host`, then explicit defaults
 *     for typography, colour-scheme, font smoothing.
 *   - **Token pinning**: every `--text-*`, `--spacing`, `--radius-*` is
 *     redefined in `px` so utilities decouple from `<html>` font-size.
 *   - **Tailwind v4 seed**: every `--tw-*` `@property` has its `initial-value`
 *     replicated as a CSS custom property on `:host` so `var(--tw-…)` never
 *     evaluates to `initial-value` from a missing registration.
 *   - **Stacking context**: `isolation: isolate` + `contain: layout style`
 *     so the host page's `z-index`, `transform`, etc. can't reach inside.
 *   - **Dark Reader opt-out**: `data-darkreader-ignore` on the host element
 *     and a `<meta name="darkreader-lock">` on the document head.
 *   - **High Contrast**: `forced-color-adjust: none` on `:host`.
 *   - **Legacy cleanup**: any prior build's leftover `<style>` or `<link>`
 *     in `document.head` is removed on mount.
 */

import globalsCss from '../styles/globals.css?inline';
import themeCss from '../styles/theme.css?inline';
import tailwindCss from '../styles/tailwind.css?inline';
// Sonner ships its layout/animation CSS as a separate file. Sonner injects
// it into `document.head` at runtime, but our React tree lives inside the
// Shadow DOM where that head-level rule is invisible — without this import
// the toast `<ol>` has no width / position and stretches across the
// viewport instead of centering at the top. Importing inline lets us drop
// the rules into our shadow stylesheet alongside Tailwind.
import sonnerCss from 'sonner/dist/styles.css?inline';

const HOST_ID = 'kivara-lingo-host';
const VIDEO_HOST_ID = 'kivara-lingo-video-host';
const REACT_ROOT_ID = 'kivara-lingo-react-root';
const VIDEO_REACT_ROOT_ID = 'kivara-lingo-video-react-root';

/**
 * Runs once per page. Drops a Dark Reader lock meta and removes any legacy
 * stylesheet a previous build may have left in the head — those would still
 * be processed by Dark Reader / picked up by the host page's CSS resets.
 */
let pageGuardsApplied = false;
function applyPageGuards(): void {
  if (pageGuardsApplied) return;
  pageGuardsApplied = true;
  try {
    if (!document.querySelector('meta[name="darkreader-lock"]')) {
      const meta = document.createElement('meta');
      meta.name = 'darkreader-lock';
      document.head?.appendChild(meta);
    }
    // Strip any leftover global stylesheet from older builds. Defensive —
    // we don't expect to ever inject into the head, but a stray HMR run
    // during development can leave one behind and it would defeat the
    // shadow boundary.
    document
      .querySelectorAll<HTMLElement>('style[data-kivara-lingo], link[data-kivara-lingo]')
      .forEach((el) => el.remove());
  } catch {
    /* head may not be ready yet on document_start; the next mount picks
     * it up anyway. */
  }
}

export class ShadowHost {
  static mount(container: HTMLElement, options: { isOverlay?: boolean } = {}) {
    applyPageGuards();

    const hostElement = document.createElement('div');
    hostElement.id = options.isOverlay ? VIDEO_HOST_ID : HOST_ID;

    // Tell Dark Reader (and similar) to leave our host alone.
    hostElement.setAttribute('data-darkreader-ignore', 'true');

    // Position the host so it overlays the page without intercepting clicks
    // outside our actual interactive surfaces. Only the React tree opts back
    // into pointer-events.
    hostElement.style.position = options.isOverlay ? 'absolute' : 'fixed';
    hostElement.style.top = '0';
    hostElement.style.left = '0';
    hostElement.style.width = '100%';
    hostElement.style.height = options.isOverlay ? '100%' : '0';
    hostElement.style.zIndex = '2147483647'; // Max int32 z-index
    hostElement.style.pointerEvents = 'none';
    hostElement.style.contain = 'layout style';
    // `all: initial` resets inheritable properties picked up from the host
    // page (color, font-family, text-shadow, letter-spacing, etc.) before
    // we re-establish our own baseline inside the shadow tree.
    hostElement.style.all = 'initial';

    container.appendChild(hostElement);

    const shadowRoot = hostElement.attachShadow({ mode: 'open' });

    // ── Layer 1: baseline stylesheet ─────────────────────────────────────
    // Pinned typography + Tailwind v4 token overrides + every --tw-* seed.
    // Lives BEFORE the main stylesheet so user-authored utilities can still
    // override individual tokens (e.g. .text-3xl uses --text-3xl, which we
    // set to 30px here but a `text-[2.5rem]` arbitrary class still wins).
    const baselineStyle = document.createElement('style');
    baselineStyle.setAttribute('data-kivara-lingo', 'baseline');
    baselineStyle.textContent = BASELINE_CSS;
    shadowRoot.appendChild(baselineStyle);

    // ── Layer 2: app stylesheet ──────────────────────────────────────────
    // Concatenated globals + theme + Tailwind utilities + sonner's own CSS
    // (sonner injects it into document.head at runtime, which can't reach
    // a Shadow Root, so we ship it inside the boundary).
    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-kivara-lingo', 'app');
    styleEl.textContent = `${globalsCss}\n${themeCss}\n${tailwindCss}\n${sonnerCss}`;
    shadowRoot.appendChild(styleEl);

    const reactRoot = document.createElement('div');
    reactRoot.id = options.isOverlay ? VIDEO_REACT_ROOT_ID : REACT_ROOT_ID;
    if (!options.isOverlay) {
      // Allow clicks on panels/popovers; the host element itself stays
      // pointer-events: none so we don't capture clicks outside our React
      // tree (subtitle clicks in the player, YouTube controls, etc.).
      reactRoot.style.pointerEvents = 'auto';
    } else {
      reactRoot.style.position = 'absolute';
      reactRoot.style.inset = '0';
      reactRoot.style.pointerEvents = 'none';
      reactRoot.style.display = 'flex';
      reactRoot.style.flexDirection = 'column';
    }
    shadowRoot.appendChild(reactRoot);

    return { hostElement, shadowRoot, reactRoot };
  }
}

/* ─── Baseline CSS ──────────────────────────────────────────────────────────
 *
 * Kept as a module-level string constant so tooling (TypeScript, linters)
 * stays out of the way and the build doesn't have to re-emit it on every
 * mount call. */
const BASELINE_CSS = `
  :host {
    /* ── Box model + layout primitives ────────────────────────────────── */
    display: block;
    box-sizing: border-box;
    /* New stacking context so the host page's z-index ladder never bleeds
     * through us, and a containment context so YouTube layout thrashes
     * don't cause our subtree to re-flow. */
    isolation: isolate;
    contain: layout style;
    color-scheme: light dark;
    /* Disable Windows High Contrast Mode forced repaint on our colours;
     * we ship our own dark/light themes already. */
    forced-color-adjust: none;
    /* Prevent stray host-page text-shadow / decorations from leaking in. */
    text-shadow: none;
    text-decoration: none;
    text-transform: none;

    /* ── Typography reset ─────────────────────────────────────────────── */
    font-size: 16px;
    line-height: 1.5;
    letter-spacing: normal;
    /* Single source of truth for the font stack. Components that have to
     * pin font-family inline (popovers, subtitles, tooltips that portal
     * out of the React tree) should reference --kvl-font-sans so any
     * future tweak only happens here. */
    --kvl-font-sans: ui-sans-serif, system-ui, -apple-system,
      BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial,
      "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji",
      "Segoe UI Symbol";
    font-family: var(--kvl-font-sans);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;

    /* ── Tailwind v4 size tokens pinned to absolute px ────────────────── */
    /* Without this, host pages that set html { font-size: 10px } (YouTube
     * does this) would shrink every rem-based utility by ≈ 62%. The
     * tokens below match Tailwind v4 defaults at 1rem = 16px. */
    --text-xs:    12px;
    --text-sm:    14px;
    --text-base:  16px;
    --text-lg:    18px;
    --text-xl:    20px;
    --text-2xl:   24px;
    --text-3xl:   30px;
    --text-4xl:   36px;
    --text-5xl:   48px;

    --spacing:    4px;          /* gap / p / m base unit */

    --radius-sm:  2px;
    --radius-md:  6px;
    --radius-lg:  8px;
    --radius-xl:  12px;
    --radius-2xl: 16px;
    --radius-3xl: 24px;

    /* ── Tailwind v4 @property --tw-* seeds ──────────────────────────── */
    /* Tailwind v4 registers per-utility defaults via @property at the
     * DOCUMENT level. Inside a Shadow Root those registrations are not
     * always honoured, so utilities like translate-*, shadow-*, ring-*,
     * space-y-*, divide-y-*, gradient-*, animate-* can silently fall back
     * to "unset" — breaking cards, drop-shadows, divider gaps, sliding
     * indicators, etc.
     *
     * IMPORTANT: only seed properties that Tailwind declares with an
     * explicit \`initial-value\`. Properties without one (--tw-shadow-color,
     * --tw-ring-color, --tw-blur, --tw-leading, --tw-rotate-x, etc.) MUST
     * remain unset — otherwise compiled rules like
     *   box-shadow: ... var(--tw-shadow-color, rgb(0 0 0 / 0.1)) ...
     * never reach the fallback and resolve to currentColor, painting a
     * spurious WHITE HALO around cards and buttons in dark mode. */

    /* transforms (with initial-value) */
    --tw-translate-x: 0;
    --tw-translate-y: 0;
    --tw-translate-z: 0;
    --tw-scale-x: 1;
    --tw-scale-y: 1;
    --tw-scale-z: 1;

    /* layout helpers (with initial-value) */
    --tw-space-y-reverse: 0;
    --tw-space-x-reverse: 0;
    --tw-divide-y-reverse: 0;
    --tw-border-style: solid;

    /* shadows + rings (with initial-value) — colour vars stay UNSET */
    --tw-shadow: 0 0 #0000;
    --tw-shadow-alpha: 100%;
    --tw-inset-shadow: 0 0 #0000;
    --tw-inset-shadow-alpha: 100%;
    --tw-ring-shadow: 0 0 #0000;
    --tw-inset-ring-shadow: 0 0 #0000;
    --tw-ring-offset-width: 0px;
    --tw-ring-offset-color: #fff;
    --tw-ring-offset-shadow: 0 0 #0000;
    --tw-outline-style: solid;

    /* drop-shadow alpha (only this filter property has initial-value) */
    --tw-drop-shadow-alpha: 100%;

    /* gradients (with initial-value) */
    --tw-gradient-from: #0000;
    --tw-gradient-via: #0000;
    --tw-gradient-to: #0000;
    --tw-gradient-from-position: 0%;
    --tw-gradient-via-position: 50%;
    --tw-gradient-to-position: 100%;

    /* content (with initial-value) */
    --tw-content: "";

    /* tw-animate-css enter/exit (with initial-value) — used by sonner
     * toasts, dialogs, popovers */
    --tw-animation-delay: 0s;
    --tw-animation-direction: normal;
    --tw-animation-fill-mode: none;
    --tw-animation-iteration-count: 1;
    --tw-enter-blur: 0;
    --tw-enter-opacity: 1;
    --tw-enter-rotate: 0;
    --tw-enter-scale: 1;
    --tw-enter-translate-x: 0;
    --tw-enter-translate-y: 0;
    --tw-exit-blur: 0;
    --tw-exit-opacity: 1;
    --tw-exit-rotate: 0;
    --tw-exit-scale: 1;
    --tw-exit-translate-x: 0;
    --tw-exit-translate-y: 0;

    /* Properties WITHOUT initial-value are intentionally NOT seeded —
     * they live their normal life via Tailwind's per-utility cascade and
     * use \`var(name, fallback)\` for sensible defaults. Seeding them to
     * an empty string would break that fallback and paint white halos. */
  }

  /* Border-box for everything inside the shadow tree. Matches Tailwind
   * Preflight, but applied here so the host page's reset (or its absence)
   * doesn't change our intent. */
  :host *,
  :host *::before,
  :host *::after {
    box-sizing: border-box;
  }
`;
