/**
 * Dedicated MV3 IMAGE probe. Runs the image fan-out (`purpose: 'card'`)
 * from the real browser runtime and captures, per token+tier, the FULL
 * candidate pool with each candidate's score and reason codes — not just
 * the published winner.
 *
 * The corpus-quality probe runs `purpose: 'popover'`, which skips the
 * image sources by design, so it reports `img` empty for every token.
 * This probe is the opposite: it exists ONLY to gather image evidence
 * (raw pool + winner + rejection reason) so the ranking in
 * `pickImageCandidate` / `rankImageCandidates` can be calibrated against
 * real data instead of guesses.
 *
 * Evidence source: the `[kivara:enrichment:image]` service-worker trace,
 * which now emits `{ token, imageUrl, source, candidates, emptyReason,
 * pool: [{ source, url, title, score, fallback, reasons }] }`.
 *
 * Usage:
 *   node scripts/mv3-image-probe.mjs
 *   node scripts/mv3-image-probe.mjs --tokens apple,week,piece of cake
 *   node scripts/mv3-image-probe.mjs --custom "cat|The cat slept.";"whatever|Do whatever."
 *   node scripts/mv3-image-probe.mjs --tiers vip --delay-ms 1500
 *
 * Prereq: `pnpm build` first, and after any code change wipe the SW
 * bytecode cache or Chrome runs the previous worker:
 *   rm -rf ".audit/mv3-image-profile/Default/Service Worker" \
 *          ".audit/mv3-image-profile/Default/Code Cache" \
 *          ".audit/mv3-image-profile/Default/Local Extension Settings" \
 *          ".audit/mv3-image-profile/Default/IndexedDB"
 */

import { chromium } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const DEFAULT_PROFILE = path.join(ROOT, '.audit', 'mv3-image-profile');
const REPORT_DIR = path.join(ROOT, 'docs', 'reports', 'final-quality');
const STORE_KEY = 'kivara-lingo-state';

/**
 * Image-focused corpus. Deliberately WITHOUT sentences by default: this
 * probe exercises the web-image fallback path (single word, no video
 * frame), which is where the known failures live (`piece of cake` → cake,
 * `week` → news). A sentence can still be attached via --custom to check a
 * sense-pinned run.
 *
 * Mix of: concrete nouns (should publish), abstract/function words (should
 * stay empty), idioms (should stay empty without figurative evidence), and
 * the specific broken cases from the audit.
 */
const IMAGE_CORPUS = [
  ['apple', ''],
  ['cat', ''],
  ['tensor', ''],
  ['run', ''],
  ['anything', ''],
  ['week', ''],
  ['know', ''],
  ['piece of cake', ''],
  ['break up', ''],
  ['lit', ''],
  ['forget', ''],
  ['support', ''],
  ['give', ''],
  ['umbrella', ''],
  ['whatever', ''],
];

function parseArgs(argv) {
  const options = {
    corpus: IMAGE_CORPUS,
    tiers: ['standard', 'vip'],
    delayMs: 1500,
    timeoutMs: 45000,
    executablePath: process.env.KIVARA_CHROMIUM_PATH || '',
    profile: DEFAULT_PROFILE,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--tokens' && next) {
      const wanted = new Set(next.split(',').map((v) => v.trim()).filter(Boolean));
      options.corpus = IMAGE_CORPUS.filter(([token]) => wanted.has(token));
      i += 1;
    } else if (arg === '--custom' && next) {
      options.corpus = next.split(';').map((probe) => {
        const [token, ...rest] = probe.split('|');
        return [token.trim(), (rest.join('|') || '').trim()];
      }).filter(([token]) => token);
      i += 1;
    } else if (arg === '--tiers' && next) {
      options.tiers = next.split(',').map((v) => v.trim()).filter(Boolean);
      i += 1;
    } else if (arg === '--delay-ms' && next) options.delayMs = Number(argv[++i]);
    else if (arg === '--timeout-ms' && next) options.timeoutMs = Number(argv[++i]);
    else if (arg === '--executable' && next) options.executablePath = argv[++i];
    else if (arg === '--profile' && next) options.profile = path.resolve(ROOT, argv[++i]);
    else if (arg === '--help') {
      console.log('Uso: node scripts/mv3-image-probe.mjs [--tokens apple,week] [--custom "word|sentence"] [--tiers standard,vip] [--delay-ms 1500]');
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
    // fall through to Playwright's bundled Chromium
  }
  return '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compactValue(value, depth = 0) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length > 400 ? `${value.slice(0, 397)}...` : value;
  if (depth >= 5) return Array.isArray(value) ? `[Array(${value.length})]` : '[Object]';
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => compactValue(item, depth + 1));
  const out = {};
  for (const [key, child] of Object.entries(value).slice(0, 30)) out[key] = compactValue(child, depth + 1);
  return out;
}

