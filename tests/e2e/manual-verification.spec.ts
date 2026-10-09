/**
 * MANUAL verification, automated: the three checks the audit rounds kept
 * asking a human to do in a real Chrome. Each one runs against the BUILT
 * extension inside a real Chromium (see fixtures.ts), so what is asserted
 * here is what a user would see.
 *
 *  1. Sync unusable (quota / signed out) → save a key, change a setting,
 *     reload → the key is still there, and the warning explained itself.
 *  2. Anki on a custom port, service worker left idle past its 30s budget,
 *     then requested again → no CORS/network errors.
 *  3. Two open tabs: "Quitar" in one, a setting change in the other → the
 *     key stays cleared.
 *
 * Locale note: the bundled Chromium reports a Spanish UI language here, so
 * every text assertion accepts both dictionaries (es/en) rather than pinning
 * one. The accordion titles are hardcoded strings and safe to match directly.
 */
import { test, expect, type Page } from './fixtures';
import http from 'node:http';
import type { Server } from 'node:http';

type AnkiLog = { hits: number; urls: string[] };

function startFakeAnki(port: number, log: AnkiLog): Promise<Server> {
  const server = http.createServer((req, res) => {
    log.hits++;
    log.urls.push(req.url ?? '?');
    // AnkiConnect answers POST with { result, error } and permissive CORS.
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ result: '25.02.manual', error: null }));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

/** chrome.storage.sync.set rejecting, like a full quota or signed-out sync.
 * `defineProperty` because some Chromium builds expose these objects frozen. */
const BREAK_SYNC = () => {
  Object.defineProperty(chrome.storage, 'sync', {
    configurable: true,
    value: {
      ...chrome.storage.sync,
      set: () => Promise.reject(new Error('QUOTA_BYTES quota exceeded')),
    },
  });
};

const SLOT = 'kivara-secret:v1:ai.apiKey';

/** The options page opens on the Cards tab; the secrets live under Settings.
 * The AI key input only exists once a provider preset is selected (a fresh
 * install ships `provider: 'disabled'`), so the first preset is picked — and
 * the AI provider key is the only secret input rendered with the visibility
 * toggle, which identifies its sibling input unambiguously. */
async function openSettingsAiKey(page: Page): Promise<ReturnType<Page['locator']>> {
  await page.getByRole('button', { name: /^(Settings|Ajustes|Configuración)$/ }).click();
  await page.getByRole('button', { name: /IA premium/ }).click();
  await page.locator('ul li button').first().click();
  return page.locator(
    'xpath=//button[@title="Show what is typed" or @title="Mostrar lo escrito"]/preceding-sibling::input',
  );
}

const SAVED_PLACEHOLDER = /guardada|saved/;
const CLEAR_TITLE = /Quitar la clave guardada|Remove the saved key/;

