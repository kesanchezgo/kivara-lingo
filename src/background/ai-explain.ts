/// <reference types="chrome" />

/**
 * `AI_EXPLAIN_SENTENCE` — the service-worker half of F7
 * (docs/REDESIGN-V2.md §4.6, §7 F7, §10).
 *
 * Flow: settings → cache lookup in Dexie v7 `explain_cache` → `callAiJson`
 * (inputs as a JSON block, H17) → validation → cache write → answer. Concurrent
 * identical requests share one provider call. A response that fails to parse
 * or validate is returned as a readable error and NOT cached, so the next press
 * retries instead of replaying the broken answer.
 */
import { DEFAULT_AI } from '../shared/store';
import { getDB } from '../shared/db';
import type { AiExplainRequest, AiExplainResponse } from '../shared/types';
import { callAiJson } from './ai-providers';
import {
  buildExplainInput,
  buildExplainSystemPrompt,
  explainCacheExpiresAt,
  explainCacheFresh,
  explainCacheKey,
  parseExplanationResponse,
} from './ai-explain-core';
import { getAiSettings, getResolvedNativeLang } from './ai-enrich';
import { pruneExpiredCaches } from './enrichment/cache';

/** in-flight requests keyed by cache key, to coalesce a repeated press. */
const inflight = new Map<string, Promise<AiExplainResponse>>();

export async function explainSentence(req: AiExplainRequest): Promise<AiExplainResponse> {
  const line = (req.line ?? '').trim();
  if (!line) return { ok: false, error: 'Line is empty' };

  const settings = await getAiSettings();
  if (settings.provider === 'disabled') {
    return { ok: false, error: 'AI disabled' };
  }
  // Loopback endpoints (Ollama, LM Studio) are keyless; every hosted provider
  // needs its key before a call is worth making.
  if (!settings.apiKey.trim() && settings.provider !== 'openai-compatible') {
    return { ok: false, error: 'API key missing' };
  }

  const nativeLang = (req.nativeLang || (await getResolvedNativeLang(settings))).trim();
  const uiLang = (req.uiLang || 'en').trim();
  const lang = (req.lang || '').trim();
  const prev = req.prev?.trim() || undefined;
  const next = req.next?.trim() || undefined;
  const model = settings.model.trim();
  const key = explainCacheKey(
    settings.provider,
    model,
    lang,
    uiLang,
    nativeLang,
    prev,
    line,
    next,
  );

  try {
    const cached = await getDB().explain_cache.get(key);
    if (cached && explainCacheFresh(cached.expiresAt)) {
      return { ok: true, data: cached.data, cached: true };
    }
  } catch (err) {
    console.warn('[Kivara Lingo] explain_cache read failed', err);
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const work = (async (): Promise<AiExplainResponse> => {
    const request: AiExplainRequest = { ...req, line, prev, next, lang, uiLang, nativeLang };
    const call = await callAiJson(
      {
        system: buildExplainSystemPrompt(uiLang, nativeLang),
        input: buildExplainInput(request),
        temperature: 0.3,
        maxTokens: 600,
      },
      settings,
    );
    if (!call.ok) return { ok: false, error: call.error };

    const parsed = parseExplanationResponse(call.text, line);
    if (!parsed.ok) return { ok: false, error: parsed.error };

    const now = Date.now();
    try {
      await getDB().explain_cache.put({
        key,
        provider: settings.provider,
        model,
        lang,
        uiLang,
        nativeLang,
        prev,
        line,
        next,
        data: parsed.data,
        expiresAt: explainCacheExpiresAt(settings.cacheTtlDays, now, DEFAULT_AI.cacheTtlDays),
        createdAt: now,
      });
      // Same housekeeping the enrichment cache runs after its own writes: the
      // shared pass sweeps this table's expired rows under the same cadence.
      void pruneExpiredCaches();
    } catch (err) {
      console.warn('[Kivara Lingo] explain_cache write failed', err);
    }
    return { ok: true, data: parsed.data, cached: false };
  })();

  inflight.set(key, work);
  try {
    return await work;
  } finally {
    inflight.delete(key);
  }
}