async function consoleEvent(message) {
  const values = [];
  for (const arg of message.args()) {
    try {
      values.push(compactValue(await arg.jsonValue()));
    } catch {
      values.push('[unserializable]');
    }
  }
  return { at: new Date().toISOString(), type: message.type(), text: message.text(), values };
}

/** Resolve a word through the real service-worker port with the image
 * fan-out enabled (`purpose: 'card'`). */
async function resolveWord(page, { token, sentence, timeoutMs }) {
  return page.evaluate(async ({ token, sentence, timeoutMs }) => {
    const messages = [];
    await new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: 'kvl-resolve-word' });
      const timer = setTimeout(() => { port.disconnect(); reject(new Error(`timeout ${timeoutMs}ms`)); }, timeoutMs);
      port.onMessage.addListener((message) => {
        messages.push(message);
        if (message?.phase === 'done') { clearTimeout(timer); port.disconnect(); resolve(); }
      });
      port.onDisconnect.addListener(() => {
        if (chrome.runtime.lastError) { clearTimeout(timer); reject(new Error(chrome.runtime.lastError.message)); }
      });
      port.postMessage({ kind: 'resolve-word', token, sentence, sourceLang: 'en', includeAi: false, purpose: 'card' });
    });
    return messages;
  }, { token, sentence, timeoutMs });
}

/** Pull the enriched image trace (winner + full scored pool) from the SW
 * console events of this lookup. */
function imageTrace(tierConsole) {
  return tierConsole
    .filter((event) => event.text.includes('[kivara:enrichment:image]'))
    .map((event) => event.values.find((value) => value && typeof value === 'object' && value.token !== undefined))
    .find(Boolean);
}

/** Which image sources actually returned data for this lookup. */
function imageSourceLogs(tierConsole) {
  const IMAGE_SOURCES = new Set([
    'wikimediaCommons', 'openverse', 'unsplash', 'pixabay', 'bingImages', 'duckduckgoImages',
  ]);
  return tierConsole
    .filter((event) => event.text.includes('[kivara:enrichment:source]'))
    .map((event) => event.values.find((value) => value && typeof value === 'object' && value.source))
    .filter((log) => log && IMAGE_SOURCES.has(log.source));
}

async function setTier(page, tier) {
  return page.evaluate(async ({ storeKey, tier }) => {
    const raw = await chrome.storage.sync.get(storeKey);
    let persisted = {};
    try { persisted = typeof raw[storeKey] === 'string' ? JSON.parse(raw[storeKey]) : {}; } catch { persisted = {}; }
    const wrapped = !!persisted?.state;
    const state = wrapped ? { ...persisted.state } : { ...persisted };
    const vip = { ...(state.vip ?? {}), enabled: tier === 'vip', perSourceTimeoutMs: 12000, cacheTtlDays: 0 };
    state.vip = vip;
    const next = wrapped ? { ...persisted, state } : state;
    await chrome.storage.sync.set({ [storeKey]: JSON.stringify(next) });
    return { enabled: vip.enabled };
  }, { storeKey: STORE_KEY, tier });
}

