/**
 * The behaviour surface, end to end on the TWO-TRACK fixture
 * (`fixtures/player-dual.html`).
 *
 * The fixture is a real YouTube-shaped page: no `<track>`, a caption DOM the
 * player repaints on a 0–3 / 3–6 / 6–9 s timer, and one `/api/timedtext`
 * request for the EN track. The MAIN-world interceptor captures it, the bus
 * then asks for `&tlang=es` on its own, and the overlay shows both lines. Every
 * case here drives the BUILT extension through the E2E hit map — real mouse
 * gestures on the real controls of a CLOSED shadow root — and reads only what
 * the build publishes for the suite (`data-kivara-e2e-*`), never internals.
 *
 * The three sentences are the shared vocabulary of the whole file: the EN
 * track in the fixture, the json3 bodies below and the ES track the bus
 * fetches all line up on 0–3 / 3–6 / 6–9 s.
 */
import type { BrowserContext } from '@playwright/test';
import { test, expect, type Page } from './fixtures';
import {
  armBar,
  clickInRoot,
  clickRow,
  clickSpeed,
  clickToken,
  hitsOf,
  hitStartingWith,
  LABEL,
  lastTokenOf,
  mouseAway,
  openPlayer,
  overlaps,
  parkAt,
  paused,
  play,
  pressedInRoot,
  rate,
  readFixture,
  rowsOf,
  seekTo,
  stateOf,
  time,
  tokensOf,
  translationOf,
  waitForHits,
  waitForLine,
  waitForState,
  waitForTranslation,
  boxesOf,
  hoverToken,
  PANEL_HOST,
  VIDEO_HOST,
} from './helpers';

const FIXTURE = readFixture('player-dual.html');

const EN = [
  'Hello, this is a test cue.',
  'The rat ships frames and audio.',
  'Every crumb gets gnawed.',
];

const ES = [
  'Hola, esta es una prueba.',
  'La rata envía fotogramas y audio.',
  'Cada migaja se roe.',
];

/** YouTube json3 for the three 3-second lines. */
function json3(lines: readonly string[]): string {
  return JSON.stringify({
    events: lines.map((text, index) => ({
      tStartMs: index * 3000,
      dDurationMs: 3000,
      segs: [{ utf8: text }],
    })),
  });
}

/**
 * Open the dual fixture. `tlang=es` is the auto-translated request the bus
 * makes for itself; everything else is the original EN track.
 */
async function openDual(context: BrowserContext): Promise<Page> {
  return openPlayer(context, {
    fixture: FIXTURE,
    timedtext: (url) => json3(url.searchParams.get('tlang') === 'es' ? ES : EN),
  });
}

/** Open the transcript rail through the StudyBar's own button. */
async function openRail(page: Page): Promise<void> {
  await armBar(page);
  // The bar itself carries `aria-label="Transcripción"` (its toolbar name), so
  // the RAIL TOGGLE is the match with no text (the chips are icon-only there).
  await clickInRoot(page, VIDEO_HOST, LABEL.railToggle, (hit) => hit.text === '');
  await waitForState(
    page,
    PANEL_HOST,
    (state) => state.rows.length >= 3,
    'the transcript rail painted its three lines',
  );
}

/**
 * Hover the caption plate's PADDING (not a word) so the sentence toolbar
 * opens: `toolbarOpen` requires the plate hovered with no card and no
 * selection, so a point on a token would open the word card instead.
 */
async function hoverPlatePadding(page: Page): Promise<void> {
  const tokens = await tokensOf(page);
  const first = tokens[0];
  if (!first) throw new Error('no tokens painted');
  await page.mouse.move(first.x - 8, first.y + first.height / 2);
  // The toolbar fades in over 300 ms; clicking before that lands on a
  // pointer-events-none layer.
  await page.waitForTimeout(450);
}

