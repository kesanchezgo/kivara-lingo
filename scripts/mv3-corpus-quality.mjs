/**
 * Full-corpus MV3 quality probe. Runs the contextual evaluation corpus in
 * BOTH tiers from the real browser runtime (extension origin + host
 * permissions), which is the only environment where protected scrapers
 * answer 200 (Node-side fetches yield false 403s).
 *
 * Unlike `mv3-enrichment-audit.mjs` (which isolates one provider per
 * request), this probe runs the FULL source set per tier — the same
 * configuration a real user gets — and records the final merged card
 * for each corpus token.
 *
 * Usage:
 *   node scripts/mv3-corpus-quality.mjs [--tokens run,lit,...] [--delay-ms 1500]
 */

import { chromium } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const DEFAULT_PROFILE = path.join(ROOT, '.audit', 'mv3-corpus-profile');
const REPORT_DIR = path.join(ROOT, 'docs', 'reports', 'final-quality');

const STORE_KEY = 'kivara-lingo-state';

/** Contextual corpus: token + the sentence that pins the intended sense. */
const FULL_CORPUS = [
  ['apple', 'She ate a ripe apple.'],
  ['run', 'She ran home.'],
  ['run', 'She runs the company from home.'],
  ['anything', 'I do not need anything else.'],
  ['anybody', 'I did not see anybody at the park.'],
  ['each', 'Each student has a book.'],
  ['tensor', 'The model uses a tensor.'],
  ['lit', 'The show was lit.'],
  ['break up', 'They decided to break up after college because their relationship was over.'],
  ['piece of cake', 'The exam was a piece of cake.'],
  ['forget', 'Do not forget your keys.'],
  ['support', 'Her family supported her decision.'],
  ['give', 'Give me the keys, please.'],
  ['know', 'I do not know the answer.'],
  ['week', 'Oh, yeah, last week you had a wonderful cake.'],
];

function parseArgs(argv) {
  const options = {
    corpus: FULL_CORPUS,
    delayMs: 1500,
    timeoutMs: 45000,
    executablePath: process.env.KIVARA_CHROMIUM_PATH || '',
    profile: DEFAULT_PROFILE,
    purpose: 'popover',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--tokens' && next) {
      const wanted = new Set(next.split(',').map((v) => v.trim()).filter(Boolean));
      options.corpus = FULL_CORPUS.filter(([token]) => wanted.has(token));
    } else if (arg === '--custom' && next) {
      // Arbitrary ad-hoc probes outside the fixed corpus:
      //   --custom "word|the sentence with the word."
      // Multiple probes separated by ';'. The sentence is optional —
      // without one the resolution runs context-free (pure lemma lookup).
      options.corpus = next.split(';').map((probe) => {
        const [token, ...rest] = probe.split('|');
        return [token.trim(), (rest.join('|') || '').trim()];
      }).filter(([token]) => token);
    } else if (arg === '--delay-ms' && next) options.delayMs = Number(argv[++i]);
    else if (arg === '--timeout-ms' && next) options.timeoutMs = Number(argv[++i]);
    else if (arg === '--executable' && next) options.executablePath = argv[++i];
    else if (arg === '--profile' && next) options.profile = path.resolve(ROOT, argv[++i]);
    else if (arg === '--purpose' && next) options.purpose = argv[++i];
    else if (arg === '--help') {
      console.log('Uso: node scripts/mv3-corpus-quality.mjs [--tokens run,lit] [--custom "word|sentence";"word2|sentence2"] [--delay-ms 1500] [--purpose popover|card]');
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
  if (depth >= 4) return Array.isArray(value) ? `[Array(${value.length})]` : '[Object]';
  if (Array.isArray(value)) return value.slice(0, 8).map((item) => compactValue(item, depth + 1));
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

/** Resolve a word through the real service-worker port (same path as
 * the popover). `purpose: 'card'` runs the full save-time fan-out
 * including the image sources. */
async function resolveWord(page, { token, sentence, timeoutMs, purpose }) {
  return page.evaluate(async ({ token, sentence, timeoutMs, purpose }) => {
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
      port.postMessage({ kind: 'resolve-word', token, sentence, sourceLang: 'en', includeAi: false, purpose });
    });
    return messages;
  }, { token, sentence, timeoutMs, purpose });
}

/** Build the audit card from a purpose='card' port run. The published
 * image is reconstructed from the SW console logs: the per-source events
 * plus the [kivara:enrichment:image] trace. */
function cardFromCreateResponse(messages, sourceLogs, tierConsole) {
  const withEntry = [...messages].reverse().find((message) => message?.entry?.vip);
  const imageEvent = tierConsole
    .filter((event) => event.text.includes('[kivara:enrichment:image]'))
    .map((event) => event.values.find((value) => value && typeof value === 'object' && value.token !== undefined))
    .find(Boolean);
  const successful = sourceLogs
    .filter((log) => log?.hasData)
    .map((log) => log.source);
  const entry = withEntry?.entry;
  return {
    entry: entry ? compactCardEntry(entry) : {},
    vip: {
      ...(entry?.vip ?? {}),
      imageUrl: imageEvent?.imageUrl ?? undefined,
      imageSource: imageEvent?.source ?? undefined,
      imageCandidates: imageEvent?.candidates,
    },
    successfulSources: successful,
    failedSources: sourceLogs
      .filter((log) => log && log.hasData === false && log.error)
      .map((log) => `${log.source}: ${log.error}`),
  };
}

