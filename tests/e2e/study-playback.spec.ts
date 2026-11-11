/**
 * F6 study playback, end to end on a SEEKABLE local clip
 * (docs/REDESIGN-V2.md §7 F6 "puerta extra" y §8).
 *
 * What runs: the BUILT extension inside Chromium, mounted on a page served at a
 * matched origin (`https://www.youtube.com/watch?...`) so the content script
 * actually injects. The page records a ~6.5 s clip from a canvas with
 * MediaRecorder, so the video has a real duration and seeking works — the
 * `canvas.captureStream()` of the original fixture is live and cannot seek.
 *
 * The controls are driven through the REAL page shortcuts (Alt+Z next, Alt+Q
 * auto-pause, Alt+L loop, Alt+. speed). That is the same handler the transcript
 * rail calls: the rail lives inside a CLOSED shadow root, so a Playwright
 * locator cannot click it — its click → seek wiring is covered by the component
 * test in `tests/unit/transcript-rail.test.tsx`, and the controller seek itself
 * by the tests below.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from './fixtures';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = fs.readFileSync(path.join(here, 'fixtures', 'player-seekable.html'), 'utf8');

const CUES_VTT = `WEBVTT

00:00:00.000 --> 00:00:03.000
Hello, this is a test cue.

00:00:03.000 --> 00:00:06.000
The rat ships frames and audio.

00:00:06.000 --> 00:00:09.000
Every crumb gets gnawed.
`;

async function openPlayer(context: { newPage(): Promise<Page> }): Promise<Page> {
  const page = await context.newPage();
  await page.route('*://*.youtube.com/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('cues.vtt')) {
      await route.fulfill({ status: 200, contentType: 'text/vtt', body: CUES_VTT });
      return;
    }
    if (url.includes('/watch')) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: FIXTURE });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html></html>' });
  });
  await page.goto('https://www.youtube.com/watch?v=kivara-f6');
  await page.bringToFront();
  await page.waitForFunction(
    () => (window as Window & { __kivaraFixtureReady?: unknown }).__kivaraFixtureReady === true,
    undefined,
    { timeout: 30_000 },
  );
  // The overlay host proves the content script mounted the App on this page.
  await expect
    .poll(() => page.evaluate(() => document.querySelectorAll('#kivara-lingo-host').length), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  await page.waitForFunction(() => document.querySelector('video')!.currentTime > 0.02);
  return page;
}

const time = (page: Page) => page.evaluate(() => document.querySelector('video')!.currentTime);
const paused = (page: Page) => page.evaluate(() => document.querySelector('video')!.paused);
const rate = (page: Page) => page.evaluate(() => document.querySelector('video')!.playbackRate);

test.describe('study playback over the PlaybackController', () => {
  test('next line seeks through the controller', async ({ context }) => {
    test.setTimeout(90_000);
    const page = await openPlayer(context);
    await page.keyboard.press('Alt+Z');
    await expect.poll(() => time(page), { timeout: 8_000 }).toBeGreaterThan(2.8);
    expect(await time(page)).toBeLessThan(4.5);
    await page.close();
  });

  test('auto-pause stops at the end of the cue', async ({ context }) => {
    test.setTimeout(90_000);
    const page = await openPlayer(context);
    await page.keyboard.press('Alt+Q');
    await expect.poll(() => paused(page), { timeout: 12_000 }).toBe(true);
    const at = await time(page);
    expect(at).toBeGreaterThanOrEqual(2.85);
    expect(at).toBeLessThanOrEqual(3.6);
    await page.close();
  });

  test('loop returns to the start of the cue', async ({ context }) => {
    test.setTimeout(90_000);
    const page = await openPlayer(context);
    await page.keyboard.press('Alt+L');
    await page.waitForTimeout(4500);
    expect(await paused(page)).toBe(false);
    // It crossed 3 s at least once and came back; without loop it would be past 4.
    expect(await time(page)).toBeLessThan(4);
    await page.close();
  });

  test('speed steps through 0.75 / 1 / 1.25', async ({ context }) => {
    test.setTimeout(90_000);
    const page = await openPlayer(context);
    await page.keyboard.press('Alt+.');
    await expect.poll(() => rate(page), { timeout: 5_000 }).toBeCloseTo(1.25, 3);
    await page.keyboard.press('Alt+,');
    await expect.poll(() => rate(page), { timeout: 5_000 }).toBeCloseTo(1, 3);
    await page.close();
  });
});
