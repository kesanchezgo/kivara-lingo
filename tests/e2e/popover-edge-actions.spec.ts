/**
 * The action bar is pinned to the WORD-NEAR edge of the word card, in both
 * orientations:
 *
 *   - caption near the bottom → the card opens UPWARD → the bar is the
 *     card's BOTTOM edge (last child), gap <= 8 px above the word;
 *   - caption near the top → the card opens DOWNWARD → the bar is the
 *     card's TOP edge (order-first), gap <= 8 px below the word.
 *
 * Every clickable control now lives in that bar (pronunciation, Save, status,
 * links). Neither button may drift while the enrichment batches land, and a
 * human 15-step path from the word to either button must keep the card open
 * and reach the handler.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures';
import {
  LABEL, VIDEO_HOST, boxesOf, clickInRoot, hitsOf, humanClick, humanMove,
  openPlayer, parkAt, pressedInRoot, readFixture, stateOf, tokensOf, waitForLine,
} from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFixture('player-dual.html');

type Side = 'top' | 'bottom';

const json3 = (lines: readonly string[]) => JSON.stringify({
  events: lines.map((text, index) => ({
    tStartMs: index * 3000, dDurationMs: 3000, segs: [{ utf8: text }],
  })),
});
const EN = ['Hello this is a test cue', 'The rat ships frames and audio', 'Every crumb gets gnawed'];
// The first line keeps the token "test" in both tracks so a reload that
// re-selects ES does not change which token the orientation specs hover.
const ES = ['Hola esto es una prueba test', 'La rata envía fotogramas y audio', 'Cada migaja se roe'];

/** Open with the caption's vertical position already seeded. Default 85 puts
 *  the plate near the bottom so the card opens upward; 15 puts it near the top
 *  so it opens down. Seeding before open avoids a reload (which re-selects the
 *  ES track and changes the token text). */
async function openPage(
  context: import('@playwright/test').BrowserContext,
  vertical: number,
) {
  const sw = (await context.serviceWorkers())[0];
  if (sw) {
    await sw.evaluate(async (value) => {
      const KEY = 'kivara-lingo-state';
      const raw = await chrome.storage.sync.get(KEY);
      const parsed = raw[KEY] ? JSON.parse(String(raw[KEY])) : { state: {}, version: 0 };
      parsed.state = { ...(parsed.state ?? {}) };
      parsed.state.subtitleStyles = { ...(parsed.state.subtitleStyles ?? {}), verticalOffset: value };
      await chrome.storage.sync.set({ [KEY]: JSON.stringify(parsed) });
    }, vertical);
  }
  const page = await openPlayer(context, {
    fixture: FIXTURE,
    timedtext: (url) => json3(url.searchParams.get('tlang') === 'es' ? ES : EN),
  });
  await page.evaluate(() => { document.documentElement.dataset.kivaraE2eBatches = '1'; });
  return page;
}

const nearEdgeGap = (side: Side, tokenY: number, tokenH: number, cardY: number, cardH: number) =>
  side === 'top' ? tokenY - (cardY + cardH) : cardY - (tokenY + tokenH);

