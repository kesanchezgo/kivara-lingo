/**
 * Columns on the right, end to end (#33, #38) — no streaming account needed.
 *
 * The fixture is served at a YouTube origin so the real content script mounts;
 * the page carries the `.html5-video-player` wrapper the YouTube rule targets.
 * Everything asserted here is page DOM: the reservation `<style>` lives on
 * `document.documentElement` (outside the closed shadow root), so Playwright
 * can read it even though the rail itself cannot be clicked into.
 *
 * Three facts, in order:
 *  1. opening the transcript (Alt+T — the product's own shortcut) injects the
 *     rule with the rail's width;
 *  2. YouTube is nudged with a synthetic `resize`, which is the only reason its
 *     inline-sized <video> re-measures instead of staying cropped;
 *  3. closing it removes the rule AND nudges again, so the player gets its
 *     width back.
 *
 * The unit suite (`tests/unit/columns-layout.test.ts`) owns the width math and
 * the per-platform selectors; this spec is the wiring proof.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures';

const here = path.dirname(fileURLToPath(import.meta.url));
const PLAYER_FIXTURE = fs.readFileSync(path.join(here, 'fixtures', 'player.html'), 'utf8');

/** RAIL_WIDTH_PX in src/content/ui/columns-css.ts. */
const RAIL_WIDTH_PX = 400;

test('the rail reserves its column on YouTube and nudges the player both ways', async ({ context }) => {
  const page = await context.newPage();
  try {
    // Count every resize the page receives, from document start, so the App's
    // dispatch is visible even though the video itself never resizes.
    await page.addInitScript(() => {
      const w = window as Window & { __kivaraResizes?: number };
      w.__kivaraResizes = 0;
      window.addEventListener('resize', () => {
        w.__kivaraResizes = (w.__kivaraResizes ?? 0) + 1;
      });
    });

    await page.route('*://*.youtube.com/**', async (route) => {
      const url = route.request().url();
      if (url.endsWith('cues.vtt')) {
        await route.fulfill({
          status: 200,
          contentType: 'text/vtt',
          body: 'WEBVTT\n\n00:00:00.000 --> 00:00:09.000\nHello, this is a test cue with several words.\n',
        });
        return;
      }
      // The watch page's player box, which the YouTube rule shrinks. The
      // replacements anchor on newline-free substrings so a CRLF checkout of
      // the fixture still matches.
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: PLAYER_FIXTURE.replace(
          '<div id="stage">',
          '<div class="html5-video-player" id="movie_player"><div id="stage">',
        ).replace('</body>', '</div>\n</body>'),
      });
    });

    await page.goto('https://www.youtube.com/watch?v=kivara-columns');
    await page.bringToFront();

    // Mount proof: the video host exists only after App mounted.
    await expect
      .poll(() => page.evaluate(() => document.querySelectorAll('#kivara-lingo-video-host').length), {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);

    const columnsStyle = page.locator('#kivara-columns-youtube');
    await expect(columnsStyle).toHaveCount(0);

    // Open the transcript with the product's default shortcut.
    await page.keyboard.press('Alt+T');

    await expect(columnsStyle).toHaveCount(1);
    const css = (await columnsStyle.textContent()) ?? '';
    expect(css).toContain(`width: calc(100% - ${RAIL_WIDTH_PX}px) !important;`);
    expect(css).toContain(`max-width: calc(100vw - ${RAIL_WIDTH_PX}px) !important;`);
    expect(css).toContain(':fullscreen video');
    // Max's app root is what #33 was about: it must never appear in this rule.
    expect(css).not.toContain('#root');
    await expect(page.locator('html')).toHaveAttribute('data-kvl-columns', '1');

    // The synthetic resize: at least one, dispatched by the apply path.
    const afterOpen = await page.evaluate(
      () => (window as Window & { __kivaraResizes?: number }).__kivaraResizes ?? 0,
    );
    expect(afterOpen).toBeGreaterThan(0);

    // Closing the rail restores the player: rule gone, another nudge sent.
    await page.keyboard.press('Alt+T');
    await expect(columnsStyle).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-kvl-columns', '1');
    await expect
      .poll(
        () => page.evaluate(() => (window as Window & { __kivaraResizes?: number }).__kivaraResizes ?? 0),
        { timeout: 5_000 },
      )
      .toBeGreaterThan(afterOpen);
  } finally {
    await page.close();
  }
});
