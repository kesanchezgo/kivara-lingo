/**
 * Playwright fixtures for loading the built Kivara Lingo extension into a
 * real Chromium instance.
 *
 * MV3 extensions can only be loaded through a *persistent* context with
 * `--load-extension`; headless-new supports this on recent Chromium. We spin
 * up a throwaway user-data-dir per worker so runs stay isolated and never
 * touch the developer's real Chrome profile.
 *
 * These fixtures deliberately do NOT log in to any streaming service. The
 * extension operates on whatever `<video>` and subtitle tracks are already
 * present in the page; tests drive it against a local HTML5 video so they are
 * deterministic, offline, and free of any account/credential dependency.
 */
import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(here, '../../dist');

export interface ExtensionFixtures {
  context: BrowserContext;
  extensionId: string;
  serviceWorker: Worker;
}
export type { Page } from '@playwright/test';

export const test = base.extend<ExtensionFixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    if (!fs.existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
      throw new Error(
        `Built extension not found at ${EXTENSION_PATH}. Run \`pnpm build\` before the e2e suite.`,
      );
    }

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kivara-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      // The `chromium` channel uses the *new* headless mode, which is the only
      // headless variant that runs MV3 background service workers. The legacy
      // bundled headless never registers the worker, so extension tests hang.
      channel: 'chromium',
      headless: true,
      locale: 'es-ES',
      args: [
        // Pin the browser UI language: `chrome.i18n.getUILanguage()` is what
        // src/shared/i18n.ts keys off, and without this the suite inherits
        // whatever the machine or runner reports — the same spec would then
        // assert Spanish here and English elsewhere.
        '--lang=es',
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        // Autoplay without a user gesture so the <video> can start in tests.
        '--autoplay-policy=no-user-gesture-required',
      ],
    });

    await use(context);

    await context.close();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* best effort cleanup */
    }
  },

  serviceWorker: async ({ context }, use) => {
    // The MV3 background service worker is lazy: in headless Chromium it may
    // not register until the context has done *something*. Open a blank page
    // to wake the browser, then grab the existing worker or wait for it.
    let [sw] = context.serviceWorkers();
    if (!sw) {
      const warmup = await context.newPage();
      await warmup.goto('about:blank').catch(() => {});
      [sw] = context.serviceWorkers();
      if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20_000 });
      await warmup.close().catch(() => {});
    }
    await use(sw);
  },

  extensionId: async ({ serviceWorker }, use) => {
    // chrome-extension://<id>/service-worker-loader.js
    const url = serviceWorker.url();
    const id = url.split('/')[2];
    await use(id);
  },
});

export const expect = test.expect;