/** Extract the final entry + vip payload from the streamed messages.
 * The enrichment phase carries the merged card; successfulSources is
 * rebuilt from the per-source console logs. */
function finalCard(messages, sourceLogs) {
  const withEntry = [...messages].reverse().find((message) => message?.entry?.vip);
  if (!withEntry) {
    const localOnly = [...messages].reverse().find((message) => message?.entry);
    if (!localOnly) return null;
    return { entry: compactCardEntry(localOnly.entry), vip: {}, successfulSources: [], failedSources: [] };
  }
  const entry = withEntry.entry;
  const successful = sourceLogs
    .filter((log) => log?.hasData)
    .map((log) => log.source);
  const failed = sourceLogs
    .filter((log) => log && log.hasData === false && log.error)
    .map((log) => `${log.source}: ${log.error}`);
  return {
    entry: compactCardEntry(entry),
    vip: entry.vip ? {
      definitions: entry.vip.definitions,
      examples: entry.vip.examples,
      etymology: entry.vip.etymology,
      imageUrl: entry.vip.imageUrl,
      videoLinks: entry.vip.videoLinks,
      frequencyEvidence: entry.vip.frequencyEvidence,
      provenance: entry.vip.provenance,
    } : {},
    successfulSources: successful,
    failedSources: failed,
  };
}

function compactCardEntry(entry) {
  return {
    translation: entry.translation,
    bilingual: entry.bilingual,
    monolingual: entry.monolingual,
    phonetic: entry.phonetic,
    synonyms: entry.synonyms,
    antonyms: entry.antonyms,
    collocations: entry.collocations,
    examples: entry.examples,
    frequencyEvidence: entry.frequencyEvidence,
  };
}

/** Set the tier source configuration in the persisted store. */
async function setTier(page, tier) {
  return page.evaluate(async ({ storeKey, tier }) => {
    const raw = await chrome.storage.sync.get(storeKey);
    let persisted = {};
    try { persisted = typeof raw[storeKey] === 'string' ? JSON.parse(raw[storeKey]) : {}; } catch { persisted = {}; }
    const wrapped = !!persisted?.state;
    const state = wrapped ? { ...persisted.state } : { ...persisted };
    const previous = state.vip && typeof state.vip === 'object' ? state.vip : {};
    const defaults = {
      enabled: tier === 'vip',
      perSourceTimeoutMs: 12000,
      cacheTtlDays: 0,
    };
    // Keep per-source toggles the user had (or all-on defaults for a fresh
    // profile), only re-derive the master switch and timeouts.
    state.vip = { ...previous, ...defaults, ...(previous.unsplashAccessKey === undefined ? {} : { unsplashAccessKey: previous.unsplashAccessKey }), ...(previous.pixabayApiKey === undefined ? {} : { pixabayApiKey: previous.pixabayApiKey }) };
    if (tier === 'standard') state.vip.enabled = false;
    state.translate = { ...(state.translate ?? {}), targetLanguage: 'es' };
    const next = wrapped ? { ...persisted, state } : state;
    await chrome.storage.sync.set({ [storeKey]: JSON.stringify(next) });
    const verified = JSON.parse((await chrome.storage.sync.get(storeKey))[storeKey]);
    const vip = verified?.state?.vip ?? verified?.vip ?? {};
    return { enabled: vip.enabled, wordnet: vip.wordnet, merriamWebsterThesaurus: vip.merriamWebsterThesaurus };
  }, { storeKey: STORE_KEY, tier });
}

/** Clear the enrichment cache so every probe is a real network run.
 * Uses the same `CLEAR_CACHE` message the side panel sends. */
