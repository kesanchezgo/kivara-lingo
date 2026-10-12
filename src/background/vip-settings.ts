/// <reference types="chrome" />

/**
 * VIP settings loader for the service worker.
 *
 * Mirrors `loadAiSettings()` in `ai-enrich.ts` but for the VIP block.
 * Reads the same `chrome-storage` key the Zustand panel writes to, so a
 * toggle flip in the side panel takes effect on the next RESOLVE_WORD
 * without any explicit messaging.
 */

import { DEFAULT_VIP, DEFAULT_TRANSLATE, PERSIST_STORE_KEY as STORE_KEY } from '../shared/store';
import { resolveSecret } from '../shared/secret-store';
import { normalizeTtlDays } from '../shared/cache-ttl';
import type { VipSettings } from '../shared/types';

export async function getVipSettings(): Promise<VipSettings> {
  try {
    const raw = await chrome.storage.sync.get(STORE_KEY);
    const value = raw[STORE_KEY];
    if (typeof value !== 'string') return DEFAULT_VIP;
    const parsed = JSON.parse(value);
    const vip = parsed?.state?.vip ?? parsed?.vip;
    if (vip && typeof vip === 'object') {
      const merged: VipSettings = { ...DEFAULT_VIP, ...vip };
      // `chrome.storage.sync` is read DIRECTLY here, not through the store's
      // `mergePersisted`, so nothing else has validated this number: a -5 or a
      // 9999 written by an older build would reach the enrichment cache
      // unchecked, and one wipes the whole table while the other never expires
      // a row. Normalising here is the same clamp, one more entry point.
      merged.cacheTtlDays = normalizeTtlDays(merged.cacheTtlDays);
      // BYOK image keys live in local slots (see secret-store.ts) —
      // resolveSecret handles decrypt + legacy fallback + unreadable.
      merged.unsplashAccessKey = await resolveSecret(
        'vip',
        'unsplashAccessKey',
        merged.unsplashAccessKey,
      );
      merged.pixabayApiKey = await resolveSecret('vip', 'pixabayApiKey', merged.pixabayApiKey);
      return merged;
    }
  } catch (err) {
    console.warn('[Kivara Lingo] could not read VIP settings', err);
  }
  return DEFAULT_VIP;
}

/**
 * Read the user's currently configured target (native) language for
 * translation purposes. Used by the enrichment chain to drive
 * Reverso / Linguee / WordReference / SpanishDict language pairs.
 */
export async function loadTranslateTargetLang(): Promise<string> {
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
