/**
 * Netflix uses the Kivara-owned player bar from the prototype: a full-width
 * bottom chrome layer delegated to the real Netflix playback bridge. The
 * native control row stays in the DOM but is hidden, and no tiny inline slot
 * is injected into it.
 */
import { boxesOf, hitsOf, readFixture, VIDEO_HOST } from './helpers';
import { expect, test } from './fixtures';

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

test('Netflix mounts the owned mock-fidelity bar, not an inline slot', async ({ context }) => {
  test.setTimeout(120_000);
  const page = await openNetflix(context);

  await expect.poll(
    () => page.evaluate(() => !!document.getElementById('kivara-owned-bar-netflix')),
    { timeout: 10_000 },
  ).toBe(true);
  expect(await page.evaluate(() => !!document.getElementById('kivara-lingo-bar-slot'))).toBe(false);

  const labels = (await hitsOf(page, VIDEO_HOST)).map((hit) => hit.label);
  expect(labels).toContain('Bucle');
  expect(labels).toContain('0.75×');
  expect(labels).toContain('1×');
  expect(labels).toContain('1.25×');
  expect((await boxesOf(page)).bar).not.toBeNull();

  const loopHit = (await hitsOf(page, VIDEO_HOST)).find((hit) => hit.label === 'Bucle')!;
  await page.mouse.click(loopHit.cx, loopHit.cy);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.querySelector('video')?.paused)).toBe(false);

  // The owned bar does not depend on the site's auto-hide cycle.
  await page.waitForTimeout(400);
  expect((await hitsOf(page, VIDEO_HOST)).map((hit) => hit.label)).toContain('Bucle');
  await page.close();
});
