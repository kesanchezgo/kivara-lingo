/**
 * P1 data-loss guard: a word whose note ALREADY exists in the deck is reused
 * (never a new note). REUSING it must never offer "Deshacer" — that would send
 * ANKI_DELETE_NOTE and destroy an old note with all its review history. For a
 * different sentence the toast offers "Añadir esta escena" (the existing
 * add-context flow) instead, and no new "saved" row appears in Recientes.
 *
 * Drive the save through the KEYBOARD shortcut on a hovered token, with a
 * local fake AnkiConnect that answers the real wire actions. The binding is
 * seeded to Alt+Shift+S so the page owns it (no SW chrome.commands hop).
 */
import fs from 'node:fs';
import http from 'node:http';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from './fixtures';
import { boxesOf, hitsOf, PANEL_HOST, readFixture, stateOf, VIDEO_HOST } from './helpers';

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
  addedIds: number[];
  addedNotes: Array<{ fields: Record<string, string>; tags?: string[] }>;
  deleted: number[];
  updated: number[];
  updatedFields: Array<Record<string, string>>;
}
const EXISTING_NOTE_ID = 424242;
/** The synthetic-capture tests need the KIVARA_E2E bridge page in dist. */
const hasE2EBridge = existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../dist/src/e2e/index.html'));

interface FakeAnkiOptions {
  /** Surface stored on the pre-existing note (lowercase). */
  word: string;
  /** Lemma tag on the note; when present, the identity query matches it. */
  lemmaTag?: string;
  /** Stored cue — different from the saved cue → other-context. */
  storedSentence?: string;
  /** Stored meaning, read through the bilingual/translation field. */
  storedGloss?: string;
}

function startFakeAnki(port: number, log: AnkiLog, opts: FakeAnkiOptions): Promise<Server> {
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
        // Match the identity query on the lemma tag OR either surface/key
        // field clause. CI can seed different fieldSources labels; deck/model
        // clauses are irrelevant to which note the mock stands in for.
        const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wanted = [opts.word, ...(opts.lemmaTag ? [opts.lemmaTag.split('::').pop() ?? ''] : [])]
          .filter(Boolean).map(esc);
        result = wanted.some((w) => new RegExp(w, 'i').test(query)) ? [EXISTING_NOTE_ID] : [];
      } else if (action === 'notesInfo') {
        result = [{
          noteId: EXISTING_NOTE_ID,
          fields: {
            Front: { value: opts.word },
            Translation: { value: opts.storedGloss ?? '' },
            Sentence: { value: opts.storedSentence ?? 'An old sentence.' },
            'Sentence audio': { value: '' },
          },
          tags: [
            'kivara-lingo',
            ...(opts.lemmaTag ? [opts.lemmaTag] : []),
            ...(opts.storedGloss ? [`kivara::sense::${opts.storedGloss.replace(/\s+/g, '-')}`] : []),
          ],
          modelName: 'Basic', cards: [1],
        }];
      } else if (action === 'canAddNotes') result = [false];
      else if (action === 'findCards') {
        const query = String(params.query ?? '');
        log.queries.push(query);
        const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wanted = [opts.word, ...(opts.lemmaTag ? [opts.lemmaTag.split('::').pop() ?? ''] : [])]
          .filter(Boolean).map(esc);
        result = wanted.some((w) => new RegExp(w, 'i').test(query)) ? [99] : [];
      }
      else if (action === 'cardsInfo') result = [{ cardId: 99, noteId: EXISTING_NOTE_ID }];
      else if (action === 'addNote') {
        // Anki note ids are creation timestamps: mimic that so the Undo
        // freshness guard accepts the freshly created note.
        log.added += 1;
        const note = (params.note as { fields?: Record<string, string>; tags?: string[] }) ?? {};
        log.addedIds.push(Date.now());
        log.addedNotes.push({ fields: note.fields ?? {}, tags: note.tags });
        result = log.addedIds[log.addedIds.length - 1];
      }
      else if (action === 'deleteNotes') { log.deleted.push(...((params.notes as number[]) ?? [])); result = null; }
      else if (action === 'updateNoteFields') {
        log.updated.push(EXISTING_NOTE_ID);
        log.updatedFields.push((((params.note as { fields?: Record<string, string> })?.fields) ?? (params.fields as Record<string, string>) ?? {}));
        result = null;
      }
      else if (action === 'addTags' || action === 'storeMediaFile') result = null;
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
      fieldSources: { Front: 'selection', Translation: 'bilingual', Sentence: 'cue', 'Sentence audio': 'sentence-audio' },
    };
    // Drive the save through a KEYBOARD shortcut the page owns, not the
    // manifest Ctrl+Shift+S (which is delivered by the SW's chrome.commands
    // and can be dropped on a loaded CI runner). Alt+Shift+S is not bound to
    // any manifest command, so the in-page handler fires it deterministically
    // through the SAME setSaveTick -> CREATE_CARD pipeline.
    parsed.state.shortcuts = { ...(parsed.state.shortcuts ?? {}), save: 'Alt+Shift+S' };
    await chrome.storage.sync.set({ [KEY]: JSON.stringify(parsed) });
  }, port);
}