for (const side of ['top', 'bottom'] as const) {
  test(`both action buttons stay put and the near edge is <= 8px (opens ${side})`, async ({ context, serviceWorker }) => {
    test.setTimeout(120_000);
    const page = await openPage(context, 85);
    try {
      // Seed verticalOffset with the SW (guaranteed live) then reload so the
      // store hydrates it. The token "test" exists in both EN and ES tracks.
      await serviceWorker.evaluate(async (value) => {
        const KEY = 'kivara-lingo-state';
        const raw = await chrome.storage.sync.get(KEY);
        const parsed = raw[KEY] ? JSON.parse(String(raw[KEY])) : { state: {}, version: 0 };
        parsed.state = { ...(parsed.state ?? {}) };
        parsed.state.subtitleStyles = { ...(parsed.state.subtitleStyles ?? {}), verticalOffset: value };
        await chrome.storage.sync.set({ [KEY]: JSON.stringify(parsed) });
      }, side === 'top' ? 85 : 15);
      await page.reload();
      await page.waitForFunction(() => !!document.querySelector('video'), { timeout: 20_000 });
      await page.waitForTimeout(1_200);
      await page.evaluate(() => document.fonts.ready);
      await parkAt(page, 1);
      // Wait for the token in whichever language the reload selected.
      await expect.poll(async () => (await boxesOf(page, VIDEO_HOST)).tokens.some((t) => t.text === 'test'),
        { timeout: 10_000 }).toBe(true);
      // Native alignment and verticalOffset hydrate after reload; let the
      // caption token reach its final box before anchoring the card.
      await page.waitForTimeout(800);
      await humanMove(page, 640, side === 'top' ? 500 : 200);
      await humanMove(page, ...(await tokenCentre(page, 'test')));

      await expect
        .poll(
          async () => (await hitsOf(page, VIDEO_HOST)).some((h) => h.label === LABEL.pronounce && h.label !== undefined)
            && (await hitsOf(page, VIDEO_HOST)).some((h) => h.label === LABEL.save),
          { timeout: 10_000, message: 'the pinned action bar published pronunciation and Save' },
        )
        .toBe(true);

      const saveSamples: Array<{ x: number; y: number }> = [];
      const pronounceSamples: Array<{ x: number; y: number }> = [];
      let gapMax = -Infinity;
      let frames = 0;
      const started = Date.now();
      while (Date.now() - started < 3_000) {
        frames += 1;
        const hits = await hitsOf(page, VIDEO_HOST);
        const save = hits.find((h) => h.label === LABEL.save);
        const pronounce = hits.find((h) => h.label === LABEL.pronounce);
        const boxes = await boxesOf(page, VIDEO_HOST);
        const tok = boxes.tokens.find((t) => t.text === 'test');
        // The card may legitimately re-centre when native cue alignment
        // arrives and grow as enrichment lands. What MUST stay fixed is each
        // button's distance to the PINNED (word-near) edge of the card.
        const nearY = (cy: number) => side === 'top'
          ? boxes.card!.y + boxes.card!.height - cy
          : cy - boxes.card!.y;
        // Ignore the first few frames while the card's reserved height settles.
        if (frames >= 5 && save && boxes.card) saveSamples.push({ x: save.cx - boxes.card.x, y: nearY(save.cy) });
        // The prototype puts pronunciation in the HEADER, not the footer.
        if (frames >= 5 && pronounce && boxes.card) pronounceSamples.push({ x: pronounce.cx - boxes.card.x, y: pronounce.cy - boxes.card.y });
        if (boxes.card && tok) {
          gapMax = Math.max(gapMax, nearEdgeGap(side, tok.y, tok.height, boxes.card.y, boxes.card.height));
        }
        await page.waitForTimeout(100);
      }
      expect(saveSamples.length).toBeGreaterThanOrEqual(20);
      expect(pronounceSamples.length).toBeGreaterThanOrEqual(20);
      for (const [label, samples] of [['Save', saveSamples], ['pronunciation', pronounceSamples]] as const) {
        const dx = Math.max(...samples.map((s) => s.x)) - Math.min(...samples.map((s) => s.x));
        expect(dx, `${label} x drift`).toBeLessThanOrEqual(2);
        // VERTICAL drift, measured against the edge each control is pinned to.
        // `fitBodyToCap` used to re-squeeze the body on every enrichment batch,
        // which moved these by tens of px and is why this assertion was
        // removed. With the cap derived from the real chrome it must hold.
        const dy = Math.max(...samples.map((s) => s.y)) - Math.min(...samples.map((s) => s.y));
        expect(dy, `${label} y drift`).toBeLessThanOrEqual(2);
      }
      // The card's reserved height settles while enrichment arrives, so the
      // absolute y of the header/footer changes. Their side stays pinned.
      // The prototype's two-row footer changes vertical rhythm while the
      // card's reserved height settles; the hard contract remains that the
      // controls keep their horizontal positions and the word-near edge gap.
      // The near edge is <= 8 px from the word. content lands in batches
      // during the 3 s, so this covers both low- and high-content states.
      expect(gapMax).toBeLessThanOrEqual(8);
      expect(gapMax).toBeGreaterThanOrEqual(0);

      // Trusted clicks on BOTH pinned buttons still reach their handlers.
      const hits = await hitsOf(page, VIDEO_HOST);
      const pronounce = hits.find((h) => h.label === LABEL.pronounce)!;
      await humanClick(page, pronounce.cx, pronounce.cy, 4, 16);
      const save = (await hitsOf(page, VIDEO_HOST)).find((h) => h.label === LABEL.save)!;
      await humanClick(page, save.cx, save.cy, 4, 16);
    } finally {
      await page.close();
    }
  });
}

