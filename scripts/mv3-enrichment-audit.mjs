import { chromium } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const DEFAULT_PROFILE = path.join(ROOT, '.audit', 'mv3-profile');
const REPORT_DIR = path.join(ROOT, 'docs', 'reports', 'runtime');
const STORE_KEY = 'kivara-lingo-state';
const RATE_KEYS = {
  linguee: 'enrichment:linguee:rate-limit:v1',
  promtContext: 'enrichment:promt-context:rate-limit:v1',
};

const ALL_SOURCE_FLAGS = [
  'freeDictionary', 'datamuse', 'wiktionary', 'wiktionaryHtml',
  'wiktionaryApi', 'wiktApi', 'britannicaDictionary', 'mobyThesaurus',
  'thesaurusCom', 'wordHippo', 'theIdioms', 'bundled', 'yomitanPacks',
  'cambridge', 'oxfordLearners', 'longman', 'collins', 'merriamWebster',
  'merriamWebsterThesaurus', 'oxfordCollocations', 'ozdic', 'pons', 'babla', 'dictCc', 'reverso',
  'linguee', 'promtContext', 'wordReference', 'spanishDict', 'tatoeba',
  'cambridgeAudio', 'oxfordAudio', 'forvo', 'linguaLibre',
  'googleTtsFallback', 'unsplash', 'pixabay', 'bingImages', 'openverse',
  'wikimediaCommons', 'duckduckgoImages', 'youglish', 'etymonline',
];

const PROVIDERS = {
  britannicaDictionary: {
    setting: 'britannicaDictionary',
    hosts: ['www.britannica.com', 'media.merriam-webster.com'],
  },
  merriamWebster: {
    setting: 'merriamWebster',
    hosts: ['www.merriam-webster.com', 'media.merriam-webster.com'],
  },
  merriamWebsterThesaurus: {
    setting: 'merriamWebsterThesaurus',
    hosts: ['www.merriam-webster.com', 'media.merriam-webster.com'],
  },
  wordnet: {
    setting: 'wordnet',
    // Bundled OEWN shards are fetched from the extension's own asset
    // URLs, so there is no remote host to watch.
    hosts: [],
  },
  reverso: {
    setting: 'reverso',
    hosts: ['context.reverso.net'],
  },
  wordReference: {
    setting: 'wordReference',
    hosts: ['www.wordreference.com'],
  },
  forvo: {
    setting: 'forvo',
    hosts: ['forvo.com', 'www.forvo.com', 'audio00.forvo.com', 'audio12.forvo.com'],
  },
  linguee: {
    setting: 'linguee',
    hosts: ['www.linguee.com'],
    rateKey: RATE_KEYS.linguee,
    minIntervalMs: 15_000,
    maxPerHour: 6,
  },
  promtContext: {
    setting: 'promtContext',
    hosts: ['www.online-translator.com'],
    rateKey: RATE_KEYS.promtContext,
    minIntervalMs: 3_000,
    maxPerHour: 30,
  },
  dictionaryCom: {
    setting: 'collins',
    hosts: ['www.dictionary.com', 'dictionary.com', 'audio.dictionary.com'],
  },
  cambridge: {
    setting: 'cambridge',
    hosts: ['dictionary.cambridge.org'],
  },
  pons: {
    setting: 'pons',
    hosts: ['en-es.pons.com', 'es-en.pons.com', 'pons.com'],
  },
  babla: {
    setting: 'babla',
    hosts: ['en.bab.la', 'es.bab.la', 'www.bab.la'],
  },
  dictCc: {
    setting: 'dictCc',
    hosts: ['en-es.dict.cc', 'www.dict.cc', 'dict.cc', 'ssel.idsccrm.com', 'midx-pool.idsccrm.com'],
  },
  spanishDict: {
    setting: 'spanishDict',
    hosts: ['www.spanishdict.com', 'spanishdict.com', 'audio1.spanishdict.com'],
  },
  wiktApi: {
    setting: 'wiktApi',
    hosts: ['wiktapi.com', 'api.wiktapi.com'],
  },
  freeDictionary: {
    setting: 'freeDictionary',
    hosts: ['api.dictionaryapi.dev', 'dictionaryapi.dev'],
  },
  datamuse: {
    setting: 'datamuse',
    hosts: ['api.datamuse.com', 'datamuse.com'],
  },
  wiktionaryHtml: {
    setting: 'wiktionaryHtml',
    hosts: ['en.wiktionary.org', 'wiktionary.org'],
  },
  ozdic: {
    setting: 'ozdic',
    hosts: ['ozdic.com', 'www.ozdic.com'],
  },
  pons: {
    setting: 'pons',
    hosts: ['en-es.pons.com', 'es-en.pons.com', 'pons.com', 'www.pons.com'],
  },
  dictCc: {
    setting: 'dictCc',
    hosts: ['en-es.dict.cc', 'www.dict.cc', 'dict.cc', 'ssel.idsccrm.com', 'midx-pool.idsccrm.com'],
  },
  longman: {
    setting: 'longman',
    hosts: ['www.ldoceonline.com', 'ldoceonline.com'],
  },
  oxfordLearners: {
    setting: 'oxfordLearners',
    hosts: ['www.oxfordlearnersdictionaries.com', 'oxfordlearnersdictionaries.com'],
  },
};

