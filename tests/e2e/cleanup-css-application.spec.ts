/**
 * PR #169 — the "Limpieza visual" sheet, measured by a REAL Chromium engine.
 *
 * `e945085` joined the selector lists with a bare newline, so the sheet was one
 * descendant selector that matched nothing: every probe below stayed fully
 * visible on the real page while a text assertion on the sheet still passed.
 * This spec injects the native chrome the sheet targets, lets the pointer go
 * idle over the video (the toggle only hides while the pointer rests), and
 * reads `getComputedStyle` in the browser.
 */
import { expect, test } from './fixtures';
import { readFixture, VIDEO_HOST } from './helpers';

const TTML = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="en"><body><div>
<p begin="0s" end="9s">RUN is hard work</p>
</div></body></tt>`;

async function openNetflix(context: import('@playwright/test').BrowserContext): Promise<import('@playwright/test').Page> {
  const page = await context.newPage();
  await page.route('*://*.nflxvideo.net/**', (route) => route.fulfill({
    status: 200, contentType: 'application/xml',
    headers: { 'access-control-allow-origin': '*' }, body: TTML,
  }));
  await page.route('*://*.netflix.com/**', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: readFixture('player-netflix.html'),
  }));
  await page.goto('https://www.netflix.com/watch/80057281');
  await page.bringToFront();
  await page.waitForFunction(
    () => (window as Window & { __kivaraFixtureReady?: unknown }).__kivaraFixtureReady !== undefined,
    undefined, { timeout: 30_000 },
  );
  await expect.poll(
    () => page.evaluate(() => !!document.getElementById('kivara-lingo-video-host')),
    { timeout: 15_000 },
  ).toBe(true);
  return page;
}

/** The native chrome the cleanup sheet targets, as the real page ships it. */
const PROBE_MARKUP = `
  <div class="PlayerControlsNeo__top-controls" id="probe-top"></div>
  <div class="PlayerControlsNeo__bottom-controls" id="probe-native-row"></div>
  <div class="watch-video--bottom-gradient" id="probe-gradient"></div>
  <div data-uia="player-controls" id="probe-row">
    <div data-uia="selector-audio-subtitle" id="probe-cc">CC</div>
    <div role="menu" id="probe-menu"></div>
  </div>
  <div role="dialog" id="probe-player-dialog"></div>
