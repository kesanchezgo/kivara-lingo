/**
 * PR #172 — Kivara's own Audio/Subtitles and Episodes menus, in a real browser.
 *
 * The point of the PR is that the user never has to open Netflix's own drawer,
 * so this spec clicks OUR buttons and then asserts what the page can see: the
 * fixture records the track switches the player received (object or id, the way
 * a real Cadmium session does), the hit map publishes our controls and their
 * checked state, and the episode picker lists the seasons of the graph.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import {
  auditClosedRoot,
  describeViolations,
  hitsOf,
  inClosedRoot,
  readFixture,
  VIDEO_HOST,
  VIDEO_REACT_ROOT_ID,
} from './helpers';

const TTML = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="en"><body><div>
<p begin="0s" end="9s">RUN is hard work</p>
</div></body></tt>`;

async function openNetflix(context: import('@playwright/test').BrowserContext): Promise<import('@playwright/test').Page> {
  const page = await context.newPage();
  // The menus are measured: one fixed, comparable viewport for every case.
  await page.setViewportSize({ width: 1280, height: 720 });
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

const labels = async (page: import('@playwright/test').Page) =>
  (await hitsOf(page, VIDEO_HOST)).map((hit) => hit.label);
const pressed = async (page: import('@playwright/test').Page, label: string) =>
  (await hitsOf(page, VIDEO_HOST)).find((hit) => hit.label === label)?.pressed;
const audioSwitches = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as Window & { __kivaraAudioSwitch?: string[] }).__kivaraAudioSwitch ?? []);
const subtitleSwitches = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as Window & { __kivaraSubtitleSwitch?: string[] }).__kivaraSubtitleSwitch ?? []);

/**
 * Click one of OUR controls by its published label.
 *
 * The tray auto-hides after 3s of playback, and its controls (and our menus)
 * leave the hit map with it: the pointer is woken first and the label is waited
 * for, so the click lands on the real button instead of on nothing.
 */
async function clickHit(page: import('@playwright/test').Page, label: string): Promise<void> {
  await page.mouse.move(400, 300);
  await expect.poll(async () => (await labels(page)).includes(label), {
    timeout: 10_000, message: `the hit map published "${label}"`,
  }).toBe(true);
  const hit = (await hitsOf(page, VIDEO_HOST)).find((entry) => entry.label === label)!;
  await page.mouse.move(hit.cx, hit.cy);
  await page.mouse.click(hit.cx, hit.cy);
  await page.waitForTimeout(250);
}

test('our own audio and subtitles menu drives the player', async ({ context }) => {
  test.setTimeout(150_000);
  const page = await openNetflix(context);
  try {
    await clickHit(page, 'Subtítulos de Netflix');
    // Our menu, not Netflix's drawer: the Off row and the audio list are ours.
    const open = await labels(page);
    expect(open, 'the menu opened with the Off row').toContain('Desactivados');
    expect(open, 'and the audio tracks').toContain('English');

    // Reading the menu takes longer than the tray's 3s auto-hide: the tray must
    // stay on screen while a menu is open, or the menu it anchors disappears
    // with it.
    await page.waitForTimeout(3_600);
    expect(await labels(page), 'the menu survives the auto-hide window').toContain('Desactivados');

    // Audio: the object path is what a modern Cadmium session wants.
    await clickHit(page, 'English');
    expect(await audioSwitches(page), 'the player received the track').toContain('object:A:en');

    // Translation lives in Kivara: clicking it flips the checked radio.
    await clickHit(page, 'Difuminada');
    expect(await pressed(page, 'Difuminada')).toBe('true');

    // Off: the none-track plus the visibility flag.
    await clickHit(page, 'Desactivados');
    expect(await subtitleSwitches(page), 'the Off track is selected on the player').toContain('T:none');

    // The trigger toggles: pressing it again closes the menu.
    await clickHit(page, 'Subtítulos de Netflix');
    expect(await labels(page), 'the second press closes it').not.toContain('Desactivados');

    // And Escape closes it too (without touching fullscreen handling).
    await clickHit(page, 'Subtítulos de Netflix');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    expect(await labels(page), 'the menu is gone').not.toContain('Desactivados');
  } finally {
    await page.close();
  }
});

test('our own episodes menu lists the seasons of the graph', async ({ context }) => {
  test.setTimeout(150_000);
  const page = await openNetflix(context);
  try {
    await clickHit(page, 'Episodios');
    const open = await labels(page);
    // The menu opens on the season the video belongs to, with the episode that
    // is playing marked, and both seasons offered.
    expect(open.some((label) => label.includes('Chapter One')), 'the season of the video').toBe(true);
    expect(open.some((label) => label.includes('Chapter Two') && label.includes('Actual')), 'the episode playing').toBe(true);

    // Switching season re-lists that season's episodes.
    const seasonTwo = (await hitsOf(page, VIDEO_HOST)).find((hit) => hit.label.includes('Temporada 2'));
    expect(seasonTwo, 'the season pills are published').toBeTruthy();
    await page.mouse.click(seasonTwo!.cx, seasonTwo!.cy);
    await page.waitForTimeout(300);
    const second = await labels(page);
    expect(second.some((label) => label.includes('Chapter Nine')), 'the other season episode').toBe(true);
    expect(second.some((label) => label.includes('Chapter One')), 'and the first season is gone').toBe(false);
  } finally {
    await page.close();
  }
});

