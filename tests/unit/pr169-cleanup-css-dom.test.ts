/**
 * PR #169 — the cleanup sheet must actually APPLY to the DOM.
 *
 * The `e945085` sheet joined every selector list with a bare newline, so
 * `A\nB\nC { … }` parsed as ONE descendant selector that matches nothing on
 * any platform: `getComputedStyle` returned empty for every node and the
 * "Limpieza visual" toggles did nothing in the browser. A text assertion like
 * `toContain('.ytp-chrome-top')` passes on that broken sheet, so this file
 * checks the two things text cannot: each rule's selector list is a COMMA
 * list, and the sheet, once injected, really styles the intended nodes.
 *
 * The DOM probe is one node per selector, all SIBLINGS (never nested): with a
 * comma list each node is matched by its own selector; with the broken chain
 * the query matches nothing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { applyCleanupCss, applyOwnedBarCss, buildCleanupCss } from '../../src/content/ui/cleanup-css';

const PLATFORMS = ['youtube', 'netflix', 'disney', 'hbo', 'prime'] as const;

/** The native popups both Netflix sheets must exempt, scoped to the player. */
const EXPECTED_EXCEPTIONS = [
  '[data-uia="selector-audio-subtitle"]',
  '[data-uia="selector-audio"]',
  '[data-uia="selector-subtitle"]',
  '[data-uia="episodes-selector"]',
  '[data-uia="episode-selector"]',
  '[data-uia="player-episodes"]',
  '[data-uia="player-menu"]',
  '.watch-video [role="menu"]',
  '.watch-video [role="dialog"]',
  '[data-uia="watch-video"] [role="menu"]',
  '[data-uia="watch-video"] [role="dialog"]',
].sort();

interface CssBlock {
  selectors: string[];
  declarations: Record<string, string>;
}

/** Split a generated sheet into rule blocks (selectors + declarations). */
function parseBlocks(css: string): CssBlock[] {
  return css
    .split('}')
    .map((block) => block.trim())
    .filter((block) => block.includes('{'))
    .map((block) => {
      const brace = block.indexOf('{');
      const selectors = block
        .slice(0, brace)
        .split(',')
        .map((selector) => selector.trim())
        .filter(Boolean);
      const declarations: Record<string, string> = {};
      for (const declaration of block.slice(brace + 1).split(';')) {
        const [property, ...rest] = declaration.split(':');
        const value = rest.join(':').trim();
        if (property?.trim() && value) declarations[property.trim()] = value;
      }
      return { selectors, declarations };
    });
}

/**
 * A node that really matches `selector`, built from the selector's own parts.
 *
 * The `matches` guard is the point: if this helper produced a node the
 * selector does not match, every assertion below would be vacuous, so it
 * throws instead of letting the test pass for the wrong reason.
 */
function materialise(selector: string): HTMLElement {
  const el = document.createElement('div');
  const tokens = selector.match(/\[[^\]]*\]|\.[A-Za-z0-9_-]+/g) ?? [];
  expect(tokens.length, `no token parsed out of ${selector}`).toBeGreaterThan(0);
  for (const token of tokens) {
    if (token.startsWith('.')) {
      el.classList.add(token.slice(1));
      continue;
    }
    const exact = token.match(/^\[([a-zA-Z-]+)="([^"]*)"\]$/);
    if (exact) {
      el.setAttribute(exact[1], exact[2]);
      continue;
    }
    const contains = token.match(/^\[([a-zA-Z-]+)\*="([^"]*)"/);
    if (contains) {
      el.classList.add(contains[2]);
      continue;
    }
    throw new Error(`unhandled selector token ${token} in ${selector}`);
  }
  if (!el.matches(selector)) throw new Error(`materialised node does not match ${selector}`);
  return el;
}

/** Mount one isolated sibling per selector and return them, keyed by selector. */
function mountSiblings(selectors: readonly string[]): Map<string, HTMLElement> {
  const nodes = new Map<string, HTMLElement>();
  for (const selector of selectors) {
    const el = materialise(selector);
    el.setAttribute('data-probe', selector);
    document.body.appendChild(el);
    nodes.set(selector, el);
  }
  return nodes;
}

function computed(el: HTMLElement) {
  const style = getComputedStyle(el);
  return {
    visibility: style.visibility,
    opacity: style.opacity,
    pointerEvents: style.pointerEvents,
  };
}

