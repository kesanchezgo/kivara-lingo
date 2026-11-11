/**
 * Parity screenshots (docs/REDESIGN-V2.md parity deliverable).
 *
 * Renders the SHIPPED UI — not the prototype — in a real Chromium with the
 * built extension loaded, seeds a small deterministic fixture, and writes
 * light/dark PNGs for the four surfaces the parity work touched:
 *
 *   cards-light.png / cards-dark.png        (panel · Tarjetas)
 *   dict-light.png  / dict-dark.png         (panel · Preferencias › Diccionarios)
 *   vocab-light.png / vocab-dark.png        (panel · Vocabulario)
 *   transcript-light.png / transcript-dark.png  (video · transcripción)
 *
 * The seed is written the same way the product writes it: recent cards go into
 * `chrome.storage.local` under the key the service worker publishes, and the
 * dictionary pack goes into IndexedDB (`dict_packs` / `dict_terms` /
 * `pack_stats`). No Anki, no network, no account.
 *
 * Usage: pnpm build && node scripts/parity-shots.mjs [--out docs/parity-shots]
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const DIST = path.join(root, 'dist');
const outArg = process.argv.indexOf('--out');
const OUT = path.resolve(
  root,
  outArg > 0 && process.argv[outArg + 1] ? process.argv[outArg + 1] : 'docs/parity-shots',
);
const PLAYER_URL = pathToFileURL(path.join(root, 'tests', 'e2e', 'fixtures', 'player.html')).href;

if (!fs.existsSync(path.join(DIST, 'manifest.json'))) {
  console.error(`Built extension not found at ${DIST}. Run \`pnpm build\` first.`);
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

/** Recent cards, in the exact shape `kvl:cards.recent` carries. */
const SEED_CARDS = [
  {
    id: 'shot-1', word: 'afford', sentence: "I can't afford to lose this job.",
    status: 'saved', kind: 'word', deck: 'English::Speak Daily', lang: 'en',
    createdAt: Date.now() - 8 * 60_000, savedAt: Date.now() - 8 * 60_000,
    attempts: 0, noteId: 1742, tags: ['kivara-lingo', 'kivara::netflix'],
    source: { platform: 'netflix', series: 'Speak Daily', season: 1, episode: 3 },
    media: { frame: true, audio: true, word: true },
  },
  {
    id: 'shot-2', word: 'get away with', sentence: 'They got away with it for years.',
    status: 'saved', kind: 'expression', deck: 'English::Speak Daily', lang: 'en',
    createdAt: Date.now() - 26 * 60_000, savedAt: Date.now() - 26 * 60_000,
    attempts: 0, noteId: 1741, tags: ['kivara-lingo', 'kivara::netflix'],
    source: { platform: 'netflix', series: 'Speak Daily', season: 1, episode: 3 },
    media: { frame: true, audio: false },
  },
  {
    id: 'shot-3', word: 'uptight', sentence: "Don't be so uptight about it.",
    status: 'queued', kind: 'word', deck: 'English::Speak Daily', lang: 'en',
    createdAt: Date.now() - 4 * 60_000, attempts: 1,
    nextRetryAt: Date.now() + 45_000, error: 'AnkiConnect: connection refused',
    tags: ['kivara-lingo'], source: { platform: 'netflix', series: 'Speak Daily', season: 1, episode: 4 },
  },
  {
    id: 'shot-4', word: 'sane', sentence: 'It is the only sane option.',
    status: 'failed', kind: 'word', deck: 'English::Speak Daily', lang: 'en',
    createdAt: Date.now() - 40 * 60_000, attempts: 10, error: 'Anki is not running',
    tags: ['kivara-lingo'], source: { platform: 'youtube', videoTitle: 'The Daily Briefing' },
  },
];