async function clearCache(page) {
  return page.evaluate(async () => {
    await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE', which: 'enrichment' }).catch(() => {});
    return true;
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(path.join(DIST, 'manifest.json'))) {
    throw new Error('No existe dist/manifest.json. Ejecuta `pnpm build` antes del probe.');
  }

  await mkdir(options.profile, { recursive: true });
  await mkdir(REPORT_DIR, { recursive: true });

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
  const allConsole = [];

  try {
    const attachWorker = (worker) => {
      worker.on('console', async (message) => {
        const event = await consoleEvent(message);
        allConsole.push(event);
      });
    };
    for (const worker of context.serviceWorkers()) attachWorker(worker);
    context.on('serviceworker', attachWorker);

    let workers = context.serviceWorkers();
    if (!workers.length) {
      await context.waitForEvent('serviceworker', { timeout: 15000 });
      workers = context.serviceWorkers();
    }
    const worker = workers.find((candidate) => candidate.url().startsWith('chrome-extension://'));
    if (!worker) throw new Error('No se detectó el service worker de la extensión.');
    const extensionId = new URL(worker.url()).host;
    console.log(`[image-probe] service worker: ${worker.url()}`);

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/manifest.json`, { waitUntil: 'domcontentloaded' });

    // Enable every source flag once so both tiers run their full image set.
    await page.evaluate(async ({ storeKey }) => {
      const raw = await chrome.storage.sync.get(storeKey);
      let persisted = {};
      try { persisted = typeof raw[storeKey] === 'string' ? JSON.parse(raw[storeKey]) : {}; } catch { persisted = {}; }
      const wrapped = !!persisted?.state;
      const state = wrapped ? { ...persisted.state } : { ...persisted };
      const flags = ['freeDictionary','datamuse','wiktionary','wiktionaryHtml','wiktionaryApi','wiktApi','mobyThesaurus','thesaurusCom','wordHippo','theIdioms','bundled','yomitanPacks','wordnet','etymonline','tatoeba','linguaLibre','googleTtsFallback','bingImages','openverse','wikimediaCommons','duckduckgoImages','youglish','britannicaDictionary','cambridge','oxfordLearners','longman','collins','merriamWebster','merriamWebsterThesaurus','oxfordCollocations','ozdic','pons','babla','dictCc','reverso','linguee','promtContext','wordReference','spanishDict','cambridgeAudio','oxfordAudio','forvo','unsplash','pixabay'];
      const vip = { ...(state.vip ?? {}), perSourceTimeoutMs: 12000, cacheTtlDays: 0 };
      for (const flag of flags) vip[flag] = true;
      vip.enabled = false;
      state.vip = vip;
      state.translate = { ...(state.translate ?? {}), targetLanguage: 'es' };
      const next = wrapped ? { ...persisted, state } : state;
      await chrome.storage.sync.set({ [storeKey]: JSON.stringify(next) });
      return true;
    }, { storeKey: STORE_KEY });

    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      runtime: 'Playwright persistent Chromium with unpacked MV3 extension, image fan-out (purpose=card)',
      note: 'Image-only evidence probe. `pool` carries every candidate with its ranking score and reason codes.',
      extensionId,
      tiers: options.tiers,
      corpus: options.corpus.map(([token, sentence]) => ({ token, sentence })),
      rows: [],
    };

    for (const tier of options.tiers) {
      const selection = await setTier(page, tier);
      console.log(`[image-probe] tier=${tier} selection=${JSON.stringify(selection)}`);

      for (const [token, sentence] of options.corpus) {
        await clearCache(page);
        const consoleStart = allConsole.length;
        const startedAt = Date.now();
        let error = null;
        try {
          await resolveWord(page, { token, sentence, timeoutMs: options.timeoutMs });
        } catch (caught) {
          error = caught instanceof Error ? caught.message : String(caught);
        }
        const ms = Date.now() - startedAt;
        await sleep(800);
        const tierConsole = allConsole.slice(consoleStart);
        const trace = imageTrace(tierConsole);
        const sourceLogs = imageSourceLogs(tierConsole);

        const row = {
          tier,
          token,
          sentence,
          ms,
          error,
          winnerUrl: trace?.imageUrl ?? null,
          winnerSource: trace?.source ?? null,
          emptyReason: trace?.emptyReason ?? null,
          candidateCount: trace?.candidates ?? 0,
          pool: trace?.pool ?? [],
          imageSources: sourceLogs.map((log) => ({ source: log.source, hasData: log.hasData, error: log.error ?? null })),
        };
        report.rows.push(row);
        const verdict = row.winnerUrl
          ? `WIN ${row.winnerSource}`
          : `EMPTY (${row.emptyReason ?? 'no-trace'})`;
        console.log(`[image-probe] ${tier}/${token}: ${error ? `ERROR ${error}` : `${ms}ms, ${row.candidateCount} cand, ${verdict}`}`);
        await sleep(options.delayMs);
      }
    }

    report.finishedAt = new Date().toISOString();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(REPORT_DIR, `mv3-image-probe-${stamp}.json`);
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\nInforme: ${path.relative(ROOT, reportPath)}`);

    // Console summary: winner source + empty-reason distribution per tier.
    const summary = report.rows.reduce((acc, row) => {
      const key = row.tier;
      if (!acc[key]) acc[key] = { tokens: 0, published: 0, empty: 0, fromFallback: 0, errors: 0 };
      acc[key].tokens += 1;
      if (row.error) { acc[key].errors += 1; return acc; }
      if (row.winnerUrl) {
        acc[key].published += 1;
        if (['bingImages', 'duckduckgoImages'].includes(row.winnerSource)) acc[key].fromFallback += 1;
      } else {
        acc[key].empty += 1;
      }
      return acc;
    }, {});
    console.table(summary);
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