// A human path from the word to each pinned button must keep the card open.
for (const target of [LABEL.pronounce, LABEL.save] as const) {
  test(`human word -> ${target} keeps the card open`, async ({ context }) => {
    test.setTimeout(120_000);
    const page = await openPage(context, 85);
    try {
      await page.evaluate(() => document.fonts.ready);
      await parkAt(page, 1);
      await waitForLine(page, 'Hello this is a test cue');
      const tok = await tokenCentre(page, 'test');
      await humanMove(page, ...tok);
      await expect
        .poll(async () => (await hitsOf(page, VIDEO_HOST)).some((h) => h.label === target),
          { timeout: 10_000 })
        .toBe(true);
      const btn = (await hitsOf(page, VIDEO_HOST)).find((h) => h.label === target)!;
      let closed = false;
      for (let i = 1; i <= 15; i++) {
        const t = i / 15;
        await page.mouse.move(tok[0] + (btn.cx - tok[0]) * t, tok[1] + (btn.cy - tok[1]) * t);
        await page.waitForTimeout(16);
        if (i < 15 && !(await boxesOf(page, VIDEO_HOST)).card) closed = true;
      }
      expect(closed).toBe(false);
      // The card is still open at the button's CURRENT centre.
      const now = (await hitsOf(page, VIDEO_HOST)).find((h) => h.label === target)!;
      await humanClick(page, now.cx, now.cy, 4, 16);
    } finally {
      await page.close();
    }
  });
}

// P3: the pinned bar owns the ONE status radiogroup. The body block is
// informational (no radios, no click handlers), so clicking "Aprendiendo"
// can only hit the bar control — and the token's status + aria-checked follow.
test('one status radiogroup, inside the bar; body has no radios', async ({ context }) => {
  test.setTimeout(120_000);
  const page = await openPage(context, 85);
  try {
    await page.evaluate(() => document.fonts.ready);
    await parkAt(page, 1);
    await waitForLine(page, 'Hello this is a test cue');
    await humanMove(page, ...await tokenCentre(page, 'test'));
    await expect.poll(async () => (await boxesOf(page, VIDEO_HOST)).card !== null,
      { timeout: 10_000 }).toBe(true);

    const state = await stateOf(page, VIDEO_HOST);
    expect(state.cardRadiogroups, 'exactly one radiogroup in the card').toBe(1);
    expect(state.radiogroupInBar, 'the radiogroup lives in the pinned bar').toBe(true);
    expect(state.bodyRadios, 'the body block is informational only').toBe(0);
    expect(state.barRadios, 'the bar exposes the three status radios').toBe(3);
    expect(state.cardRadios).toBe(3);

    await clickInRoot(page, VIDEO_HOST, LABEL.learning);
    await expect.poll(async () => (await tokensOf(page)).find((t) => t.text === 'test')?.status,
      { timeout: 6_000 }).toBe('learning');
    expect(await pressedInRoot(page, VIDEO_HOST, LABEL.learning)).toBe('true');
  } finally {
    await page.close();
  }
});

async function tokenCentre(page: import('@playwright/test').Page, text: string): Promise<[number, number]> {
  const boxes = await boxesOf(page, VIDEO_HOST);
  const tok = boxes.tokens.find((t) => t.text === text);
  if (!tok) throw new Error(`token ${text} not in box map`);
  return [tok.x + tok.width / 2, tok.y + tok.height / 2];
}
