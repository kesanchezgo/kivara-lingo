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
 * Locale note: fixtures.ts launches Chromium with `--lang=es`, so the UI
 * strings are pinned to the Spanish dictionary instead of inheriting the
 * machine's language. A regression in that pin shows up as a failing locator
 * here, which is the point.
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
 * toggle, which identifies its sibling input unambiguously.
 *
 * Note the tab bar labels are hardcoded English ("Subtitles" / "Cards" /
 * "Settings") — they are not routed through `t()` — while everything below
 * them comes from the i18n dictionaries. */
async function openSettingsAiKey(page: Page): Promise<ReturnType<Page['locator']>> {
  // `tab`, not `button`: the panel's section switch is an ARIA tab bar now
  // (role="tablist"/"tab"/"tabpanel"), which is what makes the panel legible
  // to assistive tech — the test has to speak the same language.
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /IA premium/ }).click();
  await page.locator('ul li button').first().click();
  return page.locator('xpath=//button[@title="Mostrar lo escrito"]/preceding-sibling::input');
}

const SAVED_PLACEHOLDER = /guardada/;
const CLEAR_TITLE = 'Quitar la clave guardada';

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
  test.setTimeout(320_000);
  const PORT = 18765; // NOT the default 8765
  const log: AnkiLog = { hits: 0, urls: [] };
  const server = await startFakeAnki(PORT, log);
  const corsErrors: string[] = [];
  try {
    // Point the extension at the custom port by writing the settings blob
    // directly — the same shape the app persists.
    const setup = await context.newPage();
    await setup.goto(`chrome-extension://${extensionId}/src/options/index.html`);
    // PRE-FLIGHT WAKE. The failure this spec fails with reads as "the custom
    // port never answered", but one of the causes is that the service worker
    // was still sleeping when the popup's first message arrived — and an
    // indefinite localhost hold is what that looks like from outside.
    // chrome.runtime.sendMessage IS the standard wake mechanism, so ping it
    // here, before the idle wait, and let its answer prove the worker is up.
    await setup.evaluate(
      () =>
        new Promise<void>((resolve) => {
          chrome.runtime.sendMessage({ type: 'PING' }, () => resolve());
          setTimeout(() => resolve(), 5_000);
        }),
    );
    await setup.evaluate(
      async ([key, port]) => {
        // Test 1 of this suite breaks `chrome.storage.sync.set` on purpose.
        // That patch is installed per PAGE, but the SW can carry the failed
        // state into its own fallback paths — and an Anki URL that never
        // landed means the ping goes to the default port and this test fails
        // for the wrong reason. Writing through the store's own Setter first
        // (once sync is healthy again) is not possible from there, so just
        // assert the write landed before continuing.
        const found = await chrome.storage.sync.get(key);
        const raw = (found[key] as string) ?? JSON.stringify({ state: {}, version: 0 });
        const parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
        const state = (parsed.state ??= {}) as Record<string, unknown>;
        state.ankiMapping = {
          ...((state.ankiMapping as object) ?? {}),
          ankiUrl: `http://127.0.0.1:${Number(port)}`,
        };
        delete (parsed as Record<string, unknown>)._w;
        // Re-write until it sticks: a still-broken sync would leave the app on
        // the default port, which is exactly the regression this test guards.
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await chrome.storage.sync
            .set({ [key]: JSON.stringify(parsed) })
            .catch(() => {});
          const verify = await chrome.storage.sync.get(key).catch(() => ({}));
          if (String((verify as Record<string, string>)[key] ?? '').includes(`127.0.0.1:${Number(port)}`)) {
            return;
          }
          await new Promise((r) => setTimeout(r, 300));
        }
        throw new Error('could not persist the custom Anki port');
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
      // The popup pings on mount and the status pill shows the server version
      // on success ("AnkiConnect v… · activo/active"). The version text itself
      // is not what matters here — that the SW REACHES the custom port after
      // going idle is, with no CORS/network error.
      //
      // The budget is wide on purpose: this test runs second in a suite whose
      // first test deliberately breaks chrome.storage.sync, and a busy service
      // worker can be slow to answer its first ping — but the SW budget below
      // keeps the total bounded, and the failure being watched (a port that
      // never answers) hangs for the whole window rather than coming back
      // quickly and clean.
      await expect
        .poll(
          async () => {
            const visible = await page
              .getByText('25.02.manual', { exact: false })
              .first()
              .isVisible()
              .catch(() => false);
            if (!visible) {
              // Report WHILE it fails: hits is what the fake server saw, so
              // hits>=2 says the request reached AnkiConnect and the silent
              // half is the render; hits low is connectivity on its own.
              console.log('[ANKI-POLL] pill? ' + visible + ' hits=' + log.hits);
            }
            return visible;
          },
          {
            message: '[Anki] the custom-port ping did not answer (see [ANKI-POLL] lines for what the server saw)',
            timeout: 60_000,
            intervals: [1000, 2000, 4000, 8000],
          },
        )
        .toBe(true);
      return page;
    };

    const first = await openPopup();
    await first.close();

    // The MV3 service worker is torn down after 30s of inactivity — longer
    // than the budget, on purpose. A fixed sleep competes with machine load:
    // the extended lookup budget on the pill below is what carries this, and
    // awaiting an observed teardown would need a surface the browser does not
    // expose.
    await new Promise((r) => setTimeout(r, 35_000));
    const second = await openPopup();
    await second.close();

    expect(corsErrors).toEqual([]);
    // `hits` counts pings the fake server saw. A pill that never appeared with
    // hits>=2 is a render failure; hits low is connectivity; corsErrors is the
    // original regression. Both facts go into the failure text because the
    // assertion itself is where a reader starts.
    const diag = () => 'hits=' + log.hits + ' errors=' + JSON.stringify(corsErrors.slice(0, 4));
    expect(log.hits, 'server saw ' + diag()).toBeGreaterThanOrEqual(2);
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
