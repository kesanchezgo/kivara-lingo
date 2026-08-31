/**
 * PROMT.One Contexts bilingual example scraper.
 *
 * PROMT is the closest currently reachable Linguee-style fallback: each page
 * contains aligned source/target sentences in static HTML. Requests are
 * deliberately sparse and persisted across service-worker restarts so this
 * fallback does not become another blocked provider.
 */

import { fetchHtml } from '../fetcher';
import { extractByClass, stripHtml } from '../html-utils';
import type { EnrichmentSource, SourcePartial } from '../types';

const RATE_LIMIT_STORAGE_KEY = 'enrichment:promt-context:rate-limit:v1';
const MAX_REQUESTS_PER_HOUR = 30;
const MIN_REQUEST_INTERVAL_MS = 3_000;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const COOLDOWN_AFTER_429_MS = 2 * RATE_WINDOW_MS;

interface RateState {
  requestTimestamps: number[];
  lastRequestAt: number;
  cooldownUntil: number;
}

const LANG_PAIR: Record<string, string> = {
  'en-es': 'english-spanish',
  'es-en': 'spanish-english',
  'en-fr': 'english-french',
  'fr-en': 'french-english',
  'en-de': 'english-german',
  'de-en': 'german-english',
  'en-it': 'english-italian',
  'it-en': 'italian-english',
  'en-pt': 'english-portuguese',
  'pt-en': 'portuguese-english',
};

let requestInFlight = false;

async function readRateState(): Promise<RateState | null> {
  try {
    const stored = await chrome.storage.local.get(RATE_LIMIT_STORAGE_KEY);
    const value = stored[RATE_LIMIT_STORAGE_KEY] as Partial<RateState> | undefined;
    return {
      requestTimestamps: Array.isArray(value?.requestTimestamps)
        ? value.requestTimestamps.filter(Number.isFinite)
        : [],
      lastRequestAt: Number.isFinite(value?.lastRequestAt) ? value!.lastRequestAt! : 0,
      cooldownUntil: Number.isFinite(value?.cooldownUntil) ? value!.cooldownUntil! : 0,
    };
  } catch (error) {
    console.warn('[kivara:enrichment:promt] could not read persistent rate limit', error);
    return null;
  }
}

async function writeRateState(state: RateState): Promise<boolean> {
  try {
    await chrome.storage.local.set({ [RATE_LIMIT_STORAGE_KEY]: state });
    return true;
  } catch (error) {
    console.warn('[kivara:enrichment:promt] could not persist rate limit', error);
    return false;
  }
}

async function acquireRequestPermit(): Promise<RateState | null> {
  if (requestInFlight) return null;
  requestInFlight = true;

  const state = await readRateState();
  if (!state) {
    requestInFlight = false;
    return null;
  }

  const now = Date.now();
  state.requestTimestamps = state.requestTimestamps.filter((timestamp) => now - timestamp < RATE_WINDOW_MS);
  if (
    state.cooldownUntil > now
    || now - state.lastRequestAt < MIN_REQUEST_INTERVAL_MS
    || state.requestTimestamps.length >= MAX_REQUESTS_PER_HOUR
  ) {
    requestInFlight = false;
    return null;
  }

  state.lastRequestAt = now;
  state.requestTimestamps.push(now);
  if (!await writeRateState(state)) {
    requestInFlight = false;
    return null;
  }
  return state;
}

export const promtContextSource: EnrichmentSource = {
  id: 'promtContext',
  label: 'PROMT.One Contexts',
  async enrich(token, ctx): Promise<SourcePartial> {
    const source = (ctx.sourceLang || 'en').slice(0, 2).toLowerCase();
    const target = (ctx.targetLang || 'es').slice(0, 2).toLowerCase();
    const slug = LANG_PAIR[`${source}-${target}`];
    const query = token.trim();
    if (!slug || !query) return {};

    const permit = await acquireRequestPermit();
    if (!permit) return {};

    const url = `https://www.online-translator.com/contexts/${slug}/${encodeURIComponent(query)}`;
    let status = 0;
    let html: string | null = null;
    try {
      html = await fetchHtml(url, {
        timeoutMs: ctx.timeoutMs,
        signal: ctx.signal,
        onResponse: (response) => {
          status = response.status;
        },
      });
      if (status === 429) {
        permit.cooldownUntil = Date.now() + COOLDOWN_AFTER_429_MS;
        await writeRateState(permit);
      }
    } finally {
      requestInFlight = false;
    }
    if (!html) return {};

    const sources = extractByClass(html, 'samSource', 'span').map(stripHtml);
    const targets = extractByClass(html, 'samTranslation', 'span').map(stripHtml);
    const examples: NonNullable<SourcePartial['examples']> = [];
    const seen = new Set<string>();
    const count = Math.min(sources.length, targets.length);
    for (let index = 0; index < count && examples.length < 6; index += 1) {
      const text = sources[index]?.replace(/\s+/g, ' ').trim();
      const translation = targets[index]?.replace(/\s+/g, ' ').trim();
      const key = `${text?.toLocaleLowerCase()}\u0000${translation?.toLocaleLowerCase()}`;
      if (
        !text || !translation || seen.has(key)
        || text.length < 4 || text.length > 280
        || translation.length < 2 || translation.length > 280
      ) continue;
      seen.add(key);
      examples.push({ text, translation });
    }

    return examples.length ? { examples } : {};
  },
};
