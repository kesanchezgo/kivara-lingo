/**
 * Synchronous read-through cache for the MT fallback used by the dual
 * caption. The host app prefetches the next cues while the current one plays;
 * without this cache the overlay discards those answers and starts a new
 * round trip at every cue boundary, so the translated line trails the primary
 * caption. Keys are the exact TRANSLATE request, not the cue id, so a replayed
 * or reused cue is served from the same entry.
 */
import type { TranslateResponse } from '../../shared/types';

const cache = new Map<string, string>();

function translationCacheKey(
  text: string,
  sourceLang: string,
  targetLang: string,
): string {
  return `${sourceLang.toLowerCase()}\u0000${targetLang.toLowerCase()}\u0000${text.trim()}`;
}

export function readTranslation(
  text: string,
  sourceLang: string,
  targetLang: string,
): string | null {
  return cache.get(translationCacheKey(text, sourceLang, targetLang)) ?? null;
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
  cache.set(translationCacheKey(text, sourceLang, targetLang), value);
}
