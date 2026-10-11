import { test, expect } from './fixtures';

test('fullscreen re-parents the mounted overlay and cleans up after itself', async ({
  context,
}) => {
  const page = await context.newPage();
  try {
    // Serve the fixture at a matched origin so the content script actually runs.
    // A file:// or about:blank page mounts nothing, which made the previous
    // version of this spec pass without exercising the code.
    await page.route('*://*.netflix.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html><html><body>
      <div id="stage"><video id="video" width="320" height="180"></video></div>
      <button id="enterFullscreen">enter fullscreen</button>
      <script>
        document.getElementById('enterFullscreen').addEventListener('click', () => {
          document.getElementById('stage').requestFullscreen();
        });
      </script>
    </body></html>`,
      });
    });

    await page.goto('https://www.netflix.com/watch/x');
    await page.bringToFront();

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

    const enterFullscreen = page.getByRole('button', { name: 'enter fullscreen' });
    await enterFullscreen.focus();
    await page.bringToFront();
    await page.evaluate(() => window.focus());
    await expect.poll(
      async () => await page.evaluate(() => document.hasFocus() && document.visibilityState === 'visible'),
    ).toBe(true);
    // Keyboard activation is a real user gesture and is stable in headless Chromium;
    // a synthetic evaluate/click can lose the transient fullscreen permission.
    await enterFullscreen.press('Enter');
    await expect.poll(
      async () => await page.evaluate(() => Boolean(document.fullscreenElement)),
      { timeout: 10_000 },
    ).toBe(true);
    await expect.poll(
      async () =>
        await page.evaluate(() =>
          Array.from(document.body.querySelectorAll('*')).some(
            (el) => el.shadowRoot !== null && el.parentElement?.id === 'stage',
          ),
        ),
      { timeout: 10_000 },
    ).toBe(true);

    await page.evaluate(() => document.exitFullscreen());
    await expect.poll(
      async () => await page.evaluate(() => document.fullscreenElement === null),
      { timeout: 10_000 },
    ).toBe(true);

    const positionAfter = await stage.evaluate((el) => getComputedStyle(el).position);
    expect(positionAfter).toBe(positionBefore);

    const parentTags = await page.evaluate(() =>
      Array.from(document.body.querySelectorAll('*'))
        .filter((el) => el.shadowRoot !== null)
        .map((el) => el.parentElement?.tagName ?? ''),
    );
    expect(parentTags).toContain('BODY');
  } finally {
    await page.close();
  }
});