function parseArgs(argv) {
  const options = {
    token: 'give',
    sentence: 'I want to give you a book.',
    sourceLang: 'en',
    providers: Object.keys(PROVIDERS),
    delayMs: 5_000,
    timeoutMs: 35_000,
    executablePath: process.env.KIVARA_CHROMIUM_PATH || '',
    profile: DEFAULT_PROFILE,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--token' && next) options.token = argv[++i];
    else if (arg === '--sentence' && next) options.sentence = argv[++i];
    else if (arg === '--source-lang' && next) options.sourceLang = argv[++i];
    else if (arg === '--providers' && next) options.providers = argv[++i].split(',').map((v) => v.trim()).filter(Boolean);
    else if (arg === '--delay-ms' && next) options.delayMs = Number(argv[++i]);
    else if (arg === '--timeout-ms' && next) options.timeoutMs = Number(argv[++i]);
    else if (arg === '--executable' && next) options.executablePath = argv[++i];
    else if (arg === '--profile' && next) options.profile = path.resolve(ROOT, argv[++i]);
    else if (arg === '--help') {
      console.log('Uso: node scripts/mv3-enrichment-audit.mjs [--providers reverso,forvo] [--token give] [--sentence "I give..."] [--delay-ms 5000] [--profile .audit/perfil] [--executable RUTA]');
      process.exit(0);
    }
  }
  for (const provider of options.providers) {
    if (!PROVIDERS[provider]) throw new Error(`Proveedor desconocido: ${provider}`);
  }
  if (!Number.isFinite(options.delayMs) || options.delayMs < 0) throw new Error('--delay-ms debe ser un número >= 0');
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1_000) throw new Error('--timeout-ms debe ser >= 1000');
  return options;
}

function defaultChromiumPath() {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return '';
  const browserRoot = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
  try {
    const revisions = readdirSync(browserRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
      .map((entry) => ({
        name: entry.name,
        revision: Number(entry.name.slice('chromium-'.length)),
      }))
      .sort((a, b) => b.revision - a.revision);
    for (const revision of revisions) {
      const executable = path.join(browserRoot, revision.name, 'chrome-win64', 'chrome.exe');
      if (existsSync(executable)) return executable;
    }
  } catch {
    // Playwright will report its standard installation hint below.
  }
  return '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return { host: url.host, pathname: url.pathname };
  } catch {
    return { host: '', pathname: '' };
  }
}

function belongsToProvider(url, provider) {
  const host = safeUrl(url).host;
  return PROVIDERS[provider].hosts.includes(host);
}

function compactValue(value, depth = 0) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length > 320 ? `${value.slice(0, 317)}...` : value;
  if (depth >= 4) return Array.isArray(value) ? `[Array(${value.length})]` : '[Object]';
  if (Array.isArray(value)) return value.slice(0, 4).map((item) => compactValue(item, depth + 1));
  const out = {};
  for (const [key, child] of Object.entries(value).slice(0, 24)) out[key] = compactValue(child, depth + 1);
  return out;
}

function summarizeEntry(messages) {
  const entry = [...messages].reverse().find((message) => message?.entry)?.entry;
  if (!entry) return null;
  const wanted = [
    'word', 'translation', 'definition', 'phonetic', 'examples', 'synonyms',
    'antonyms', 'collocations', 'audio', 'etymology', 'imageUrl', 'videoUrl',
    'vip',
  ];
  const summary = {};
  for (const field of wanted) {
    const value = entry[field];
    if (value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length)) {
      summary[field] = compactValue(value);
    }
  }
  return summary;
}

function normalizeRateState(value) {
  const now = Date.now();
  const timestamps = Array.isArray(value?.requestTimestamps)
    ? value.requestTimestamps.filter((item) => Number.isFinite(item) && now - item < 3_600_000)
    : [];
  return {
    requestTimestamps: timestamps,
    requestsInLastHour: timestamps.length,
    lastRequestAt: Number.isFinite(value?.lastRequestAt) ? value.lastRequestAt : 0,
    cooldownUntil: Number.isFinite(value?.cooldownUntil) ? value.cooldownUntil : 0,
    cooldownRemainingMs: Math.max(0, (Number.isFinite(value?.cooldownUntil) ? value.cooldownUntil : 0) - now),
  };
}