test.describe('bilingual line (bus + overlay + transcript)', () => {
  test('the ES line shows in the overlay caption and in the transcript rail', async ({ context }) => {
    test.setTimeout(90_000);
    const page = await openDual(context);
    await parkAt(page, 1);
    // Overlay: the bus supplied the `&tlang=es` track, so the translated
    // caption paints under the source line.
    await waitForTranslation(page, /Hola, esta es una prueba\./);
    expect(EN[0]).not.toBe(await translationOf(page).then((line) => line?.text));

    await openRail(page);
    const rows = await rowsOf(page);
    expect(rows[0].text).toBe(EN[0]);
    expect(rows[0].native).toBe(ES[0]);
    // ... and the rail is the panel root's VISIBLE tab, so the line is on
    // screen, not merely in the DOM.
    const panel = await stateOf(page, PANEL_HOST);
    expect(panel.text).toContain(ES[0]);
    await page.close();
  });

  test('translation switch: visible → blurred → hidden hides the ES line', async ({ context }) => {
    test.setTimeout(90_000);
    const page = await openDual(context);
    await parkAt(page, 1);
    await waitForTranslation(page, /Hola, esta es una prueba\./);
    const visible = await translationOf(page);
    expect(visible?.filtered).toBe(false);

    await openRail(page);
    // The rail's eye button carries the NEXT mode as its name, so its label
    // proves the switch moved.
    await clickInRoot(page, PANEL_HOST, LABEL.translationShow);
    await expect.poll(
      async () => (await translationOf(page))?.filtered,
      { timeout: 8_000 },
    ).toBe(true);
    // Blurred, not gone: the words are still rendered.
    expect((await translationOf(page))?.text).toBe(ES[0]);
    expect((await rowsOf(page))[0].native).toBe(ES[0]);
    expect((await rowsOf(page))[0].nativeFiltered).toBe(true);

    await clickInRoot(page, PANEL_HOST, LABEL.translationBlur);
    await expect.poll(
      async () => (await translationOf(page))?.text ?? '',
      { timeout: 8_000 },
    ).toBe('');
    const rowsHidden = await rowsOf(page);
    expect(rowsHidden[0].native).toBe('');
    expect((await stateOf(page, VIDEO_HOST)).text).not.toContain(ES[0]);
    await page.close();
  });
});

test.describe('transcript rail', () => {
  test('searching an ES-only word finds one line and Enter seeks to it', async ({ context }) => {
    test.setTimeout(90_000);
    const page = await openDual(context);
    await parkAt(page, 1);
    await openRail(page);

    // The search icon becomes the input; the second click lands on the input
    // itself, so the keystrokes are guaranteed to go into it.
    await clickInRoot(page, PANEL_HOST, LABEL.search);
    await page.waitForTimeout(250);
    await clickInRoot(page, PANEL_HOST, LABEL.search);
    await page.keyboard.type('migaja');
    // «migaja» exists ONLY in the ES track: the rail's search covers the
    // translated line, so exactly one sentence matches.
    await waitForState(
      page,
      PANEL_HOST,
      (state) => state.live.some((text) => text.includes('1 frase')),
      'the search count reads one line',
    );
    expect((await rowsOf(page)).map((row) => row.index)).toEqual([2]);

    await page.keyboard.press('Enter');
    await waitForState(
      page,
      PANEL_HOST,
      (state) => state.live.some((text) => text.includes('1 de 1')),
      'the search position reads 1 of 1',
    );
    // Cue 3 starts at 6 s; the clip ends shortly after, so "near its start"
    // is the last half-second of the media.
    await expect.poll(() => time(page), { timeout: 8_000 }).toBeGreaterThan(5.5);
    await page.close();
  });

  test('clicking a rail line seeks the video near its start', async ({ context }) => {
    test.setTimeout(90_000);
    const page = await openDual(context);
    await parkAt(page, 1);
    await openRail(page);
    await clickRow(page, 1);
    await expect.poll(() => time(page), { timeout: 8_000 }).toBeGreaterThan(2.9);
    expect(await time(page)).toBeLessThan(5.2);
    await page.close();
  });
});

test.describe('word card', () => {
  for (const size of [{ width: 640, height: 360 }, { width: 1280, height: 720 }] as const) {
    test(`opens on the LAST word of the line at ${size.width}×${size.height}`, async ({ context }) => {
      test.setTimeout(90_000);
      const page = await openDual(context);
      await page.setViewportSize({ width: size.width, height: size.height });
      await parkAt(page, 1);
      await waitForLine(page, 'Hello this is a test cue');

      const last = await lastTokenOf(page);
      expect(last.text).toBe('cue');
      await hoverToken(page, last.text);
      await waitForHits(
        page,
        VIDEO_HOST,
        (hits) => hits.some((hit) => hit.label === `Entrada de diccionario — ${last.text}`),
        `the word card opened for the last word at ${size.width}×${size.height}`,
      );
      // The card is the LAST word's, not the first match of some other token.
      const hits = await hitsOf(page, VIDEO_HOST);
      const card = hits.find((hit) => hit.label.startsWith('Entrada de diccionario'));
      expect(card?.label.endsWith(`— ${last.text}`)).toBe(true);
      await page.close();
    });
  }
});

