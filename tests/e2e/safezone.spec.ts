/**
 * Point 5 e2e — the StudyBar respects the platform's SAFE ZONE.
 *
 * The fixture paints FAKE native chrome using the YouTube selectors the
 * safe-zone actually queries: a top bar and a bottom control row, inside the
 * player frame. The assertions:
 *  1. the bar never intersects either native band (at 640×360 AND 1280×720);
 *  2. the B3/B6 guarantee holds — no subtitle token under the bar.
 *
 * RED before: the bar parked at a fixed `top: 12 / bottom: 12`, which sat
 * inside the native bands.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures';
import { openPlayer, readFixture, boxesOf, overlaps, parkAt, waitForLine, armBar } from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXTRA = `
  <div class="ytp-chrome-top" style="position:absolute;top:0;left:0;right:0;height:40px;z-index:59;background:rgba(0,0,0,.6)"></div>
  <div class="ytp-chrome-bottom" style="position:absolute;bottom:0;left:0;right:0;height:48px;z-index:59;background:rgba(0,0,0,.6)"></div>
`;

const FIXTURE = readFixture('player-dual.html').replace(
  '      </video>\n    </div>',
  '      </video>\n' + EXTRA + '    </div>',
);

test.describe('point 5: the bar respects the safe zone', () => {
  for (const size of [{ width: 640, height: 360 }, { width: 1280, height: 720 }] as const) {
    test(`the bar clears the fake native chrome at ${size.width}×${size.height}`, async ({ context }) => {
      test.setTimeout(90_000);
      const page = await openPlayer(context, { fixture: FIXTURE });
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.addStyleTag({ content: '#stage{width:100vw !important;height:100vh !important;max-height:100vh}' });
      await parkAt(page, 1.2);
      await waitForLine(page, 'Hello this is a test cue');
      await armBar(page);
      await expect.poll(async () => (await boxesOf(page)).tokens.length, { timeout: 8_000 })
        .toBeGreaterThan(2);

      const { bar, tokens } = await boxesOf(page);
      expect(bar).toBeTruthy();

      // The native bands, in viewport coordinates.
      const bands = await page.evaluate(() => {
        const out: Array<{ x: number; y: number; width: number; height: number }> = [];
        for (const sel of ['.ytp-chrome-top', '.ytp-chrome-bottom']) {
          const el = document.querySelector<HTMLElement>(sel);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) out.push({ x: r.x, y: r.y, width: r.width, height: r.height });
        }
        return out;
      });
      expect(bands.length).toBe(2);

      for (const band of bands) {
        const hit = band.y < 100
          ? 'the bar intersects the NATIVE TOP bar'
          : 'the bar intersects the NATIVE BOTTOM controls';
        expect(overlaps(bar!, band), hit).toBe(false);
      }
      // B3/B6 holds with the safe zone in play.
      const covered = tokens.filter((token) => overlaps(bar!, token));
      expect(covered, `${covered.length} token(s) under the bar`).toEqual([]);
      await page.close();
    });
  }
});

test('the safezone fixture really paints the fake chrome', () => {
  const html = fs.readFileSync(path.join(process.cwd(), 'tests/e2e/fixtures/player-dual.html'), 'utf8');
  // The spec builds the fixture from player-dual + EXTRA; assert the pieces.
  expect(html).toContain('kivara-behaviour');
  expect(FIXTURE).toContain('ytp-chrome-top');
  expect(FIXTURE).toContain('ytp-chrome-bottom');
});