function classify(result) {
  const skip = result.consoleEvents.find((event) =>
    /request skipped/i.test(event.text) && event.values.some((value) => value && typeof value === 'object' && value.reason),
  );
  const skipDetails = skip?.values.find((value) => value && typeof value === 'object' && value.reason);
  if (result.preflight?.decision === 'skip-cooldown') return { kind: 'local-cooldown', retryAfterMs: result.preflight.waitMs };
  if (result.preflight?.decision === 'skip-hourly-limit') return { kind: 'local-hourly-limit', retryAfterMs: result.preflight.waitMs };
  if (skipDetails) return { kind: `local-${skipDetails.reason}`, retryAfterMs: skipDetails.retryAfterMs ?? null };

  const bad = result.responses.find((response) => response.status >= 400);
  if (bad) return { kind: `http-${bad.status}`, url: bad.url };

  const fetchError = result.consoleEvents.find((event) => /\[kivara:enrichment:fetch\] error/.test(event.text));
  if (fetchError) {
    const details = fetchError.values.find((value) => value && typeof value === 'object');
    if (details?.aborted) return { kind: 'timeout-or-abort', details };
    return { kind: 'network-error', details };
  }

  const source = result.sourceEvent;
  if (source?.hasData) return { kind: 'ok', fields: source.fields ?? [] };
  if (!source && result.responses.length === 0 && result.entrySample) return { kind: 'cache-hit', note: 'No se hizo solicitud de red; resultado servido por la caché normal.' };
  if (source && !source.hasData && result.responses.some((response) => response.status >= 200 && response.status < 300)) {
    return { kind: 'http-200-no-data', note: 'La página respondió, pero el parser no produjo campos.' };
  }
  if (result.responses.some((response) => response.redirected)) return { kind: 'redirected-without-data' };
  if (result.messages.some((message) => message.phase === 'error')) return { kind: 'extension-error' };
  return { kind: 'no-data', note: 'Sin evidencia suficiente para atribuirlo a HTTP, parser o cobertura.' };
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
  return {
    at: new Date().toISOString(),
    type: message.type(),
    text: message.text(),
    values,
  };
}

async function readStorage(page, area, keys) {
  return page.evaluate(async ({ area, keys }) => chrome.storage[area].get(keys), { area, keys });
}

async function getPreflight(page, provider) {
  const config = PROVIDERS[provider];
  if (!config.rateKey) return { decision: 'run', waitMs: 0, state: null };
  const stored = await readStorage(page, 'local', [config.rateKey]);
  const state = normalizeRateState(stored[config.rateKey]);
  const now = Date.now();
  if (state.cooldownUntil > now) {
    return { decision: 'skip-cooldown', waitMs: state.cooldownUntil - now, state };
  }
  if (state.requestsInLastHour >= config.maxPerHour) {
    const oldest = state.requestTimestamps[0] ?? now;
    return { decision: 'skip-hourly-limit', waitMs: Math.max(0, oldest + 3_600_000 - now), state };
  }
  const intervalWait = Math.max(0, config.minIntervalMs - (now - state.lastRequestAt));
  return { decision: intervalWait ? 'wait-interval' : 'run', waitMs: intervalWait, state };
}

async function setIsolatedProvider(page, provider) {
  const setting = PROVIDERS[provider].setting;
  return page.evaluate(async ({ storeKey, flags, setting }) => {
    const raw = await chrome.storage.sync.get(storeKey);
    let persisted = {};
    try {
      persisted = typeof raw[storeKey] === 'string' ? JSON.parse(raw[storeKey]) : {};
    } catch {
      persisted = {};
    }
    const wrapped = !!persisted?.state;
    const state = wrapped ? { ...persisted.state } : { ...persisted };
    const previousVip = state.vip && typeof state.vip === 'object' ? state.vip : {};
    const vip = {
      ...previousVip,
      enabled: true,
      perSourceTimeoutMs: 8_000,
      cacheTtlDays: previousVip.cacheTtlDays ?? 14,
    };
    for (const flag of flags) vip[flag] = false;
    vip.bundled = true;
    vip[setting] = true;
    state.vip = vip;
    state.translate = { ...(state.translate ?? {}), targetLanguage: 'es' };
    const next = wrapped ? { ...persisted, state } : state;
    await chrome.storage.sync.set({ [storeKey]: JSON.stringify(next) });
    const verified = await chrome.storage.sync.get(storeKey);
    const verifiedParsed = JSON.parse(verified[storeKey]);
    const verifiedVip = verifiedParsed?.state?.vip ?? verifiedParsed?.vip ?? {};
    return {
      enabled: verifiedVip.enabled,
      activeFlags: flags.filter((flag) => verifiedVip[flag] === true),
    };
  }, { storeKey: STORE_KEY, flags: ALL_SOURCE_FLAGS, setting });
}

