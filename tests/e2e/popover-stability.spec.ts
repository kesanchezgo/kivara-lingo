/**
 * The word card does not move while it fills.
 *
 * C2's real cause, measured with the mouse at rest: the card hangs from its
 * bottom edge and grows with the progressive enrichment (height 320 → 570 →
 * 542 → 571), so the header — and the pronunciation button — jumped up to
 * 250 px and the trusted click fell outside the button.
 *
 * The fix reserves the max height of the chosen side from the first paint and
 * decides the side once; new content can only scroll INSIDE the card. This
 * spec samples the pronunciation button every 100 ms for 3 s while the resolve
 * stream lands in batches (the E2E-only synthetic stream: translation at
 * 300 ms, enrichment at 900 ms, done at 1500 ms), then clicks the button for
 * real at ~1 s — content still arriving — and expects the handler to run.
 */
import { test, expect } from './fixtures';
import { LABEL, VIDEO_HOST, boxesOf, hitsOf, hoverToken, humanClick, openPlayer, parkAt, readFixture, waitForLine } from './helpers';

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

const AUDIO_URL = 'https://e2e-audio.kivara/cue-us.mp3';

test('the pronunciation button stays put while the card fills in batches', async ({ context }) => {
  test.setTimeout(120_000);
  const page = await openPlayer(context, {
    fixture: FIXTURE,
    timedtext: (url) => json3(url.searchParams.get('tlang') === 'es' ? ES : EN),
  });
  // The synthetic resolve stream (E2E build only) lands its batches on fixed
  // timers once the fixture marks the page.
  await page.evaluate(() => {
    document.documentElement.dataset.kivaraE2eBatches = '1';
  });
  const pageConsole: string[] = [];
  page.on("console", (m) => pageConsole.push(m.text()));
  const audioRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('e2e-audio.kivara')) audioRequests.push(request.url());
  });
  await page.route('*://e2e-audio.kivara/**', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/mpeg', body: '//kivara-e2e-audio' }));

  try {
    // The second line holds "frames", a word the bundled dictionary does not
    // know — the card fills from the stream, not from a local hit.
    // Fonts land asynchronously and would re-wrap the header mid-sampling.
    await page.evaluate(() => document.fonts.ready);
    await parkAt(page, 1);
    await waitForLine(page, 'Hello this is a test cue');
    await hoverToken(page, 'cue');

    // The card is open once its pronunciation button is published.
    await expect
      .poll(
        async () => {
          const hits = await hitsOf(page, VIDEO_HOST);
          return hits.some((hit) => hit.label === LABEL.pronounce);
        },
        { timeout: 10_000, message: 'the word card opened with its pronunciation button' },
      )
      .toBe(true);

    // Sample the button every 100 ms for 3 s while the batches land.
    const samples: Array<{ x: number; y: number; at: number; tokY?: number; cardTop?: number | null; cardH?: number | null; tr?: string | null; topStyle?: string | null }> = [];
    const started = Date.now();
    while (Date.now() - started < 3_000) {
      const hits = await hitsOf(page, VIDEO_HOST);
      const btn = hits.find((hit) => hit.label === LABEL.pronounce);
      const boxes = await boxesOf(page, VIDEO_HOST);
      const tok = boxes.tokens.find((t) => t.text === 'cue');
      const cardTop = boxes.card ? Math.round(boxes.card.y) : null;
      const cardH = boxes.card ? Math.round(boxes.card.height) : null;
      if (btn) samples.push({ x: btn.cx, y: btn.cy, at: Date.now() - started, tokY: tok ? Math.round(tok.y) : undefined, cardTop, cardH });
      await page.waitForTimeout(100);
    }
    expect(samples.length).toBeGreaterThanOrEqual(20);
    const xs = samples.map((s) => s.x);
    const ys = samples.map((s) => s.y);
    const dx = Math.max(...xs) - Math.min(...xs);
    const dy = Math.max(...ys) - Math.min(...ys);
    console.log('STABILITY', JSON.stringify({
      n: samples.length, dx: Number(dx.toFixed(1)), dy: Number(dy.toFixed(1)),
      xs: [...new Set(xs.map((v) => Math.round(v)))],
      ys: [...new Set(ys.map((v) => Math.round(v)))],
      tokYs: [...new Set(samples.map((s) => s.tokY))],
      cardTop: [...new Set(samples.map((s) => s.cardTop))],
      cardH: [...new Set(samples.map((s) => s.cardH))],
      tr: [...new Set(samples.map((s) => s.tr))],
      topStyle: [...new Set(samples.map((s) => s.topStyle))],
    }));
    expect(dx, `x varied ${dx.toFixed(1)} px across ${samples.length} samples`).toBeLessThanOrEqual(2);
    expect(dy, `y varied ${dy.toFixed(1)} px across ${samples.length} samples`).toBeLessThanOrEqual(2);
    // Requirement 3: never outside the frame — the buggy card reached −17 px.
    expect(Math.min(...ys), 'the button never leaves the frame').toBeGreaterThanOrEqual(0);

    // A trusted click ~1 s in — content still arriving — must reach the
    // handler: the pronunciation audio URL is requested. The pointer walks
    // to the button (humanClick), never teleports.
    const btn = (await hitsOf(page, VIDEO_HOST)).find((hit) => hit.label === LABEL.pronounce);
    await humanClick(page, btn!.cx, btn!.cy);
    await expect
      .poll(() => audioRequests.length, { timeout: 8_000, message: 'the pronunciation handler ran (audio requested)' })
      .toBeGreaterThan(0);
  } finally {
    await page.close();
  }
});