test.describe('card registry (no deck configured)', () => {
  test('saving without a deck fails with the no-deck code, not silently', async ({ context, serviceWorker }) => {
    test.setTimeout(120_000);
    const page = await openDual(context);
    await parkAt(page, 1);
    await waitForLine(page, 'Hello this is a test cue');

    // Save through the word card's own button (the same path a user takes).
    await hoverToken(page, 'cue');
    await waitForHits(
      page,
      VIDEO_HOST,
      (hits) => hits.some((hit) => hit.label === LABEL.save),
      'the word card is open with its save action',
    );
    await clickInRoot(page, VIDEO_HOST, LABEL.save);

    // The service worker writes the registry; no deck means the CARD still
    // gets a row, with status `failed` and the classified code `no-deck`.
    await expect.poll(
      () => serviceWorker.evaluate(async () => {
        const got = await chrome.storage.local.get('kvl:cards.recent');
        const rows = got['kvl:cards.recent'];
        return Array.isArray(rows) ? rows.length : 0;
      }),
      { timeout: 30_000, message: 'the card reached the registry' },
    ).toBeGreaterThan(0);

    const row = await serviceWorker.evaluate(async () => {
      const got = await chrome.storage.local.get('kvl:cards.recent');
      const rows = (got['kvl:cards.recent'] ?? []) as Array<{
        word?: string; status?: string; errorCode?: string;
      }>;
      return rows.find((candidate) => candidate.word === 'cue') ?? null;
    });
    expect(row?.status).toBe('failed');
    expect(row?.errorCode).toBe('no-deck');

    // ... and the panel RENDERS the code's label on that row. The panel tab is
    // opened with the real button; the row is read from the published text.
    await armBar(page);
    await clickInRoot(page, VIDEO_HOST, LABEL.panelToggle);
    await waitForHits(
      page,
      PANEL_HOST,
      (hits) => hits.some((hit) => hit.label === LABEL.panelTabCards),
      'the panel opened with its Cards tab',
    );
    await clickInRoot(page, PANEL_HOST, LABEL.panelTabCards);
    await waitForState(
      page,
      PANEL_HOST,
      (state) => state.text.includes('No hay mazo de Anki configurado'),
      'the failed row renders the noDeck label',
    );
    const panel = await stateOf(page, PANEL_HOST);
    expect(panel.text).toContain('Sin enviar');
    await page.close();
  });
});