async function clearCache(page) {
  return page.evaluate(async () => {
    await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE', which: 'enrichment' }).catch(() => {});
    return true;
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(path.join(DIST, 'manifest.json'))) {
    throw new Error('No existe dist/manifest.json. Ejecuta `pnpm build` antes del corpus.');
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
    console.log(`[corpus] service worker: ${worker.url()}`);

    // Inert extension-origin page: chrome APIs available, no React app to
    // rehydrate and fight the tier configuration.
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/manifest.json`, { waitUntil: 'domcontentloaded' });

    // Enable every source flag once on the fresh profile so both tiers run
    // their full sets. The master switch alone separates the tiers.
    const enableAll = await page.evaluate(async ({ storeKey }) => {
      const raw = await chrome.storage.sync.get(storeKey);
      let persisted = {};
      try { persisted = typeof raw[storeKey] === 'string' ? JSON.parse(raw[storeKey]) : {}; } catch { persisted = {}; }
      const wrapped = !!persisted?.state;
      const state = wrapped ? { ...persisted.state } : { ...persisted };
      const flags = ['freeDictionary','datamuse','wiktionary','wiktionaryHtml','wiktionaryApi','wiktApi','mobyThesaurus','thesaurusCom','wordHippo','theIdioms','bundled','yomitanPacks','wordnet','etymonline','tatoeba','linguaLibre','googleTtsFallback','bingImages','openverse','wikimediaCommons','duckduckgoImages','youglish','britannicaDictionary','cambridge','oxfordLearners','longman','collins','merriamWebster','merriamWebsterThesaurus','oxfordCollocations','ozdic','pons','babla','dictCc','reverso','linguee','promtContext','wordReference','spanishDict','cambridgeAudio','oxfordAudio','forvo','unsplash','pixabay'];
      const vip = { ...(state.vip ?? {}), perSourceTimeoutMs: 12000, cacheTtlDays: 0 };
      for (const flag of flags) vip[flag] = true;
      vip.enabled = false; // tier separation handled per pass below
      state.vip = vip;
      state.translate = { ...(state.translate ?? {}), targetLanguage: 'es' };
      const next = wrapped ? { ...persisted, state } : state;
      await chrome.storage.sync.set({ [storeKey]: JSON.stringify(next) });
      return true;
    }, { storeKey: STORE_KEY });
    console.log(`[corpus] all sources enabled: ${enableAll}`);

    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      runtime: 'Playwright persistent Chromium with unpacked MV3 extension, full source set per tier',
      extensionId,
      corpus: options.corpus.map(([token, sentence]) => ({ token, sentence })),
      tiers: ['standard', 'vip'],
      rows: [],
    };

    for (const tier of ['standard', 'vip']) {
      const selection = await setTier(page, tier);
      console.log(`[corpus] tier=${tier} selection=${JSON.stringify(selection)}`);

      for (const [token, sentence] of options.corpus) {
        await clearCache(page);
        const consoleStart = allConsole.length;
        const startedAt = Date.now();
        let error = null;
        let messages = [];
        try {
          messages = await resolveWord(page, { token, sentence, timeoutMs: options.timeoutMs, purpose: options.purpose });
        } catch (caught) {
          error = caught instanceof Error ? caught.message : String(caught);
        }
        const ms = Date.now() - startedAt;

        // Console events from the service worker arrive asynchronously and
        // often land AFTER the port resolves; give them a moment so the
        // per-source logs of this very lookup are captured.
        await sleep(600);
        const tierConsole = allConsole.slice(consoleStart);
        const sourceLogs = tierConsole
          .filter((event) => event.text.includes('[kivara:enrichment:source]'))
          .map((event) => event.values.find((value) => value && typeof value === 'object' && value.source))
          .filter(Boolean);
        const card = options.purpose === 'card'
          ? cardFromCreateResponse(messages, sourceLogs, tierConsole)
          : finalCard(messages, sourceLogs);
        // Collocation-pool trace: the merger logs it per lookup; capture
        // the LAST one for this token so partial runs still carry the
        // recall evidence (pool size, sense-bound count, anchor, pool).
        const collocEvent = [...tierConsole]
          .reverse()
          .map((event) => event.values.find((value) => value && typeof value === 'object' && value.poolSize !== undefined && value.token === token))
          .find(Boolean);

        report.rows.push({
          tier,
          token,
          sentence,
          ms,
          error,
          card,
          collocTrace: collocEvent ?? null,
          sourceLogs,
        });
        console.log(`[corpus] ${tier}/${token}: ${error ? `ERROR ${error}` : `${ms}ms, ${card?.successfulSources?.length ?? 0} sources`}`);
        await sleep(options.delayMs);
      }
    }

    report.finishedAt = new Date().toISOString();
    const stamp = new Date().toISOString().slice(0, 10);
    const reportPath = path.join(REPORT_DIR, `mv3-corpus-quality-${stamp}.json`);
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\nInforme: ${path.relative(ROOT, reportPath)}`);

    // Console summary: field coverage per tier.
    const summary = report.rows.reduce((acc, row) => {
      const key = row.tier;
      if (!acc[key]) acc[key] = { tokens: 0, translation: 0, definition: 0, synonyms: 0, antonyms: 0, examples: 0, phonetic: 0, etymology: 0, image: 0, errors: 0 };
      acc[key].tokens += 1;
      if (row.error) { acc[key].errors += 1; return acc; }
      const entry = row.card?.entry;
      const vip = row.card?.vip;
      if (entry?.translation && entry.translation !== '—') acc[key].translation += 1;
      if (entry?.monolingual) acc[key].definition += 1;
      if (entry?.synonyms?.length) acc[key].synonyms += 1;
      if (entry?.antonyms?.length) acc[key].antonyms += 1;
      if (entry?.examples?.length) acc[key].examples += 1;
      if (entry?.phonetic) acc[key].phonetic += 1;
      if (vip?.etymology) acc[key].etymology += 1;
      if (vip?.imageUrl) acc[key].image += 1;
      return acc;
    }, {});
    console.table(summary);
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
