/**
 * Shared plumbing for the browser-loaded E2E specs.
 *
 * The extension's UI lives in CLOSED shadow roots, so Playwright locators
 * cannot reach it and `page.evaluate` cannot read inside it. The E2E build
 * publishes three attributes on each shadow host (`src/content/ui/e2e-hitmap.ts`)
 * and these helpers are the only readers:
 *
 *   • `data-kivara-e2e-hits`   — every control's centre, for real mouse clicks;
 *   • `data-kivara-e2e-boxes`  — the bar, the corner icons and every token;
 *   • `data-kivara-e2e-state`  — READ surfaces: rail rows, translated lines,
 *                                live regions and the visible tab text.
 *
 * Nothing here types into an input or seeks with a JS call unless the case says
 * so: a click is a mouse click at the published coordinates, which is the same
 * gesture the user makes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page } from '@playwright/test';
import { expect } from './fixtures';

export const VIDEO_HOST = 'kivara-lingo-video-host';
export const PANEL_HOST = 'kivara-lingo-host';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(HERE, 'fixtures');

/** Read a fixture page verbatim; the route handler serves it at /watch. */
export function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}

/* ── Shapes published by the E2E build ─────────────────────────────────── */

export interface E2EBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface E2EHit {
  label: string;
  text: string;
  /** Viewport coordinates of the control's centre. */
  cx: number;
  cy: number;
  pressed?: string;
}

export interface E2ERow extends E2EBox {
  index: number;
  text: string;
  native: string;
  nativeFiltered: boolean;
}

export interface E2EState {
  rows: E2ERow[];
  translation: { text: string; filtered: boolean } | null;
  live: string[];
  text: string;
}

export interface E2EBoxes {
  bar: E2EBox | null;
  badges: E2EBox[];
  tokens: Array<E2EBox & { text: string; status?: string }>;
}

/** Raw hit as the publisher writes it (`x`/`y` are already the centre). */
interface RawHit {
  label: string;
  text: string;
  x: number;
  y: number;
  pressed?: string;
}

/* ── Attribute readers ─────────────────────────────────────────────────── */

async function readAttr(page: Page, hostId: string, attr: string): Promise<string | null> {
  return page.evaluate(
    ({ id, name }) => document.getElementById(id)?.getAttribute(name) ?? null,
    { id: hostId, name: attr },
  );
}

/** Every published control of one host. */
export async function hitsOf(page: Page, hostId: string): Promise<E2EHit[]> {
  const raw = await readAttr(page, hostId, 'data-kivara-e2e-hits');
  const parsed = raw ? (JSON.parse(raw) as RawHit[]) : [];
  return parsed.map((hit) => ({
    label: hit.label,
    text: hit.text,
    cx: hit.x,
    cy: hit.y,
    ...(hit.pressed === undefined ? {} : { pressed: hit.pressed }),
  }));
}

/** The control with exactly this accessible name. */
export async function hitOf(
  page: Page,
  hostId: string,
  label: string,
  where?: (hit: E2EHit) => boolean,
): Promise<E2EHit> {
  const hits = await hitsOf(page, hostId);
  const hit = hits.find((candidate) => candidate.label === label && (where?.(candidate) ?? true));
  if (!hit) {
    const seen = hits.map((candidate) => candidate.label).join(' · ');
    throw new Error(`no "${label}" in the ${hostId} hit map (saw: ${seen})`);
  }
  return hit;
}

/** The first control whose label starts with `prefix`. */
export async function hitStartingWith(
  page: Page,
  hostId: string,
  prefix: string,
): Promise<E2EHit> {
  const hits = await hitsOf(page, hostId);
  const hit = hits.find((candidate) => candidate.label.startsWith(prefix));
  if (!hit) {
    const seen = hits.map((candidate) => candidate.label).join(' · ');
    throw new Error(`no control starting with "${prefix}" in ${hostId} (saw: ${seen})`);
  }
  return hit;
}

export async function clickInRoot(
  page: Page,
  hostId: string,
  label: string,
  where?: (hit: E2EHit) => boolean,
): Promise<void> {
  const hit = await hitOf(page, hostId, label, where);
  await page.mouse.click(hit.cx, hit.cy);
}

/** aria-pressed / aria-checked of a control, as the host published it. */
export async function pressedInRoot(
  page: Page,
  hostId: string,
  label: string,
): Promise<string | null> {
  return (await hitOf(page, hostId, label)).pressed ?? null;
}

export async function boxesOf(page: Page, hostId = VIDEO_HOST): Promise<E2EBoxes> {
  const raw = await readAttr(page, hostId, 'data-kivara-e2e-boxes');
  if (!raw) throw new Error(`no box map published on ${hostId}`);
  return JSON.parse(raw) as E2EBoxes;
}

export async function stateOf(page: Page, hostId = PANEL_HOST): Promise<E2EState> {
  const raw = await readAttr(page, hostId, 'data-kivara-e2e-state');
  if (!raw) throw new Error(`no state map published on ${hostId}`);
  return JSON.parse(raw) as E2EState;
}

/* ── Polling wrappers ──────────────────────────────────────────────────── */

