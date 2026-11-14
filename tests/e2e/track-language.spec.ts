/**
 * Completing #114 — the track's language, end to end.
 *
 * Three states the QA found on real Netflix, reproduced on a fixture:
 *
 *  1. TTML with `xml:lang="es"` and a learner on English → Kivara showed
 *     NOTHING: the adapter dropped the track as "not the primary language"
 *     and no notice explained it.
 *  2. TTML with no language at all → the Spanish cues were labelled 'en'
 *     (the adapter stamped `sourceLang`), so no notice and English lookups.
 *  3. TTML declaring 'en' → nothing to say: no mismatch notice.
 *
 * Plus the rule behind both: with a track in another language the
 * "no subtitles are active" notice must stay silent — it would be false.
 *
 * The fixture is a Netflix watch page (`/watch/<id>` + `.watch-video`) that
 * fetches a TTML from `nflxvideo.net`; the spec serves that body. The overlay
 * publishes `[aria-live]` text as `live` on the video host, which is how the
 * notices are read here (the roots are closed).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures';
import type { Worker } from '@playwright/test';
import { readFixture, stateOf, waitForState, VIDEO_HOST, PANEL_HOST } from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFixture('player-netflix.html');

const SPANISH = [
  'El taxista dijo que probablemente ya esté en la ciudad, señor.',
  'No los he visto en un mes, pero volverán mañana por la tarde.',
  'Cuando vuelas de Buriatia a Chegdomyn no hay otra manera de llegar.',
];
const ENGLISH = [
  'The taxi driver said he is probably in the city already, sir.',
  'I have not seen them for a month, but they will come back tomorrow.',
  'When you fly from Buryatia to Chegdomyn there is no other way to get there.',
];

function ttml(lines: string[], lang: string | null): string {
  const body = lines
    .map((text, i) => `<p begin="${i * 3}s" end="${i * 3 + 3}s">${text}</p>`)
    .join('\n      ');
  const langAttr = lang ? ` xml:lang="${lang}"` : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml"${langAttr}>
  <body>
    <div>
      ${body}
    </div>
  </body>
</tt>`;
}

/** Open the Netflix fixture with `ttmlBody` served for the nflxvideo request. */
async function openNetflix(
  context: import('@playwright/test').BrowserContext,
  ttmlBody: string,
): Promise<import('@playwright/test').Page> {
  const page = await context.newPage();
  await page.route('*://*.nflxvideo.net/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/xml',
      headers: { 'access-control-allow-origin': '*' },
      body: ttmlBody,
    });
  });
  await page.route('*://*.netflix.com/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/watch/')) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: FIXTURE });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html></html>' });
  });
  await page.goto('https://www.netflix.com/watch/82939619');
  await page.bringToFront();
  await page.waitForFunction(
    () => (window as Window & { __kivaraFixtureReady?: unknown }).__kivaraFixtureReady !== undefined,
    undefined,
    { timeout: 30_000 },
  );
  await expect
    .poll(
      () => page.evaluate(
        (ids) => ids.every((id) => document.getElementById(id) !== null),
        [PANEL_HOST, VIDEO_HOST],
      ),
      { timeout: 15_000 },
    )
    .toBe(true);
  return page;
}

test('a Spanish TTML with xml:lang="es" is shown and explained, never hidden', async ({ context }) => {
  const page = await openNetflix(context, ttml(SPANISH, 'es'));
  try {
    // The cues are published (the old build dropped the track and showed nothing).
    await waitForState(
      page,
      VIDEO_HOST,
      (state) => state.live.some((t) => /no pude cambiarlos/i.test(t)),
      'the mismatch notice explains the Spanish track',
      20_000,
    );
    const live = (await stateOf(page, VIDEO_HOST)).live;
    expect(live.join(' ')).not.toMatch(/no hay subtítulos activos/i);
    expect(live.join(' ')).toMatch(/español/i);
  } finally {
    await page.close();
  }
});

test('a Spanish TTML with no declared language is detected, not stamped as English', async ({ context }) => {
  const page = await openNetflix(context, ttml(SPANISH, null));
  try {
    await waitForState(
      page,
      VIDEO_HOST,
      (state) => state.live.some((t) => /no pude cambiarlos/i.test(t)),
      'the detector names Spanish when the track declares nothing',
      20_000,
    );
    const live = (await stateOf(page, VIDEO_HOST)).live;
    expect(live.join(' ')).not.toMatch(/no hay subtítulos activos/i);
  } finally {
    await page.close();
  }
});

test('an English TTML raises no mismatch notice', async ({ context }) => {
  const page = await openNetflix(context, ttml(ENGLISH, 'en'));
  try {
    // Give the app the same window the other cases use before concluding.
    await page.waitForTimeout(8_000);
    const live = (await stateOf(page, VIDEO_HOST)).live;
    expect(live.join(' ')).not.toMatch(/no pude cambiarlos|could not switch/i);
    expect(live.join(' ')).not.toMatch(/no hay subtítulos activos/i);
  } finally {
    await page.close();
  }
});

test('Kivara switches the subtitle track itself, without asking the user', async ({ context }) => {
  const page = await openNetflix(context, ttml(SPANISH, 'es'));
  try {
    // The bus only has the Spanish track; the learner is on English. The app
    // must ask the player for the English track through the MAIN-world bridge.
    await expect
      .poll(
        () => page.evaluate(() => (window as Window & { __kivaraSubtitleSwitch?: string[] }).__kivaraSubtitleSwitch ?? []),
        { message: 'the app asked the player for the English track', timeout: 20_000 },
      )
      .toContain('T:en');
  } finally {
    await page.close();
  }
});



/** Write the master switch before the page loads (the store hydrates at start). */
async function seedEnabled(sw: Worker, enabled: boolean): Promise<void> {
  await sw.evaluate(async (arg: { enabled: boolean }) => {
    const KEY = 'kivara-lingo-state';
    const cur = await chrome.storage.sync.get(KEY);
    const parsed = cur[KEY] ? JSON.parse(String(cur[KEY])) : { state: {}, version: 0 };
    parsed.state = { ...(parsed.state ?? {}), enabled: arg.enabled };
    await chrome.storage.sync.set({ [KEY]: JSON.stringify(parsed) });
  }, { enabled });
}

const switchCalls = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as Window & { __kivaraSubtitleSwitch?: string[] }).__kivaraSubtitleSwitch ?? []);

test('with Kivara OFF the player is never touched', async ({ context, serviceWorker }) => {
  await seedEnabled(serviceWorker, false);
  const page = await openNetflix(context, ttml(SPANISH, 'es'));
  try {
    await page.waitForTimeout(9_000);
    expect(await switchCalls(page)).toEqual([]);
  } finally {
    await page.close();
  }
});

test('with Kivara ON the switch happens', async ({ context, serviceWorker }) => {
  await seedEnabled(serviceWorker, true);
  const page = await openNetflix(context, ttml(SPANISH, 'es'));
  try {
    await expect.poll(() => switchCalls(page), { timeout: 20_000 }).toContain('T:en');
  } finally {
    await page.close();
  }
});
