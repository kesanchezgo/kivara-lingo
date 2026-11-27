/**
 * PR #170 · 1 — a lookup session owns the pause, in a real browser.
 *
 * The 350 ms resume watchdog used to play the video while the user was READING
 * the card: the card is portaled outside the token wrapper and was not a hover
 * zone, so the pointer sitting on it read as "not over Kivara". Two gestures
 * are measured here, both of them real input:
 *
 *   • the pointer travels from the word onto the card (a hand reading a card);
 *   • the card is opened by KEYBOARD, with the pointer parked far away.
 */
import { expect, test } from './fixtures';
import { boxesOf, humanMove, hoverToken, mouseAway, openPlayer as openFixture, readFixture, VIDEO_HOST } from './helpers';

const YOUTUBE_FIXTURE = readFixture('player.html');

const VTT = `WEBVTT

00:00:00.000 --> 00:00:09.000
Hello, this is a test cue with several words.
`;

/** The proven path: the fixture at a matched YouTube origin, mounted and playing. */
async function openPlayer(context: import('@playwright/test').BrowserContext) {
  const page = await openFixture(context, { fixture: YOUTUBE_FIXTURE, vtt: VTT });
  // The hit map is published a beat after the host mounts, so the poll has to
  // tolerate the "not yet" throw instead of failing on it.
  await expect.poll(async () => {
    try {
      return (await boxesOf(page, VIDEO_HOST)).tokens.length;
    } catch {
      return 0;
    }
  }, { timeout: 15_000 }).toBeGreaterThan(1);
  return page;
}

const paused = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.querySelector('video')!.paused);

test('reading the card keeps the video paused while the pointer rests on it', async ({ context }) => {
  test.setTimeout(120_000);
  const page = await openPlayer(context);
  try {
    await page.evaluate(() => { const v = document.querySelector('video')!; v.play().catch(() => {}); });
    await page.waitForTimeout(300);

    // Hovering a word opens its card and pauses the video (pauseOnLookup).
    await hoverToken(page, 'test');
    await expect.poll(() => paused(page), { timeout: 5_000 }).toBe(true);

    // The hand travels onto the CARD and stays there: the watchdog ticks every
    // 350 ms, so 1.5 s is four chances to wrongly resume.
    const card = (await boxesOf(page, VIDEO_HOST)).card;
    expect(card, 'the card published its box').not.toBeNull();
    await humanMove(page, card!.x + card!.width / 2, card!.y + card!.height / 2);
    await page.waitForTimeout(1_500);

    expect(await paused(page), 'the card is a Kivara zone: no resume mid-lookup').toBe(true);
    const after = await boxesOf(page, VIDEO_HOST);
    expect(after.card, 'and the card is still open').not.toBeNull();
  } finally {
    await page.close();
  }
});

test('a card opened by keyboard stays paused with the pointer parked away', async ({ context }) => {
  test.setTimeout(120_000);
  const page = await openPlayer(context);
  try {
    await page.evaluate(() => { const v = document.querySelector('video')!; v.play().catch(() => {}); });
    await mouseAway(page);
    await page.waitForTimeout(300);

    // Tab into the overlay until the focused word opens its card: that is the
    // path a keyboard user has, and it must pause too.
    let opened = false;
    for (let i = 0; i < 10 && !opened; i += 1) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(150);
      opened = await paused(page);
    }
    expect(opened, 'focusing a word opens the card and pauses').toBe(true);

    // Pointer far away, four watchdog ticks: the session outranks the watchdog.
    await mouseAway(page);
    await page.waitForTimeout(1_500);
    expect(await paused(page), 'the keyboard session survives the watchdog').toBe(true);
  } finally {
    await page.close();
  }
});
