/**
 * PR #170 · 2 — turning the extension OFF from the popup puts the site back in
 * the same tick.
 *
 * The popup used to write only `chrome.storage.sync`; the tab learned about it
 * through a 250 ms-debounced rehydrate, so the hosts stayed mounted, the study
 * playback kept looping at its rate and the native subtitles stayed hidden.
 * This spec measures the real thing in a real browser: click the popup's power
 * switch, then look at the PLAYER tab.
 */
import { expect, test } from './fixtures';
import {
  armBar, boxesOf, LABEL, openPlayer, parkAt, play, pressedInRoot, readFixture, seekTo, VIDEO_HOST,
} from './helpers';

// The seekable fixture carries the VTT cues the loop needs to wrap on.
const YOUTUBE_FIXTURE = readFixture('player-seekable.html');
const VTT = `WEBVTT

00:00:00.000 --> 00:00:06.000
Hello, this is a test cue with several words.
`;

/** The viewer's own "is it really off?" reading of the player tab. */
const siteState = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const video = document.querySelector('video');
  return {
    hosts: ['kivara-lingo-host', 'kivara-lingo-video-host', 'kivara-lingo-bar-slot']
      .filter((id) => document.getElementById(id)),
    sheets: Array.from(document.querySelectorAll('style[id^="kivara-"]')).map((el) => el.id),
    rate: video ? video.playbackRate : null,
    paused: video ? video.paused : null,
    time: video ? video.currentTime : null,
  };
});

test('the popup switch stops the loop and tears the player down immediately', async ({ context, extensionId }) => {
  test.setTimeout(180_000);
  const player = await openPlayer(context, { fixture: YOUTUBE_FIXTURE, vtt: VTT });
  try {
    // The hit map publishes a beat after the host mounts: the poll has to
    // tolerate the "not yet" throw instead of failing on it.
    await expect.poll(async () => {
      try {
        return (await boxesOf(player, VIDEO_HOST)).tokens.length;
      } catch {
        return 0;
      }
    }, { timeout: 15_000 }).toBeGreaterThan(1);
    const before = await siteState(player);
    expect(before.hosts.length, 'the extension is mounted to start with').toBeGreaterThan(0);

    // A real speed on the media: the disable path must take it back to 1×.
    await player.evaluate(() => { document.querySelector('video')!.playbackRate = 1.25; });

    // With the loop ON (the product's own Alt+L) the playhead wraps at the cue
    // end: that is the behaviour the disable path has to stop.
    await parkAt(player, 5.4);
    await armBar(player);
    await player.keyboard.press('Alt+L');
    await expect.poll(() => pressedInRoot(player, VIDEO_HOST, LABEL.loop), { timeout: 5_000 }).toBe('true');
    await play(player);
    await expect.poll(async () => (await siteState(player)).time, { timeout: 8_000 })
      .toBeLessThan(3);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    // The popup renders in the BROWSER's language (es-ES in this suite), while a
    // spec-side `t()` resolves in Node: match both labels instead of guessing.
    const toggle = popup.locator('button[aria-label="Extension enabled"], button[aria-label="Extensión activada"]');
    await expect(toggle).toBeVisible();

    const clickedAt = Date.now();
    await toggle.click();
    // The tab must react in the same tick: the storage rehydrate alone would
    // take 250 ms, so anything under that is only possible through the
    // SET_ENABLED broadcast.
    await expect
      .poll(async () => (await siteState(player)).hosts.length, { timeout: 5_000, message: 'the hosts are gone' })
      .toBe(0);
    const teardownMs = Date.now() - clickedAt;

    const after = await siteState(player);
    expect(after.hosts, 'every Kivara host is gone').toEqual([]);
    expect(after.sheets, 'and every injected sheet too').toEqual([]);
    expect(after.rate, 'the media is back at 1×').toBe(1);
    expect(teardownMs, `teardown took ${teardownMs} ms (must beat the 250 ms storage debounce)`).toBeLessThan(250);

    // No loop either: the playhead runs to the end of the media and stays there.
    await seekTo(player, 5.4);
    await play(player);
    await player.waitForTimeout(1_400);
    const crossed = await siteState(player);
    expect(crossed.time, 'the cue end is not a loop point any more').toBeGreaterThan(6.2);

    // While it is OFF, a page that loads stays untouched: the content script
    // must not paint anything at all (not even for the frame before the store
    // hydrates).
    const fresh = await context.newPage();
    // A flash is still a bug: watch the whole load for the host ever appearing.
    await fresh.addInitScript(() => {
      const seen = { host: false };
      (window as Window & { __kvlHostEverSeen?: boolean }).__kvlHostEverSeen = false;
      const check = () => {
        if (document.getElementById('kivara-lingo-video-host') || document.getElementById('kivara-lingo-host')) {
          (window as Window & { __kvlHostEverSeen?: boolean }).__kvlHostEverSeen = true;
        }
      };
      const observer = new MutationObserver(check);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      window.addEventListener('DOMContentLoaded', check);
      void seen;
    });
    await context.route('*://*.youtube.com/**', async (route) => {
      const url = route.request().url();
      if (url.endsWith('cues.vtt')) {
        await route.fulfill({ status: 200, contentType: 'text/vtt', body: VTT });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'text/html', body: YOUTUBE_FIXTURE });
    });
    await fresh.goto('https://www.youtube.com/watch?v=kivara-off-gate');
    await fresh.waitForTimeout(4_000);
    const untouched = await siteState(fresh);
    expect(untouched.hosts, 'a page opened while OFF carries no Kivara host').toEqual([]);
    expect(
      await fresh.evaluate(() => (window as Window & { __kvlHostEverSeen?: boolean }).__kvlHostEverSeen),
      'and never painted one, not even for the frame before the store hydrated',
    ).toBe(false);
    expect(untouched.sheets, 'and no injected sheet').toEqual([]);
    await fresh.close();

    // Back inside the cue, so the re-mount has a line to paint.
    await seekTo(player, 1.5);
    await play(player);
    await player.waitForTimeout(600);

    // Turning it back on remounts over the video that is playing, with no reload.
    const onToggle = popup.locator('button[aria-label="Extension disabled"], button[aria-label="Extensión desactivada"]');
    await onToggle.click();
    await expect
      .poll(async () => (await siteState(player)).hosts.length, { timeout: 10_000, message: 'the hosts are back' })
      .toBeGreaterThan(0);
    // The cleanup sheet follows the pointer (it covers the chrome only while
    // the pointer rests over the video), so give the idle gate its window.
    await expect
      .poll(async () => (await siteState(player)).sheets.length, { timeout: 8_000, message: 'the sheets are re-applied' })
      .toBeGreaterThan(0);
    await expect.poll(async () => {
      try {
        return (await boxesOf(player, VIDEO_HOST)).tokens.length;
      } catch {
        return 0;
      }
    }, { timeout: 8_000, message: 'the overlay republishes its hit map' }).toBeGreaterThan(1);
    await popup.close();
  } finally {
    await player.close();
  }
});
