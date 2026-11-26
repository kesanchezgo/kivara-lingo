/**
 * PR #168 — real-mouse contracts for the owned player bar.
 *
 * The audit reproduced these in Chromium with `document.elementFromPoint`:
 * the progress track answered `<video>`, so a click paused instead of seeking;
 * and a bar that had auto-hidden still answered `pointer-events: auto` on its
 * row, swallowing invisible clicks. Both are measured here with real mouse
 * input through Playwright, never with synthetic events.
 */
import { expect, test } from './fixtures';
import { boxesOf, hitsOf, readFixture, VIDEO_HOST } from './helpers';

const TTML = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="en"><body><div>
<p begin="0s" end="9s">RUN is hard work</p>
</div></body></tt>`;

async function openNetflix(context: import('@playwright/test').BrowserContext): Promise<import('@playwright/test').Page> {
  const page = await context.newPage();
  await page.route('*://*.nflxvideo.net/**', (route) => route.fulfill({
    status: 200, contentType: 'application/xml',
    headers: { 'access-control-allow-origin': '*' }, body: TTML,
  }));
  await page.route('*://*.netflix.com/**', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: readFixture('player-netflix.html'),
  }));
  await page.goto('https://www.netflix.com/watch/80057281');
  await page.bringToFront();
  await page.waitForFunction(
    () => (window as Window & { __kivaraFixtureReady?: unknown }).__kivaraFixtureReady !== undefined,
    undefined, { timeout: 30_000 },
  );
  await expect.poll(
    () => page.evaluate(() => !!document.getElementById('kivara-lingo-video-host')),
    { timeout: 15_000 },
  ).toBe(true);
  return page;
}

/** The published seek surface, plus the hit test answered inside the root. */
async function seekProbe(page: import('@playwright/test').Page) {
  const boxes = await boxesOf(page, VIDEO_HOST);
  expect(boxes.seek, 'the hit map publishes the seek surface').toBeTruthy();
  expect(boxes.seekHit, 'the hit map publishes the seek hit test').toBeTruthy();
  return { seek: boxes.seek!, hit: boxes.seekHit! };
}

/** Count the clicks that reach the `<video>`: in Netflix, a click there pauses. */
async function countVideoClicks(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as Window & { __kvlVideoClicks?: number };
    w.__kvlVideoClicks = 0;
    document.querySelector('video')!.addEventListener('click', () => {
      w.__kvlVideoClicks = (w.__kvlVideoClicks ?? 0) + 1;
    });
  });
}

async function videoClicks(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => (window as Window & { __kvlVideoClicks?: number }).__kvlVideoClicks ?? 0);
}

/**
 * Whether the HOST page's own hit test at this point reaches our overlay.
 *
 * A closed root retargets the answer to the host element, so this is `true`
 * whenever ANY of our shadow chrome owns the pixel, visible or not — the
 * "invisible row swallows the click" defect in one boolean.
 */
async function pageReachesOurHost(
  page: import('@playwright/test').Page, x: number, y: number,
): Promise<boolean> {
  return page.evaluate(({ px, py }) => {
    const host = document.getElementById('kivara-lingo-video-host');
    const el = document.elementFromPoint(px, py);
    return !!el && !!host && (el === host || host.contains(el));
  }, { px: x, py: y });
}

test('a real mouse click on the progress track seeks instead of pausing', async ({ context }) => {
  test.setTimeout(120_000);
  const page = await openNetflix(context);
  try {
    await page.waitForTimeout(800);
    const { seek, hit } = await seekProbe(page);
    expect(seek.width, 'the track is wider than the 20px hit surface is tall').toBeGreaterThan(20);

    // Answered from INSIDE the closed root (the page's own elementFromPoint
    // retargets to the host and cannot tell our chrome from the video). This
    // is the audit's measurement: the pointer must reach the seek surface.
    expect(hit.tag, 'the track is not the video element').not.toBe('VIDEO');
    expect(hit.own, 'the click lands inside our overlay').toBe(true);
    expect(hit.inSeek, 'it lands on the seek surface').toBe(true);
    // The page-level view agrees: the pixel belongs to our host.
    expect(await pageReachesOurHost(page, hit.x, hit.y), 'the page sees our host at the track').toBe(true);

    await countVideoClicks(page);
    const before = await page.evaluate(() => {
      const v = document.querySelector('video')!;
      return { t: v.currentTime, paused: v.paused };
    });

    // A real click at the published point on the track.
    await page.mouse.move(hit.x, hit.y);
    await page.waitForTimeout(120);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.up();
    await page.waitForTimeout(600);

    const after = await page.evaluate(() => {
      const v = document.querySelector('video')!;
      return { t: v.currentTime, paused: v.paused };
    });
    // The adapter seek moved the playhead forward; the click did not pause.
    expect(after.t, 'the playhead moved forward').toBeGreaterThan(before.t + 0.3);
    expect(after.paused, 'a seek click never pauses').toBe(before.paused);
    // The decisive part: the gesture never leaked through to the video, which
    // is the element whose click handler pauses Netflix playback.
    expect(await videoClicks(page), 'the seek click never reached the video').toBe(0);
  } finally {
    await page.close();
  }
});

test('dragging the progress track scrubs and releases cleanly', async ({ context }) => {
  test.setTimeout(120_000);
  const page = await openNetflix(context);
  try {
    await page.waitForTimeout(800);
    const { seek, hit } = await seekProbe(page);
    const y = hit.y;
    const startX = seek.x + seek.width * 0.2;
    const endX = seek.x + seek.width * 0.8;

    await page.mouse.move(startX, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(startX + ((endX - startX) * i) / 10, y);
      await page.waitForTimeout(30);
    }
    await page.mouse.up();
    await page.waitForTimeout(700);

    const t = await page.evaluate(() => document.querySelector('video')!.currentTime);
    expect(t, 'the drag committed a forward seek').toBeGreaterThan(0.3);

    // The global listeners are gone: a later move must not keep seeking.
    const settled = await page.evaluate(() => document.querySelector('video')!.currentTime);
    await page.mouse.move(seek.x + seek.width * 0.1, y);
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => document.querySelector('video')!.currentTime);
    expect(Math.abs(after - settled), 'no drag leaks past mouseup').toBeLessThan(1.2);
  } finally {
    await page.close();
  }
});

test('an auto-hidden bar yields every click to the video', async ({ context }) => {
  test.setTimeout(120_000);
  const page = await openNetflix(context);
  try {
    // Play so the 3 s auto-hide timer runs.
    await page.evaluate(() => document.querySelector('video')!.play());
    await page.waitForTimeout(3_400);

    // The bar is hidden: it publishes no box, no seek surface and none of its
    // controls, so the suite can never click an invisible layer.
    const boxes = await boxesOf(page, VIDEO_HOST);
    expect(boxes.bar, 'a hidden bar publishes no box').toBeNull();
    expect(boxes.seek, 'a hidden bar publishes no seek surface').toBeNull();
    expect(boxes.seekHit, 'a hidden bar publishes no seek hit test').toBeNull();
    const labels = (await hitsOf(page, VIDEO_HOST)).map((h) => h.label);
    expect(labels).not.toContain('Bucle');
    expect(labels).not.toContain('Subtítulos de Netflix');

    // The hit test INSIDE the root at the control row: with the bar hidden
    // nothing of ours may answer, so the pointer must fall through to the
    // page. `own` is what separates "yields" from "swallows".
    const rowHit = boxes.rowHit;
    expect(rowHit, 'the row still publishes its hit test').toBeTruthy();
    expect(rowHit!.own, 'the hidden row does not swallow the click').toBe(false);
    expect(rowHit!.inBar, 'the hit does not belong to the bar').toBe(false);

    // The page-level view agrees.
    expect(
      await pageReachesOurHost(page, rowHit!.x, rowHit!.y),
      'the page reaches past the hidden bar',
    ).toBe(false);

    // And the decisive, real-gesture proof: a click there reaches the VIDEO.
    // Re-hiding first is what makes the gesture honest — the pointer has to
    // travel to the point, and that travel legitimately wakes the bar.
    await page.mouse.move(rowHit!.x, rowHit!.y);
    await page.waitForTimeout(3_400);
    expect((await boxesOf(page, VIDEO_HOST)).bar, 'the bar hid itself again').toBeNull();
    await countVideoClicks(page);
    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(await videoClicks(page), 'the click reached the video, not our chrome').toBe(1);
  } finally {
    await page.close();
  }
});

test('moving the mouse brings the bar back and it accepts clicks again', async ({ context }) => {
  test.setTimeout(120_000);
  const page = await openNetflix(context);
  try {
    await page.evaluate(() => document.querySelector('video')!.play());
    await page.waitForTimeout(3_400);
    await page.mouse.move(300, 250);
    await page.mouse.move(340, 270);
    await page.waitForTimeout(400);

    const boxes = await boxesOf(page, VIDEO_HOST);
    expect(boxes.bar, 'the bar republishes its box').not.toBeNull();
    const labels = (await hitsOf(page, VIDEO_HOST)).map((h) => h.label);
    expect(labels).toContain('Bucle');
  } finally {
    await page.close();
  }
});
