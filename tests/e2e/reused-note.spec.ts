/**
 * P1 data-loss guard: a word whose note ALREADY exists in the deck is reused
 * (never a new note). REUSING it must never offer "Deshacer" — that would send
 * ANKI_DELETE_NOTE and destroy an old note with all its review history. For a
 * different sentence the toast offers "Añadir esta escena" (the existing
 * add-context flow) instead, and no new "saved" row appears in Recientes.
 *
 * Drive the save through the KEYBOARD shortcut (Ctrl+Shift+S) on a hovered
 * token, with a local fake AnkiConnect that answers the real wire actions.
 */
import fs from 'node:fs';
import http from 'node:http';
import type { Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from './fixtures';
import { boxesOf, PANEL_HOST, readFixture, stateOf, VIDEO_HOST } from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFixture('player-netflix.html');
const TTML = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml"><body><div>
<p begin="0s" end="9s">STEVE shouts in the yard</p>
</div></body></tt>`;

interface AnkiLog {
  actions: string[];
  queries: string[];
  added: number;
  deleted: number[];
}
const EXISTING_NOTE_ID = 424242;

function startFakeAnki(port: number, log: AnkiLog): Promise<Server> {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let action = '';
      let params: Record<string, unknown> = {};
      try { const p = JSON.parse(body); action = p.action ?? ''; params = p.params ?? {}; } catch { /* ignore */ }
      log.actions.push(action);
      let result: unknown = null;
      if (action === 'version') result = '25.02.reuse';
      else if (action === 'findNotes') {
        const query = String(params.query ?? '');
        log.queries.push(query);
        // The word-field query carries "steve" (case-insensitive, escaped by
        // buildExactNoteQuery). Match on the VALUE, not a hardcoded field name:
        // CI can seed a different fieldSources label, and the deck/model/deck
        // clauses are irrelevant to which note the mock stands in for.
        result = /steve/i.test(query) ? [EXISTING_NOTE_ID] : [];
      } else if (action === 'notesInfo') {
        // The existing note has an OLD sentence → other-context.
        result = [{ noteId: EXISTING_NOTE_ID, fields: { Front: { value: 'steve' }, Sentence: { value: 'An old sentence.' }, 'Sentence audio': { value: '' } }, tags: ['kivara-lingo'], modelName: 'Basic', cards: [1] }];
      } else if (action === 'canAddNotes') result = [false];
      else if (action === 'addNote') { log.added += 1; result = 999999; }
      else if (action === 'deleteNotes') { log.deleted.push(...((params.notes as number[]) ?? [])); result = null; }
      else if (action === 'addTags' || action === 'updateNoteFields' || action === 'storeMediaFile') result = null;
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end(JSON.stringify({ result, error: null }));
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function seedAnki(context: import('@playwright/test').BrowserContext, port: number) {
  const sw = (await context.serviceWorkers())[0];
  if (!sw) return;
  await sw.evaluate(async (p) => {
    const KEY = 'kivara-lingo-state';
    const raw = await chrome.storage.sync.get(KEY);
    const parsed = raw[KEY] ? JSON.parse(String(raw[KEY])) : { state: {}, version: 0 };
    parsed.state = parsed.state ?? {};
    parsed.state.ankiMapping = {
      ankiUrl: `http://127.0.0.1:${p}`,
      deckName: 'Kivara QA',
      modelName: 'Basic',
      fieldSources: { Front: 'selection', Sentence: 'cue' },
    };
    await chrome.storage.sync.set({ [KEY]: JSON.stringify(parsed) });
  }, port);
}

async function openPage(context: import('@playwright/test').BrowserContext) {
  const page = await context.newPage();
  await page.route('*://*.nflxvideo.net/**', (route) => route.fulfill({
    status: 200, contentType: 'application/xml',
    headers: { 'access-control-allow-origin': '*' }, body: TTML,
  }));
  await page.route('*://*.netflix.com/**', (route) => {
    if (route.request().url().includes('/watch/')) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: FIXTURE });
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html></html>' });
  });
  await page.goto('https://www.netflix.com/watch/82939619');
  await page.bringToFront();
  await page.waitForFunction(
    () => (window as Window & { __kivaraFixtureReady?: unknown }).__kivaraFixtureReady !== undefined,
    undefined, { timeout: 30_000 },
  );
  await page.waitForFunction(() => !!document.querySelector('video'), { timeout: 15_000 });
  await page.waitForTimeout(1200);
  return page as Page & Record<string, unknown>;
}

test('saving STEVE over an existing steve note: no Undo, add-scene offered, old note survives', async ({ context, serviceWorker }) => {
  test.setTimeout(120_000);
  const log: AnkiLog = { actions: [], queries: [], added: 0, deleted: [] };
  const PORT = 18766;
  const server = await startFakeAnki(PORT, log);
  try {
    await seedAnki(context, PORT);
    void serviceWorker;
    const page = await openPage(context);
    try {
      // Hover the token so the shortcut has a target word (box map works
      // through the closed shadow root). Wait for the word card to actually
      // OPEN — that is the proof hoveredKeyRef is set; on a loaded runner the
      // mouse.move alone can land before the hover handler has fired, and the
      // shortcut would then fall through to "nothing to save" (empty toast).
      await expect.poll(async () => (await boxesOf(page, VIDEO_HOST)).tokens.length, { timeout: 10_000 }).toBeGreaterThan(0);
      const tokBox = (await boxesOf(page, VIDEO_HOST)).tokens[0];
      const tok = { x: tokBox.x + tokBox.width / 2, y: tokBox.y + tokBox.height / 2 };
      for (let i = 0; i < 15; i++) {
        await page.mouse.move(640 + (tok.x - 640) * (i + 1) / 15, 360 + (tok.y - 360) * (i + 1) / 15);
        await page.waitForTimeout(16);
      }
      await expect.poll(async () => (await boxesOf(page, VIDEO_HOST)).card !== null,
        { timeout: 10_000 }).toBe(true);

      // The keyboard shortcut (Ctrl+Shift+S) is the save trigger.
      await page.keyboard.press('Control+Shift+S');

      // The reused notice appears WITHOUT "Deshacer" and WITH add-scene.
      // Generous timeout: Ctrl+Shift+S is a manifest command delivered through
      // the (lazy, possibly idle) background service worker, which can take a
      // beat on a loaded CI runner before it reaches the save handler.
      await expect.poll(async () => (await stateOf(page, PANEL_HOST)).toasts?.join(' | ') ?? '',
        { timeout: 20_000, message: `reused toast never appeared; Anki actions: ${log.actions.join(',')} | queries: ${log.queries.join(' ; ')}` })
        .toMatch(/ya está en tu mazo/);
      const toastText = (await stateOf(page, PANEL_HOST)).toasts?.join(' | ') ?? '';
      expect(toastText).not.toContain('Deshacer');
      expect(toastText).toContain('Añadir esta escena');

      // No add, no delete — the old note survives, nothing new was created.
      expect(log.added).toBe(0);
      expect(log.deleted).toEqual([]);
      expect(log.actions).toContain('findNotes');
      expect(log.actions).toContain('notesInfo');

      // Recientes has no row carrying the reused noteId (no Undo there).
      const recent = await serviceWorker.evaluate(async () => {
        const got = await chrome.storage.local.get('kvl:cards.recent');
        return (got['kvl:cards.recent'] ?? []) as Array<{ noteId?: number; word: string }>;
      });
      expect(recent.some((r) => r.noteId === EXISTING_NOTE_ID)).toBe(false);
    } finally {
      await page.close();
    }
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