/**
 * Seed a tiny bilingual EN->ES dictionary pack ("run" -> "correr") directly
 * into the extension's Dexie database from the service worker. The pack gloss
 * outranks BOTH the bundled dictionary and any live enrichment chain, so the
 * contextual gloss is deterministic in CI regardless of network.
 */
const E2E_BRIDGE = (extensionId: string) => `chrome-extension://${extensionId}/src/e2e/index.html`;

/** Open the extension's E2E bridge page (the offscreen control surface). */
async function openCapture(
  context: import('@playwright/test').BrowserContext,
  extensionId: string,
): Promise<import('@playwright/test').Page> {
  const page = await context.newPage();
  await page.goto(E2E_BRIDGE(extensionId));
  await page.waitForFunction(() => document.readyState === 'complete', undefined, { timeout: 20_000 });
  return page;
}

/** Send one bridge message and return its response. */
async function bridge(page: import('@playwright/test').Page, message: unknown): Promise<{ ok: boolean; error?: string; [k: string]: unknown }> {
  return page.evaluate(async (msg) => {
    const res = await chrome.runtime.sendMessage(msg);
    return res as { ok: boolean; error?: string };
  }, message);
}

/** Start the offscreen SYNTHETIC audio stream (E2E-gated production code). */
async function startSyntheticCapture(
  bridgePage: import('@playwright/test').Page,
  tabId: number,
): Promise<void> {
  const started = await bridge(bridgePage, {
    type: 'KIVARA_E2E_START_AUDIO_CAPTURE',
    data: { tabId, synthetic: true },
  });
  if (!started.ok) throw new Error(`capture refused: ${started.error ?? 'unknown'}`);
}

