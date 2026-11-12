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

/** A cue long enough to wrap, with a first line that reaches the right edge. */
const CUES_VTT_LONG = `WEBVTT

00:00:00.000 --> 00:00:03.000
Hello, this is a test cue that fills the first line completely, because the caption really does wrap onto a second line on a small player.

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

/** The bar's box, the corner icons' boxes and every token's box, as published. */
async function boxesOf(page: Page): Promise<{
  bar: { x: number; y: number; width: number; height: number };
  badges: Array<{ x: number; y: number; width: number; height: number }>;
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
  // The publisher writes every 400 ms; without this wait the click below can
  // use a snapshot from BEFORE the pointer moved (or from before the bar
  // flipped above a taller caption plate) and land on empty video.
  await page.waitForTimeout(500);
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
   * The caption plate, the study bar and the corner icons, by real rectangles.
   *
   * The bar used to sit at `bottom-16` ON TOP of the caption on a small player:
   * the tokens under it could not be clicked, so it now parks on the opposite
   * half. The corner icons (Listen-first, mode) used to be pinned to `top-4
   * right-4` of the caption band — INSIDE a two-line caption that reaches the
   * right edge. All three must stay off each other.
   *
   * Parked mid-cue on purpose: the long first cue is the wrapping, right-edge
   * case, and playing through it would race the assertion against the cue
   * boundary.
   */
  for (const size of [{ width: 640, height: 360 }, { width: 1280, height: 720 }] as const) {
    test(`neither the bar nor the corner icons cover a token at ${size.width}×${size.height}`, async ({ context }) => {
      test.setTimeout(90_000);
      const page = await openPlayer(context, { vtt: CUES_VTT_LONG });
      await page.setViewportSize({ width: size.width, height: size.height });
      // The fixture's stage is a fixed 640×360 box. The PLAYER is what the
      // overlay measures, so the stage has to follow the viewport or the wide
      // case would measure the same 640 px player as the small one.
      await page.addStyleTag({
        content: '#stage{width:100vw !important;height:100vh !important;max-height:100vh}',
      });
      // Pause inside the first (long) cue: the geometry is what is asserted.
      await page.evaluate(() => {
        const video = document.querySelector('video')!;
        video.pause();
        video.currentTime = 1.2;
      });
      await page.waitForTimeout(500);
      await armBar(page);
      await expect.poll(async () => (await boxesOf(page)).tokens.length, { timeout: 8_000 })
        .toBeGreaterThan(5);
      const { bar, badges, tokens } = await boxesOf(page);
      // Listen-first and the mode toggle are always there.
      expect(badges.length).toBeGreaterThanOrEqual(2);

      const coveredByBar = tokens.filter((token) => overlaps(bar, token));
      expect(coveredByBar, `${coveredByBar.length} token(s) under the bar at ${size.width}×${size.height}`)
        .toEqual([]);

      for (const badge of badges) {
        const covered = tokens.filter((token) => overlaps(badge, token));
        expect(covered, `${covered.length} token(s) under a corner icon at ${size.width}×${size.height}`)
          .toEqual([]);
        expect(overlaps(bar, badge), 'the bar and a corner icon overlap').toBe(false);
      }

      // Everything stays inside the frame.
      for (const box of [bar, ...badges]) {
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(size.height);
      }
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

/**
 * A SEEK is not the end of a cue.
 *
 * Loop and end-of-cue auto-pause compare two consecutive ticks. A tick is a
 * few ms of playback, but a seek (a scrub, the platform's own chapter jump)
 * skips seconds at once — and the old bookkeeping read that jump as "the cue
 * ended": a forward jump past a cue's end looped back to that cue's start (or
 * paused mid-cue), and the cue reference stayed put across the jump.
 *
 * These cases drive the REAL media element (`video.currentTime`), which is the
 * same path a user scrub takes, plus the controller path through the buttons.
 */
test.describe('a seek is not the end of a cue', () => {
  /** Jump the media element, the way a scrub / platform control does. */
  const seekTo = (page: Page, seconds: number) =>
    page.evaluate((value) => {
      const video = document.querySelector('video')!;
      video.currentTime = value;
    }, seconds);

  /** Park the playhead so the settings can be armed before natural playback
   *  reaches a real cue end (arming takes long enough to cross 3 s). */
  async function parkAt(page: Page, seconds: number): Promise<void> {
    await page.evaluate((value) => {
      const video = document.querySelector('video')!;
      video.pause();
      video.currentTime = value;
    }, seconds);
    // The element snaps a seek to a frame boundary, so allow a little drift.
    await expect.poll(() => time(page), { timeout: 5_000 }).toBeGreaterThan(seconds - 0.2);
    expect(await time(page)).toBeLessThan(seconds + 0.2);
    // Let the bar republish: a new cue can move it above/below the caption.
    await page.waitForTimeout(500);
  }

  const play = (page: Page) => page.evaluate(() => document.querySelector('video')!.play());

  test('loop: a jump into the next cue does not snap back', async ({ context }) => {
    test.setTimeout(90_000);
    const page = await openPlayer(context);
    // Park inside cue 1 (0–3 s), arm the loop through its button, then play.
    await parkAt(page, 1);
    await armBar(page);
    await clickInRoot(page, VIDEO_HOST, LABEL.loop);
    await expect.poll(() => pressedInRoot(page, VIDEO_HOST, LABEL.loop), { timeout: 5_000 }).toBe('true');
    await play(page);
    await page.waitForTimeout(300);
    expect(await time(page)).toBeLessThan(2.9);

    // The jump that is not playback: 1.x → 4.2 s (inside cue 2, 3–6 s).
    await seekTo(page, 4.2);
    await page.waitForTimeout(600);
    const at = await time(page);
    expect(at, `loop snapped back to ${at.toFixed(2)}s`).toBeGreaterThanOrEqual(4.2);
    expect(at).toBeLessThan(6);
    expect(await paused(page)).toBe(false);

    // ... and it keeps advancing from the destination instead of restarting.
    await page.waitForTimeout(400);
    expect(await time(page)).toBeGreaterThan(at);
    await page.close();
  });

  test('auto-pause: a jump into the next cue pauses only at its real end', async ({ context }) => {
    test.setTimeout(90_000);
    const page = await openPlayer(context);
    await parkAt(page, 1);
    await armBar(page);
    await clickInRoot(page, VIDEO_HOST, LABEL.autoPause);
    await expect.poll(() => pressedInRoot(page, VIDEO_HOST, LABEL.autoPause), { timeout: 5_000 })
      .toBe('true');
    await play(page);
    await page.waitForTimeout(300);
    expect(await time(page)).toBeLessThan(2.9);

    // 1.x → 4.2 s: past cue 1's end, but that end was never played.
    await seekTo(page, 4.2);
    // Still playing at ~5 s — an auto-pause fired by the jump would have
    // stopped the playhead at 4.2 and this poll would time out.
    await expect.poll(() => time(page), { timeout: 4_000 }).toBeGreaterThan(4.9);
    expect(await paused(page)).toBe(false);

    // The genuine end of cue 2 (6 s) still pauses.
    await expect.poll(() => paused(page), { timeout: 6_000 }).toBe(true);
    const at = await time(page);
    expect(at).toBeGreaterThanOrEqual(5.85);
    expect(at).toBeLessThanOrEqual(6.6);
    await page.close();
  });

  test('seeking back fires neither loop nor auto-pause', async ({ context }) => {
    test.setTimeout(90_000);
    const page = await openPlayer(context);
    // Both triggers armed, parked inside cue 2, then playing.
    await parkAt(page, 4.6);
    await armBar(page);
    await clickInRoot(page, VIDEO_HOST, LABEL.loop);
    await expect.poll(() => pressedInRoot(page, VIDEO_HOST, LABEL.loop), { timeout: 5_000 }).toBe('true');
    await clickInRoot(page, VIDEO_HOST, LABEL.autoPause);
    await expect.poll(() => pressedInRoot(page, VIDEO_HOST, LABEL.autoPause), { timeout: 5_000 })
      .toBe('true');
    await play(page);
    await page.waitForTimeout(300);

    // Back inside the same cue: no loop restart, no pause.
    await seekTo(page, 3.4);
    await page.waitForTimeout(500);
    expect(await paused(page)).toBe(false);
    const inside = await time(page);
    expect(inside, `restarted or paused at ${inside.toFixed(2)}s`).toBeGreaterThanOrEqual(3.4);
    expect(inside).toBeLessThan(6);

    // Back into an earlier cue: still no loop restart, still no pause.
    await seekTo(page, 1.4);
    await page.waitForTimeout(500);
    expect(await paused(page)).toBe(false);
    const earlier = await time(page);
    expect(earlier, `restarted or paused at ${earlier.toFixed(2)}s`).toBeGreaterThanOrEqual(1.4);
    expect(earlier).toBeLessThan(3);
    await page.close();
  });
});