test('the overlay with our menu open has no WCAG A/AA violations', async ({ context }) => {
  test.setTimeout(150_000);
  const page = await openNetflix(context);
  try {
    await clickHit(page, 'Subtítulos de Netflix');
    // Two audits, because our menu lives in a CLOSED root that axe cannot walk
    // from the page: the page itself, and the OPEN menu inside the root. The
    // runner clones the root into a temporary open shadow root over CDP, so the
    // real radios, their radiogroup parents and the Traduccion group are judged
    // instead of a reconstruction of them.
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(
      results.violations.map((violation) => `${violation.id}: ${violation.nodes.length}`),
      'no WCAG A/AA violations with the menu open',
    ).toEqual([]);

    const { violations, elements } = await auditClosedRoot(page, VIDEO_REACT_ROOT_ID);
    expect(elements, 'the audit really saw our open chrome').toBeGreaterThan(20);
    expect(describeViolations(violations), 'no WCAG A/AA violations inside the closed root').toBe('');
  } finally {
    await page.close();
  }
});

test('the menus use the real height above the tray, scroll and return the focus', async ({ context }) => {
  test.setTimeout(150_000);
  const page = await openNetflix(context);
  try {
    // ── The tracks menu: seven dubs do not fit in a 180px box ──────────────
    await clickHit(page, 'Subtítulos de Netflix');
    const tracks = await inClosedRoot(page, VIDEO_REACT_ROOT_ID, function (this: ParentNode) {
      const pop = this.querySelector('[data-kvl-track-popover]') as HTMLElement | null;
      const scroll = pop?.querySelector('.kvl-popover-scroll') as HTMLElement | null;
      const footer = pop?.lastElementChild as HTMLElement | null;
      const popRect = pop?.getBoundingClientRect();
      const footerRect = footer?.getBoundingClientRect();
      return {
        height: Math.round(popRect?.height ?? 0),
        footerInside:
          !!popRect && !!footerRect && footerRect.bottom <= popRect.bottom + 1 && footerRect.top >= popRect.top - 1,
        radios: pop?.querySelectorAll('[role="radio"]').length ?? 0,
        groups: pop?.querySelectorAll('[role="radiogroup"]').length ?? 0,
        columnsScroll: !!scroll && scroll.scrollHeight > scroll.clientHeight,
      };
    });
    expect(tracks.height, 'the menu is not pinned to the 180px floor').toBeGreaterThan(220);
    expect(tracks.radios, 'seven dubs plus the subtitle and Traduccion rows').toBeGreaterThanOrEqual(10);
    expect(tracks.groups, 'audio, subtitles and Traduccion are radio groups').toBe(3);
    expect(tracks.footerInside, 'the Traduccion footer stays inside the menu').toBe(true);
    expect(tracks.columnsScroll, 'the track columns really scroll').toBe(true);

    // ── The episodes menu: the eighth episode is reachable ────────────────
    await page.keyboard.press('Escape');
    await clickHit(page, 'Episodios');
    const episodes = await inClosedRoot(page, VIDEO_REACT_ROOT_ID, function (this: ParentNode) {
      const pop = this.querySelector('[data-kvl-episodes-popover]') as HTMLElement | null;
      const list = pop?.querySelector('ul.kvl-popover-scroll') as HTMLElement | null;
      return {
        height: Math.round(pop?.getBoundingClientRect().height ?? 0),
        rows: list?.querySelectorAll('li').length ?? 0,
        canScroll: !!list && list.scrollHeight > list.clientHeight + 1,
      };
    });
    expect(episodes.rows, 'the season of the video lists eight episodes').toBe(8);
    expect(episodes.height, 'the menu is taller than the old floor').toBeGreaterThan(220);
    expect(episodes.canScroll, 'eight episodes do not fit without scrolling').toBe(true);

    const scrolled = await inClosedRoot(page, VIDEO_REACT_ROOT_ID, function (this: ParentNode) {
      const list = this.querySelector('ul.kvl-popover-scroll') as HTMLElement | null;
      if (!list) return null;
      list.scrollTop = list.scrollHeight;
      const last = list.lastElementChild as HTMLElement | null;
      const listRect = list.getBoundingClientRect();
      const lastRect = last?.getBoundingClientRect();
      return {
        moved: list.scrollTop > 0,
        lastText: last?.textContent ?? '',
        lastVisible:
          !!lastRect && !!listRect && lastRect.top >= listRect.top - 2 && lastRect.bottom <= listRect.bottom + 2,
      };
    });
    expect(scrolled?.moved, 'the list scrolled').toBe(true);
    expect(scrolled?.lastText, 'the eighth episode is the last row').toContain('Chapter Eight');
    expect(scrolled?.lastVisible, 'and it is visible once scrolled').toBe(true);

    // ── Escape gives the focus back to the button that opened it ─────────
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const after = await inClosedRoot(page, VIDEO_REACT_ROOT_ID, function (this: ParentNode) {
      const active = (this.getRootNode() as ShadowRoot).activeElement as HTMLElement | null;
      return {
        open: !!this.querySelector('[data-kvl-episodes-popover]'),
        trigger: active?.getAttribute('data-kvl-trigger') ?? null,
      };
    });
    expect(after.open, 'Escape closed the menu').toBe(false);
    expect(after.trigger, 'focus went to the Episodios button, not to the first button').toBe('episodes');
  } finally {
    await page.close();
  }
});
