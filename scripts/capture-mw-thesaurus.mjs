/**
 * Capture a real Merriam-Webster Thesaurus HTML fixture from inside the
 * MV3 service worker (Chrome extension origin + host_permissions), where
 * previous audits confirmed M-W answers 200 (the Node-side 403 was a
 * false negative from a non-browser context).
 *
 * The fixture is the ONLY source of truth for the thesaurus parser:
 * selectors must come from this capture, never invented.
 *
 * Usage:
 *   node scripts/capture-mw-thesaurus.mjs --tokens run,support,lit
 */

import { chromium } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const DEFAULT_PROFILE = path.join(ROOT, '.audit', 'mv3-profile');
const OUT_DIR = path.join(ROOT, 'docs', 'reports', 'runtime', 'fixtures', 'mw-thesaurus');

function parseArgs(argv) {
  const options = {
    tokens: ['run', 'support', 'lit'],
    timeoutMs: 30_000,
    executablePath: process.env.KIVARA_CHROMIUM_PATH || '',
    profile: DEFAULT_PROFILE,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--tokens' && next) options.tokens = next.split(',').map((v) => v.trim()).filter(Boolean);
    else if (arg === '--timeout-ms' && next) options.timeoutMs = Number(argv[++i]);
    else if (arg === '--executable' && next) options.executablePath = argv[++i];
    else if (arg === '--profile' && next) options.profile = path.resolve(ROOT, argv[++i]);
    else if (arg === '--help') {
      console.log('Uso: node scripts/capture-mw-thesaurus.mjs --tokens run,support --timeout-ms 30000');
      process.exit(0);
    }
  }
  return options;
}

function defaultChromiumPath() {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return '';
  const browserRoot = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
  try {
    const revisions = readdirSync(browserRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
      .map((entry) => ({ name: entry.name, revision: Number(entry.name.slice('chromium-'.length)) }))
      .sort((a, b) => b.revision - a.revision);
    for (const revision of revisions) {
      const executable = path.join(browserRoot, revision.name, 'chrome-win64', 'chrome.exe');
      if (existsSync(executable)) return executable;
    }
  } catch {
    // fall through to Playwright's bundled executable
  }
  return '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a URL from an extension-origin page. The page shares the
 * extension's origin and host permissions, so the request is exactly
 * what the service worker sees — same context as the enrichment source.
 */
async function fetchFromExtensionPage(page, url) {
  return page.evaluate(async (target) => {
    try {
      const response = await fetch(target, { credentials: 'include' });
      const status = response.status;
      const headers = {};
      response.headers.forEach((value, key) => { headers[key] = value; });
      const body = status >= 200 && status < 300 ? await response.text() : '';
      return { status, headers, body, finalUrl: response.url, error: null };
    } catch (err) {
      return { status: 0, headers: {}, body: '', finalUrl: target, error: String(err) };
    }
  }, url);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(path.join(DIST, 'manifest.json'))) {
    throw new Error('No existe dist/manifest.json. Ejecuta `pnpm build` antes de la captura.');
  }

  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(options.profile, { recursive: true });

  const preferredExecutable = options.executablePath || defaultChromiumPath();
  const launchOptions = {
    headless: false,
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      '--no-first-run',
      '--disable-default-apps',
    ],
  };
  if (preferredExecutable && existsSync(preferredExecutable)) launchOptions.executablePath = preferredExecutable;

  const context = await chromium.launchPersistentContext(options.profile, launchOptions);
  try {
    let workers = context.serviceWorkers();
    if (!workers.length) {
      await context.waitForEvent('serviceworker', { timeout: 15_000 });
      workers = context.serviceWorkers();
    }
    const worker = workers.find((candidate) => candidate.url().startsWith('chrome-extension://'));
    if (!worker) throw new Error('No se detectó el service worker de la extensión.');
    const extensionId = new URL(worker.url()).host;
    console.log(`[capture] service worker: ${worker.url()}`);

    // An inert extension-origin document: Chrome APIs and the extension's
    // host permissions are available, and no React/Zustand app can
    // rehydrate and overwrite anything while we capture.
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/manifest.json`, { waitUntil: 'domcontentloaded' });

    const manifest = {
      capturedAt: new Date().toISOString(),
      runtime: 'MV3 extension-origin fetch (extension host permissions)',
      serviceWorkerUrl: worker.url(),
      extensionId,
      browserVersion: context.browser()?.version() ?? null,
      tokens: {},
    };

    for (const token of options.tokens) {
      const slug = encodeURIComponent(token.trim().toLowerCase().replace(/\s+/g, ' '));
      const url = `https://www.merriam-webster.com/thesaurus/${slug}`;
      console.log(`[capture] ${token} -> ${url}`);
      const response = await fetchFromExtensionPage(page, url);
      const fileName = `${token.trim().toLowerCase().replace(/\s+/g, '_')}.html`;
      if (response.status === 200 && response.body) {
        await writeFile(path.join(OUT_DIR, fileName), response.body);
        console.log(`[capture] ${token}: 200, ${response.body.length} bytes -> ${fileName}`);
      } else {
        console.log(`[capture] ${token}: status=${response.status}${response.error ? ` error=${response.error}` : ''}`);
      }
      manifest.tokens[token] = {
        url,
        finalUrl: response.finalUrl,
        status: response.status,
        bytes: response.body?.length ?? 0,
        contentType: response.headers['content-type'] ?? null,
        cfMitigated: response.headers['cf-mitigated'] ?? null,
        file: response.status === 200 ? fileName : null,
      };
      // Politeness gap between requests to the same host.
      await sleep(2_000);
    }

    await writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`[capture] manifest -> ${path.join(OUT_DIR, 'manifest.json')}`);
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
