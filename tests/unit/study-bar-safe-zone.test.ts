/** Intersects + expand live in overlay-geometry; expand was private — the
 * safe-zone needs it for the air between the bar and the native chrome. */
import { describe, expect, it } from 'vitest';
import { placeStudyBar, safeZoneFor } from '../../src/content/ui/study-bar-safe-zone';

const HOST = { x: 0, y: 0, width: 1280, height: 720 };
const BAR = { width: 260, height: 30 };

describe('placeStudyBar (point 5)', () => {
  it('keeps the platform margins: netflix clears the top bar and the bottom controls', () => {
    const controls = [
      { x: 0, y: 0, width: 1280, height: 60 }, // top bar
      { x: 0, y: 650, width: 1280, height: 70 }, // bottom controls
    ];
    const placement = placeStudyBar({
      host: HOST,
      caption: null,
      bar: BAR,
      zone: safeZoneFor('netflix'),
      controls,
    });
    const top = placement.top ?? HOST.height - placement.bottom! - BAR.height;
    // The bar must sit between the two chrome bands.
    expect(top).toBeGreaterThan(60);
    expect(top + BAR.height).toBeLessThan(650);
  });

  it('shifts vertically within the half when a native control intersects the slot', () => {
    // A «Saltar intro» band right where the bottom slot would go.
    const controls = [
      { x: 0, y: 560, width: 1280, height: 80 },
      { x: 0, y: 650, width: 1280, height: 70 },
    ];
    const placement = placeStudyBar({
      host: HOST,
      caption: null,
      bar: BAR,
      zone: safeZoneFor('netflix'),
      controls,
    });
    const top = placement.top ?? HOST.height - placement.bottom! - BAR.height;
    const barRect = { x: HOST.width - 24 - BAR.width, y: top, width: BAR.width, height: BAR.height };
    for (const c of controls) {
      const overlap = !(barRect.x + barRect.width < c.x || c.x + c.width < barRect.x
        || barRect.y + barRect.height < c.y || c.y + c.height < barRect.y);
      expect(overlap, `bar overlaps control at y=${c.y}`).toBe(false);
    }
  });

  it('never covers the caption plate (the B3/B6 guarantee)', () => {
    const caption = { x: 200, y: 580, width: 400, height: 60 };
    const placement = placeStudyBar({
      host: HOST,
      caption,
      bar: BAR,
      zone: safeZoneFor('netflix'),
      controls: [],
    });
    const top = placement.top ?? HOST.height - placement.bottom! - BAR.height;
    const barRect = { x: HOST.width - 24 - BAR.width, y: top, width: BAR.width, height: BAR.height };
    const overlap = !(barRect.x + barRect.width < caption.x || caption.x + caption.width < barRect.x
      || barRect.y + barRect.height < caption.y || caption.y + caption.height < barRect.y);
    expect(overlap).toBe(false);
  });

  it('parks on the half opposite the caption', () => {
    // Caption at the bottom → the bar goes top, and vice versa.
    const captionBottom = { x: 200, y: 580, width: 400, height: 60 };
    const topPlacement = placeStudyBar({
      host: HOST, caption: captionBottom, bar: BAR, zone: safeZoneFor('netflix'), controls: [],
    });
    expect(topPlacement.side).toBe('top');
    const captionTop = { x: 200, y: 40, width: 400, height: 60 };
    const bottomPlacement = placeStudyBar({
      host: HOST, caption: captionTop, bar: BAR, zone: safeZoneFor('netflix'), controls: [],
    });
    expect(bottomPlacement.side).toBe('bottom');
    expect(bottomPlacement.bottom).toBeGreaterThanOrEqual(110);
  });

  it('prime keeps the icon-cluster margin on the right', () => {
    const placement = placeStudyBar({
      host: HOST,
      caption: null,
      bar: BAR,
      zone: safeZoneFor('prime'),
      controls: [],
    });
    const top = placement.top ?? HOST.height - placement.bottom! - BAR.height;
    const x = HOST.width - safeZoneFor('prime').margins.right - BAR.width;
    expect(x).toBeLessThanOrEqual(HOST.width - 140 - BAR.width + 1);
    expect(top).toBeGreaterThan(0);
  });

  it('a crowded frame falls back to the plain margins instead of throwing', () => {
    const controls = [
      { x: 0, y: 0, width: 1280, height: 400 },
      { x: 0, y: 400, width: 1280, height: 400 },
    ];
    const placement = placeStudyBar({
      host: HOST,
      caption: { x: 400, y: 640, width: 500, height: 60 },
      bar: BAR,
      zone: safeZoneFor('netflix'),
      controls,
    });
    expect(placement).toBeTruthy();
  });
});
