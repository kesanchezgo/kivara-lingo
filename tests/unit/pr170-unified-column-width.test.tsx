/**
 * PR #170 · 3 — the transcript rail and the docked panel are ONE column: same
 * slot, same width, and swapping them never moves the right edge.
 *
 * They used to be 400 px and 440 px, so every `Transcripción ⇄ Panel Kivara`
 * switch jumped the left edge by 40 px and re-letterboxed the video. The width
 * animation was the second half of the shine: swapping animated `0 ↔ width` on
 * both columns at once, so for 300 ms the flex row reserved neither of them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import {
  PANEL_MIN_WIDTH_PX,
  PANEL_WIDTH_PX,
  RAIL_MIN_WIDTH_PX,
  RAIL_WIDTH_PX,
  STUDY_COLUMN_WIDTH_PX,
  computeColumnLayout,
} from '../../src/content/ui/columns-css';
import { SlideColumn } from '../../src/content/ui/SlideColumn';

const RAIL_ONLY = { rail: true, panel: false };
const PANEL_ONLY = { rail: false, panel: true };
const NONE = { rail: false, panel: false };

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('PR #170 · one width for both coupled columns', () => {
  it('gives the rail and the docked panel the same 420px slot', () => {
    expect(STUDY_COLUMN_WIDTH_PX).toBe(420);
    expect(RAIL_WIDTH_PX).toBe(STUDY_COLUMN_WIDTH_PX);
    expect(PANEL_WIDTH_PX).toBe(STUDY_COLUMN_WIDTH_PX);
    // The same floor too: a narrower minimum would reintroduce the jump on the
    // narrow viewports where scaling kicks in.
    expect(RAIL_MIN_WIDTH_PX).toBe(PANEL_MIN_WIDTH_PX);
  });

  it('reserves the same width for either column on every viewport — 0 px jump', () => {
    for (const viewport of [2560, 1920, 1600, 1440, 1280, 1150, 1050, 1000, 950, 900]) {
      const rail = computeColumnLayout(RAIL_ONLY, viewport);
      const panel = computeColumnLayout(PANEL_ONLY, viewport);
      expect(rail.railWidth, `rail at ${viewport}`).toBe(panel.panelWidth);
      expect(rail.reserved, `reserve at ${viewport}`).toBe(panel.reserved);
      expect(rail.overlay, `overlay at ${viewport}`).toBe(panel.overlay);
    }
    // And a closed slot reserves nothing, so opening either column moves the
    // edge exactly once, by the same amount.
    expect(computeColumnLayout(NONE, 1920).reserved).toBe(0);
    expect(computeColumnLayout(RAIL_ONLY, 1920).reserved).toBe(STUDY_COLUMN_WIDTH_PX);
  });

  it('takes the slot in the same frame when a column is swapped in', () => {
    // `instant` is what App passes when the rail hands the slot to the panel:
    // the width is applied in the same commit, with no 0px pass-through for
    // the video to measure.
    const view = render(
      <SlideColumn open={false} instant widthPx={STUDY_COLUMN_WIDTH_PX}>
        <div data-testid="swap-child">rail</div>
      </SlideColumn>,
    );
    expect(screen.queryByTestId('swap-child')).toBeNull();

    view.rerender(
      <SlideColumn open instant widthPx={STUDY_COLUMN_WIDTH_PX}>
        <div data-testid="swap-child">rail</div>
      </SlideColumn>,
    );
    const outer = screen.getByTestId('swap-child').parentElement!.parentElement!;
    expect(outer.style.width, 'the slot is taken before any frame passes').toBe(`${STUDY_COLUMN_WIDTH_PX}px`);
    expect(outer.className, 'and it is not left collapsed').not.toContain('w-0');
    // The content carries the transition instead of the width.
    expect(outer.className).toContain('duration-150');
  });

  it('still animates the width when a column opens from closed', () => {
    // Opening from "no column" keeps the 0 → 420 slide: there is no handover to
    // hide, and the animation is what tells the user the video is giving up
    // room. (An open from closed must NOT jump.)
    const view = render(
      <SlideColumn open={false} widthPx={STUDY_COLUMN_WIDTH_PX}>
        <div data-testid="open-child">rail</div>
      </SlideColumn>,
    );
    view.rerender(
      <SlideColumn open widthPx={STUDY_COLUMN_WIDTH_PX}>
        <div data-testid="open-child">rail</div>
      </SlideColumn>,
    );
    const outer = screen.getByTestId('open-child').parentElement!.parentElement!;
    expect(outer.style.width, 'the column starts collapsed and the rAF grows it').toBe('');
    expect(outer.className).toContain('duration-300');
  });
});

describe('PR #170 · the swap does not disturb the panel that is already open', () => {
  it('keeps the content of the incoming column mounted through the handover', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id as unknown as NodeJS.Timeout));
    const view = render(
      <>
        <SlideColumn open instant widthPx={STUDY_COLUMN_WIDTH_PX}>
          <div data-testid="rail-pane">rail</div>
        </SlideColumn>
        <SlideColumn open={false} instant widthPx={STUDY_COLUMN_WIDTH_PX}>
          <div data-testid="panel-pane">panel</div>
        </SlideColumn>
      </>,
    );
    expect(screen.getByTestId('rail-pane')).toBeTruthy();
    // Swap: the rail leaves, the panel takes the slot in the same frame.
    view.rerender(
      <>
        <SlideColumn open={false} instant widthPx={STUDY_COLUMN_WIDTH_PX}>
          <div data-testid="rail-pane">rail</div>
        </SlideColumn>
        <SlideColumn open instant widthPx={STUDY_COLUMN_WIDTH_PX}>
          <div data-testid="panel-pane">panel</div>
        </SlideColumn>
      </>,
    );
    const panelOuter = screen.getByTestId('panel-pane').parentElement!.parentElement!;
    expect(panelOuter.style.width).toBe(`${STUDY_COLUMN_WIDTH_PX}px`);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(screen.getByTestId('panel-pane')).toBeTruthy();
  });
});
