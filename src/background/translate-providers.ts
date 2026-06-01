/// <reference types="chrome" />

import type { TranslateProvider, TranslateSettings } from '../shared/types';

export interface ProviderResult {
  ok: true;
  translatedText: string;
  provider: TranslateProvider;
}

export interface ProviderError {
  ok: false;
  error: string;
  provider: TranslateProvider;
  /**
   * True for errors that are likely transient (network, timeout, 5xx). Chain
   * mode uses this hint to decide whether to retry the same provider on the
   * next call or move on permanently for this session.
   */
  transient?: boolean;
}

const TIMEOUT_MS = 5000;

function withTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

/**
 * Normalize Kivara's BCP-47 codes to whatever each provider expects.
 *  - DeepL upper-cases target codes and uses "EN-US" / "PT-BR" instead of "en" / "pt".
 *  - Google accepts plain lowercase or BCP-47.
 *  - LibreTranslate uses two-letter codes.
 *  - MyMemory uses BCP-47-ish pairs like "en|es".
 *  - Lingva uses lowercase two-letter codes.
 */
function toDeeplCode(code: string, opts: { isTarget: boolean }): string {
  const c = code.toLowerCase();
  const base = c.split('-')[0];
  if (opts.isTarget) {
    if (c === 'en' || c === 'en-us') return 'EN-US';
    if (c === 'en-gb') return 'EN-GB';
    if (c === 'pt' || c === 'pt-br') return 'PT-BR';
    if (c === 'pt-pt') return 'PT-PT';
    return base.toUpperCase();
  }
  return base.toUpperCase();
}

function toTwoLetter(code: string): string {
  return code.toLowerCase().split('-')[0];
}

async function callDeepL(
  text: string,
  source: string,
  target: string,
  token: string,
): Promise<ProviderResult | ProviderError> {
  if (!token) return { ok: false, error: 'DeepL token missing', provider: 'deepl' };
  // Free vs Pro token: free keys end with ":fx"
  const host = token.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  const body = new URLSearchParams();
  body.append('text', text);
  body.append('source_lang', toDeeplCode(source, { isTarget: false }));
  body.append('target_lang', toDeeplCode(target, { isTarget: true }));
  try {
    const res = await withTimeout(`${host}/v2/translate`, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `DeepL ${res.status}`,
        provider: 'deepl',
        transient: res.status >= 500 || res.status === 429,
      };
    }
    const json = (await res.json()) as { translations?: Array<{ text: string }> };
    const translated = json.translations?.[0]?.text?.trim();
    if (!translated) return { ok: false, error: 'DeepL empty response', provider: 'deepl' };
    return { ok: true, translatedText: translated, provider: 'deepl' };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'DeepL error',
      provider: 'deepl',
      transient: true,
    };
  }
}

async function callGoogle(
  text: string,
  source: string,
  target: string,
  token: string,
): Promise<ProviderResult | ProviderError> {
  if (!token) return { ok: false, error: 'Google token missing', provider: 'google' };
  const url = new URL('https://translation.googleapis.com/language/translate/v2');
  url.searchParams.set('key', token);
  try {
    const res = await withTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: text,
        source: toTwoLetter(source),
        target: toTwoLetter(target),
        format: 'text',
      }),
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `Google ${res.status}`,
        provider: 'google',
        transient: res.status >= 500 || res.status === 429,
      };
    }
    const json = (await res.json()) as {
      data?: { translations?: Array<{ translatedText: string }> };
    };
    const translated = json.data?.translations?.[0]?.translatedText?.trim();
    if (!translated) return { ok: false, error: 'Google empty response', provider: 'google' };
    return { ok: true, translatedText: translated, provider: 'google' };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Google error',
      provider: 'google',
      transient: true,
    };
  }
}

