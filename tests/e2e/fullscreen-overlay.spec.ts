import { test, expect } from './fixtures';

test('fullscreen re-parents the mounted overlay and cleans up after itself', async ({
  context,
}) => {
  const page = await context.newPage();
  // Serve the fixture AT a matched origin so the content script actually runs.
  // A file:// or about:blank page mounts nothing, which made the previous
  // version of this spec pass without exercising the code.
  await page.route('*://*.netflix.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><body>
      <div id="stage"><video id="video" width="320" height="180"></video></div>
      <button id="focusme">focus me</button>
    </body></html>`,
    });
  });

  await page.goto('https://www.netflix.com/watch/x');

  // The overlay host must exist before anything else means something.
  const hostCount = async () =>
    page.evaluate(
      () =>
        Array.from(document.body.querySelectorAll('*')).filter((el) => el.shadowRoot !== null)
          .length,
    );
  await expect.poll(async () => await hostCount(), { timeout: 15_000 }).toBeGreaterThan(0);

  const stage = page.locator('#stage');
  const positionBefore = await stage.evaluate((el) => getComputedStyle(el).position);

  await stage.evaluate((el) => el.requestFullscreen());
  await page.waitForFunction(() => document.fullscreenElement !== null, undefined, {
    timeout: 5000,
  });
  await page.waitForTimeout(400);

  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => document.fullscreenElement === null, undefined, {
    timeout: 5000,
  });
  await page.waitForTimeout(600);

  const positionAfter = await stage.evaluate((el) => getComputedStyle(el).position);
  expect(positionAfter).toBe(positionBefore);

  const parentTags = await page.evaluate(() =>
    Array.from(document.body.querySelectorAll('*'))
      .filter((el) => el.shadowRoot !== null)
      .map((el) => el.parentElement?.tagName ?? ''),
  );
  expect(parentTags).toContain('BODY');
});