const UI_DECLARATIONS = { visibility: 'hidden !important', 'pointer-events': 'none !important' };
const SHADOW_DECLARATIONS = {
  visibility: 'hidden !important',
  opacity: '0 !important',
  'pointer-events': 'none !important',
};

const isUiBlock = (block: CssBlock) => !!block.declarations['pointer-events'] && block.declarations['opacity'] === undefined;
const isShadowBlock = (block: CssBlock) => block.declarations['opacity'] === '0 !important';

/**
 * Whether ANY rule of our sheets matches `el`.
 *
 * The counterpart of `computed()`: `getComputedStyle` answers "what did the
 * engine resolve", which for an unstyled node is the CSS initial value — so
 * "did WE style it?" needs the selector match itself.
 */
function matchedByOurSheets(el: HTMLElement): boolean {
  const sheets = Array.from(document.querySelectorAll('style[id^="kivara-cleanup-"], style[id^="kivara-owned-bar-"]')) as HTMLStyleElement[];
  return sheets.some((sheet) => Array.from(sheet.sheet?.cssRules ?? []).some((rule) => {
    const selectorText = (rule as CSSStyleRule).selectorText;
    if (!selectorText) return false;
    try {
      return el.matches(selectorText);
    } catch {
      return false;
    }
  }));
}

afterEach(() => {
  document.body.innerHTML = '';
  for (const style of Array.from(document.querySelectorAll('style[id^="kivara-cleanup-"], style[id^="kivara-owned-bar-"]'))) {
    style.remove();
  }
});

