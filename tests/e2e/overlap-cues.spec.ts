/**
 * Overlapping cues, end to end.
 *
 * Verified with this fixture and a TTML carrying A 0–3 s and B 2.3–5 s: at
 * 2.6 s Kivara showed only A and B appeared at 3.4 s — when A ended. The
 * second line has to appear at its own start.
 *
 * The playhead is parked at each instant so the assertion is about the cue
 * set, not about timing luck.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures';
import { readFixture, stateOf, VIDEO_HOST, PANEL_HOST } from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFixture('player-netflix.html');

/** A 0–3 s and B 2.3–5 s: the exact overlap the QA reported. */
const OVERLAP_TTML = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="en">
  <body>
    <div>
      <p begin="0s" end="3s">FIRST LINE</p>
      <p begin="2.3s" end="5s">SECOND LINE</p>
    </div>
  </body>
</tt>`;

async function openNetflix(context: import('@playwright/test').BrowserContext) {
  const page = await context.newPage();
  await page.route('*://*.nflxvideo.net/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/xml',
      headers: { 'access-control-allow-origin': '*' },
      body: OVERLAP_TTML,
    });
  });
  await page.route('*://*.netflix.com/**', async (route) => {
    if (route.request().url().includes('/watch/')) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: FIXTURE });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html></html>' });
  });
  await page.goto('https://www.netflix.com/watch/82939619');
  await page.bringToFront();
  await page.waitForFunction(
    () => (window as Window & { __kivaraFixtureReady?: unknown }).__kivaraFixtureReady !== undefined,
    undefined,
    { timeout: 30_000 },
  );
  await expect
    .poll(() => page.evaluate((ids) => ids.every((id) => document.getElementById(id) !== null), [PANEL_HOST, VIDEO_HOST]), { timeout: 15_000 })
    .toBe(true);
  return page;
}

/** Park the playhead and read the caption the overlay is showing. */
async function captionAt(page: import('@playwright/test').Page, seconds: number): Promise<string> {
  await page.evaluate((s) => {
    const v = document.querySelector('video');
    if (!v) return;
    v.pause();
    v.currentTime = s;
  }, seconds);
  await page.waitForTimeout(1_200);
  return (await stateOf(page, VIDEO_HOST)).caption;
}

test('a second line that overlaps the first appears at its own start', async ({ context }) => {
  const page = await openNetflix(context);
  try {
    // 2.6 s: both lines are on screen.
    const both = await captionAt(page, 2.6);
    expect(both).toContain('FIRST LINE');
    expect(both).toContain('SECOND LINE');

    // 3.4 s: the first line is over, the second is still there.
    const secondOnly = await captionAt(page, 3.4);
    expect(secondOnly).toContain('SECOND LINE');
    expect(secondOnly).not.toContain('FIRST LINE');

    // 1.0 s: only the first line, at the start.
    const firstOnly = await captionAt(page, 1.0);
    expect(firstOnly).toContain('FIRST LINE');
    expect(firstOnly).not.toContain('SECOND LINE');
  } finally {
    await page.close();
  }
});