export async function waitForHits(
  page: Page,
  hostId: string,
  predicate: (hits: E2EHit[]) => boolean,
  message: string,
  timeout = 8_000,
): Promise<void> {
  await expect.poll(async () => predicate(await hitsOf(page, hostId)), { message, timeout })
    .toBe(true);
}

export async function waitForState(
  page: Page,
  hostId: string,
  predicate: (state: E2EState) => boolean,
  message: string,
  timeout = 10_000,
): Promise<void> {
  await expect.poll(async () => predicate(await stateOf(page, hostId)), { message, timeout })
    .toBe(true);
}

/* ── Geometry ──────────────────────────────────────────────────────────── */

export function overlaps(a: E2EBox, b: E2EBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width
    && a.y < b.y + b.height && b.y < a.y + a.height;
}

/* ── The overlay's words ───────────────────────────────────────────────── */

export type TokenBox = E2EBox & { text: string; status?: string };

export async function tokensOf(page: Page): Promise<TokenBox[]> {
  return (await boxesOf(page)).tokens;
}

/**
 * Wait until the painted tokens satisfy `predicate`.
 *
 * The translated line can appear BEFORE the source cue (the alt lookup runs
 * on the playhead), so a test that needs the OVERLAY's line must wait on the
 * tokens themselves, never on the translation.
 */
export async function waitForTokens(
  page: Page,
  predicate: (tokens: TokenBox[]) => boolean,
  message: string,
  timeout = 10_000,
): Promise<void> {
  await expect.poll(async () => predicate(await tokensOf(page)), { message, timeout }).toBe(true);
}

/** Wait until the overlay paints the given line (punctuation stripped). */
export async function waitForLine(page: Page, line: string, timeout = 10_000): Promise<void> {
  await waitForTokens(
    page,
    (tokens) => tokens.map((token) => token.text).join(' ') === line,
    `the overlay paints "${line}"`,
    timeout,
  );
}

/** The token whose visible text is exactly `text` (first match). */
export async function tokenOf(page: Page, text: string): Promise<TokenBox> {
  const tokens = await tokensOf(page);
  const token = tokens.find((candidate) => candidate.text === text);
  if (!token) {
    throw new Error(`no token "${text}" (saw: ${tokens.map((t) => t.text).join(' · ')})`);
  }
  return token;
}

/** The last token currently painted (the caption's last word). */
export async function lastTokenOf(page: Page): Promise<TokenBox> {
  const tokens = await tokensOf(page);
  const token = tokens.at(-1);
  if (!token) throw new Error('no tokens painted');
  return token;
}

const centre = (box: E2EBox) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/** Move the pointer over a token (opens its card; does not click). */
export async function hoverToken(page: Page, text: string): Promise<void> {
  const token = await tokenOf(page, text);
  const at = centre(token);
  await page.mouse.move(at.x, at.y);
}

/** Click a token with the mouse. `shift` keeps a free-selection range. */
export async function clickToken(page: Page, text: string, shift = false): Promise<void> {
  const token = await tokenOf(page, text);
  const at = centre(token);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  if (shift) await page.keyboard.up('Shift');
}

/** Park the pointer away from the player so hover-only surfaces close. */
export async function mouseAway(page: Page): Promise<void> {
  await page.mouse.move(4, 4);
}

/* ── The transcript rail ───────────────────────────────────────────────── */

export async function rowsOf(page: Page): Promise<E2ERow[]> {
  return (await stateOf(page, PANEL_HOST)).rows;
}

/** The rail row for a cue index, waiting until the rail has rendered it. */
export async function rowOf(page: Page, index: number): Promise<E2ERow> {
  await waitForState(
    page,
    PANEL_HOST,
    (state) => state.rows.some((row) => row.index === index),
    `rail row ${index} rendered`,
  );
  const row = (await rowsOf(page)).find((candidate) => candidate.index === index);
  if (!row) throw new Error(`no rail row ${index}`);
  return row;
}

/** Click a rail line, which seeks through the PlaybackController. */
export async function clickRow(page: Page, index: number): Promise<void> {
  // Hover FIRST and let the row render: the rows are `content-visibility:
  // auto`, so the first pointer entry activates their layout, and a click that
  // lands in the same event as the move can hit the placeholder geometry.
  const first = await rowOf(page, index);
  const at = centre(first);
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(150);
  const row = await rowOf(page, index);
  const target = centre(row);
  await page.mouse.click(target.x, target.y);
}

/* ── The overlay's translated line ─────────────────────────────────────── */

export async function translationOf(page: Page): Promise<{ text: string; filtered: boolean } | null> {
  return (await stateOf(page, VIDEO_HOST)).translation;
}

export async function waitForTranslation(
  page: Page,
  expected: RegExp,
  timeout = 10_000,
): Promise<string> {
  await expect.poll(
    async () => (await translationOf(page))?.text ?? '',
    { timeout },
  ).toMatch(expected);
  const line = (await translationOf(page))?.text ?? '';
  return line;
}

/* ── The video element (the harness reads it directly) ─────────────────── */