test.describe('study marks', () => {
  test('"know the rest" then a selective undo keeps one word as learning', async ({ context }) => {
    test.setTimeout(120_000);
    const page = await openDual(context);
    // Line 2 is the vocabulary-dense one: rat / ships / frames / audio.
    await parkAt(page, 4);
    // Wait for the SOURCE cue, not its translation: the alt lookup runs on the
    // playhead and can supply the ES line a tick before the overlay repaints
    // the line it belongs to.
    await waitForLine(page, 'The rat ships frames and audio');

    const before = await tokensOf(page);
    const fresh = before.filter((token) => token.status === 'new');
    expect(fresh.length, 'the line has at least two new words').toBeGreaterThanOrEqual(2);
    const learningWord = fresh[0].text;
    const revertWord = fresh[1].text;

    await hoverPlatePadding(page);
    const knowRest = await hitStartingWith(page, VIDEO_HOST, LABEL.knowRest);
    await page.mouse.click(knowRest.cx, knowRest.cy);
    // The marks go through chrome.storage: wait for the repaint, do not race
    // the write.
    await expect.poll(
      async () => (await tokensOf(page)).find((token) => token.text === learningWord)?.status,
      { timeout: 6_000, message: 'the know-rest marks landed' },
    ).toBe('known');
    const marked = await tokensOf(page);
    expect(marked.find((token) => token.text === revertWord)?.status).toBe('known');

    // Re-mark ONE of them by hand through its card's status selector.
    await hoverToken(page, learningWord);
    await waitForHits(
      page,
      VIDEO_HOST,
      (hits) => hits.some((hit) => hit.label === LABEL.learning),
      'the card exposes the status selector',
    );
    await clickInRoot(page, VIDEO_HOST, LABEL.learning);
    await expect.poll(
      async () => (await tokensOf(page)).find((token) => token.text === learningWord)?.status,
      { timeout: 6_000 },
    ).toBe('learning');

    // The toast's Undo reverts only what nobody has touched since.
    // The toast's action is inside a toast that is still entering: it lives
    // above the viewport until sonner mounts it. Click it only once it is
    // actually on screen (the publisher's toast tick keeps the rect honest).
    await waitForHits(
      page,
      PANEL_HOST,
      (hits) => hits.some((hit) => hit.label === 'Deshacer' && hit.cy > 8),
      'the know-rest notice offers a clickable Undo',
      15_000,
    );
    await clickInRoot(page, PANEL_HOST, 'Deshacer');

    await expect.poll(
      async () => (await tokensOf(page)).find((token) => token.text === revertWord)?.status,
      { timeout: 6_000 },
    ).toBe('new');
    // The hand mark survives the undo: that is the whole point of the rule.
    expect((await tokensOf(page)).find((token) => token.text === learningWord)?.status)
      .toBe('learning');
    await page.close();
  });

  test('Shift+click over two words opens the selection toolbar', async ({ context }) => {
    test.setTimeout(90_000);
    const page = await openDual(context);
    await parkAt(page, 1);
    await waitForLine(page, 'Hello this is a test cue');

    await clickToken(page, 'test', true);
    await clickToken(page, 'cue', true);
    await waitForHits(
      page,
      VIDEO_HOST,
      (hits) => hits.some((hit) => hit.label.startsWith(LABEL.saveSelection)),
      'the free-selection toolbar appears',
    );
    const button = await hitStartingWith(page, VIDEO_HOST, LABEL.saveSelection);
    expect(button.text).toBe('Guardar selección');
    // Selecting is not saving: nothing is created by the gesture alone.
    await mouseAway(page);
    await page.close();
  });
});

test.describe('study playback by button', () => {
  test('loop button restarts the cue instead of running past it', async ({ context }) => {
    test.setTimeout(90_000);
    const page = await openDual(context);
    await parkAt(page, 1);
    await armBar(page);
    await clickInRoot(page, VIDEO_HOST, LABEL.loop);
    await expect.poll(() => pressedInRoot(page, VIDEO_HOST, LABEL.loop), { timeout: 5_000 })
      .toBe('true');
    await play(page);
    // From 1 s, the cue ends at 3 s: a loop returns to its start, so after
    // 4.5 s the playhead is back in the first cue (and never reached the end).
    await page.waitForTimeout(4500);
    expect(await paused(page)).toBe(false);
    expect(await time(page)).toBeLessThan(4);
    await page.close();
  });

  test('auto-pause button stops at the end of the cue', async ({ context }) => {
    test.setTimeout(90_000);
    const page = await openDual(context);
    await parkAt(page, 1);
    await armBar(page);
    await clickInRoot(page, VIDEO_HOST, LABEL.autoPause);
    await expect.poll(() => pressedInRoot(page, VIDEO_HOST, LABEL.autoPause), { timeout: 5_000 })
      .toBe('true');
    await play(page);
    await expect.poll(() => paused(page), { timeout: 12_000 }).toBe(true);
    const at = await time(page);
    expect(at).toBeGreaterThanOrEqual(2.85);
    expect(at).toBeLessThanOrEqual(3.6);
    await page.close();
  });

  test('speed radios apply 1.25× and 0.75× by click', async ({ context }) => {
    test.setTimeout(90_000);
    const page = await openDual(context);
    await parkAt(page, 1);
    await armBar(page);
    await clickSpeed(page, '1.25×');
    await expect.poll(() => rate(page), { timeout: 5_000 }).toBeCloseTo(1.25, 3);
    await clickSpeed(page, '0.75×');
    await expect.poll(() => rate(page), { timeout: 5_000 }).toBeCloseTo(0.75, 3);
    await page.close();
  });
});

