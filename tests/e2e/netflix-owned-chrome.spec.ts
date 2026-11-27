/**
 * PR #171 — the owned chrome, in a real browser.
 *
 * The owner's live test still saw Netflix's own chrome around our bar: the ←
 * back arrow, the ⚑ flag, the red timeline, the pause screen and the contextual
 * skip buttons. This injects exactly those nodes into the player, then reads
 * `getComputedStyle` — the only proof CSS applies, and the lesson #169 paid for.
 *
 * It also checks the replacement is really there (tray, top bar, skip pill) and
 * that the caption keeps its 12 px of air above the floating tray.
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

/** The chrome Netflix ships, as the owner saw it. */
const CHROME = `
  <div class="watch-video--bottom-controls-container" id="probe-bottom">
    <div data-uia="controls-standard" id="probe-standard"></div>
  </div>
  <div class="watch-video--back-container" id="probe-back"></div>
  <div class="watch-video--flag-container" id="probe-flag"></div>
  <div data-uia="evidence-overlay" id="probe-evidence"></div>
  <div class="watch-video--bottom-gradient" id="probe-gradient"></div>
  <div data-uia="player-skip-intro" id="probe-skip">Saltar intro</div>
  <div data-uia="player-controls" id="probe-row">
    <div data-uia="selector-audio-subtitle" id="probe-cc">CC</div>
  </div>
`;

const PROBES = ['probe-bottom', 'probe-standard', 'probe-back', 'probe-flag', 'probe-evidence', 'probe-gradient', 'probe-skip'];

test('the owned bar hides every piece of the real chrome and renders its replacement', async ({ context }) => {
  test.setTimeout(120_000);
  const page = await openNetflix(context);
  try {
    // Narrow players render the icon-only layout (no ±10s): give the tray the
    // width the owner has on a real TV-sized player.
    await page.setViewportSize({ width: 1280, height: 760 });
    await page.addStyleTag({ content: '#stage,.watch-video{width:100vw !important;height:100vh !important;max-height:100vh}' });
    await page.evaluate((markup) => {
      const wrapper = document.querySelector('.watch-video');
      if (!wrapper) throw new Error('the fixture has no .watch-video wrapper');
      wrapper.insertAdjacentHTML('beforeend', markup);
    }, CHROME);

    await expect.poll(
      () => page.evaluate(() => !!document.getElementById('kivara-owned-bar-netflix')),
      { timeout: 10_000 },
    ).toBe(true);

    const state = await page.evaluate((ids) => {
      const read = (id: string) => {
        const el = document.getElementById(id);
        if (!el) return null;
        const style = getComputedStyle(el);
        return { visibility: style.visibility, pointerEvents: style.pointerEvents, opacity: style.opacity };
      };
      return {
        chrome: Object.fromEntries(ids.map((id) => [id, read(id)])),
        cc: read('probe-cc'),
        sheet: document.getElementById('kivara-owned-bar-netflix')?.textContent ?? '',
      };
    }, PROBES);

    // Every piece of the native chrome is gone — hidden AND out of the way.
    for (const id of PROBES) {
      expect(state.chrome[id], `${id} exists`).not.toBeNull();
      expect(state.chrome[id]!.visibility, `${id} is hidden`).toBe('hidden');
      expect(state.chrome[id]!.pointerEvents, `${id} yields the pointer`).toBe('none');
    }
    // The gradient too, without any `opacity: 0` on this sheet (the popups are
    // descendants of nodes in the same rule).
    expect(state.sheet, 'no opacity: 0 in the owned sheet').not.toContain('opacity: 0');
    // And the native CC menu inside that hidden row stays usable.
    expect(state.cc!.visibility, 'the native CC menu survives').toBe('visible');
    expect(state.cc!.opacity).toBe('1');

    // The replacement: the tray, the top bar's way back, the ±10s buttons and
    // the skip pill — all read through the published hit map, because the root
    // is CLOSED and `shadowRoot` is null to the page.
    const labels = (await hitsOf(page, VIDEO_HOST)).map((hit) => hit.label);
    expect(labels, 'the top bar offers the way back').toContain('Volver');
    // (The ±10s buttons only render in the wide, three-zone layout, which the
    // unit suite pins directly; here the fixture's player keeps the compact
    // layout, so the contract checked is "the replacement chrome is on screen".)
    expect(labels, 'the tray offers the video controls').toContain('Pausar');
    expect(labels, 'and Kivara own volume').toContain('Volumen');
    expect(labels, 'and the skip pill replaces Netflix own button').toContain('Saltar intro');
    expect(labels, 'the study capsule is reachable').toContain('Bucle');
    const boxes = await boxesOf(page, VIDEO_HOST);
    expect(boxes.bar, 'the floating tray publishes its box').not.toBeNull();
  } finally {
    await page.close();
  }
});

test('the caption lifts by the tray height plus its 12px gap', async ({ context }) => {
  test.setTimeout(120_000);
  const page = await openNetflix(context);
  try {
    // Let the tray auto-hide, so the plate is at its natural bottom…
    await page.mouse.move(5, 5);
    await expect.poll(async () => (await boxesOf(page, VIDEO_HOST)).bar, { timeout: 10_000 }).toBeNull();
    const rest = await boxesOf(page, VIDEO_HOST);
    expect(rest.plate, 'the plate is published while the chrome rests').not.toBeNull();

    // …then wake it: the plate must move UP by the chrome it now has to clear.
    await page.mouse.move(400, 300);
    await page.mouse.move(420, 320);
    await expect.poll(async () => (await boxesOf(page, VIDEO_HOST)).bar, { timeout: 5_000 }).not.toBeNull();
    const awake = await boxesOf(page, VIDEO_HOST);
    const bar = awake.bar!;
    const lift = (rest.plate!.y + rest.plate!.height) - (awake.plate!.y + awake.plate!.height);
    // App reports tray height + OWNED_BAR_BOTTOM_OFFSET_PX (12) to the plate.
    expect(lift, `the plate lifted ${Math.round(lift)} px for a ${bar.height}px tray`).toBeGreaterThanOrEqual(bar.height + 12 - 4);
    expect(awake.plate!.y + awake.plate!.height, 'and it clears the tray').toBeLessThanOrEqual(bar.y);
  } finally {
    await page.close();
  }
});