describe('PR #169 — the sheet applies to the DOM on all five platforms', () => {
  for (const platform of PLATFORMS) {
    it(`${platform}: hideUI hides the chrome and hideShadows fades the shadows`, () => {
      const css = buildCleanupCss({ hideUI: true, hideShadows: true, controlsIdle: true, platform });
      const blocks = parseBlocks(css);
      const uiBlock = blocks.find(isUiBlock);
      const shadowBlock = blocks.find(isShadowBlock);
      expect(uiBlock, `${platform}: a chrome rule exists`).toBeTruthy();
      expect(shadowBlock, `${platform}: a shadow rule exists`).toBeTruthy();

      // The declarations are exactly the intended ones — never `opacity: 0`
      // on the chrome (that is what killed the native CC / episodes menus).
      expect(uiBlock!.declarations).toEqual(UI_DECLARATIONS);
      expect(shadowBlock!.declarations).toEqual(SHADOW_DECLARATIONS);

      // A selector lives in ONE of the two rules: `hideShadows` must not
      // repeat what `hideUI` already hides.
      const overlap = uiBlock!.selectors.filter((selector) => shadowBlock!.selectors.includes(selector));
      expect(overlap, `${platform}: one rule per selector`).toEqual([]);

      // The comma list is real: every selector of a rule is its own selector.
      for (const selector of [...uiBlock!.selectors, ...shadowBlock!.selectors]) {
        expect(selector, `${platform}: selector list is comma-joined`).not.toMatch(/[\r\n]/);
        expect(selector).not.toContain('{');
      }

      const uiNodes = mountSiblings(uiBlock!.selectors);
      const shadowNodes = mountSiblings(shadowBlock!.selectors);
      applyCleanupCss({ hideUI: true, hideShadows: true, controlsIdle: true, platform });

      for (const [selectors, nodes, fades] of [
        [uiBlock!.selectors, uiNodes, false],
        [shadowBlock!.selectors, shadowNodes, true],
      ] as const) {
        // Every selector matches ITS OWN node. With the broken chain
        // (`A\nB\nC`) this is false: the list is one descendant selector.
        for (const [selector, node] of nodes) {
          expect(node.matches(selector), `${platform}: ${selector} matches its node`).toBe(true);
        }
        // The rule as a whole reaches all of them. A count is deliberately not
        // asserted 1:1: substring selectors legitimately overlap (a
        // `ControlsCenterInfoContainer` node also matches `[class*="ControlsCenter"]`,
        // on the real page too).
        const matched = Array.from(document.querySelectorAll(selectors.join(',')));
        for (const node of nodes.values()) expect(matched).toContain(node);

        // And the sheet really styles them: getComputedStyle, not text.
        for (const [selector, node] of nodes) {
          const style = computed(node);
          expect(style.visibility, `${platform} ${selector} visibility`).toBe('hidden');
          expect(style.pointerEvents, `${platform} ${selector} pointer-events`).toBe('none');
          if (fades) {
            expect(style.opacity, `${platform} ${selector} opacity`).toBe('0');
          } else {
            expect(style.opacity, `${platform} ${selector} must not fade`).not.toBe('0');
          }
        }
      }
    });
  }

  it('chrome selectors are hidden without fading, even when they also look like shadows', () => {
    // `.ytp-gradient-*` is listed by BOTH toggles on YouTube: the chrome rule
    // wins, so the overlay is hidden but NOT faded (the fade belongs to the
    // shadow toggle, and a faded chrome would still paint).
    const css = buildCleanupCss({ hideUI: true, hideShadows: true, controlsIdle: true, platform: 'youtube' });
    const uiBlock = parseBlocks(css).find(isUiBlock)!;
    expect(uiBlock.selectors).toContain('.ytp-gradient-bottom');
    document.body.innerHTML = '<div class="ytp-gradient-bottom" data-probe="g"></div>';
    applyCleanupCss({ hideUI: true, hideShadows: true, controlsIdle: true, platform: 'youtube' });
    const style = computed(document.querySelector('[data-probe="g"]') as HTMLElement);
    expect(style.visibility).toBe('hidden');
    expect(style.opacity).not.toBe('0');
  });

  it('real shadows without the word "gradient" keep their fade', () => {
    // Shadow-ONLY selectors: `hideShadows` lists a real shadow whose name has
    // no "gradient" in it, and the old `/gradient/i` split left them un-faded.
    const cases = [
      ['youtube', '.ytp-shadow-content'],
      ['hbo', '[class*="HoverOverlay"]'],
      ['hbo', '[class*="hover-overlay"]'],
    ] as const;
    for (const [platform, selector] of cases) {
      document.body.innerHTML = '';
      const css = buildCleanupCss({ hideUI: true, hideShadows: true, controlsIdle: true, platform });
      const shadowBlock = parseBlocks(css).find(isShadowBlock)!;
      expect(shadowBlock.selectors, `${platform}: ${selector} belongs to the shadow rule`).toContain(selector);

      const node = materialise(selector);
      node.setAttribute('data-probe', selector);
      document.body.appendChild(node);
      applyCleanupCss({ hideUI: true, hideShadows: true, controlsIdle: true, platform });
      const style = computed(node);
      expect(style.opacity, `${platform} ${selector} fades`).toBe('0');
      expect(style.visibility).toBe('hidden');
      expect(style.pointerEvents).toBe('none');
    }
  });

  it('a selector listed by BOTH toggles is hidden by the chrome rule, never faded', () => {
    // `.controls__bg-overlay` (Disney) is chrome AND a background: the chrome
    // rule owns it, so it is hidden with `visibility` but keeps `opacity: 1` —
    // a faded chrome would still paint, and `opacity: 0` on it is exactly what
    // made the native menus unusable.
    document.body.innerHTML = '<div class="controls__bg-overlay" data-probe="disney"></div>';
    const css = buildCleanupCss({ hideUI: true, hideShadows: true, controlsIdle: true, platform: 'disney' });
    const uiBlock = parseBlocks(css).find(isUiBlock)!;
    expect(uiBlock.selectors).toContain('.controls__bg-overlay');
    applyCleanupCss({ hideUI: true, hideShadows: true, controlsIdle: true, platform: 'disney' });
    const style = computed(document.querySelector('[data-probe="disney"]') as HTMLElement);
    expect(style.visibility).toBe('hidden');
    expect(style.pointerEvents).toBe('none');
    expect(style.opacity).not.toBe('0');
  });
});

