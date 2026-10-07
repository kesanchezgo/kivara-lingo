/**
 * Seed Yomitan packs (kty-en-es + kty-en-ipa) into a persistent Chromium
 * profile's IndexedDB, then run the contextual corpus against THAT profile.
 *
 * Why this exists: the corpus script uses a FRESH profile every run, so
 * Yomitan packs are never installed there — every "Yomitan packs" audit
 * row so far measured an empty table. This harness installs the two
 * recommended offline packs once (persisted in the profile dir), so the
 * corpus measures what a real onboarded user gets.
 *
 * Usage:
 *   node scripts/seed-yomitan-packs.mjs [--profile .audit/mv3-yomitan-profile]
 *   node scripts/mv3-corpus-quality.mjs --profile .audit/mv3-yomitan-profile --purpose card
 *
 * Packs (same URLs as the onboarding wizard):
 *   kty-en-es.zip  (~1.6 MB, ~61k terms, EN->ES glosses)
 *   kty-en-ipa.zip (~5 MB, ~140k rows, IPA overlay)
 */
import { chromium } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const DEFAULT_PROFILE = path.join(ROOT, '.audit', 'mv3-yomitan-profile');
const PACKS_BASE_URL = 'https://pub-c3d38cca4dc2403b88934c56748f5144.r2.dev/releases/latest';

function parseArgs(argv) {
  const options = { profile: DEFAULT_PROFILE, executablePath: process.env.KIVARA_CHROMIUM_PATH || '' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--profile' && argv[i + 1]) options.profile = path.resolve(ROOT, argv[++i]);
    else if (argv[i] === '--executable' && argv[i + 1]) options.executablePath = argv[++i];
  }
  return options;
}

function defaultChromiumPath() {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return '';
  const browserRoot = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
  try {
    const revisions = readdirSync(browserRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^chromium-\d+$/.test(e.name))
      .map((e) => ({ name: e.name, revision: Number(e.name.slice('chromium-'.length)) }))
      .sort((a, b) => b.revision - a.revision);
    for (const r of revisions) {
      const exe = path.join(browserRoot, r.name, 'chrome-win64', 'chrome.exe');
      if (existsSync(exe)) return exe;
    }
  } catch { /* fall through */ }
  return '';
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(path.join(DIST, 'manifest.json'))) {
    throw new Error('No existe dist/manifest.json. Ejecuta build antes.');
  }
  const preferredExecutable = options.executablePath || defaultChromiumPath();
  const launchOptions = {
    headless: false,
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--no-first-run', '--disable-default-apps'],
  };
  if (preferredExecutable && existsSync(preferredExecutable)) launchOptions.executablePath = preferredExecutable;

  const context = await chromium.launchPersistentContext(options.profile, launchOptions);
  try {
    let workers = context.serviceWorkers();
    if (!workers.length) await context.waitForEvent('serviceworker', { timeout: 15000 });
    workers = context.serviceWorkers();
    const worker = workers.find((c) => c.url().startsWith('chrome-extension://'));
    if (!worker) throw new Error('No se detectó el service worker.');
    const extensionId = new URL(worker.url()).host;
    console.log(`[seed] service worker: ${worker.url()}`);

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/manifest.json`, { waitUntil: 'domcontentloaded' });

    for (const pack of ['kty-en-es', 'kty-en-ipa']) {
      const url = `${PACKS_BASE_URL}/${pack}.zip`;
      console.log(`[seed] instalando ${pack} (~1-2 min)...`);
      const result = await page.evaluate(async ({ packUrl }) => {
        const send = (type, payload) => new Promise((resolve) => {
          chrome.runtime.sendMessage({ type, ...payload }, (response) => {
            const err = chrome.runtime.lastError;
            resolve(err ? { ok: false, error: err.message } : response);
          });
        });
        return send('INSTALL_DICT_PACK_FROM_URL', { url: packUrl });
      }, { packUrl: url });
      console.log(`[seed] ${pack}: ${JSON.stringify(result).slice(0, 300)}`);
    }

    // Verify: count packs + probe lookups for the corpus headwords.
    const check = await page.evaluate(async () => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'LIST_DICT_PACKS' }, (response) => {
        const err = chrome.runtime.lastError;
        resolve(err ? { ok: false, error: err.message } : response);
      });
    }));
    console.log(`[seed] packs: ${JSON.stringify(check).slice(0, 500)}`);
    console.log(`[seed] perfil listo: ${options.profile}`);
  } finally {
    await context.close();
  }
}

main().catch((err) => { console.error('[seed] FATAL:', err); process.exit(1); });