/** One imported pack + its coverage rows, so the section shows real numbers. */
const SEED_PACK = {
  pack: {
    id: 'shotpack1', title: 'Essential English–Spanish', revision: '2026.11.01', format: 3,
    sourceLang: 'en', targetLang: 'es', termCount: 12, enabled: true,
    author: 'Kivara', description: 'Core vocabulary for the study profile.',
    createdAt: Date.now() - 86_400_000,
  },
  terms: ['afford', 'uptight', 'sane', 'subtle', 'awkward', 'cheap', 'border', 'waste',
    'deal', 'figure', 'matter', 'point'].map((expression) => ({
    packId: 'shotpack1', expression, reading: '', definitions: [`sentido de ${expression}`],
    popularity: 100, termTags: 'common',
  })),
  stats: [
    { packId: 'shotpack1', hits: 34, lastUsedAt: Date.now() - 3_600_000, createdAt: Date.now() - 86_400_000 },
    { packId: 'bundle', hits: 128, lastUsedAt: Date.now() - 60_000, createdAt: Date.now() - 86_400_000 },
    { packId: 'remote', hits: 9, lastUsedAt: Date.now() - 3_600_000, createdAt: Date.now() - 86_400_000 },
    { packId: 'miss', hits: 3, lastUsedAt: Date.now() - 3_600_000, createdAt: Date.now() - 86_400_000 },
  ],
};

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kivara-shots-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: true,
  locale: 'en-US',
  viewport: { width: 760, height: 960 },
  deviceScaleFactor: 2,
  args: [
    '--lang=en',
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const shot = async (page, name) => {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`wrote ${path.relative(root, file)}`);
};

try {
  // The MV3 worker is lazy: wake the browser, then read the extension id.
  let [sw] = context.serviceWorkers();
  if (!sw) {
    const warm = await context.newPage();
    await warm.goto('about:blank');
    [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20_000 });
    await warm.close();
  }
  const extensionId = new URL(sw.url()).host;
  console.log(`extension id ${extensionId}`);

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options/index.html`);
  await page.waitForLoadState('load');
  await page.waitForTimeout(600);
  // Ask the worker for the dictionary list first: Dexie creates the schema on
  // the first real read, so the stores exist before the seed writes into them.
  await page.evaluate(
    () => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'LIST_DICT_PACKS' }, () => resolve(undefined));
    }),
  );

  // Seed exactly what the product writes.
  await page.evaluate(
    async ({ cards, pack }) => {
      await chrome.storage.local.set({ 'kvl:cards.recent': cards });
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('kivara-lingo');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['dict_packs', 'dict_terms', 'pack_stats'], 'readwrite');
          tx.oncomplete = () => resolve(undefined);
          tx.onerror = () => reject(tx.error);
          tx.objectStore('dict_packs').put(pack.pack);
          for (const term of pack.terms) tx.objectStore('dict_terms').put(term);
          for (const stat of pack.stats) tx.objectStore('pack_stats').put(stat);
        };
      });
    },
    { cards: SEED_CARDS, pack: SEED_PACK },
  );
  await page.reload();
  await page.waitForTimeout(600);

  const panel = page.locator('.shadow-2xl').first();
  const tab = (name) => page.getByRole('tab', { name });
  const setDark = async (dark) => {
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    if (isDark !== dark) {
      await page.getByRole('button', { name: dark ? /dark mode/i : /light mode/i }).click();
      await page.waitForTimeout(250);
    }
  };

  for (const dark of [false, true]) {
    const suffix = dark ? 'dark' : 'light';
    // Options keeps `isDarkMode` in the store; the toggle button is the switch.
    await page.reload();
    await page.waitForTimeout(400);
    await setDark(dark);

    // Tarjetas
    await tab('Cards').click();
    await page.waitForTimeout(350);
    await shot(panel, `cards-${suffix}`);

    // Preferencias › Diccionarios: the section scrolls into view inside the tab.
    await tab('Preferences').click();
    const dictHeading = page.getByText('Dictionaries', { exact: false }).first();
    if (await dictHeading.count()) {
      await dictHeading.scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await shot(panel, `dict-${suffix}`);
    } else {
      console.warn('dictionary section heading not found — screenshot skipped');
    }

    // Vocabulario
    await tab('Vocabulary').click();
    await page.waitForTimeout(350);
    await shot(panel, `vocab-${suffix}`);
  }

  // Transcripción: the real overlay on the e2e player fixture.
  for (const dark of [false, true]) {
    const suffix = dark ? 'dark' : 'light';
    const video = await context.newPage();
    await video.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    await video.goto(PLAYER_URL);
    await video.waitForFunction(
      () => (window).__kivaraFixtureReady === true,
      undefined,
      { timeout: 20_000 },
    );
    await video.waitForTimeout(1200);
    await video.keyboard.press('Alt+T');
    await video.waitForTimeout(600);
    await shot(video, `transcript-${suffix}`);
    await video.close();
  }
} finally {
  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}