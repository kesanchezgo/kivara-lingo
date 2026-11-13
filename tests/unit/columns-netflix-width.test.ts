/**
 * Netflix's column reservation must use the WIDTH mechanism, not `right`.
 *
 * Live-measured on a real Netflix watch page (2026-11, Chrome 157): the
 * player containers (`.watch-video`, `.watch-video--player-view`,
 * `[data-uia="watch-video"]`) are `position: absolute` with an explicit
 * width, so `right: Npx` is over-constrained and does NOTHING — the video
 * stayed at 2246×1080 with the rule applied. The columns then float OVER the
 * video and cover Netflix's own control row, which is what the owner saw:
 * "no puedo activar subtítulos porque tapa el reproductor".
 *
 * `width: calc(100% - Npx)` DOES move the player (video 2246→1406 wide) —
 * the same mechanism the youtube rule already uses.
 */
import { describe, expect, it } from 'vitest';
import { computeColumnLayout, buildColumnsCss, type ColumnVisibility } from '../../src/content/ui/columns-css';

const RAIL_ONLY: ColumnVisibility = { rail: true, panel: false };
const BOTH: ColumnVisibility = { rail: true, panel: true };

describe('buildColumnsCss: netflix uses the width mechanism', () => {
  it('reserves space with width, like youtube — right would be a no-op', () => {
    const rail = computeColumnLayout(RAIL_ONLY, 1920);
    const css = buildColumnsCss({ platform: 'netflix', state: RAIL_ONLY, viewportWidth: 1920 });
    expect(css).toContain(`width: calc(100% - ${rail.reserved}px) !important;`);
    expect(css).not.toContain('right:');
  });

  it('still targets Netflix\'s real player containers', () => {
    const css = buildColumnsCss({ platform: 'netflix', state: BOTH, viewportWidth: 2560 });
    for (const sel of ['.watch-video', '.watch-video--player-view', '[data-uia="watch-video"]']) {
      expect(css).toContain(sel);
    }
    const both = computeColumnLayout(BOTH, 2560);
    expect(css).toContain(`width: calc(100% - ${both.reserved}px) !important;`);  });
});
