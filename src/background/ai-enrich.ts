/// <reference types="chrome" />

import { DEFAULT_AI, DEFAULT_TRANSLATE, PERSIST_STORE_KEY as STORE_KEY } from '../shared/store';
import { aiCacheKey, getDB } from '../shared/db';
import type {
  AiEnrichRequest,
  AiEnrichResponse,
  AiEnrichment,
  AiSettings,
} from '../shared/types';
import { callAiProvider } from './ai-providers';
import { resolveSecret } from '../shared/secret-store';

const DEBOUNCE_MS = 300;
let lastCallAt = 0;
/** in-flight calls keyed by cache key to coalesce duplicate hovers/saves */
const inflight = new Map<string, Promise<AiEnrichResponse>>();

async function loadAiSettings(): Promise<AiSettings> {
  try {
    const raw = await chrome.storage.sync.get(STORE_KEY);
    const value = raw[STORE_KEY];
    if (typeof value !== 'string') return DEFAULT_AI;
    const parsed = JSON.parse(value);
    const ai = parsed?.state?.ai ?? parsed?.ai;
    if (ai && typeof ai === 'object') {
      const merged: AiSettings = { ...DEFAULT_AI, ...ai };
      // Secrets live in local slots now (see secret-store.ts): resolveSecret
      // reads + decrypts the slot, falls back to the legacy blob value, and
      // returns '' when unreadable so we never send `enc:v1:` to a provider.
      merged.apiKey = await resolveSecret('ai', 'apiKey', merged.apiKey);
      return merged;
    }
  } catch (err) {
    console.warn('[Kivara Lingo] could not read AI settings', err);
  }
  return DEFAULT_AI;
}

async function loadNativeLang(): Promise<string> {
  try {
    const raw = await chrome.storage.sync.get(STORE_KEY);
    const value = raw[STORE_KEY];
    if (typeof value !== 'string') return DEFAULT_TRANSLATE.targetLanguage;
    const parsed = JSON.parse(value);
    const t = parsed?.state?.translate ?? parsed?.translate;
    if (t && typeof t === 'object' && typeof t.targetLanguage === 'string') {
      return t.targetLanguage;
    }
  } catch {
    // ignore
  }
  return DEFAULT_TRANSLATE.targetLanguage;
}

export async function getAiSettings(): Promise<AiSettings> {
  return loadAiSettings();
}

export async function getResolvedNativeLang(settings: AiSettings): Promise<string> {
  if (settings.nativeLanguage && settings.nativeLanguage.trim()) {
    return settings.nativeLanguage.trim();
  }
  return loadNativeLang();
}

/**
 * Enrich `req` using the configured AI provider, with cache lookup and a
 * shared debounce. Returns the same shape every time (cache hits get
 * `cached: true` and `latencyMs: 0`).
 */
export async function enrichWithAi(req: AiEnrichRequest): Promise<AiEnrichResponse> {
  const settings = await loadAiSettings();
  if (settings.provider === 'disabled') {
    return { ok: false, error: 'AI disabled', provider: 'disabled' };
  }
  if (!settings.apiKey) {
    return { ok: false, error: 'API key missing', provider: settings.provider };
  }

  const nativeLang = req.nativeLang || (await getResolvedNativeLang(settings));
  const cacheKey = aiCacheKey(settings.provider, req.sourceLang, nativeLang, req.token, req.sentence);

  // Cache lookup
  try {
    const cached = await getDB().ai_cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        ok: true,
        data: { ...cached.data, cached: true, latencyMs: 0, provider: settings.provider },
      };
    }
  } catch (err) {
    console.warn('[Kivara Lingo] ai_cache read failed', err);
  }

  // Coalesce concurrent identical requests
  const existing = inflight.get(cacheKey);
  if (existing) return existing;

  const work = (async (): Promise<AiEnrichResponse> => {
    const sinceLast = Date.now() - lastCallAt;
    if (sinceLast < DEBOUNCE_MS) {
      await new Promise((r) => setTimeout(r, DEBOUNCE_MS - sinceLast));
    }
    lastCallAt = Date.now();

    const started = Date.now();
    const result = await callAiProvider({ ...req, nativeLang }, settings);
    const latencyMs = Date.now() - started;
    if (!result.ok) return { ok: false, error: result.error, provider: result.provider };

    const data: AiEnrichment = {
      ...result.data,
      provider: settings.provider,
      latencyMs,
      cached: false,
    };
    const ttl = (settings.cacheTtlDays || 30) * 24 * 60 * 60 * 1000;
    try {
      await getDB().ai_cache.put({
        key: cacheKey,
        provider: settings.provider,
        sourceLang: req.sourceLang,
        nativeLang,
        token: req.token,
        sentence: req.sentence,
        data,
        expiresAt: Date.now() + ttl,
        createdAt: Date.now(),
      });
    } catch (err) {
      console.warn('[Kivara Lingo] ai_cache write failed', err);
    }
    return { ok: true, data };
  })();

  inflight.set(cacheKey, work);
  try {
    return await work;
  } finally {
    inflight.delete(cacheKey);
  }
}
