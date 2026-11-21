/**
 * RED TESTS — mock fidelity (base main@a30d854).
 * The prototype in .mock/ is the visual contract; these pin four deviations
 * reported on the live Netflix session.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildColumnsCss, computeColumnLayout } from '../../src/content/ui/columns-css';
import { placeStudyBar, safeZoneFor } from '../../src/content/ui/study-bar-safe-zone';
import { placeBadgeGroup } from '../../src/content/ui/overlay-geometry';

const HOST = { x: 0, y: 0, width: 1280, height: 720 };
const BAR = { width: 260, height: 30 };

describe('1 — no double width reservation on Netflix', () => {
  it('only shrinks the OUTERMOST player container, never its nested child', () => {
    const css = buildColumnsCss({
      platform: 'netflix',
      state: { rail: true, panel: false },
      viewportWidth: 1920,
    });
    const layout = computeColumnLayout({ rail: true, panel: false }, 1920);
    expect(css).toContain(`width: calc(100% - ${layout.reserved}px) !important;`);
    expect(css).not.toContain('.watch-video--player-view');
  });
});

describe('2 — the study bar stays where the mock puts it', () => {
  it('the bar never flips to the top, even when the caption is in the bottom half', () => {
    const placement = placeStudyBar({
      host: HOST,
      caption: { x: 300, y: 560, width: 600, height: 60 },
      bar: BAR,
      zone: safeZoneFor('netflix'),
      controls: [],
    });
    expect(placement.side).toBe('bottom');
    const top = placement.top ?? HOST.height - placement.bottom! - BAR.height;
    expect(top).toBeGreaterThanOrEqual(HOST.height / 2);
  });

  it('the badges stay at the top-right corner per the mock', () => {
    const p = placeBadgeGroup(
      HOST,
      { x: 300, y: 560, width: 600, height: 60 },
      { width: 72, height: 32 },
      'bottom',
      { x: 900, y: 560, width: 300, height: 40 },
    );
    // top-4/right-4 of a 1280x720 host (MARGIN=16 in the geometry module).
    expect(p.x).toBeGreaterThanOrEqual(1280 - 72 - 20);
    expect(p.y).toBeLessThanOrEqual(20);
  });
});

describe('3 — word marks follow the mock token design', () => {
  it('the subtitle token uses only the status mark — no invented saved border or check', () => {
    const src = readFileSync('src/content/ui/SubtitleOverlay.tsx', 'utf-8');
    expect(src).not.toContain('border-emerald-400/70');
    expect(src).not.toContain('decoration-violet-300/40');
  });
});