async function seedDictPack(context: import('@playwright/test').BrowserContext) {
  const sw = (await context.serviceWorkers())[0];
  if (!sw) return;
  await sw.evaluate(async () => {
    // The SW's start-up orphan sweep can race this write with a stale pack
    // snapshot (deleting the term again). Write, verify, retry until the row
    // survives — the sweep runs once per SW start, so the retry settles it.
    const openDb = () => new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('kivara-lingo');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    for (let attempt = 0; attempt < 20; attempt++) {
      const db = await openDb();
      await new Promise<void>((res, rej) => {
        const tx = db.transaction(['dict_packs', 'dict_terms'], 'readwrite');
        tx.objectStore('dict_packs').put({
          id: 'e2e-pack-es', title: 'E2E pack ES', revision: '1', format: 3,
          sourceLang: 'en', targetLang: 'es', termCount: 1, enabled: true,
          createdAt: Date.now(),
        });
        tx.objectStore('dict_terms').put({
          id: 1, packId: 'e2e-pack-es', expression: 'run',
          definitions: ['correr'], popularity: 1000,
        });
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      const n = await new Promise<number>((res, rej) => {
        const rq = db.transaction('dict_terms', 'readonly').objectStore('dict_terms').count();
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => rej(rq.error);
      });
      db.close();
      if (n >= 1) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('dict pack term did not persist');
  });
}

async function openPage(context: import('@playwright/test').BrowserContext, ttml: string = TTML) {
  const page = await context.newPage();
  await page.route('*://*.nflxvideo.net/**', (route) => route.fulfill({
    status: 200, contentType: 'application/xml',
    headers: { 'access-control-allow-origin': '*' }, body: ttml,
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

test('saving STEVE over an existing steve note: no Undo, add-scene offered, old note survives', async ({ context, serviceWorker, extensionId }) => {
  test.setTimeout(180_000);
  test.skip(!hasE2EBridge, 'skipped: needs a KIVARA_E2E=1 build (the e2e bridge page is absent from a production dist)');
  const log: AnkiLog = { actions: [], queries: [], added: 0, addedIds: [], addedNotes: [], deleted: [], updated: [], updatedFields: [] };
  const PORT = 18766;
  const server = await startFakeAnki(PORT, log, { word: 'steve' });
  try {
    await seedAnki(context, PORT);
    void serviceWorker;
    const page = await openPage(context);
    // P3: the synthetic tab-capture stream fills the offscreen buffer with
    // real (production) audio, so "Add this scene" can slice the SAVED cue.
    const bridgePage = await openCapture(context, extensionId);
    // tabId is irrelevant on the synthetic path (the offscreen streams itself).
    await startSyntheticCapture(bridgePage, 0);
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

      // The keyboard shortcut (Alt+Shift+S, seeded above) is the save trigger.
      await page.keyboard.press('Alt+Shift+S');

      // The reused notice appears WITHOUT "Deshacer" and WITH add-scene.
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

      // P3: with the synthetic capture running, "Add this scene" converts the
      // SAVED cue window (video time → wall clock) and the note receives the
      // sentence audio — [sound:...] lands on the existing note.
      const beforeUpdates = log.updatedFields.length;
      await expect.poll(async () => (await hitsOf(page, PANEL_HOST)).some((h) => h.label === 'Añadir esta escena'),
        { timeout: 15_000, message: 'add-scene action never rendered' }).toBe(true);
      for (let attempt = 0; attempt < 8; attempt++) {
        const hits = (await hitsOf(page, PANEL_HOST)).filter((h) => h.label === 'Añadir esta escena');
        if (hits.length) await page.mouse.click(hits[0].cx, hits[0].cy);
        await page.waitForTimeout(500);
        if (log.updatedFields.length > beforeUpdates) break;
        if (attempt === 7) break;
      }
      await expect.poll(() => log.updatedFields.length, { timeout: 30_000 }).toBeGreaterThan(beforeUpdates);
      const sceneFields = log.updatedFields[log.updatedFields.length - 1];
      expect(Object.values(sceneFields).join(' ')).toContain('[sound:');

      // Recientes has NO row for the reused word — not by noteId, not by word.
      const recent = await serviceWorker.evaluate(async () => {
        const got = await chrome.storage.local.get('kvl:cards.recent');
        return (got['kvl:cards.recent'] ?? []) as Array<{ noteId?: number; word: string }>;
      });
      expect(recent.filter((r) => r.word.toLowerCase() === 'steve')).toHaveLength(0);
      expect(recent.some((r) => r.noteId === EXISTING_NOTE_ID)).toBe(false);
    } finally {
      await bridgePage.close();
      await page.close();
    }
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('saving "running" over a pre-existing lemma "run" note reuses it and add-scene attaches to that SAME note', async ({ context, serviceWorker }) => {
  test.setTimeout(120_000);
  const log: AnkiLog = { actions: [], queries: [], added: 0, addedIds: [], addedNotes: [], deleted: [], updated: [], updatedFields: [] };
  const PORT = 18767;
  const RUN_TTML = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml"><body><div>
<p begin="0s" end="9s">RUNNING is hard work</p>
</div></body></tt>`;
  const server = await startFakeAnki(PORT, log, {
    word: 'run', lemmaTag: 'kivara::lemma::run', storedSentence: 'He runs every day.',
  });
  try {
    await seedAnki(context, PORT);
    void serviceWorker;
    const page = await openPage(context, RUN_TTML);
    try {
      await expect.poll(async () => (await boxesOf(page, VIDEO_HOST)).tokens.length, { timeout: 10_000 }).toBeGreaterThan(0);
      const tokBox = (await boxesOf(page, VIDEO_HOST)).tokens[0];
      const tok = { x: tokBox.x + tokBox.width / 2, y: tokBox.y + tokBox.height / 2 };
      for (let i = 0; i < 15; i++) {
        await page.mouse.move(640 + (tok.x - 640) * (i + 1) / 15, 360 + (tok.y - 360) * (i + 1) / 15);
        await page.waitForTimeout(16);
      }
      await expect.poll(async () => (await boxesOf(page, VIDEO_HOST)).card !== null,
        { timeout: 10_000 }).toBe(true);
      await page.keyboard.press('Alt+Shift+S');

      await expect.poll(async () => (await stateOf(page, PANEL_HOST)).toasts?.join(' | ') ?? '',
        { timeout: 20_000, message: `queries: ${log.queries.join(' ; ')}` })
        .toMatch(/ya está en tu mazo/);
      const toastText = (await stateOf(page, PANEL_HOST)).toasts?.join(' | ') ?? '';
      expect(toastText).not.toContain('Deshacer');
      expect(toastText).toContain('Añadir esta escena');
      // The identity query targeted the lemma, not just the surface.
      expect(log.queries.some((q) => q.includes('tag:kivara::lemma::run'))).toBe(true);
      expect(log.added).toBe(0);
      expect(log.deleted).toEqual([]);

      // Click the existing add-scene action: it must update the SAME note.
      // Fresh coordinates on each attempt: sonner animates the toast in, so
      // a hit captured before the settle can be stale by a few pixels.
      for (let attempt = 0; attempt < 6; attempt++) {
        const hits = (await hitsOf(page, PANEL_HOST)).filter((h) => h.label === 'Añadir esta escena');
        if (!hits.length) break;
        await page.mouse.click(hits[0].cx, hits[0].cy);
        await page.waitForTimeout(250);
        const text = (await stateOf(page, PANEL_HOST)).toasts?.join(' | ') ?? '';
        if (!text.includes('Añadir esta escena')) break;
      }
      await expect.poll(async () => (await stateOf(page, PANEL_HOST)).toasts?.join(' | ') ?? '',
        { timeout: 5_000 }).not.toContain('Añadir esta escena');
      await expect.poll(async () => log.updated.length,
        { timeout: 10_000, message: `actions: ${log.actions.join(',')} | queries: ${log.queries.join(' ; ')}` })
        .toBeGreaterThan(0);
      expect(log.added).toBe(0);
      expect(log.deleted).toEqual([]);
      expect(log.updated).toContain(EXISTING_NOTE_ID);
    } finally {
      await page.close();
    }
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('other meaning: the new-sense toast shows both actions, create-first, no Undo', async ({ context, serviceWorker }) => {
  test.setTimeout(120_000);
  const log: AnkiLog = { actions: [], queries: [], added: 0, addedIds: [], addedNotes: [], deleted: [], updated: [], updatedFields: [] };
  const PORT = 18768;
  const RUN_TTML = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="en"><body><div>
<p begin="0s" end="9s">RUN is hard work</p>
</div></body></tt>`;
  const server = await startFakeAnki(PORT, log, {
    word: 'run', lemmaTag: 'kivara::lemma::run',
    storedSentence: 'He runs every day.', storedGloss: 'dirigir',
  });
  try {
    // A deterministic gloss: the pack beats bundle AND any live chain, so the
    // popover's gloss is 'correr' (≠ the stored 'dirigir') without network.
    await seedDictPack(context);
    await seedAnki(context, PORT);
    void serviceWorker;
    const page = await openPage(context, RUN_TTML);
    try {
      await expect.poll(async () => (await boxesOf(page, VIDEO_HOST)).tokens.length, { timeout: 10_000 }).toBeGreaterThan(0);
      const tokBox = (await boxesOf(page, VIDEO_HOST)).tokens[0];
      for (let i = 0; i < 15; i++) {
        await page.mouse.move(
          640 + (tokBox.x + tokBox.width / 2 - 640) * (i + 1) / 15,
          360 + (tokBox.y + tokBox.height / 2 - 360) * (i + 1) / 15,
        );
        await page.waitForTimeout(16);
      }
      await expect.poll(async () => (await hitsOf(page, VIDEO_HOST)).some((h) => h.label === 'Guardar'),
        { timeout: 10_000 }).toBe(true);
      // The popover resolves its gloss asynchronously — wait until the card
      // actually shows it, so the click carries a real gloss, never the '—'.
      await expect.poll(async () => (await boxesOf(page, VIDEO_HOST)).cardText ?? '',
        { timeout: 15_000 }).toContain('correr');
      const save = (await hitsOf(page, VIDEO_HOST)).find((h) => h.label === 'Guardar')!;
      await page.mouse.click(save.cx, save.cy);

      await expect.poll(async () => (await stateOf(page, PANEL_HOST)).toasts?.join(' | ') ?? '',
        { timeout: 20_000, message: `actions: ${log.actions.join(',')} | queries: ${log.queries.join(' ; ')}` })
        .toMatch(/ya está en tu mazo/);
      const text = (await stateOf(page, PANEL_HOST)).toasts?.join(' | ') ?? '';
      expect(text).toContain('dirigir');
      expect(text).not.toContain('Deshacer');
      const hits = (await hitsOf(page, PANEL_HOST)).map((h) => h.label);
      const createIdx = hits.indexOf('Crear tarjeta para este significado');
      const addIdx = hits.indexOf('Añadir esta escena');
      expect(createIdx).toBeGreaterThanOrEqual(0);
      expect(addIdx).toBeGreaterThan(createIdx);
      expect(log.added).toBe(0);
      expect(log.deleted).toEqual([]);
    } finally {
      await page.close();
    }
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});


test('shortcut save then "Crear tarjeta para este significado": one addNote, old note intact, no repeated toast', async ({ context, serviceWorker, extensionId }) => {
  test.setTimeout(180_000);
  test.skip(!hasE2EBridge, 'skipped: needs a KIVARA_E2E=1 build (the e2e bridge page is absent from a production dist)');
  const log: AnkiLog = { actions: [], queries: [], added: 0, addedIds: [], addedNotes: [], deleted: [], updated: [], updatedFields: [] };
  const PORT = 18769;
  const RUN_TTML = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml"><body><div>
<p begin="0s" end="9s">RUN is hard work</p>
</div></body></tt>`;
  const server = await startFakeAnki(PORT, log, {
    word: 'run', lemmaTag: 'kivara::lemma::run',
    storedSentence: 'He runs every day.', storedGloss: 'correr',
  });
  try {
    await seedAnki(context, PORT);
    void serviceWorker;
    const page = await openPage(context, RUN_TTML);
    const bridgePage = await openCapture(context, extensionId);
    await startSyntheticCapture(bridgePage, 0);
    try {
      await expect.poll(async () => (await boxesOf(page, VIDEO_HOST)).tokens.length, { timeout: 10_000 }).toBeGreaterThan(0);
      const tokBox = (await boxesOf(page, VIDEO_HOST)).tokens[0];
      for (let i = 0; i < 15; i++) {
        await page.mouse.move(
          640 + (tokBox.x + tokBox.width / 2 - 640) * (i + 1) / 15,
          360 + (tokBox.y + tokBox.height / 2 - 360) * (i + 1) / 15,
        );
        await page.waitForTimeout(16);
      }
      await expect.poll(async () => (await boxesOf(page, VIDEO_HOST)).card !== null, { timeout: 10_000 }).toBe(true);
      await page.keyboard.press('Alt+Shift+S');
      await expect.poll(async () => (await stateOf(page, PANEL_HOST)).toasts?.join(' | ') ?? '',
        { timeout: 20_000, message: `actions: ${log.actions.join(',')}` })
        .toMatch(/ya está en tu mazo/);
      expect(log.added).toBe(0);
      expect(log.deleted).toEqual([]);

      // Click the create action with FRESH coordinates (sonner animates).
      for (let attempt = 0; attempt < 6; attempt++) {
        const hits = (await hitsOf(page, PANEL_HOST)).filter((h) => h.label === 'Crear tarjeta para este significado');
        if (!hits.length) break;
        await page.mouse.click(hits[0].cx, hits[0].cy);
        await page.waitForTimeout(250);
        const text = (await stateOf(page, PANEL_HOST)).toasts?.join(' | ') ?? '';
        if (!text.includes('ya está en tu mazo')) break;
      }
      await expect.poll(() => log.added, { timeout: 20_000 }).toBe(1);
      expect(log.deleted).toEqual([]);
      // The pre-existing note was never deleted or overwritten.
      expect(log.updated).toEqual([]);
      // No reused toast comes back after the create (the notice is one-shot).
      await page.waitForTimeout(800);
      expect((await stateOf(page, PANEL_HOST)).toasts?.join(' | ') ?? '').not.toMatch(/ya está en tu mazo/);
      // P2: the create rides the SAVED scene — the anchor wall-clock lets the
      // background slice the SAVED cue window (or label TTS), so the note
      // carries sentence audio again.
      await expect.poll(() => log.addedNotes.length, { timeout: 20_000 }).toBe(1);
      const created = log.addedNotes[0];
      const audioValue = Object.entries(created?.fields ?? {})
        .find(([k]) => /audio/i.test(k))?.[1] ?? '';
      expect(audioValue).toContain('[sound:');
      expect(Object.values(created?.fields ?? {}).join(' ')).toContain('RUN is hard work');
    } finally {
      await bridgePage.close();
      await page.close();
    }
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});


test('forced create on the SAME meaning: final notice has NO Crear, old note intact', async ({ context, serviceWorker, extensionId }) => {
  test.setTimeout(180_000);
  test.skip(!hasE2EBridge, 'skipped: needs a KIVARA_E2E=1 build (the e2e bridge page is absent from a production dist)');
  const log: AnkiLog = { actions: [], queries: [], added: 0, addedIds: [], addedNotes: [], deleted: [], updated: [], updatedFields: [] };
  const PORT = 18770;
  const RUN_TTML = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="en"><body><div>
<p begin="0s" end="9s">RUN is hard work</p>
</div></body></tt>`;
  const server = await startFakeAnki(PORT, log, {
    word: 'run', lemmaTag: 'kivara::lemma::run',
    storedSentence: 'He runs every day.', storedGloss: 'correr',
  });
  try {
    await seedAnki(context, PORT);
    void serviceWorker;
    const page = await openPage(context, RUN_TTML);
    const bridgePage = await openCapture(context, extensionId);
    await startSyntheticCapture(bridgePage, 0);
    try {
      await expect.poll(async () => (await boxesOf(page, VIDEO_HOST)).tokens.length, { timeout: 10_000 }).toBeGreaterThan(0);
      // Seed AFTER the overlay is live: the SW's one-shot orphan sweep has
      // settled by now, so the pack term cannot be swept mid-flight.
      await seedDictPack(context);
      const tokBox = (await boxesOf(page, VIDEO_HOST)).tokens[0];
      for (let i = 0; i < 15; i++) {
        await page.mouse.move(
          640 + (tokBox.x + tokBox.width / 2 - 640) * (i + 1) / 15,
          360 + (tokBox.y + tokBox.height / 2 - 360) * (i + 1) / 15,
        );
        await page.waitForTimeout(16);
      }
      await expect.poll(async () => (await boxesOf(page, VIDEO_HOST)).card !== null, { timeout: 10_000 }).toBe(true);
      await page.keyboard.press('Alt+Shift+S');
      const firstToasts = await expect.poll(async () => (await stateOf(page, PANEL_HOST)).toasts?.join(' | ') ?? '',
        { timeout: 20_000, message: `actions: ${log.actions.join(',')}` })
        .toMatch(/ya está en tu mazo/);
      expect(log.added).toBe(0);

      // One-shot click on the create action with fresh coordinates.
      await expect.poll(async () => (await hitsOf(page, PANEL_HOST)).some((h) => h.label === 'Crear tarjeta para este significado'),
        { timeout: 15_000, message: 'create action never rendered' }).toBe(true);
      const hits = (await hitsOf(page, PANEL_HOST)).filter((h) => h.label === 'Crear tarjeta para este significado');
      await page.mouse.click(hits[0].cx, hits[0].cy);
      // The final notice says the meaning is ALREADY on file — no Crear again.
      await expect.poll(async () => (await stateOf(page, PANEL_HOST)).toasts?.join(' | ') ?? '',
        { timeout: 30_000 }).toContain('Ya tienes');
      // Let the exit animations finish before reading the button surface.
      await page.waitForTimeout(1500);
      const labels = (await hitsOf(page, PANEL_HOST)).map((h) => h.label);
      const toastDump = (await stateOf(page, PANEL_HOST)).toasts?.join(' | ') ?? '';
      expect(`labels=${labels.join(',')} toasts=${toastDump} added=${log.added} notes=${JSON.stringify(log.addedNotes)}`)
        .not.toContain('Crear tarjeta para este significado');
      expect(log.added).toBe(0);
      expect(log.deleted).toEqual([]);
      expect(log.updated).toEqual([]);
    } finally {
      await page.close();
    }
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('fresh save then Deshacer: deleteNotes [id] and the saved notice closes', async ({ context, serviceWorker }) => {
  test.setTimeout(180_000);
  const log: AnkiLog = { actions: [], queries: [], added: 0, addedIds: [], addedNotes: [], deleted: [], updated: [], updatedFields: [] };
  const PORT = 18771;
  const RUN_TTML = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="en"><body><div>
<p begin="0s" end="9s">RUN is hard work</p>
</div></body></tt>`;
  // A word the fake Anki does NOT know: findNotes([]) -> a FRESH add.
  const server = await startFakeAnki(PORT, log, { word: 'nomatch-xyz' });
  try {
    await seedAnki(context, PORT);
    void serviceWorker;
    const page = await openPage(context, RUN_TTML);
    try {
      await expect.poll(async () => (await boxesOf(page, VIDEO_HOST)).tokens.length, { timeout: 10_000 }).toBeGreaterThan(0);
      const tokBox = (await boxesOf(page, VIDEO_HOST)).tokens[0];
      for (let i = 0; i < 15; i++) {
        await page.mouse.move(
          640 + (tokBox.x + tokBox.width / 2 - 640) * (i + 1) / 15,
          360 + (tokBox.y + tokBox.height / 2 - 360) * (i + 1) / 15,
        );
        await page.waitForTimeout(16);
      }
      await expect.poll(async () => (await boxesOf(page, VIDEO_HOST)).card !== null, { timeout: 10_000 }).toBe(true);
      await page.keyboard.press('Alt+Shift+S');
      await expect.poll(async () => (await stateOf(page, PANEL_HOST)).toasts?.join(' | ') ?? '',
        { timeout: 30_000, message: `actions: ${log.actions.join(',')}` })
        .toContain('Tarjeta guardada');
      expect(log.added).toBe(1);

      // Undo through the notice, with fresh coordinates (sonner animates).
      for (let attempt = 0; attempt < 6; attempt++) {
        const hits = (await hitsOf(page, PANEL_HOST)).filter((h) => h.label === 'Deshacer');
        if (!hits.length) break;
        await page.mouse.click(hits[0].cx, hits[0].cy);
        await page.waitForTimeout(300);
        const text = (await stateOf(page, PANEL_HOST)).toasts?.join(' | ') ?? '';
        if (!text.includes('Tarjeta guardada')) break;
      }
      // deleteNotes hits EXACTLY the id addNote returned — never another note.
      await expect.poll(() => log.deleted, { timeout: 15_000 }).toEqual([log.addedIds[0]]);
      expect((await stateOf(page, PANEL_HOST)).toasts?.join(' | ') ?? '').not.toContain('Tarjeta guardada');
    } finally {
      await page.close();
    }
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
