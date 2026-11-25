/**
 * Bounded synchronous read-through cache for the MT fallback used by the dual
 * caption. Keys are the canonical TRANSLATE request — (source language, target
 * language, normalized source text) — so changing target language can never
 * serve a previous language's answer, and locale tags like es-ES / en-US
 * collapse to the same bucket as es / en. Insertion-order Map gives LRU with a
 * fixed cap; the oldest entry is evicted on overflow.
 */
import type { TranslateResponse } from '../../shared/types';

const CAPACITY = 512;
const cache = new Map<string, string>();

function language(lang: string): string {
  return lang.split('-')[0]!.toLowerCase();
}

export function translationCacheKey(
  text: string,
  sourceLang: string,
  targetLang: string,
): string {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\s+/g, ' ').trim();
  return `${language(sourceLang)}\u0000${language(targetLang)}\u0000${normalized}`;
}

export function readTranslation(
  text: string,
  sourceLang: string,
  targetLang: string,
): string | null {
  const key = translationCacheKey(text, sourceLang, targetLang);
  const value = cache.get(key);
  if (value === undefined) return null;
  // Touch on read: Map preserves insertion order, so delete+set makes this MRU.
  cache.delete(key);
  cache.set(key, value);
  return value;
}

export function rememberTranslation(
  text: string,
  sourceLang: string,
  targetLang: string,
  response: TranslateResponse | null,
): void {
  if (!response?.ok) return;
  const value = response.translatedText?.trim();
  if (!value) return;
  const key = translationCacheKey(text, sourceLang, targetLang);
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > CAPACITY) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export function clearTranslationCache(): void {
  cache.clear();
}
