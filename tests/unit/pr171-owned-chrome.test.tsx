/**
 * PR #171 · 1 — the owned bar hides the REAL Netflix chrome, all of it.
 *
 * The owner's live test still showed the ← / ⚑ corners, the red timeline, the
 * pause screen and the contextual skip buttons: `OWNED_BAR_SELECTORS.netflix`
 * only knew three legacy selectors. The list is now the exported
 * `NETFLIX_OWNED_HIDE_SELECTORS`, and this file checks it selector by selector
 * with `getComputedStyle` — the only way to prove CSS applies (the #169 lesson).
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyCleanupCss,
  applyOwnedBarCss,
  NETFLIX_OWNED_HIDE_SELECTORS,
  NETFLIX_POPUP_CSS_SELECTORS,
} from '../../src/content/ui/cleanup-css';

const REQUIRED = [
  // Bottom chrome + the red timeline.
  '.watch-video--bottom-controls-container',
  '[data-uia="controls-standard"]',
  '[data-uia="watch-video-bottom-controls"]',
  '[data-uia="player-controls"]',
  '.PlayerControlsNeo__bottom-controls',
  '[data-uia="timeline-bar"]',
  '[data-uia="timeline"]',
  // Top chrome: the back arrow and the flag.
  '.watch-video--back-container',
  '.watch-video--flag-container',
  '.PlayerControlsNeo__top-controls',
  '[data-uia="control-nav-back"]',
  '[data-uia="control-flag-button"]',
  // Pause screen and the native contextual buttons we replace.
  '.watch-video--evidence-overlay-container',
  '[data-uia="evidence-overlay"]',
  '[data-uia="pause-overlay"]',
  '[data-uia="player-skip-intro"]',
  '[data-uia="player-skip-recap"]',
  '[data-uia="player-skip-preplay"]',
  '[data-uia="next-episode-seamless-button"]',
  '[data-uia="next-episode-seamless-button-draining"]',
  // Native gradients.
  '.watch-video--bottom-gradient',
  '.watch-video--top-gradient',
];

/** A node that really matches `selector` (throws when it would not). */
function materialise(selector: string): HTMLElement {
  const el = document.createElement('div');
  const tokens = selector.match(/\[[^\]]*\]|\.[A-Za-z0-9_-]+/g) ?? [];
  for (const token of tokens) {
    if (token.startsWith('.')) { el.classList.add(token.slice(1)); continue; }
    const exact = token.match(/^\[([a-zA-Z-]+)="([^"]*)"\]$/);
    if (exact) { el.setAttribute(exact[1], exact[2]); continue; }
    const contains = token.match(/^\[([a-zA-Z-]+)\*="([^"]*)"/);
    if (contains) { el.classList.add(contains[2]); continue; }
    throw new Error(`unhandled token ${token} in ${selector}`);
  }
  if (!el.matches(selector)) throw new Error(`node does not match ${selector}`);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
  for (const style of Array.from(document.querySelectorAll('style[id^="kivara-"]'))) style.remove();
});

describe('PR #171 · the chrome list', () => {
  it('exports every container the owner still saw', () => {
    for (const selector of REQUIRED) {
      expect(NETFLIX_OWNED_HIDE_SELECTORS, `${selector} must be hidden`).toContain(selector);
    }
    // The gradients live in the SAME rule as the chrome: `visibility: hidden`
    // already makes them invisible, and `opacity: 0` here would break the
    // popup-exemption contract on this sheet (#167 pins that).
    expect(NETFLIX_OWNED_HIDE_SELECTORS).toContain('[class*="watch-video--"][class*="gradient" i]');
    expect(new Set(NETFLIX_OWNED_HIDE_SELECTORS).size, 'no duplicates').toBe(NETFLIX_OWNED_HIDE_SELECTORS.length);
  });

  it('hides every one of them, measured on the DOM', () => {
    const nodes = NETFLIX_OWNED_HIDE_SELECTORS.map((selector) => {
      const el = materialise(selector);
      el.setAttribute('data-probe', selector);
      document.body.appendChild(el);
      return [selector, el] as const;
    });
    applyOwnedBarCss(true, 'netflix');
    // The rule as a whole is a comma list that reaches them all.
    const matched = Array.from(document.querySelectorAll(NETFLIX_OWNED_HIDE_SELECTORS.join(',')));
    for (const [selector, el] of nodes) {
      expect(matched, `${selector} matches its node`).toContain(el);
      const style = getComputedStyle(el);
      expect(style.visibility, `${selector} visibility`).toBe('hidden');
      expect(style.pointerEvents, `${selector} pointer-events`).toBe('none');
      // NEVER faded: the popups are descendants of some of these nodes.
      expect(style.opacity, `${selector} must not fade`).not.toBe('0');
    }
  });

  it('keeps the native popups usable and never fades the row', () => {
    document.body.innerHTML = `
      <div class="watch-video">
        <div class="watch-video--bottom-controls-container">
          <div data-uia="selector-audio-subtitle" id="cc">CC</div>
        </div>
      </div>
    `;
    applyOwnedBarCss(true, 'netflix');
    const css = document.getElementById('kivara-owned-bar-netflix')?.textContent ?? '';
    expect(css, 'the owned sheet never uses opacity: 0').not.toContain('opacity: 0');
    for (const selector of NETFLIX_POPUP_CSS_SELECTORS) expect(css).toContain(selector);
    const cc = getComputedStyle(document.getElementById('cc')!);
    expect(cc.visibility).toBe('visible');
    expect(cc.opacity).toBe('1');
    expect(cc.pointerEvents).toBe('auto');
    // The chrome itself is still hidden.
    expect(getComputedStyle(document.querySelector('.watch-video--bottom-controls-container')!).visibility).toBe('hidden');
  });

  it('does not depend on the idle gate (the chrome rule is always-on for the owned bar)', () => {
    // The cleanup sheet withholds hideUI while the pointer moves; the owned-bar
    // sheet must NOT: our bar replaces that chrome for the whole session.
    applyOwnedBarCss(true, 'netflix');
    applyCleanupCss({ hideUI: true, hideShadows: true, controlsIdle: false, platform: 'netflix' });
    expect(document.getElementById('kivara-owned-bar-netflix')?.textContent).toContain('[data-uia="control-nav-back"]');
    expect(document.getElementById('kivara-cleanup-netflix')?.textContent ?? '').not.toContain('[data-uia="control-nav-back"]');
  });
});
