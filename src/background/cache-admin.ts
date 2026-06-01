/**
 * Cache administration — stats + clear for every IndexedDB cache the
 * extension keeps. Surfaced to the side-panel through the service
 * worker message bus so the user can see how much is cached and wipe
 * it on demand.
 *
 * Caches covered:
 *  - vip_cache         → multi-source enrichment results (popover + cards)
 *  - translation_cache → remote translator responses (MyMemory / DeepL / …)
 *  - ai_cache          → AI enrichment responses (OpenAI / Anthropic / Gemini)
 *  - media_cache       → audio/frame dedup hashes (tiny, kept for Anki dedup)
 *
 * NOTE: `dict_terms` (installed Yomitan packs) and `saved_notes`
 * (the Anki dedup ledger) are deliberately EXCLUDED — those are user
 * data, not caches, and wiping them would lose installed dictionaries
 * or re-create duplicate cards. They have their own management UI.
 */

import { getDB } from '../shared/db';
import { clearMemEnrichmentCache } from './enrichment/orchestrator';

export interface CacheBucketStats {
  /** Stable id used by the clear API. */
  id: 'enrichment' | 'translation' | 'ai' | 'media';
  /** Human label for the panel. */
  label: string;
  /** Number of rows. */
  count: number;
  /** Approximate serialized byte size. */
  bytes: number;
}

export interface CacheStatsResult {
  buckets: CacheBucketStats[];
  totalCount: number;
  totalBytes: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tableStats(table: any, approxRowBytes?: (row: unknown) => number): Promise<{ count: number; bytes: number }> {
  try {
    if (!table) return { count: 0, bytes: 0 };
    const rows = (await table.toArray()) as unknown[];
    if (!rows.length) return { count: 0, bytes: 0 };
    let bytes = 0;
    for (const r of rows) {
      try {
        bytes += approxRowBytes ? approxRowBytes(r) : JSON.stringify(r).length;
      } catch {
        // skip un-serialisable rows
      }
    }
    return { count: rows.length, bytes };
  } catch {
    return { count: 0, bytes: 0 };
  }
}

export async function getCacheStats(): Promise<CacheStatsResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getDB() as any;
  const [enrichment, translation, ai, media] = await Promise.all([
    tableStats(db.vip_cache),
    tableStats(db.translation_cache),
    tableStats(db.ai_cache),
    tableStats(db.media_cache),
  ]);
  const buckets: CacheBucketStats[] = [
    { id: 'enrichment', label: 'Enriquecimiento (palabras/hover)', ...enrichment },
    { id: 'translation', label: 'Traducciones (subtítulos)', ...translation },
    { id: 'ai', label: 'IA (mnemonics/etimología)', ...ai },
    { id: 'media', label: 'Multimedia (dedup audio/imágenes)', ...media },
  ];
  return {
    buckets,
    totalCount: buckets.reduce((a, b) => a + b.count, 0),
    totalBytes: buckets.reduce((a, b) => a + b.bytes, 0),
  };
}

/**
 * Clear one or all cache buckets. `which === 'all'` wipes every cache
 * (but never user data — packs and saved-note ledger are untouched).
 * Returns the number of rows removed.
 */
export async function clearCaches(
  which: 'all' | CacheBucketStats['id'],
): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getDB() as any;
  const table = {
    enrichment: db.vip_cache,
    translation: db.translation_cache,
    ai: db.ai_cache,
    media: db.media_cache,
  };
  let removed = 0;
  const targets =
    which === 'all'
      ? [table.enrichment, table.translation, table.ai, table.media]
      : [table[which]];
  for (const t of targets) {
    try {
      if (!t) continue;
      removed += (await t.count()) ?? 0;
      await t.clear();
    } catch {
      // ignore — best effort
    }
  }
  // Also drop the hot in-memory enrichment layer so a freshly-wiped cache
  // isn't shadowed by entries still warm in the service worker's memory.
  if (which === 'all' || which === 'enrichment') {
    try {
      clearMemEnrichmentCache();
    } catch {
      // ignore
    }
  }
  return removed;
}