describe('PR #169 — both Netflix sheets exempt the SAME native popups', () => {
  function exceptionSelectors(sheetId: string): string[] {
    const css = document.getElementById(sheetId)?.textContent ?? '';
    const block = parseBlocks(css).find((b) => b.declarations['visibility'] === 'visible !important');
    return block ? [...block.selectors].sort() : [];
  }

  it('the owned-bar sheet hides the native row on its own', async () => {
    // Alone, without the cleanup sheet: the row rule's own selector list must
    // Alone, without the cleanup sheet: the row rule's own selector list must
    // be a comma list, or the native row stays visible under our bar. PR #171
    // grew that list to every real Netflix container, so the expectation is the
    // EXPORTED list rather than a copy that can drift.
    const { NETFLIX_OWNED_HIDE_SELECTORS } = await import('../../src/content/ui/cleanup-css');
    const row = [...NETFLIX_OWNED_HIDE_SELECTORS];
    expect(row.length, 'the whole chrome, not the three legacy selectors').toBeGreaterThan(15);
    const nodes = mountSiblings(row);
    applyOwnedBarCss(true, 'netflix');
    const block = parseBlocks(document.getElementById('kivara-owned-bar-netflix')?.textContent ?? '')
      .find((b) => b.declarations['visibility'] === 'hidden !important')!;
    expect([...block.selectors].sort()).toEqual([...row].sort());
    for (const [selector, node] of nodes) {
      const style = computed(node);
      expect(style.visibility, `${selector} hidden by the owned bar`).toBe('hidden');
      expect(style.pointerEvents, `${selector} yields the pointer`).toBe('none');
      expect(style.opacity, `${selector} must not fade`).not.toBe('0');
    }
  });

  it('mounts the popup exemptions identically in the cleanup and owned-bar sheets', async () => {
    // Imported dynamically so this file still RUNS (and shows the DOM-level
    // failures) on a tree where the canonical list does not exist yet.
    const { NETFLIX_POPUP_CSS_SELECTORS } = await import('../../src/content/ui/cleanup-css');
    applyOwnedBarCss(true, 'netflix');
    applyCleanupCss({ hideUI: true, hideShadows: true, controlsIdle: true, platform: 'netflix' });
    expect(document.getElementById('kivara-owned-bar-netflix')).not.toBeNull();
    expect(document.getElementById('kivara-cleanup-netflix')).not.toBeNull();

    // The ONE list both sheets are built from, pinned selector by selector.
    expect([...NETFLIX_POPUP_CSS_SELECTORS].sort()).toEqual(EXPECTED_EXCEPTIONS);

    const owned = exceptionSelectors('kivara-owned-bar-netflix');
    const cleanup = exceptionSelectors('kivara-cleanup-netflix');
    expect(owned.length).toBeGreaterThan(0);
    // The sheet mounted LAST (`#kivara-cleanup-netflix`, App.tsx:614 vs :552)
    // is the one that wins with `!important`: a different list there silently
    // re-hides a popup the owned bar had exempted.
    expect(cleanup).toEqual(owned);
    expect(cleanup).toEqual(EXPECTED_EXCEPTIONS);
    // The generic role selectors are allowed ONLY scoped to the player: a bare
    // `[role="menu"]` matches unrelated page nodes.
    expect(cleanup).not.toContain('[role="menu"]');
    expect(cleanup).not.toContain('[role="dialog"]');
  });

  it('keeps the native popups visible and clickable while the chrome is hidden', () => {
    document.body.innerHTML = `
      <div class="watch-video">
        <div data-uia="player-controls">
          <div data-uia="selector-audio-subtitle" id="probe-cc">CC</div>
          <div role="menu" id="probe-menu"></div>
        </div>
        <div class="PlayerControlsNeo__top-controls" id="probe-top"></div>
      </div>
      <div role="dialog" id="probe-page-dialog"></div>
    `;
    applyOwnedBarCss(true, 'netflix');
    applyCleanupCss({ hideUI: true, hideShadows: true, controlsIdle: true, platform: 'netflix' });

    const cc = document.getElementById('probe-cc') as HTMLElement;
    const menu = document.getElementById('probe-menu') as HTMLElement;
    expect(cc.matches('[data-uia="selector-audio-subtitle"]')).toBe(true);
    expect(menu.matches('.watch-video [role="menu"]')).toBe(true);
    for (const [name, el] of [['cc', cc], ['menu', menu]] as const) {
      expect(computed(el), `${name} stays usable`).toEqual({
        visibility: 'visible',
        opacity: '1',
        pointerEvents: 'auto',
      });
    }

    // The chrome itself is still hidden, so the exemption is not the sheet.
    const top = computed(document.getElementById('probe-top') as HTMLElement);
    expect(top.visibility).toBe('hidden');
    expect(top.pointerEvents).toBe('none');

    // A page-level dialog OUTSIDE `.watch-video` is never matched by our
    // exception selectors — and no rule of either sheet matches it at all
    // (`getComputedStyle().opacity` cannot answer this: an unstyled element
    // reports the CSS initial value, not an empty string, once a real engine
    // is in play).
    const outside = document.getElementById('probe-page-dialog') as HTMLElement;
    expect(document.querySelectorAll('.watch-video [role="dialog"]')).toHaveLength(0);
    expect(outside.matches('.watch-video [role="dialog"]')).toBe(false);
    expect(matchedByOurSheets(outside), 'no rule of ours matches the page dialog').toBe(false);
  });
});
