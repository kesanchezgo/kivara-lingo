/**
 * Columns on the right: the width math and the injected reservation
 * (F6 · docs/REDESIGN-V2.md §3 H11, D1; issues #33 and #38).
 *
 * Three things are pinned here, because they are the three ways this feature
 * has broken before:
 *
 *  1. **One width.** `computeColumnLayout` is what BOTH the App's inline styles
 *     and the injected stylesheet consume. If the reserved width ever exceeds
 *     the 40 % cap, or the layout stops degrading to overlay on a narrow
 *     screen, the player gets covered instead of shrunk.
 *  2. **The platform rules.** Max was styled through `#root` — the whole app
 *     shell — so the entire page moved instead of the player. And YouTube
 *     needs a synthetic `resize` on apply AND on cleanup, because it sizes the
 *     video inline and ignores a stylesheet change.
 *  3. **The visibility rule (#38).** A docked panel is a second column BESIDE
 *     the transcript, never a replacement for it.
 *
 * The dispatch tests use the real happy-dom `window` as the fake page: a
 * listener is registered and the events it receives are the product's output.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COLUMN_GAP_PX,
  MAX_RESERVED_FRACTION,
  PANEL_MIN_WIDTH_PX,
  PANEL_WIDTH_PX,
  RAIL_MIN_WIDTH_PX,
  RAIL_WIDTH_PX,
  applyColumnsCss,
  buildColumnsCss,
  computeColumnLayout,
  computeColumnVisibility,
  type ColumnVisibility,
} from '../../src/content/ui/columns-css';
import type { SubtitleSource } from '../../src/content/platform-adapters/types';

type Platform = SubtitleSource['platform'];

const RAIL_ONLY: ColumnVisibility = { rail: true, panel: false };
const PANEL_ONLY: ColumnVisibility = { rail: false, panel: true };
const BOTH: ColumnVisibility = { rail: true, panel: true };
const NONE: ColumnVisibility = { rail: false, panel: false };

const PLATFORMS: Platform[] = ['youtube', 'netflix', 'hbo', 'disney', 'prime', 'generic'];

afterEach(() => {
  for (const style of Array.from(document.querySelectorAll('style[id^="kivara-columns-"]'))) {
    style.remove();
  }
  document.documentElement.removeAttribute('data-kvl-columns');
});

describe('computeColumnVisibility', () => {
  it('shows the rail AND the docked panel at the same time (#38)', () => {
    expect(
      computeColumnVisibility({ enabled: true, railOpen: true, panelOpen: true, isPopupMode: false }),
    ).toEqual({ rail: true, panel: true });
  });

  it('does not treat a floating panel as a column', () => {
    expect(
      computeColumnVisibility({ enabled: true, railOpen: true, panelOpen: true, isPopupMode: true }),
    ).toEqual({ rail: true, panel: false });
  });

  it('keeps the rail visible when the panel is open in either mode', () => {
    for (const isPopupMode of [false, true]) {
      expect(
        computeColumnVisibility({ enabled: true, railOpen: true, panelOpen: true, isPopupMode }).rail,
      ).toBe(true);
    }
  });

  it('reserves nothing with the extension disabled', () => {
    expect(
      computeColumnVisibility({ enabled: false, railOpen: true, panelOpen: true, isPopupMode: false }),
    ).toEqual({ rail: false, panel: false });
  });
});

describe('computeColumnLayout', () => {
  it('reserves the rail alone when it fits', () => {
    const layout = computeColumnLayout(RAIL_ONLY, 1920);
    expect(layout.overlay).toBe(false);
    expect(layout.railWidth).toBe(RAIL_WIDTH_PX);
    expect(layout.panelWidth).toBe(0);
    expect(layout.reserved).toBe(RAIL_WIDTH_PX);
  });

  it('reserves the panel alone when it fits', () => {
    const layout = computeColumnLayout(PANEL_ONLY, 1920);
    expect(layout.overlay).toBe(false);
    expect(layout.panelWidth).toBe(PANEL_WIDTH_PX);
    expect(layout.reserved).toBe(PANEL_WIDTH_PX);
  });

  it('reserves BOTH widths plus the gap when both columns are open (#38)', () => {
    const layout = computeColumnLayout(BOTH, 2560);
    expect(layout.overlay).toBe(false);
    expect(layout.railWidth).toBe(RAIL_WIDTH_PX);
    expect(layout.panelWidth).toBe(PANEL_WIDTH_PX);
    expect(layout.gap).toBe(COLUMN_GAP_PX);
    expect(layout.reserved).toBe(RAIL_WIDTH_PX + PANEL_WIDTH_PX + COLUMN_GAP_PX);
    expect(layout.required).toBe(layout.reserved);
  });

  it('reserves nothing when no column is open', () => {
    expect(computeColumnLayout(NONE, 1920)).toMatchObject({
      reserved: 0,
      required: 0,
      railWidth: 0,
      panelWidth: 0,
      overlay: false,
    });
  });

  it('never reserves more than 40 % of the viewport', () => {
    for (const width of [320, 480, 640, 768, 1024, 1280, 1440, 1600, 1715, 1920, 2560, 3440]) {
      const cap = Math.floor(width * MAX_RESERVED_FRACTION);
      for (const state of [RAIL_ONLY, PANEL_ONLY, BOTH]) {
        const layout = computeColumnLayout(state, width);
        expect(layout.reserved, `${width}px ${JSON.stringify(state)}`).toBeLessThanOrEqual(cap);
        expect(layout.reserved).toBeLessThanOrEqual(RAIL_WIDTH_PX + PANEL_WIDTH_PX + COLUMN_GAP_PX);
      }
    }
  });

  it('scales the two columns down before it gives up', () => {
    // 1920 × 0.4 = 768, so 840 does not fit and both shrink proportionally.
    const layout = computeColumnLayout(BOTH, 1920);
    expect(layout.overlay).toBe(false);
    expect(layout.railWidth).toBeLessThan(RAIL_WIDTH_PX);
    expect(layout.panelWidth).toBeLessThan(PANEL_WIDTH_PX);
    expect(layout.railWidth).toBeGreaterThanOrEqual(RAIL_MIN_WIDTH_PX);
    expect(layout.panelWidth).toBeGreaterThanOrEqual(PANEL_MIN_WIDTH_PX);
    expect(layout.reserved).toBeLessThanOrEqual(layout.cap);
  });

  it('degrades to overlay on a narrow screen', () => {
    for (const [state, width] of [
      [RAIL_ONLY, 640],
      [PANEL_ONLY, 880],
      [BOTH, 1440],
    ] as const) {
      const layout = computeColumnLayout(state, width);
      expect(layout.overlay, `${width}px ${JSON.stringify(state)}`).toBe(true);
      expect(layout.reserved).toBe(0);
    }
  });

  it('still renders the columns at their preferred width in overlay mode', () => {
    const layout = computeColumnLayout(BOTH, 1024);
    expect(layout.overlay).toBe(true);
    expect(layout.railWidth).toBe(RAIL_WIDTH_PX);
    expect(layout.panelWidth).toBe(PANEL_WIDTH_PX);
  });

  it('overlays when there is no measurable viewport', () => {
    for (const width of [0, Number.NaN]) {
      const layout = computeColumnLayout(BOTH, width);
      expect(layout.overlay).toBe(true);
      expect(layout.reserved).toBe(0);
    }
  });

  it('keeps the documented breakpoints', () => {
    expect(computeColumnLayout(RAIL_ONLY, 700).overlay).toBe(false);
    expect(computeColumnLayout(RAIL_ONLY, 699).overlay).toBe(true);
    expect(computeColumnLayout(PANEL_ONLY, 900).overlay).toBe(false);
    expect(computeColumnLayout(PANEL_ONLY, 899).overlay).toBe(true);
    expect(computeColumnLayout(BOTH, 1715).overlay).toBe(false);
    expect(computeColumnLayout(BOTH, 1714).overlay).toBe(true);
  });
});

describe('buildColumnsCss', () => {
  const cssFor = (platform: Platform, state: ColumnVisibility, viewportWidth = 1920) =>
    buildColumnsCss({ platform, state, viewportWidth });

  it('is empty when no column is reserved', () => {
    expect(cssFor('youtube', NONE)).toBe('');
    // Narrow screen: overlay mode reserves nothing, so there is no CSS.
    expect(cssFor('netflix', BOTH, 1024)).toBe('');
  });

  it('writes the reserved width the layout computed, per platform', () => {
    const rail = computeColumnLayout(RAIL_ONLY, 1920);
    expect(cssFor('youtube', RAIL_ONLY)).toContain(`calc(100% - ${rail.reserved}px)`);
    expect(cssFor('netflix', RAIL_ONLY)).toContain(`right: ${rail.reserved}px !important;`);
    expect(cssFor('disney', RAIL_ONLY)).toContain(`right: ${rail.reserved}px !important;`);
    expect(cssFor('prime', RAIL_ONLY)).toContain(`right: ${rail.reserved}px !important;`);
    expect(cssFor('hbo', RAIL_ONLY)).toContain(`right: ${rail.reserved}px !important;`);

    const both = computeColumnLayout(BOTH, 2560);
    expect(cssFor('hbo', BOTH, 2560)).toContain(`right: ${both.reserved}px !important;`);
    expect(both.reserved).toBe(RAIL_WIDTH_PX + PANEL_WIDTH_PX + COLUMN_GAP_PX);
  });

  it('targets YouTube with width and its own selectors, never #root', () => {
    const css = cssFor('youtube', BOTH, 2560);
    expect(css).toContain('.html5-video-player');
    expect(css).toContain('#movie_player');
    expect(css).toContain('width: calc(100% - 840px) !important;');
    expect(css).toContain(':fullscreen video');
    expect(css).toContain('max-width: calc(100% - 840px) !important;');
    expect(css).not.toContain('#root');
  });

  it('shrinks the Max PLAYER container, never the app root', () => {
    const css = cssFor('hbo', RAIL_ONLY);
    expect(css).toContain('[data-testid="player-container"]');
    expect(css).toContain('[class*="Fuse-Web-Play"]');
    expect(css).not.toContain('#root');
  });

  it('never writes #root on any platform', () => {
    for (const platform of PLATFORMS) {
      for (const state of [RAIL_ONLY, PANEL_ONLY, BOTH]) {
        const css = cssFor(platform, state, 2560);
        expect(css, `${platform} ${JSON.stringify(state)}`).not.toContain('#root');
      }
    }
  });

  it('has no reservation to write for an unknown platform', () => {
    expect(cssFor('generic', BOTH, 2560)).toBe('');
  });
});

describe('applyColumnsCss', () => {
  const styleFor = (platform: Platform) =>
    document.getElementById(`kivara-columns-${platform}`) as HTMLStyleElement | null;

  /**
   * The page's resize channel: `dispatchEvent` is spied (and calls through, so
   * a real listener would still fire) and the returned reader lists the resize
   * events seen so far. `restoreMocks` puts the method back between tests.
   */
  function spyResize(): () => Event[] {
    vi.spyOn(window, 'dispatchEvent');
    return () => {
      const spy = window.dispatchEvent as unknown as { mock: { calls: [Event][] } };
      return spy.mock.calls
        .map(([event]) => event)
        .filter((event) => event.type === 'resize');
    };
  }

  it('injects the rule and nudges the YouTube player on apply', () => {
    const resizeEvents = spyResize();
    applyColumnsCss({ platform: 'youtube', state: RAIL_ONLY, viewportWidth: 1920 });

    const style = styleFor('youtube');
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain('calc(100% - 400px)');
    expect(document.documentElement.getAttribute('data-kvl-columns')).toBe('1');
    expect(resizeEvents()).toHaveLength(1);
    expect(resizeEvents()[0].type).toBe('resize');
  });

  it('nudges the YouTube player again when the rule is removed', () => {
    const resizeEvents = spyResize();
    applyColumnsCss({ platform: 'youtube', state: RAIL_ONLY, viewportWidth: 1920 });
    applyColumnsCss({ platform: 'youtube', state: NONE, viewportWidth: 1920 });

    expect(styleFor('youtube')).toBeNull();
    expect(document.documentElement.hasAttribute('data-kvl-columns')).toBe(false);
    expect(resizeEvents()).toHaveLength(2);
  });

  it('does not dispatch a resize on the platforms that re-layout by themselves', () => {
    const resizeEvents = spyResize();
    for (const platform of ['netflix', 'hbo', 'disney', 'prime'] as const) {
      applyColumnsCss({ platform, state: RAIL_ONLY, viewportWidth: 1920 });
      applyColumnsCss({ platform, state: NONE, viewportWidth: 1920 });
    }
    expect(resizeEvents()).toHaveLength(0);
  });

  it('is idempotent: re-applying rewrites the same node', () => {
    applyColumnsCss({ platform: 'netflix', state: RAIL_ONLY, viewportWidth: 1920 });
    const first = styleFor('netflix');
    applyColumnsCss({ platform: 'netflix', state: BOTH, viewportWidth: 2560 });
    const second = styleFor('netflix');
    expect(second).toBe(first);
    expect(second?.textContent).toContain('right: 840px !important;');
    expect(document.querySelectorAll('style[id^="kivara-columns-"]')).toHaveLength(1);
  });

  it('does not inject anything in overlay mode (narrow viewport)', () => {
    const resizeEvents = spyResize();
    applyColumnsCss({ platform: 'youtube', state: BOTH, viewportWidth: 1024 });
    expect(styleFor('youtube')).toBeNull();
    // Nothing was applied, so there is nothing to re-measure.
    expect(resizeEvents()).toHaveLength(0);
  });
});