test('1 · keys survive an unusable chrome.storage.sync', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options/index.html`);

  const aiInput = await openSettingsAiKey(page);
  await aiInput.fill('sk-manual-e2e-key');
  await aiInput.press('Tab'); // commit on blur

  await page.waitForFunction(
    ([slot, plain]) => {
      return chrome.storage.local
        .get(slot)
        .then((v) => typeof v[slot] === 'string' && v[slot] !== plain);
    },
    [SLOT, 'sk-manual-e2e-key'] as const,
  );

  // Sync carried the settings, never the secret.
  const sealed = await page.evaluate(async (slot) => {
    const raw = (await chrome.storage.sync.get('kivara-lingo-state'))['kivara-lingo-state'] as
      | string
      | undefined;
    if (!raw) return 'none';
    return raw.includes('sk-manual-e2e-key') ? 'plaintext' : raw.includes(slot) ? 'slot' : 'blank';
  }, SLOT);
  expect(sealed).toBe('blank');

  // ── Sync goes down. The user changes a setting (a slider) right now.
  await page.evaluate(BREAK_SYNC);
  await page.locator('input[type="range"]').first().press('ArrowRight');

  // …and the UI says so instead of pretending the setting saved.
  await expect(page.getByRole('status').filter({ hasText: 'chrome.storage.sync' })).toBeVisible();

  // ── Reload: sync still holds the last good blob, the key comes back from
  // its local slot. The input must read as "saved", not "empty".
  await page.reload();
  const aiInputAfter = await openSettingsAiKey(page);
  await expect(aiInputAfter).toHaveAttribute('placeholder', SAVED_PLACEHOLDER);
  expect(await aiInputAfter.inputValue()).toBe('');

  // And the stored value is still ciphertext, never the plaintext.
  const slotValue = await page.evaluate(async (slot) => {
    const v = await chrome.storage.local.get(slot);
    return v[slot] as string;
  }, SLOT);
  expect(slotValue).toMatch(/^enc:v1:/);
  expect(slotValue).not.toContain('sk-manual-e2e-key');
});

test('2 · Anki on a custom port, after the service worker went idle', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(150_000);
  const PORT = 18765; // NOT the default 8765
  const log: AnkiLog = { hits: 0, urls: [] };
  const server = await startFakeAnki(PORT, log);
  const corsErrors: string[] = [];
  try {
    // Point the extension at the custom port by writing the settings blob
    // directly — the same shape the app persists.
    const setup = await context.newPage();
    await setup.goto(`chrome-extension://${extensionId}/src/options/index.html`);
    await setup.evaluate(
      async ([key, port]) => {
        const found = await chrome.storage.sync.get(key);
        const raw = (found[key] as string) ?? JSON.stringify({ state: {}, version: 0 });
        const parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
        const state = (parsed.state ??= {}) as Record<string, unknown>;
        state.ankiMapping = {
          ...((state.ankiMapping as object) ?? {}),
          ankiUrl: `http://127.0.0.1:${Number(port)}`,
        };
        delete (parsed as Record<string, unknown>)._w;
        await chrome.storage.sync.set({ [key]: JSON.stringify(parsed) });
      },
      ['kivara-lingo-state', String(PORT)] as const,
    );
    await setup.close();

    const openPopup = async () => {
      const page = await context.newPage();
      page.on('console', (msg) => {
        if (/CORS|blocked/i.test(msg.text())) corsErrors.push(msg.text());
      });
      page.on('pageerror', (err) => corsErrors.push(String(err)));
      await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
      // The popup pings on mount; success renders "AnkiConnect v25.02.manual".
      await expect(page.getByText(/AnkiConnect v25\.02\.manual/)).toBeVisible();
      return page;
    };

    const first = await openPopup();
    await first.close();

    // The MV3 service worker is torn down after 30s of inactivity — longer
    // than the budget, on purpose.
    await new Promise((r) => setTimeout(r, 35_000));
    const second = await openPopup();
    await second.close();

    expect(corsErrors).toEqual([]);
    expect(log.hits).toBeGreaterThanOrEqual(2);
    expect(log.urls.every((u) => u === '/')).toBe(true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('3 · Quitar on one tab, a change on the other: the key stays cleared', async ({
  context,
  extensionId,
}) => {
  // Tab A saves a key.
  const a = await context.newPage();
  await a.goto(`chrome-extension://${extensionId}/src/options/index.html`);
  const inputA = await openSettingsAiKey(a);
  await inputA.fill('sk-tab-a-key');
  await inputA.press('Tab');
  await a.waitForFunction(
    (slot) => chrome.storage.local.get(slot).then((v) => !!v[slot]),
    SLOT,
  );

  // Tab B opens afterwards and loads the same key from the slot.
  const b = await context.newPage();
  await b.goto(`chrome-extension://${extensionId}/src/options/index.html`);
  const inputB = await openSettingsAiKey(b);
  await expect(inputB).toHaveAttribute('placeholder', SAVED_PLACEHOLDER);

  // Tab A removes it.
  const clearA = a.getByTitle(CLEAR_TITLE).first();
  await expect(clearA).toBeVisible();
  await clearA.click();
  await a.waitForFunction(
    async (slot) => {
      const v = await chrome.storage.local.get(slot);
      return v[slot] === '__cleared__';
    },
    SLOT,
  );

  // Tab B changes a setting while still holding the removed key in memory:
  // its save must not resurrect it.
  await b.locator('input[type="range"]').first().press('ArrowRight');
  await b.waitForTimeout(600);
  expect(
    await b.evaluate(async (slot) => {
      const v = await chrome.storage.local.get(slot);
      return v[slot];
    }, SLOT),
  ).toBe('__cleared__');

  // And a reload of B agrees: nothing saved, nothing to clear.
  await b.reload();
  const inputBAfter = await openSettingsAiKey(b);
  await expect(inputBAfter).not.toHaveAttribute('placeholder', SAVED_PLACEHOLDER);
  await expect(b.getByTitle(CLEAR_TITLE).first()).toBeHidden();
});
