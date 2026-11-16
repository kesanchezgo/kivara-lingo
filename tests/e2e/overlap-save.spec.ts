/**
 * Saving a word that belongs to the SECOND of two overlapping lines.
 *
 * At 3.2 s this TTML has FIRST (1.8–3.6 s) and SECOND (3.0–5.0 s) on screen at
 * the same time, so the adapter emits one combined cue whose id lists both
 * spans. Before the fix the save carried the combined text and no
 * `contextLines` (the builder looked the composite id up with `===`); the card
 * must carry the line the word sits in, plus that line's neighbours.
 *
 * The request is read from the service worker's E2E mirror
 * (`kvl:e2e:last-create`), written on the same path the card takes — the real
 * content→background message, not a React callback observed in the page.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures';
import { LABEL, PANEL_HOST, VIDEO_HOST, clickInRoot, hitsOf, hoverToken, mouseAway, parkAt, readFixture, waitForLine } from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFixture('player-netflix.html');

/** FIRST 1.8–3.6 s and SECOND 3.0–5.0 s overlap; the outer lines give context. */
const TTML = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="en">
  <body>
    <div>
      <p begin="0s" end="1.8s">BEFORE THE OVERLAP</p>
      <p begin="1.8s" end="3.6s">FIRST LINE</p>
      <p begin="3s" end="5s">SECOND LINE</p>
      <p begin="5s" end="6.5s">AFTER THE OVERLAP</p>
    </div>
  </body>
</tt>`;

async function openNetflix(context: import('@playwright/test').BrowserContext) {
  const page = await context.newPage();
  await page.route('*://*.nflxvideo.net/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/xml',
      headers: { 'access-control-allow-origin': '*' },
      body: TTML,
    });
  });
  await page.route('*://*.netflix.com/**', async (route) => {
    if (route.request().url().includes('/watch/')) {
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
      () => page.evaluate((ids) => ids.every((id) => document.getElementById(id) !== null), [PANEL_HOST, VIDEO_HOST]),
      { timeout: 15_000 },
    )
    .toBe(true);
  return page;
}

interface MirroredRequest {
  token?: string;
  sentence?: string;
  cueStart?: number;
  cueEnd?: number;
  contextLines?: { prev?: string; next?: string };
}

const readMirror = (worker: import('@playwright/test').Worker) =>
  worker.evaluate(async () => {
    const got = await chrome.storage.local.get('kvl:e2e:last-create');
    return (got['kvl:e2e:last-create'] ?? null) as unknown as MirroredRequest | null;
  });

test('a word saved from the second overlapping line carries that line and its neighbours', async ({ context, serviceWorker }) => {
  test.setTimeout(120_000);
  const page = await openNetflix(context);
  try {
    // 3.2 s: FIRST and SECOND are both on screen.
    await parkAt(page, 3.2);
    await waitForLine(page, 'FIRST LINE SECOND LINE');

    // The card opens on token hover, but a repaint between reading the box
    // map and moving the pointer can swallow the enter event — so move away
    // and hover again until the save action is published (this is the gesture
    // a user makes anyway).
    await expect
      .poll(
        async () => {
          await mouseAway(page).catch(() => {});
          try {
            await hoverToken(page, 'SECOND');
          } catch {
            return false;
          }
          const hits = await hitsOf(page, VIDEO_HOST);
          return hits.some((hit) => hit.label === LABEL.save);
        },
        { timeout: 25_000, message: 'the word card opened on the second line with its save action' },
      )
      .toBe(true);
    await clickInRoot(page, VIDEO_HOST, LABEL.save);

    await expect
      .poll(
        () => readMirror(serviceWorker),
        { timeout: 30_000, message: 'the CREATE_CARD request reached the service worker' },
      )
      .not.toBeNull();

    const sent: MirroredRequest | null = await readMirror(serviceWorker);
    // The card's headword goes through the dictionary lookup, which lowercases.
    expect(sent?.token).toBe('second');
    // The LINE that holds the word — not the combined plate.
    expect(sent?.sentence).toBe('SECOND LINE');
    expect(sent?.cueStart).toBe(3_000);
    expect(sent?.cueEnd).toBe(5_000);
    expect(sent?.contextLines).toEqual({
      prev: 'FIRST LINE',
      next: 'AFTER THE OVERLAP',
    });
  } finally {
    await page.close();
  }
});