async function resolveWord(page, options) {
  return page.evaluate(async ({ token, sentence, sourceLang, timeoutMs }) => {
    const messages = [];
    await new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: 'kvl-resolve-word' });
      const timer = setTimeout(() => {
        port.disconnect();
        reject(new Error(`El flujo MV3 excedió ${timeoutMs} ms`));
      }, timeoutMs);
      port.onMessage.addListener((message) => {
        messages.push(message);
        if (message?.phase === 'done') {
          clearTimeout(timer);
          port.disconnect();
          resolve();
        }
      });
      port.onDisconnect.addListener(() => {
        if (chrome.runtime.lastError) {
          clearTimeout(timer);
          reject(new Error(chrome.runtime.lastError.message));
        }
      });
      port.postMessage({
        kind: 'resolve-word',
        token,
        sentence,
        sourceLang,
        includeAi: false,
      });
    });
    return messages;
  }, options);
}

async function restoreSyncState(page, snapshot) {
  if (Object.prototype.hasOwnProperty.call(snapshot, STORE_KEY)) {
    await page.evaluate(async ({ key, value }) => chrome.storage.sync.set({ [key]: value }), {
      key: STORE_KEY,
      value: snapshot[STORE_KEY],
    });
  } else {
    await page.evaluate(async (key) => chrome.storage.sync.remove(key), STORE_KEY);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(path.join(DIST, 'manifest.json'))) {
    throw new Error('No existe dist/manifest.json. Ejecuta `pnpm build` antes de la auditoría MV3.');
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

  const report = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    environment: {
      runtime: 'Playwright persistent Chromium with unpacked MV3 extension',
      dist: DIST,
      profile: options.profile,
      executablePath: launchOptions.executablePath ?? chromium.executablePath(),
    },
    request: {
      token: options.token,
      sentence: options.sentence,
      sourceLang: options.sourceLang,
      delayMs: options.delayMs,
      providers: options.providers,
    },
    safeguards: {
      isolatedPersistentProfile: true,
      storageClearCalled: false,
      normalCacheUsed: true,
      preferencesRestored: false,
      rateLimitStateRestored: false,
      note: 'El estado de rate limit se conserva deliberadamente para simular el uso normal entre ejecuciones.',
    },
    providers: [],
  };

  let context;
  let page;
  let syncSnapshot;
  const allConsole = [];
  const allResponses = [];
  let activeProvider = null;

  try {
    context = await chromium.launchPersistentContext(options.profile, launchOptions);

    const attachWorker = (worker) => {
      worker.on('console', async (message) => {
        const event = await consoleEvent(message);
        allConsole.push({ provider: activeProvider, workerUrl: worker.url(), ...event });
      });
    };
    for (const worker of context.serviceWorkers()) attachWorker(worker);
    context.on('serviceworker', attachWorker);
    context.on('response', (response) => {
      if (!activeProvider || !belongsToProvider(response.url(), activeProvider)) return;
      const request = response.request();
      allResponses.push({
        provider: activeProvider,
        at: new Date().toISOString(),
        url: response.url(),
        status: response.status(),
        statusText: response.statusText(),
        redirected: request.redirectedFrom() !== null,
        resourceType: request.resourceType(),
        method: request.method(),
        contentType: response.headers()['content-type'] ?? null,
        server: response.headers().server ?? null,
        cfMitigated: response.headers()['cf-mitigated'] ?? null,
        retryAfter: response.headers()['retry-after'] ?? null,
      });
    });

    let workers = context.serviceWorkers();
    if (!workers.length) {
      await context.waitForEvent('serviceworker', { timeout: 15_000 });
      workers = context.serviceWorkers();
    }
    const worker = workers.find((candidate) => candidate.url().startsWith('chrome-extension://'));
    if (!worker) throw new Error('No se detectó el service worker de la extensión.');
    const extensionId = new URL(worker.url()).host;
    report.environment.extensionId = extensionId;
    report.environment.serviceWorkerUrl = worker.url();
    report.environment.browserVersion = context.browser()?.version() ?? null;

    page = await context.newPage();
    // `manifest.json` is an inert extension-origin document: Chrome APIs are
    // available, but no React/Zustand app can rehydrate and overwrite the
    // temporary provider selection while a probe is running.
    await page.goto(`chrome-extension://${extensionId}/manifest.json`, { waitUntil: 'domcontentloaded' });
    syncSnapshot = await readStorage(page, 'sync', [STORE_KEY]);
    const initialRateState = await readStorage(page, 'local', Object.values(RATE_KEYS));
    report.initialRateState = Object.fromEntries(
      Object.entries(RATE_KEYS).map(([provider, key]) => [provider, normalizeRateState(initialRateState[key])]),
    );

    for (let index = 0; index < options.providers.length; index += 1) {
      const provider = options.providers[index];
      activeProvider = provider;
      const consoleStart = allConsole.length;
      const responseStart = allResponses.length;
      const startedAt = new Date().toISOString();
      console.log(`[MV3] ${provider}: preparando consulta aislada`);

      const selection = await setIsolatedProvider(page, provider);
      const preflight = await getPreflight(page, provider);
      if (preflight.decision === 'wait-interval' && preflight.waitMs > 0) {
        console.log(`[MV3] ${provider}: esperando ${preflight.waitMs} ms por intervalo persistente`);
        await sleep(preflight.waitMs + 100);
      }

      let messages = [];
      let error = null;
      const shouldSkip = preflight.decision === 'skip-cooldown' || preflight.decision === 'skip-hourly-limit';
      if (!shouldSkip) {
        // Clear the enrichment cache first: the isolated audit must
        // observe the provider's real network response, not a cached
        // merge from a previous run/probe (cache-hit classifications
        // were polluting audits of tokens probed earlier in the day).
        await page.evaluate(async () => {
          await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE', which: 'enrichment' }).catch(() => {});
        });
        await sleep(300);
        try {
          messages = await resolveWord(page, {
            token: options.token,
            sentence: options.sentence,
            sourceLang: options.sourceLang,
            timeoutMs: options.timeoutMs,
          });
        } catch (caught) {
          error = caught instanceof Error ? caught.message : String(caught);
        }
      }

      await sleep(250);
      const consoleEvents = allConsole.slice(consoleStart).filter((event) => event.provider === provider);
      const responses = allResponses.slice(responseStart).filter((event) => event.provider === provider);
      const sourceEventLog = [...consoleEvents].reverse().find((event) =>
        event.text.includes('[kivara:enrichment:source]')
        && event.values.some((value) => value && typeof value === 'object' && value.source === provider),
      );
      const sourceEvent = sourceEventLog?.values.find((value) => value && typeof value === 'object' && value.source === provider) ?? null;
      const afterRateRaw = PROVIDERS[provider].rateKey
        ? await readStorage(page, 'local', [PROVIDERS[provider].rateKey])
        : null;
      const providerResult = {
        provider,
        setting: PROVIDERS[provider].setting,
        startedAt,
        finishedAt: new Date().toISOString(),
        selection,
        preflight,
        error,
        messages: compactValue(messages),
        entrySample: summarizeEntry(messages),
        sourceEvent,
        responses,
        consoleEvents: consoleEvents.filter((event) =>
          /kivara:enrichment|service worker|could not read VIP/i.test(event.text),
        ),
        rateStateAfter: afterRateRaw
          ? normalizeRateState(afterRateRaw[PROVIDERS[provider].rateKey])
          : null,
      };
      providerResult.classification = error
        ? { kind: 'probe-error', message: error }
        : classify(providerResult);
      report.providers.push(providerResult);
      console.log(`[MV3] ${provider}: ${providerResult.classification.kind}`);

      if (index < options.providers.length - 1 && options.delayMs > 0) await sleep(options.delayMs);
    }
  } finally {
    activeProvider = null;
    if (page && syncSnapshot) {
      try {
        await restoreSyncState(page, syncSnapshot);
        report.safeguards.preferencesRestored = true;
      } catch (error) {
        report.safeguards.preferenceRestoreError = error instanceof Error ? error.message : String(error);
      }
    }
    if (context) await context.close();
  }

  report.finishedAt = new Date().toISOString();
  const reportPath = path.join(REPORT_DIR, `mv3-enrichment-audit-${timestampForFile()}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`\nInforme: ${path.relative(ROOT, reportPath)}`);
  console.table(report.providers.map((result) => ({
    provider: result.provider,
    classification: result.classification.kind,
    fields: result.sourceEvent?.fields?.join(', ') ?? '',
    statuses: result.responses.map((response) => response.status).join(', '),
  })));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