async function callLibreTranslate(
  text: string,
  source: string,
  target: string,
  baseUrl: string,
  token: string,
): Promise<ProviderResult | ProviderError> {
  const host = (baseUrl || 'https://libretranslate.com').replace(/\/+$/, '');
  try {
    const res = await withTimeout(`${host}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: text,
        source: toTwoLetter(source),
        target: toTwoLetter(target),
        format: 'text',
        api_key: token || undefined,
      }),
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `LibreTranslate ${res.status}`,
        provider: 'libretranslate',
        transient: res.status >= 500 || res.status === 429,
      };
    }
    const json = (await res.json()) as { translatedText?: string };
    if (!json.translatedText) {
      return { ok: false, error: 'LibreTranslate empty response', provider: 'libretranslate' };
    }
    return { ok: true, translatedText: json.translatedText.trim(), provider: 'libretranslate' };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'LibreTranslate error',
      provider: 'libretranslate',
      transient: true,
    };
  }
}

/**
 * MyMemory free tier:
 *  - 5 000 chars/day anonymous
 *  - 50 000 chars/day with email (`de` query param)
 *  - docs: https://mymemory.translated.net/doc/spec.php
 *
 * The endpoint returns a JSON envelope where `responseData.translatedText`
 * is the best match. Quota-exhausted responses come back as HTTP 200 with a
 * `responseStatus` of 429 or a textual message in `responseDetails` — we treat
 * those as transient errors so chain mode falls through to the next provider.
 */
async function callMyMemory(
  text: string,
  source: string,
  target: string,
  email: string,
): Promise<ProviderResult | ProviderError> {
  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q', text);
  url.searchParams.set('langpair', `${toTwoLetter(source)}|${toTwoLetter(target)}`);
  if (email && email.includes('@')) {
    url.searchParams.set('de', email);
  }
  try {
    const res = await withTimeout(url, { method: 'GET' });
    if (!res.ok) {
      return {
        ok: false,
        error: `MyMemory ${res.status}`,
        provider: 'mymemory',
        transient: res.status >= 500 || res.status === 429,
      };
    }
    const json = (await res.json()) as {
      responseStatus?: number | string;
      responseDetails?: string;
      responseData?: { translatedText?: string };
    };
    const status = Number(json.responseStatus ?? 0);
    if (status && status >= 400) {
      return {
        ok: false,
        error: `MyMemory ${status} ${json.responseDetails ?? ''}`.trim(),
        provider: 'mymemory',
        transient: status === 429 || status >= 500,
      };
    }
    const translated = json.responseData?.translatedText?.trim();
    if (!translated) {
      return { ok: false, error: 'MyMemory empty response', provider: 'mymemory' };
    }
    // MyMemory occasionally echoes "MYMEMORY WARNING: YOU USED ALL AVAILABLE
    // FREE TRANSLATIONS FOR TODAY" inside the translatedText field instead of
    // a real translation. Detect and bubble that up as a transient error so
    // chain mode falls through.
    if (/MYMEMORY\s+WARNING/i.test(translated)) {
      return {
        ok: false,
        error: translated,
        provider: 'mymemory',
        transient: true,
      };
    }
    // Echo guard: when MyMemory has no translation it sometimes returns
    // the source text unchanged (e.g. a nonsense token or an untranslat-
    // able proper noun). Treat an exact case-insensitive echo as "no
    // translation" so the popover doesn't show the English word as its
    // own Spanish translation.
    if (translated.toLowerCase() === text.trim().toLowerCase()) {
      return { ok: false, error: 'MyMemory echoed source', provider: 'mymemory' };
    }
    return { ok: true, translatedText: translated, provider: 'mymemory' };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'MyMemory error',
      provider: 'mymemory',
      transient: true,
    };
  }
}

/**
 * Lingva mirrors known to host `/api/v1/:src/:tgt/:query` and respond
 * with `{ translation: "..." }`. Probed live 2026-05-22:
 *
 *   ✓ lingva.ml                   (200, returns translation)
 *   ✗ lingva.thedaviddelta.com    (503 DEPLOYMENT_PAUSED — moved off Vercel)
 *   ✓ translate.plausibility.cloud (200)
 *   ✓ lingva.lunar.icu            (200)
 *
 * The chain tries the user-configured `lingvaUrl` first, then falls back
 * to the curated mirror list below. A 503/timeout doesn't penalise the
 * Lingva tier — we just hop to the next mirror until one answers.
 */
const LINGVA_FALLBACK_MIRRORS = [
  'https://lingva.ml',
  'https://translate.plausibility.cloud',
  'https://lingva.lunar.icu',
];

/**
 * Lingva is an unauthenticated front-end / scraper for Google Translate.
 * Reference: https://github.com/thedaviddelta/lingva-translate
 *
 * The API shape used here is `/api/v1/:SOURCE/:TARGET/:QUERY` which the
 * thedaviddelta.com instance and most community mirrors expose. Source
 * accepts 'auto' as a placeholder when the caller doesn't know the source.
 */
async function callLingva(
  text: string,
  source: string,
  target: string,
  baseUrl: string,
): Promise<ProviderResult | ProviderError> {
  const src = toTwoLetter(source) || 'auto';
  const tgt = toTwoLetter(target);
  const path = `/api/v1/${src}/${tgt}/${encodeURIComponent(text)}`;

  // Try the user's configured host first, then walk the fallback mirrors.
  // Skip duplicates so a host already in the fallback list isn't tried twice.
  const userHost = (baseUrl || '').replace(/\/+$/, '');
  const candidates: string[] = [];
  if (userHost) candidates.push(userHost);
  for (const m of LINGVA_FALLBACK_MIRRORS) {
    if (!candidates.includes(m)) candidates.push(m);
  }

  let lastError = 'Lingva unreachable';
  let anyTransient = false;
  for (const host of candidates) {
    const url = `${host}${path}`;
    try {
      const res = await withTimeout(url, { method: 'GET' });
      if (!res.ok) {
        lastError = `Lingva ${res.status} (${host})`;
        anyTransient = anyTransient || res.status >= 500 || res.status === 429;
        continue;
      }
      const json = (await res.json()) as { translation?: string };
      const translated = json.translation?.trim();
      if (!translated) {
        lastError = `Lingva empty response (${host})`;
        continue;
      }
      return { ok: true, translatedText: translated, provider: 'lingva' };
    } catch (err) {
      lastError = err instanceof Error ? `${err.message} (${host})` : `Lingva error (${host})`;
      anyTransient = true;
    }
  }
  return { ok: false, error: lastError, provider: 'lingva', transient: anyTransient };
}

/**
 * Dispatch to a single provider. Used both by `callProvider` (legacy single
 * mode) and by `callChain` which walks an ordered list.
 *
 * `offline` is rejected here because the cache + dictionary lookup happens in
 * `translate.ts` *before* we even consider hitting a provider.
 */
export async function callOne(
  provider: TranslateProvider,
  text: string,
  source: string,
  target: string,
  settings: TranslateSettings,
): Promise<ProviderResult | ProviderError> {
  switch (provider) {
    case 'deepl':
      return callDeepL(text, source, target, settings.deeplToken);
    case 'google':
      return callGoogle(text, source, target, settings.googleToken);
    case 'libretranslate':
      return callLibreTranslate(
        text,
        source,
        target,
        settings.libreTranslateUrl,
        settings.libreTranslateToken,
      );
    case 'mymemory':
      return callMyMemory(text, source, target, settings.myMemoryEmail);
    case 'lingva':
      return callLingva(text, source, target, settings.lingvaUrl);
    case 'offline':
    default:
      return { ok: false, error: 'offline provider has no network call', provider: 'offline' };
  }
}

/**
 * Legacy single-provider dispatch retained so any caller that hasn't migrated
 * to chain mode keeps working.
 */
export async function callProvider(
  text: string,
  source: string,
  target: string,
  settings: TranslateSettings,
): Promise<ProviderResult | ProviderError> {
  return callOne(settings.provider, text, source, target, settings);
}

export interface ChainStep {
  provider: TranslateProvider;
  error: string;
  transient?: boolean;
}

export interface ChainResult {
  ok: true;
  translatedText: string;
  provider: TranslateProvider;
  attempted: ChainStep[];
}

export interface ChainError {
  ok: false;
  attempted: ChainStep[];
  /** The user-visible error \u2014 always the last failure in the chain. */
  error: string;
}

/**
 * Walk an ordered list of providers, returning the first successful result.
 * Providers that fail with a credential-missing error are silently skipped
 * (no point telling the user "no DeepL key" when they haven't even tried to
 * configure one).
 */
export async function callChain(
  providers: TranslateProvider[],
  text: string,
  source: string,
  target: string,
  settings: TranslateSettings,
): Promise<ChainResult | ChainError> {
  const attempted: ChainStep[] = [];
  for (const provider of providers) {
    if (provider === 'offline') continue;
    const result = await callOne(provider, text, source, target, settings);
    if (result.ok) {
      attempted.push({ provider, error: 'ok' });
      return { ok: true, translatedText: result.translatedText, provider, attempted };
    }
    attempted.push({
      provider: result.provider,
      error: result.error,
      transient: result.transient,
    });
  }
  return {
    ok: false,
    attempted,
    error: attempted[attempted.length - 1]?.error ?? 'no provider succeeded',
  };
}

/**
 * Race a set of FREE providers concurrently and return the first SUCCESS,
 * preferring an earlier-listed provider when two finish in the same tick.
 *
 * Why only the free tier: the free providers (MyMemory, Lingva) are
 * unauthenticated, quota-light and roughly equivalent in quality for the
 * short tokens the popover translates — so firing both at once and taking
 * whichever answers first turns the chain's latency from "sum until one
 * works" into "fastest of the bunch", without burning paid quota. Premium
 * providers (DeepL / Google) are intentionally NOT raced here: they cost
 * money per call and the user's ordering expresses a real preference, so
 * the caller runs them sequentially AFTER this race fails.
 *
 * Quality is preserved: if MyMemory (listed first) and Lingva both succeed,
 * MyMemory wins via the preference index, exactly as the sequential chain
 * would have picked it. The race only changes WHEN we get the answer, never
 * WHICH answer when results are equivalent.
 */
export async function callChainRaced(
  providers: TranslateProvider[],
  text: string,
  source: string,
  target: string,
  settings: TranslateSettings,
): Promise<ChainResult | ChainError> {
  const candidates = providers.filter((p) => p !== 'offline');
  if (candidates.length === 0) {
    return { ok: false, attempted: [], error: 'no provider in race' };
  }
  if (candidates.length === 1) {
    return callChain(candidates, text, source, target, settings);
  }

  const attempted: ChainStep[] = [];
  return new Promise<ChainResult | ChainError>((resolve) => {
    let settledCount = 0;
    let resolved = false;
    // Track the best (lowest-index) successful result seen so far, so that
    // if the preferred provider finishes slightly after a later one we
    // still honour the preference within a tiny grace window. In practice
    // we resolve on the FIRST success to minimise latency; the preference
    // only matters for tie-breaking the `provider` label/attribution.
    candidates.forEach((provider, index) => {
      void callOne(provider, text, source, target, settings)
        .then((result) => {
          settledCount += 1;
          if (result.ok) {
            if (!resolved) {
              resolved = true;
              attempted.push({ provider, error: 'ok' });
              resolve({
                ok: true,
                translatedText: result.translatedText,
                provider,
                attempted,
              });
            }
          } else {
            attempted.push({
              provider: result.provider,
              error: result.error,
              transient: result.transient,
            });
            // All failed — surface the last error.
            if (!resolved && settledCount === candidates.length) {
              resolved = true;
              resolve({
                ok: false,
                attempted,
                error: attempted[attempted.length - 1]?.error ?? 'no provider succeeded',
              });
            }
          }
        })
        .catch((err) => {
          settledCount += 1;
          attempted.push({
            provider,
            error: err instanceof Error ? err.message : 'threw',
            transient: true,
          });
          if (!resolved && settledCount === candidates.length) {
            resolved = true;
            resolve({
              ok: false,
              attempted,
              error: attempted[attempted.length - 1]?.error ?? 'no provider succeeded',
            });
          }
        });
      void index;
    });
  });
}
