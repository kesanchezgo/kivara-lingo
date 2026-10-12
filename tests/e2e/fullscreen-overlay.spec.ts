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
    //
    // Counted by ELEMENT ID, not by `el.shadowRoot !== null`: the roots are
    // closed (see content/shadow-host.ts — a page-readable root is how the
    // API-key fields used to leak), and a closed root is invisible to that
    // query from the page's side. The host itself is still page DOM, which is
    // exactly what this assertion is about: that we mounted, and where.
    const hostCount = async () =>
      page.evaluate(
        () =>
          document.querySelectorAll('#kivara-lingo-host, #kivara-lingo-video-host').length,
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
    // `TypeError: not granted`. Only THAT refusal is retried, and at most
    // twice more: if the product ever stops calling requestFullscreen inside
    // the gesture, every attempt answers the same way and the test fails
    // instead of passing on a slow retry. A run that needed the retry is
    // logged, so the noise rate stays visible in the report rather than
    // being absorbed.
    const ACTIVATION_REFUSALS = [
      // V8: no transient activation.
      /TypeError: not granted/i,
      // Chromium: the gesture is no longer fresh enough.
      /NotAllowedError/i,
      /Permissions check failed/i,
    ];
    const tryFullscreenGesture = async () => {
      await page.bringToFront();
      await enterFullscreen.press('Enter');
      return page.evaluate(() => ({
        fullscreen: Boolean(document.fullscreenElement),
        error: (window as Window & { __kivaraFullscreenError?: string }).__kivaraFullscreenError ?? null,
      }));
    };
    const probe = await tryFullscreenGesture();
    let attempts = 1;
    while (
      !probe.fullscreen &&
      attempts < 3 &&
      ACTIVATION_REFUSALS.some((r) => r.test(String(probe.error)))
    ) {
      attempts += 1;
      Object.assign(probe, await tryFullscreenGesture());
    }
    expect(
      probe,
      `fullscreen refused after ${attempts} attempt(s): ${probe.error}`,
    ).toMatchObject({ fullscreen: true });
    if (attempts > 1) {
      // A minority of retried runs is environment noise; a majority is the
      // product, and this line is where that trend first shows up.
      console.warn(
        `[full] needed a transient-activation retry: attempts=${attempts} (${probe.error})`,
      );
    }
    // The re-parent must put a lot inside the fullscreen element. It is
    // counted the only way a closed shadow root allows: by our own host ids
    // inside the stage's own DOM.
    await expect.poll(
      async () =>
        await page.evaluate(() => {
          const stage = document.getElementById('stage');
          if (!stage) return false;
          return stage.querySelector('#kivara-lingo-host, #kivara-lingo-video-host') !== null;
        }),
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
    // The same reparent verdict from the other end: once the exit is settled
    // our hosts are back under <body>, not inside the stage. Counted by host
    // id because the roots are closed.
    await expect.poll(
      async () =>
        await page.evaluate(() =>
          Array.from(
            document.querySelectorAll('#kivara-lingo-host, #kivara-lingo-video-host'),
          ).map((el) => el.parentElement?.tagName ?? ''),
        ),
      { timeout: 10_000 },
    ).toContain('BODY');
  } finally {
    await page.close();
  }
});
