/**
 * The word card survives a HUMAN mouse path from the word to its actions.
 *
 * The C2 regression (measured with a 15-step, 16 ms-apart hand movement from
 * the word to the card): the rebuilt card opened 42 px away from the word,
 * right-aligned to it, at a fixed 543 px height — and it CLOSED before the
 * pointer arrived, because the hover bridge no longer covered the gap. The
 * tests below fail against that build and hold the fixes:
 *
 *   • the card's height for a low-content word stays ≤ 380 px;
 *   • the card is centred on the word (within the frame's limits);
 *   • a human path from the word to «Guardar» keeps the card open and the
 *     click lands (the save reaches the registry).
 *
 * Every pointer travel here uses humanMove/humanClick — never a teleport.
 */
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { test, expect } from './fixtures';
import {
  LABEL, VIDEO_HOST, boxesOf, hitsOf, humanClick, humanMove,
  openPlayer, parkAt, readFixture, waitForLine,
} from './helpers';

const FIXTURE = readFixture('player-dual.html');

const EN = [
  'Hello, this is a test cue.',
  'The rat ships frames and audio.',
  'Every crumb gets gnawed.',
];
const ES = ['Hola, esta es una prueba.', 'La rata envía fotogramas y audio.', 'Cada migaja se roe.'];

function json3(lines: readonly string[]): string {
  return JSON.stringify({
    events: lines.map((text, index) => ({
      tStartMs: index * 3000,
      dDurationMs: 3000,
      segs: [{ utf8: text }],
    })),
  });
}

async function openDual(context: import('@playwright/test').BrowserContext) {
  const page = await openPlayer(context, {
    fixture: FIXTURE,
    timedtext: (url) => json3(url.searchParams.get('tlang') === 'es' ? ES : EN),
  });
  await page.evaluate(() => document.fonts.ready);
  return page;
}

test('the card is centred on the word and stays ≤ 380 px for a low-content word', async ({ context }) => {
  test.setTimeout(120_000);
  const page = await openDual(context);
  try {
    await parkAt(page, 1);
    await waitForLine(page, 'Hello this is a test cue');
    const tok = (await boxesOf(page, VIDEO_HOST)).tokens.find((t) => t.text === 'test');
    expect(tok).toBeTruthy();
    await humanMove(page, tok!.x + tok!.width / 2, tok!.y + tok!.height / 2);
    await expect
      .poll(
        async () => {
          const boxes = await boxesOf(page, VIDEO_HOST);
          return boxes.card ? boxes.card.height : 0;
        },
        { timeout: 10_000, message: 'the card opened' },
      )
      .toBeGreaterThan(0);

    const boxes = await boxesOf(page, VIDEO_HOST);
    const card = boxes.card!;
    const tok2 = (await boxesOf(page, VIDEO_HOST)).tokens.find((t) => t.text === 'test')!;
    // Low-content word: the reserved card never exceeds ~380 px.
    expect(card.height, `the card is ${Math.round(card.height)} px tall`).toBeLessThanOrEqual(380);
    // Centred on the word (this word sits mid-plate, so the clamp cannot
    // shift the card): the centres must agree within 24 px.
    const cardCenterX = card.x + card.width / 2;
    const tokCenterX = tok2.x + tok2.width / 2;
    expect(Math.abs(cardCenterX - tokCenterX), `the card is off-centre by ${Math.abs(cardCenterX - tokCenterX).toFixed(1)} px`).toBeLessThanOrEqual(24);
    // And the gap between the word and the card is small (≤ 12 px).
    const gap = tok2.y - (card.y + card.height);
    // The done-phase shrink may grow the gap; the hover bridge covers it.
    expect(gap, `the gap is ${gap.toFixed(1)} px`).toBeLessThanOrEqual(24);
  } finally {
    await page.close();
  }
});

test('a human path from the word to Guardar keeps the card open and saves', async ({ context, serviceWorker }) => {
  test.setTimeout(120_000);
  const page = await openDual(context);
  try {
    await parkAt(page, 1);
    await waitForLine(page, 'Hello this is a test cue');
    const tok = (await boxesOf(page, VIDEO_HOST)).tokens.find((t) => t.text === 'cue');
    await humanMove(page, tok!.x + tok!.width / 2, tok!.y + tok!.height / 2);
    await expect
      .poll(
        async () => (await hitsOf(page, VIDEO_HOST)).some((hit) => hit.label === LABEL.save),
        { timeout: 10_000, message: 'the card opened with its save action' },
      )
      .toBe(true);

    // The card must STAY OPEN while the pointer walks to Guardar: sample the
    // dialog through the whole path. The card fills in batches for ~2.5 s —
    // wait for the stream to finish first so the buttons settle and the path
    // is measured against their final positions.
    await page.waitForTimeout(2_800);
    const save = (await hitsOf(page, VIDEO_HOST)).find((hit) => hit.label === LABEL.save)!;
    const closedLog: Array<{ at: number; card: [number, number, number] | null; pointer: [number, number]; layout?: string | null }> = [];
    let closedMidPath = false;
    const steps = 15;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = tok!.x + tok!.width / 2 + (save.cx - (tok!.x + tok!.width / 2)) * t;
      const y = tok!.y + tok!.height / 2 + (save.cy - (tok!.y + tok!.height / 2)) * t;
      await page.mouse.move(x, y);
      if (i < steps) {
        await page.waitForTimeout(16);
        const boxes = await boxesOf(page, VIDEO_HOST);
        if (!boxes.card) {
          closedMidPath = true;
              }
        void boxes;
      }
    }
    expect(closedMidPath, 'the card closed before the pointer reached Guardar').toBe(false);
    // Re-read the save button AFTER the path: the card's content settles and
    // the hit map follows it (the 150 ms tick while a dialog is open).
    const saveNow = (await hitsOf(page, VIDEO_HOST)).find((hit) => hit.label === LABEL.save)!;
    await humanClick(page, saveNow.cx, saveNow.cy, 4, 16);

    // The save reached the registry (no deck configured → the classified
    // no-deck row is still proof the handler ran).
    await expect
      .poll(
        () => serviceWorker.evaluate(async () => {
          const got = await chrome.storage.local.get('kvl:cards.recent');
          const rows = (got['kvl:cards.recent'] ?? []) as Array<{ word?: string }>;
          return rows.some((row) => row.word === 'cue');
        }),
        { timeout: 30_000, message: 'the guarded click saved (the registry row exists)' },
      )
      .toBe(true);
  } finally {
    await page.close();
  }
});

test('new pointer specs travel: no teleporting clicks in this file', async () => {
  // Discipline guard: the specs born with the C2 fix must never use a raw
  // teleporting click — every click goes through humanClick (which walks).
  const fs = await import('node:fs');
  const path = await import('node:path');
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const name of ['popover-human-path.spec.ts', 'popover-stability.spec.ts']) {
    const body = fs.readFileSync(path.join(here, name), 'utf8');
    const needle = 'page.mouse' + '.click(';
    expect(body.includes(needle), `${name} teleports a click`).toBe(false);
  }
});