`;

/** A page-level dialog, OUTSIDE the player: our sheets must not reach it. */
const OUTSIDE_MARKUP = '<div role="dialog" id="probe-outside-dialog"></div>';

function styleOf(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const read = (id: string) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const style = getComputedStyle(el);
      return { visibility: style.visibility, opacity: style.opacity, pointerEvents: style.pointerEvents };
    };
    return {
      top: read('probe-top'),
      nativeRow: read('probe-native-row'),
      gradient: read('probe-gradient'),
      cc: read('probe-cc'),
      menu: read('probe-menu'),
      playerDialog: read('probe-player-dialog'),
      cleanupSheet: !!document.getElementById('kivara-cleanup-netflix'),
      ownedBarSheet: !!document.getElementById('kivara-owned-bar-netflix'),
      // The exception selector lists, as the browser parsed them.
      cleanupExceptions: [...((document.getElementById('kivara-cleanup-netflix') as HTMLStyleElement | null)?.sheet?.cssRules ?? [])]
        .map((rule) => (rule as CSSStyleRule).selectorText)
        .filter((text) => text?.includes('selector-audio-subtitle')),
      ownedExceptions: [...((document.getElementById('kivara-owned-bar-netflix') as HTMLStyleElement | null)?.sheet?.cssRules ?? [])]
        .map((rule) => (rule as CSSStyleRule).selectorText)
        .filter((text) => text?.includes('selector-audio-subtitle')),
      /**
       * Whether ANY of our sheets has a rule matching the page-level dialog.
       * `getComputedStyle` cannot answer this: in a real browser an unstyled
       * element reports `opacity: 1`, the CSS initial value, so only the
       * selector match distinguishes "we styled it" from "nobody did".
       */
      outsideDialogMatched: (() => {
        const el = document.getElementById('probe-outside-dialog');
        if (!el) return true;
        const sheets = [...document.querySelectorAll('style[id^="kivara-"]')] as HTMLStyleElement[];
        return sheets.some((sheet) => [...(sheet.sheet?.cssRules ?? [])].some((rule) => {
          const selectorText = (rule as CSSStyleRule).selectorText;
          if (!selectorText) return false;
          try {
            return el.matches(selectorText);
          } catch {
            return false;
          }
        }));
      })(),
    };
  });
}

test('the cleanup sheet hides the real chrome and keeps the native CCS menu usable', async ({ context }) => {
  test.setTimeout(120_000);
  const page = await openNetflix(context);
  try {
    // The toggles ship ON by default (DEFAULT_CLEANUP), so both sheets are up.
    await page.evaluate(({ markup, outside }) => {
      const wrapper = document.querySelector('.watch-video');
      if (!wrapper) throw new Error('the fixture has no .watch-video wrapper');
      wrapper.insertAdjacentHTML('beforeend', markup);
      document.body.insertAdjacentHTML('beforeend', outside);
    }, { markup: PROBE_MARKUP, outside: OUTSIDE_MARKUP });

    // The chrome only hides while the pointer RESTS over the video: park it
    // off the player and give the 2.5 s idle timer room to fire.
    await page.mouse.move(1200, 40);
    await page.waitForTimeout(1_200);
    await page.mouse.move(320, 300);
    await page.waitForTimeout(3_400);

    const state = await styleOf(page);
    expect(state.cleanupSheet, 'the cleanup sheet is mounted for netflix').toBe(true);
    expect(state.ownedBarSheet, 'the owned-bar sheet is mounted for netflix').toBe(true);

    // The chrome: hidden, and NOT faded (opacity is the shadow toggle's job).
    expect(state.top, 'the top controls exist').not.toBeNull();
    expect(state.top!.visibility, 'the chrome is hidden').toBe('hidden');
    expect(state.top!.pointerEvents).toBe('none');
    expect(state.top!.opacity).not.toBe('0');
    // The native row the owned bar replaces: hidden by whichever sheet, and
    // never faded.
    expect(state.nativeRow, 'the native row probe exists').not.toBeNull();
    expect(state.nativeRow!.visibility, 'the native row is hidden').toBe('hidden');
    expect(state.nativeRow!.opacity).not.toBe('0');

    // The shadow: faded AND hidden.
    expect(state.gradient, 'the gradient probe exists').not.toBeNull();
    expect(state.gradient!.opacity, 'the gradient fades').toBe('0');
    expect(state.gradient!.visibility).toBe('hidden');

    // The native popups inside the hidden row stay visible and clickable.
    expect(state.cc!.visibility, 'the CC menu stays visible').toBe('visible');
    expect(state.cc!.opacity).toBe('1');
    expect(state.cc!.pointerEvents).toBe('auto');
    expect(state.menu!.visibility, 'the scoped native menu stays visible').toBe('visible');
    expect(state.menu!.opacity).toBe('1');
    // `[role="dialog"]` is exempted ONLY inside the player subtree.
    expect(state.playerDialog!.visibility, 'a dialog INSIDE the player is exempted').toBe('visible');
    expect(state.playerDialog!.opacity).toBe('1');

    // Both sheets carry the SAME exception list, so the one mounted last
    // cannot re-hide what the owned bar exempted.
    expect(state.cleanupExceptions.length).toBeGreaterThan(0);
    expect(state.cleanupExceptions).toEqual(state.ownedExceptions);
    // Scoped, never bare: a page-level `[role="menu"]` must not match.
    for (const text of state.cleanupExceptions) {
      expect(text).not.toMatch(/(^|,)\s*\[role="(menu|dialog)"\]/);
    }

    // A dialog OUTSIDE the player is untouched by our sheets.
    expect(state.outsideDialogMatched, 'the page dialog is not matched by our sheets').toBe(false);
  } finally {
    await page.close();
  }
});

test('a second measurement keeps the same values after the sheet is re-applied', async ({ context }) => {
  test.setTimeout(120_000);
  const page = await openNetflix(context);
  try {
    await page.evaluate((markup) => {
      document.querySelector('.watch-video')?.insertAdjacentHTML('beforeend', markup);
    }, PROBE_MARKUP);
    await page.mouse.move(320, 300);
    await page.waitForTimeout(3_400);
    const first = await styleOf(page);
    // The contract, so this is not just "two equally broken measurements".
    expect(first.top?.visibility, 'the chrome is hidden').toBe('hidden');
    expect(first.gradient?.opacity, 'the gradient fades').toBe('0');
    expect(first.cc?.visibility, 'the native CC stays usable').toBe('visible');
    // The sheet is rebuilt whenever the toggles or the idle state change; the
    // values must not drift.
    await page.mouse.move(1200, 40);
    await page.waitForTimeout(200);
    await page.mouse.move(320, 300);
    await page.waitForTimeout(3_400);
    const second = await styleOf(page);
    expect(second.top).toEqual(first.top);
    expect(second.gradient).toEqual(first.gradient);
    expect(second.cc).toEqual(first.cc);
    expect(second.menu).toEqual(first.menu);
    // Sanity: the fixture really carries our host, so the sheets belong to it.
    expect(await page.evaluate((id) => !!document.getElementById(id), VIDEO_HOST)).toBe(true);
  } finally {
    await page.close();
  }
});
