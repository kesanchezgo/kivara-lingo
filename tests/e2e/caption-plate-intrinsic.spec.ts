/**
 * PR #167 — the caption plate hugs its text.
 *
 * A one-to-three-word subtitle with `backgroundOpacity > 0` must paint only
 * behind the text: the plate's width is intrinsic (`w-fit max-w-full`), never
 * the player's width. A full-width plate would paint a black band across the
 * video, fire hover on empty video and pin `align: left` text to the edge.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures';
import { boxesOf, openPlayer, parkAt, readFixture, VIDEO_HOST, waitForLine } from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFixture('player-seekable.html');

const json3 = (lines: readonly string[]) => JSON.stringify({
  events: lines.map((text, index) => ({
    tStartMs: index * 3000, dDurationMs: 3000, segs: [{ utf8: text }],
  })),
});

// Line 1 is deliberately THREE words: the plate must shrink to it.
const EN = ['Run home now', 'The rat ships frames and audio', 'Every crumb gets gnawed'];

test('a 3-word caption paints a plate that hugs the text, not the player', async ({ context }) => {
  test.setTimeout(120_000);
  const page = await openPlayer(context, {
    fixture: FIXTURE,
    vtt: `WEBVTT

00:00:00.000 --> 00:00:09.000
Run home now
`,
    timedtext: () => json3(EN),
  });
  try {
    await page.waitForFunction(
      () => (window as Window & { __kivaraFixtureReady?: unknown }).__kivaraFixtureReady !== undefined,
      undefined, { timeout: 30_000 },
    );
    await page.evaluate(() => document.fonts.ready);
    await parkAt(page, 1);
    await waitForLine(page, 'Run home now');
    await page.waitForTimeout(600);

    const boxes = await boxesOf(page, VIDEO_HOST);
    const tokens = boxes.tokens.filter((t) => t.text.length > 0);
    expect(tokens.length).toBeGreaterThanOrEqual(3);
    const left = Math.min(...tokens.map((t) => t.x));
    const right = Math.max(...tokens.map((t) => t.x + t.width));
    const textWidth = right - left;

    // The painted plate is inside the closed root: the E2E bridge publishes
    // its box next to the tokens. It must hug the text (px-4 = 32px of
    // padding each side at most) and never reach the player's edges.
    const plate = boxes.plate;
    expect(plate, 'the box map publishes the caption plate').not.toBeNull();
    expect(plate!.width).toBeLessThan(textWidth + 120);
    expect(plate!.width).toBeLessThan(480);
    // And it is centred on the text it carries, not stretched.
    const plateCenter = plate!.x + plate!.width / 2;
    expect(Math.abs(plateCenter - (left + right) / 2)).toBeLessThan(40);
  } finally {
    await page.close();
  }
});
