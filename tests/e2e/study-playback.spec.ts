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

/** A cue long enough to wrap to TWO lines at 640×360 (and at 1280×720). */
const CUES_VTT_LONG = `WEBVTT

00:00:00.000 --> 00:00:03.000
Hello, this is a test cue that keeps going, because the caption really does wrap onto a second line on a small player.

00:00:03.000 --> 00:00:06.000
The rat ships frames and audio.

00:00:06.000 --> 00:00:09.000
Every crumb gets gnawed.
`;

async function openPlayer(
  context: { newPage(): Promise<Page> },
  opts: { vtt?: string } = {},
): Promise<Page> {
  const page = await context.newPage();
  await page.route('*://*.youtube.com/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('cues.vtt')) {
      await route.fulfill({ status: 200, contentType: 'text/vtt', body: opts.vtt ?? CUES_VTT });
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

/**
 * Click a control by its accessible name INSIDE the closed shadow root.
 *
 * The bar lives in a `mode: 'closed'` root, so Playwright locators cannot see
 * it, and a content script's `window` is its isolated world — not the page's.
 * The one channel both worlds share is the DOM: the StudyBar (E2E build only)
 * publishes each control's CENTER into `data-kivara-e2e-hits` on the shadow
 * host. This helper reads it and clicks with the mouse — a real gesture on the
 * real button, which is the only honest way to prove a button is wired.
 */
async function hitOf(page: Page, hostId: string, label: string) {
  const hits = await page.evaluate((id) => {
    const raw = document.getElementById(id)?.getAttribute('data-kivara-e2e-hits');
    return raw ? (JSON.parse(raw) as Array<{ label: string; x: number; y: number; pressed?: string }>) : [];
  }, hostId);
  const hit = hits.find((h) => h.label === label);
  if (!hit) {
    throw new Error(`no "${label}" in the bar hit-map (saw: ${hits.map((h) => h.label).join(', ')})`);
  }
  return hit;
}

async function clickInRoot(page: Page, hostId: string, label: string): Promise<void> {
  const hit = await hitOf(page, hostId, label);
  await page.mouse.click(hit.x, hit.y);
}

/** aria-pressed / aria-checked of a control, as the bar published it. */
async function pressedInRoot(page: Page, hostId: string, label: string): Promise<string | null> {
  return (await hitOf(page, hostId, label)).pressed ?? null;
}

/*
 * Persistence is checked THROUGH THE UI, not through `chrome.storage`: the
 * page world Playwright evaluates in has no `chrome.*` (only the content
 * script's isolated world does). Click the control, reload, and the restored
 * `aria-pressed` IS the storage assertion — with the extra guarantee that no
 * code path can pass it by writing the key without rendering from it.
 */

const VIDEO_HOST = 'kivara-lingo-video-host';

/**
 * Accessible names as the harness renders them: `tests/e2e/fixtures.ts` pins
 * `--lang=es` so the content script resolves the Spanish dictionary. Kept in
 * one place so a copy change shows up once.
 */
const LABEL = {
  loop: 'Bucle',
  autoPause: 'Pausa al final de cada frase',
  prev: 'Frase anterior',
  next: 'Frase siguiente',
  replay: 'Repetir frase',
} as const;

/** The bar's box and every token's box, as the bar published them. */
async function boxesOf(page: Page): Promise<{
  bar: { x: number; y: number; width: number; height: number };
  tokens: Array<{ x: number; y: number; width: number; height: number }>;
}> {
  const raw = await page.evaluate(() => document.getElementById('kivara-lingo-video-host')
    ?.getAttribute('data-kivara-e2e-boxes') ?? null);
  if (!raw) throw new Error('no box map published');
  return JSON.parse(raw) as never;
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width
    && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Click a speed radio by its visible text ("1.25×"), via the same hit map. */
async function clickSpeed(page: Page, value: string): Promise<void> {
  await clickInRoot(page, VIDEO_HOST, value);
}

/** Move the pointer so the bar appears, then wait for its hit map. */
async function armBar(page: Page): Promise<void> {
  await page.mouse.move(320, 200);
  await expect.poll(
    () => page.evaluate(() => document.getElementById('kivara-lingo-video-host')
      ?.getAttribute('data-kivara-e2e-hits')?.length ?? 0),
    { timeout: 8_000 },
  ).toBeGreaterThan(10);
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

/**
 * The StudyBar BUTTONS, clicked with the mouse (not the shortcuts).
 *
 * These exist because the loop button was wired to the TRANSCRIPT toggle in
 * App.tsx: clicking it opened the rail, `aria-pressed` stayed false, no
 * `kvl:study.loop` was written and the clip ran past the cue. A shortcut test
 * could never catch that — the keyboard path was correct the whole time.
 */
test.describe('StudyBar buttons (mouse, closed shadow root)', () => {
  test('loop button starts the loop: pressed, persisted, cue restarts', async ({ context }) => {
    test.setTimeout(90_000);
    const page = await openPlayer(context);
    await armBar(page);
    await clickInRoot(page, VIDEO_HOST, LABEL.loop);
    await expect.poll(() => pressedInRoot(page, VIDEO_HOST, LABEL.loop), { timeout: 5_000 }).toBe('true');
    // With loop on, the cue restarts instead of running past its end.
    await page.waitForTimeout(4500);
    expect(await paused(page)).toBe(false);
    expect(await time(page)).toBeLessThan(4);
    // Persisted: a reload restores the pressed state from storage.
    await page.reload();
    await page.waitForFunction(() => document.querySelector('video')!.currentTime > 0.02);
    await armBar(page);
    await expect.poll(() => pressedInRoot(page, VIDEO_HOST, LABEL.loop), { timeout: 8_000 }).toBe('true');
    await page.close();
  });

  test('auto-pause button stops at the end of the cue', async ({ context }) => {
    test.setTimeout(90_000);
    const page = await openPlayer(context);
    await armBar(page);
    await clickInRoot(page, VIDEO_HOST, LABEL.autoPause);
    await expect.poll(() => pressedInRoot(page, VIDEO_HOST, LABEL.autoPause), { timeout: 5_000 })
      .toBe('true');
    await expect.poll(() => paused(page), { timeout: 12_000 }).toBe(true);
    const at = await time(page);
    expect(at).toBeGreaterThanOrEqual(2.85);
    expect(at).toBeLessThanOrEqual(3.6);
    await page.close();
  });

  test('next / prev buttons move by line', async ({ context }) => {
    test.setTimeout(90_000);
    const page = await openPlayer(context);
    await armBar(page);
    await clickInRoot(page, VIDEO_HOST, LABEL.next);
    await expect.poll(() => time(page), { timeout: 8_000 }).toBeGreaterThan(2.8);
    expect(await time(page)).toBeLessThan(4.5);
    await clickInRoot(page, VIDEO_HOST, LABEL.prev);
    await expect.poll(() => time(page), { timeout: 8_000 }).toBeLessThan(0.6);
    await page.close();
  });

  test('replay button returns to the start of the current cue', async ({ context }) => {
    test.setTimeout(90_000);
    const page = await openPlayer(context);
    await armBar(page);
    // Park the playhead inside the first cue, PAUSE (so the seek cannot be
    // overtaken by playback before the poll looks), then replay it.
    await page.evaluate(() => {
      const video = document.querySelector('video')!;
      video.pause();
      video.currentTime = 1.4;
    });
    await page.waitForTimeout(300);
    await clickInRoot(page, VIDEO_HOST, LABEL.replay);
    await expect.poll(() => time(page), { timeout: 6_000 }).toBeLessThan(0.5);
    await page.close();
  });

  /**
   * The bar used to sit at `bottom-16` ON TOP of the caption on a small
   * player: the tokens under it could not be clicked. The bar now measures
   * the caption plate and parks above it.
   */
  for (const size of [{ width: 640, height: 360 }, { width: 1280, height: 720 }] as const) {
    test(`the bar never covers a subtitle token at ${size.width}×${size.height}`, async ({ context }) => {
      test.setTimeout(90_000);
      const page = await openPlayer(context, { vtt: CUES_VTT_LONG });
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.waitForTimeout(400);
      await armBar(page);
      await expect.poll(async () => (await boxesOf(page)).tokens.length, { timeout: 8_000 })
        .toBeGreaterThan(5);
      const { bar, tokens } = await boxesOf(page);
      const covered = tokens.filter((token) => overlaps(bar, token));
      expect(covered, `${covered.length} token(s) under the bar`).toEqual([]);
      // The bar is still inside the frame.
      expect(bar.y).toBeGreaterThanOrEqual(0);
      expect(bar.y + bar.height).toBeLessThanOrEqual(size.height);
      await page.close();
    });
  }

  /**
   * Icon-only mode follows the PLAYER, not the bar.
   *
   * `compact` used to be computed from the bar's own width; hiding the labels
   * shrank the bar below the 760 px breakpoint for good, so a wide player never
   * got its labels back. At 1280 the chips must read «Auto-pausa» / «Bucle»; at
   * 640 they are icons only.
   */
  for (const size of [{ width: 1280, height: 720, labels: true }, { width: 640, height: 360, labels: false }] as const) {
    test(`icon-only mode follows the player width at ${size.width}px`, async ({ context }) => {
      test.setTimeout(90_000);
      const page = await openPlayer(context);
      await page.setViewportSize({ width: size.width, height: size.height });
      // The fixture's stage is a fixed 640×360 box. The PLAYER is what the bar
      // measures, so the stage has to follow the viewport for this test to say
      // anything about a wide player.
      await page.addStyleTag({
        content: '#stage{width:100vw !important;height:100vh !important;max-height:100vh}',
      });
      await page.waitForTimeout(600);
      await armBar(page);
      // Wait until the bar has MEASURED the player: without this the spec can
      // read a hit map from before the resize (the bar publishes every 400 ms).
      await expect.poll(
        () => page.evaluate(() => document.getElementById('kivara-lingo-video-host')?.getAttribute('data-kivara-e2e-width')),
        { timeout: 8_000 },
      ).toBe(String(size.width));
      await page.waitForTimeout(500);
      await armBar(page);
      const hits = await page.evaluate((id) => {
        const raw = document.getElementById(id)?.getAttribute('data-kivara-e2e-hits');
        return raw ? (JSON.parse(raw) as Array<{ label: string; text: string }>) : [];
      }, VIDEO_HOST);
      const loop = hits.find((h) => h.label === LABEL.loop);
      expect(loop).toBeTruthy();
      if (size.labels) {
        expect(loop!.text).toBe(LABEL.loop);
        expect(hits.find((h) => h.label === LABEL.autoPause)?.text).toBe('Auto-pausa');
      } else {
        expect(loop!.text).toBe('');
        expect(hits.find((h) => h.label === LABEL.autoPause)?.text).toBe('');
      }
      await page.close();
    });
  }

  test('speed radios apply 1.25× and 0.75× by click', async ({ context }) => {
    test.setTimeout(90_000);
    const page = await openPlayer(context);
    await armBar(page);
    await clickSpeed(page, '1.25×');
    await expect.poll(() => rate(page), { timeout: 5_000 }).toBeCloseTo(1.25, 3);
    await clickSpeed(page, '0.75×');
    await expect.poll(() => rate(page), { timeout: 5_000 }).toBeCloseTo(0.75, 3);
    await page.close();
  });
});