/**
 * Regressions B5 / B6 / B7 on the dual-track fixture.
 *
 * B5 — a SEEK is a jump, not playback: the end it skips was never played, so
 *      it must not loop or auto-pause.
 * B6 — the bar and the corner icons live outside the caption plate: no token
 *      may sit under either of them, at either player size.
 * B7 — the translated line for 5.7 s is the bus's 3–6 s cue (real start/end),
 *      not the one that merely happens to be emitted next.
 */
test.describe('regressions', () => {
  test('B5: a forward seek is not the cue end', async ({ context }) => {
    test.setTimeout(90_000);
    const page = await openDual(context);
    await parkAt(page, 1);
    await armBar(page);
    await clickInRoot(page, VIDEO_HOST, LABEL.autoPause);
    await expect.poll(() => pressedInRoot(page, VIDEO_HOST, LABEL.autoPause), { timeout: 5_000 })
      .toBe('true');
    await play(page);
    await page.waitForTimeout(300);

    // 1.x → 4.2 s: past cue 1's end, which was never played.
    await seekTo(page, 4.2);
    await expect.poll(() => time(page), { timeout: 4_000 }).toBeGreaterThan(4.9);
    expect(await paused(page)).toBe(false);

    // The genuine end of cue 2 (6 s) still pauses.
    await expect.poll(() => paused(page), { timeout: 6_000 }).toBe(true);
    const at = await time(page);
    expect(at).toBeGreaterThanOrEqual(5.85);
    expect(at).toBeLessThanOrEqual(6.6);
    await page.close();
  });

  for (const size of [{ width: 640, height: 360 }, { width: 1280, height: 720 }] as const) {
    test(`B6: no token under the bar or the corner icons at ${size.width}×${size.height}`, async ({ context }) => {
      test.setTimeout(90_000);
      const page = await openDual(context);
      await page.setViewportSize({ width: size.width, height: size.height });
      // The fixture's stage is a fixed 640×360 box; the PLAYER is what the
      // overlay measures, so the wide case has to be a wide player.
      await page.addStyleTag({
        content: '#stage{width:100vw !important;height:100vh !important;max-height:100vh}',
      });
      await parkAt(page, 1.2);
      await waitForLine(page, 'Hello this is a test cue');
      await armBar(page);
      await expect.poll(async () => (await boxesOf(page)).tokens.length, { timeout: 8_000 })
        .toBeGreaterThan(2);

      const { bar, badges, tokens } = await boxesOf(page);
      expect(bar).toBeTruthy();
      expect(badges.length).toBeGreaterThanOrEqual(2);
      const barCovered = tokens.filter((token) => overlaps(bar!, token));
      expect(barCovered, `${barCovered.length} token(s) under the bar`).toEqual([]);
      for (const badge of badges) {
        const covered = tokens.filter((token) => overlaps(badge, token));
        expect(covered, `${covered.length} token(s) under a corner icon`).toEqual([]);
        expect(overlaps(bar!, badge), 'the bar overlaps a corner icon').toBe(false);
      }
      await page.close();
    });
  }

  test('B7: after seeking to 5.7 s the ES line is the 3–6 s cue', async ({ context }) => {
    test.setTimeout(90_000);
    const page = await openDual(context);
    // Play into the second cue naturally: the caption DOM then carries the
    // second sentence and the active cue keeps the real 3–6 s window.
    await page.waitForFunction(() => document.querySelector('video')!.currentTime > 3.15);
    await expect.poll(
      async () => (await tokensOf(page)).map((token) => token.text).join(' '),
      { timeout: 8_000 },
    ).toContain('rat');

    await page.evaluate(() => {
      const video = document.querySelector('video')!;
      video.pause();
      video.currentTime = 5.7;
    });
    await expect.poll(() => time(page), { timeout: 5_000 }).toBeGreaterThan(5.4);

    const line = await waitForTranslation(page, /La rata envía fotogramas y audio\./);
    expect(line).toBe(ES[1]);
    expect(line).not.toContain('migaja');
    // The source line is the same cue, so the pair is aligned.
    expect((await tokensOf(page)).map((token) => token.text)).toContain('rat');
    await page.close();
  });
});
