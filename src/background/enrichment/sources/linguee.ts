/**
 * Linguee scraper — VIP source.
 *
 * Linguee ships translations and bilingual examples curated from real
 * web documents. Pattern based on `imankulov/linguee-api` and
 * `felipe-augusto/linguee`.
 *
 * Linguee doesn't have a public API. We hit the search HTML page and
 * extract:
 *   - top translations (head word equivalents)
 *   - external example sentences (1-2 sentence parallel pairs)
 */

import { fetchHtml } from '../fetcher';
import { extractByClass, stripHtml } from '../html-utils';
import type { EnrichmentSource, SourcePartial } from '../types';

const RATE_LIMIT_STORAGE_KEY = 'enrichment:linguee:rate-limit:v1';
const MAX_REQUESTS_PER_HOUR = 6;
const MIN_REQUEST_INTERVAL_MS = 15_000;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const COOLDOWN_AFTER_429_MS = 6 * RATE_WINDOW_MS;

interface LingueeRateState {
  requestTimestamps: number[];
  lastRequestAt: number;
  cooldownUntil: number;
}

let lingueeRequestInFlight = false;

async function readRateState(): Promise<LingueeRateState | null> {
  try {
    const stored = await chrome.storage.local.get(RATE_LIMIT_STORAGE_KEY);
    const value = stored[RATE_LIMIT_STORAGE_KEY] as Partial<LingueeRateState> | undefined;
    return {
      requestTimestamps: Array.isArray(value?.requestTimestamps)
        ? value.requestTimestamps.filter((timestamp) => Number.isFinite(timestamp))
        : [],
      lastRequestAt: Number.isFinite(value?.lastRequestAt) ? value!.lastRequestAt! : 0,
      cooldownUntil: Number.isFinite(value?.cooldownUntil) ? value!.cooldownUntil! : 0,
    };
  } catch (error) {
    console.warn('[kivara:enrichment:linguee] could not read persistent rate limit', error);
    return null;
  }
}

async function writeRateState(state: LingueeRateState): Promise<boolean> {
  try {
    await chrome.storage.local.set({ [RATE_LIMIT_STORAGE_KEY]: state });
    return true;
  } catch (error) {
    console.warn('[kivara:enrichment:linguee] could not persist rate limit', error);
    return false;
  }
}

async function acquireRequestPermit(): Promise<LingueeRateState | null> {
  if (lingueeRequestInFlight) {
    console.info('[kivara:enrichment:linguee] request skipped', { reason: 'concurrent-request' });
    return null;
  }
  lingueeRequestInFlight = true;

  const state = await readRateState();
  if (!state) {
    lingueeRequestInFlight = false;
    return null;
  }

  const now = Date.now();
  state.requestTimestamps = state.requestTimestamps.filter((timestamp) => now - timestamp < RATE_WINDOW_MS);
  if (state.cooldownUntil > now) {
    console.info('[kivara:enrichment:linguee] request skipped', {
      reason: 'cooldown',
      retryAfterMs: state.cooldownUntil - now,
    });
    lingueeRequestInFlight = false;
    return null;
  }
  if (now - state.lastRequestAt < MIN_REQUEST_INTERVAL_MS) {
    console.info('[kivara:enrichment:linguee] request skipped', {
      reason: 'minimum-interval',
      retryAfterMs: MIN_REQUEST_INTERVAL_MS - (now - state.lastRequestAt),
    });
    lingueeRequestInFlight = false;
    return null;
  }
  if (state.requestTimestamps.length >= MAX_REQUESTS_PER_HOUR) {
    console.info('[kivara:enrichment:linguee] request skipped', { reason: 'hourly-limit' });
    lingueeRequestInFlight = false;
    return null;
  }

  state.lastRequestAt = now;
  state.requestTimestamps.push(now);
  if (!await writeRateState(state)) {
    lingueeRequestInFlight = false;
    return null;
  }
  return state;
}

const LANG_PAIR: Record<string, string> = {
  'en-es': 'english-spanish',
  'es-en': 'spanish-english',
  'en-fr': 'english-french',
  'fr-en': 'french-english',
  'en-de': 'english-german',
  'de-en': 'german-english',
  'en-pt': 'english-portuguese',
  'pt-en': 'portuguese-english',
  'en-it': 'english-italian',
  'it-en': 'italian-english',
};

export const lingueeSource: EnrichmentSource = {
  id: 'linguee',
  label: 'Linguee',
  async enrich(token, ctx): Promise<SourcePartial> {
    const pair = `${(ctx.sourceLang || 'en').slice(0, 2)}-${(ctx.targetLang || 'es').slice(0, 2)}`;
    const slug = LANG_PAIR[pair];
    if (!slug) return {};
    const permit = await acquireRequestPermit();
    if (!permit) return {};

    const url = `https://www.linguee.com/${slug}/search?source=auto&query=${encodeURIComponent(token)}`;
    let status = 0;
    let html: string | null = null;
    try {
      html = await fetchHtml(url, {
        timeoutMs: ctx.timeoutMs,
        signal: ctx.signal,
        // Never send the user's browser cookies to a third-party dictionary: a
      // leak of who is browsing what word is worse than a 403.
      credentials: 'omit',
        onResponse: (response) => {
          status = response.status;
        },
      });
      if (status === 429) {
        permit.cooldownUntil = Date.now() + COOLDOWN_AFTER_429_MS;
        await writeRateState(permit);
        console.warn('[kivara:enrichment:linguee] HTTP 429; provider cooldown activated', {
          cooldownMs: COOLDOWN_AFTER_429_MS,
        });
      }
    } finally {
      lingueeRequestInFlight = false;
    }
    if (!html) return {};

    const partial: SourcePartial = {};

    // Top translations live in `<a class="dictLink">` inside the
    // `lemma_desc` block.
    const translations = extractByClass(html, 'dictLink', 'a')
      .map(stripHtml)
      .filter((s) => s && s.length < 60);
    if (translations.length) {
      partial.translations = Array.from(new Set(translations)).slice(0, 6);
    }

    // Example pairs: `<span class="tag_s">` (source) +
    // `<span class="tag_t">` (target). Linguee renders them
    // back-to-back so we pair them sequentially.
    const sources = extractByClass(html, 'tag_s', 'span').map(stripHtml);
    const targets = extractByClass(html, 'tag_t', 'span').map(stripHtml);
    const examples: Array<{ text: string; translation?: string }> = [];
    const n = Math.min(sources.length, targets.length, 5);
    for (let i = 0; i < n; i += 1) {
      const s = sources[i];
      const t = targets[i];
      if (s && s.length > 8 && s.length < 220) {
        examples.push({ text: s, translation: t || undefined });
      }
    }
    if (examples.length) partial.examples = examples;

    return partial;
  },
};
