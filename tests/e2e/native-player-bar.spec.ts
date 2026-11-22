/**
 * Native player bar E2E: the study bar lives INSIDE the site's own control
 * row, disappears with it on inactivity, and re-inserts on remount — no
 * floating capsule while the site has a native row.
 */
import { boxesOf, hitsOf, readFixture } from './helpers';
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

const injectRow = (page: import('@playwright/test').Page, present: boolean) => page.evaluate((show) => {
  const existing = document.getElementById('fake-native-row');
  existing?.remove();
  if (!show) return;
  const row = document.createElement('div');
  row.id = 'fake-native-row';
  row.className = 'PlayerControlsNeo__bottom-controls';
  row.style.cssText = 'position:absolute;left:0;right:0;bottom:8px;height:36px;display:flex;align-items:center;justify-content:space-between';
  row.innerHTML = '<button data-uia="control-play" style="height:32px;width:32px"></button>'
    + '<button data-uia="control-audio-subtitle" style="height:32px;width:32px"></button>';
  document.querySelector('.watch-video')?.appendChild(row);
}, present);

test('the study bar mounts in the native Netflix control row and survives a resting teardown', async ({ context }) => {
  test.setTimeout(120_000);
  const page = await openNetflix(context);
  await injectRow(page, true);
  await expect.poll(
    () => page.evaluate(() => !!document.getElementById('kivara-lingo-bar-slot')),
    { timeout: 10_000 },
  ).toBe(true);

  const geom = await page.evaluate(() => {
    const slot = document.getElementById('kivara-lingo-bar-slot')!;
    const native = document.querySelector('[data-uia="control-audio-subtitle"]') as HTMLElement;
    const center = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.y + r.height / 2;
    };
    // The hit map is the only channel into the closed roots: a main-world
    return { delta: Math.abs(center(slot) - center(native)) };
  });
  expect(geom.delta).toBeLessThanOrEqual(4);
  expect((await boxesOf(page)).bar).not.toBeNull();
  const activeHits = (await hitsOf(page, 'kivara-lingo-video-host')).map((h) => h.label);
  expect(activeHits).toContain('Bucle');
  expect(activeHits).not.toContain('Pausar');
  expect(activeHits).not.toContain('Reproducir');

  // Real mouse click on the native toolbar: the site's player must not
  // pause/fullscreen from our controls (the closed-root button's own
  // aria-pressed is covered by the jsdom variant tests).
  const loopHit = (await hitsOf(page, 'kivara-lingo-video-host')).find((h) => h.label === 'Bucle')!;
  await page.mouse.click(loopHit.cx, loopHit.cy);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.querySelector('video')?.paused)).toBe(false);

  // Native teardown on inactivity: no floating fallback while the site owns
  // a native row in this session.
  await injectRow(page, false);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => !!document.getElementById('kivara-lingo-bar-slot'))).toBe(false);
  await expect.poll(async () => (await boxesOf(page)).bar, { timeout: 5_000 }).toBeNull();
  const idleHits = (await hitsOf(page, 'kivara-lingo-video-host')).map((h) => h.label);
  for (const label of ['Bucle', 'Pausar', 'Reproducir']) expect(idleHits).not.toContain(label);

  // Pointer activity re-mounts the site's row → the slot re-inserts.
  await injectRow(page, true);
  await expect.poll(
    () => page.evaluate(() => !!document.getElementById('kivara-lingo-bar-slot')),
    { timeout: 10_000 },
  ).toBe(true);
  await page.close();
});
