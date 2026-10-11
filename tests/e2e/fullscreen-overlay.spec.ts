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
          document.getElementById('stage').requestFullscreen().catch((error) => {
            window.__kivaraFullscreenError = String(error);
          });
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
      { timeout: 10_000 },
    ).toBe(true);
    // Keyboard activation is a real user gesture, which a synthetic
    // evaluate/click is not. Headless Chromium still drops the transient
    // activation between the keypress and the call once in a while, answering
    // `TypeError: not granted` -- so retry with fresh gestures and report the
    // last refusal instead of timing out on a poll.
    let entered = false;
    let lastRefusal: string | null = null;
    for (let attempt = 1; attempt <= 5 && !entered; attempt++) {
      await page.bringToFront();
      await enterFullscreen.press('Enter');
      const state = await page.evaluate(() => ({
        fullscreen: Boolean(document.fullscreenElement),
        error: (window as Window & { __kivaraFullscreenError?: string }).__kivaraFullscreenError ?? null,
      }));
      entered = state.fullscreen;
      lastRefusal = state.error;
    }
    expect(entered, `fullscreen refused after 5 gestures: ${lastRefusal}`).toBe(true);
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

    // The reparent lives in the extension's own fullscreenchange handler, so
    // the exit race is the intermediate state a single read could catch:
    // `fullscreenElement` already null while the hosts still sit inside the
    // stage and the stage still carries the override position.
    await expect.poll(
      async () => await stage.evaluate((el) => getComputedStyle(el).position),
      { timeout: 10_000 },
    ).toBe(positionBefore);
    await expect.poll(
      async () =>
        await page.evaluate(() =>
          Array.from(document.body.querySelectorAll('*'))
            .filter((el) => el.shadowRoot !== null)
            .map((el) => el.parentElement?.tagName ?? ''),
        ),
      { timeout: 10_000 },
    ).toContain('BODY');
  } finally {
    await page.close();
  }
});