export const time = (page: Page) =>
  page.evaluate(() => document.querySelector('video')!.currentTime);

export const paused = (page: Page) =>
  page.evaluate(() => document.querySelector('video')!.paused);

export const rate = (page: Page) =>
  page.evaluate(() => document.querySelector('video')!.playbackRate);

/** Park the playhead and pause, so a case is not racing playback. */
export async function parkAt(page: Page, seconds: number): Promise<void> {
  await page.evaluate((value) => {
    const video = document.querySelector('video')!;
    video.pause();
    video.currentTime = value;
  }, seconds);
  await expect.poll(() => time(page), { timeout: 5_000 }).toBeGreaterThan(seconds - 0.25);
  expect(await time(page)).toBeLessThan(seconds + 0.25);
}

/** Jump the media element the way a scrub does (a real forward seek). */
export async function seekTo(page: Page, seconds: number): Promise<void> {
  await page.evaluate((value) => {
    document.querySelector('video')!.currentTime = value;
  }, seconds);
}

export const play = (page: Page) =>
  page.evaluate(() => document.querySelector('video')!.play());

/* ── Player setup ──────────────────────────────────────────────────────── */

export interface PlayerSetup {
  /** Raw HTML served at `https://www.youtube.com/watch?...`. */
  fixture: string;
  /** Body served for `cues.vtt` (the seekable fixture's `<track>`). */
  vtt?: string;
  /**
   * json3 body for an `/api/timedtext` request. The URL says which track is
   * wanted (`&tlang=es` is the auto-translated one the bus asks for itself).
   */
  timedtext?: (url: URL) => string | null;
}

/**
 * Serve the fixture at a matched YouTube origin, load it, and wait until the
 * content script has mounted and the clip is playing.
 *
 * The route table is one place for both fixtures: `player-seekable.html` asks
 * for `cues.vtt`, `player-dual.html` asks for `/api/timedtext` and never
 * touches the VTT.
 */
export async function openPlayer(context: BrowserContext, opts: PlayerSetup): Promise<Page> {
  const page = await context.newPage();
  await page.route('*://*.youtube.com/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('cues.vtt')) {
      await route.fulfill({
        status: 200,
        contentType: 'text/vtt',
        body: opts.vtt ?? 'WEBVTT\n',
      });
      return;
    }
    if (url.includes('/api/timedtext')) {
      const body = opts.timedtext?.(new URL(url)) ?? '{"events":[]}';
      await route.fulfill({ status: 200, contentType: 'application/json', body });
      return;
    }
    if (url.includes('/watch')) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: opts.fixture });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html></html>',
    });
  });
  await page.goto('https://www.youtube.com/watch?v=kivara-behaviour');
  await page.bringToFront();
  await page.waitForFunction(
    () => (window as Window & { __kivaraFixtureReady?: unknown }).__kivaraFixtureReady === true,
    undefined,
    { timeout: 30_000 },
  );
  // The two hosts prove the content script mounted the App AND the overlay.
  await expect.poll(
    () => page.evaluate(
      (ids) => ids.every((id) => document.getElementById(id) !== null),
      [PANEL_HOST, VIDEO_HOST],
    ),
    { timeout: 15_000 },
  ).toBe(true);
  await page.waitForFunction(() => document.querySelector('video')!.currentTime > 0.02);
  return page;
}

/* ── StudyBar ──────────────────────────────────────────────────────────── */

/** Accessible names as the harness renders them: the fixtures pin `--lang=es`. */
export const LABEL = {
  loop: 'Bucle',
  autoPause: 'Pausa al final de cada frase',
  autoPauseShort: 'Auto-pausa',
  prev: 'Frase anterior',
  next: 'Frase siguiente',
  replay: 'Repetir frase',
  railToggle: 'Transcripción',
  panelToggle: 'Abrir o cerrar panel',
  search: 'Buscar en la transcripción',
  /** The rail's translation button, per current mode. */
  translationShow: 'Difuminar traducción',
  translationBlur: 'Ocultar traducción',
  translationHide: 'Mostrar traducción',
  /** Prefix of the overlay toolbar's "know the rest" button. */
  knowRest: 'Marcar la',
  /** Title of the free-selection save button. */
  saveSelection: 'Guardar la selección',
  /** Word card action. */
  save: 'Guardar',
  /** Status selector. */
  learning: 'Aprendiendo',
  panelTabCards: 'Tarjetas',
  panelTabSubtitles: 'Subtítulos',
} as const;

/** Move the pointer over the player and wait for the bar's hit map. */
export async function armBar(page: Page): Promise<void> {
  await page.mouse.move(320, 200);
  // The bar fades in on pointer activity; its controls are in the map from the
  // first write, so a short settle is enough.
  await page.waitForTimeout(400);
  await waitForHits(
    page,
    VIDEO_HOST,
    (hits) => hits.length > 10,
    'the study bar hit map is published',
  );
}

/** Click a speed radio by its visible text ("1.25×"), via the hit map. */
export async function clickSpeed(page: Page, value: string): Promise<void> {
  await clickInRoot(page, VIDEO_HOST, value);
}
