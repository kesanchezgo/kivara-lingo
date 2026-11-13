/**
 * Point 3 — Kivara's speed goes through the platform's own API.
 *
 * The fixture exposes a MAIN-world `movie_player` stub, exactly like YouTube
 * does. The contract, in order:
 *  1. clicking Kivara's 1.25× radio calls `movie_player.setPlaybackRate(1.25)`
 *     (RED before: the old code wrote the element directly and the stub never
 *     saw a call);
 *  2. the player obeying shows in the element, AND the ratechange echo must
 *     NOT be mistaken for an external change;
 *  3. when the PLATFORM reverts the rate right after our apply, Kivara
 *     re-applies ONCE (the stub records the second call);
 *  4. a rate change from the NATIVE side (outside our apply) is ACCEPTED:
 *     Kivara's speed state follows it (the 0.75× radio becomes pressed).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures';
import { openPlayer, readFixture, armBar, clickInRoot, clickSpeed, hitOf, rate, LABEL, VIDEO_HOST } from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFixture('player-seekable.html');

const movieRates = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __movieRates?: number[] }).__movieRates ?? []);

/** The MAIN-world player stub, installed from document start (like YouTube). */
async function installStub(context: import('@playwright/test').BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const w = window as unknown as { __movieRates?: number[]; movie_player?: { setPlaybackRate(r: number): void } };
    w.__movieRates = [];
    w.movie_player = {
      setPlaybackRate(rate: number) {
        w.__movieRates?.push(rate);
        const v = document.querySelector('video');
        if (v) v.playbackRate = rate;
      },
    };
  });
}

test.describe('point 3: the rate bridge', () => {
  test('clicking 1.25× calls movie_player.setPlaybackRate(1.25)', async ({ context }) => {
    await installStub(context);
    const page = await openPlayer(context, { fixture: FIXTURE });
    try {
      await armBar(page);
      await clickSpeed(page, '1.25×');
      await expect.poll(() => movieRates(page), { timeout: 8_000 }).toContain(1.25);
      await expect.poll(() => rate(page), { timeout: 5_000 }).toBeCloseTo(1.25, 3);
    } finally {
      await page.close();
    }
  });

  test('a platform revert right after our apply is retried once', async ({ context }) => {
    await installStub(context);
    const page = await openPlayer(context, { fixture: FIXTURE });
    try {
      await armBar(page);
      await clickSpeed(page, '1.25×');
      // The moment the echo lands (our apply is armed and fresh), the
      // platform disagrees with a raw element write — the revert. The poll
      // body performs the write itself so it lands INSIDE the echo window
      // deterministically.
      let writes = 0;
      await expect
        .poll(async () => {
          const rates = await movieRates(page);
          if (rates.includes(1.25) && writes === 0) {
            writes += 1;
            await page.evaluate(() => {
              const v = document.querySelector('video');
              if (v) v.playbackRate = 1;
            });
            await page.waitForTimeout(400);
          }
          return rates.filter((r) => r === 1.25).length;
        }, { timeout: 8_000 })
        .toBeGreaterThanOrEqual(2);
      await expect.poll(() => rate(page), { timeout: 5_000 }).toBeCloseTo(1.25, 3);
    } finally {
      await page.close();
    }
  });

  test('a rate the NATIVE side sets is accepted by Kivara', async ({ context }) => {
    await installStub(context);
    const page = await openPlayer(context, { fixture: FIXTURE });
    try {
      await armBar(page);
      // The mount's echo window (600 ms) must be closed first, or the native
      // write would be read as a platform revert. Waiting makes it clean.
      await page.waitForTimeout(1_500);
      await page.evaluate(() => {
        const mp = (window as unknown as { movie_player?: { setPlaybackRate(r: number): void } }).movie_player;
        mp?.setPlaybackRate(0.75);
      });
      await expect.poll(() => rate(page), { timeout: 5_000 }).toBeCloseTo(0.75, 3);
      // Kivara's speed state follows: the 0.75× radio becomes pressed.
      await expect.poll(async () => {
        const hit = await hitOf(page, VIDEO_HOST, '0.75×');
        return hit.pressed ?? '';
      }, { timeout: 8_000 }).toBe('true');
    } finally {
      await page.close();
    }
  });
});

