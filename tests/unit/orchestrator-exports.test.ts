/**
 * The orchestrator's public surface.
 *
 * The module is being split file by file, and a botched move here is silent in
 * every other way: the service worker and cache-admin import specific names
 * through the orchestrator, so a symbol renamed, lost or re-routed breaks only
 * at runtime, in the service worker, on a hover. This snapshot is the cheap
 * tripwire — `vitest -u` updates it on a deliberate change, which is exactly
 * what a real split is.
 *
 * The cache names MUST stay exported from the orchestrator even though they now
 * live in ./cache: that re-export is what keeps the two consumers from having
 * to learn about the split.
 */
import { describe, it, expect } from 'vitest';
import type { EnrichmentContext, VipSettings } from '../../src/shared/types';

const ctxOf = (): EnrichmentContext => ({ sourceLang: 'en', targetLang: 'es', sentence: 'run' });
const vipOf = (enabled: boolean) => ({ enabled }) as unknown as VipSettings;

describe('orchestrator exports', () => {
  // The dynamic import pulls in ~50 source modules; under a full-suite run on
  // a loaded box that transform can outlast the 5 s default, which read as a
  // snapshot mismatch rather than a timeout in earlier runs.
  it(
    'exposes the names the service worker, cache-admin and tests import',
    async () => {
      const mod = await import('../../src/background/enrichment/orchestrator');
      expect(Object.keys(mod).sort()).toMatchInlineSnapshot(`
        [
          "ENRICHMENT_CACHE_VERSION",
          "activeSourceSignature",
          "clearEnrichmentCache",
          "clearMemEnrichmentCache",
          "getEnrichmentCacheStats",
          "makeCacheKey",
          "mergeFields",
          "readEnrichmentCache",
          "runEnrichment",
          "writeEnrichmentCache",
        ]
      `);
  }, 30_000);

  it('mints cache keys prefixed with the schema version', async () => {
    const mod = await import('../../src/background/enrichment/orchestrator');
    const key = mod.makeCacheKey('run', ctxOf(), vipOf(false), 'popover');
    // The version prefix is what retires a payload written by an older build:
    // with it, a stale row misses on a version mismatch instead of serving
    // the old merge's output until the TTL expired.
    expect(key.startsWith(`v${mod.ENRICHMENT_CACHE_VERSION}|`)).toBe(true);
    // The unpinned parts stay in the key after the prefix (tier, signature,
    // langs, token, sentence).
    expect(key.split('|')).toHaveLength(8);
  });

  it('clears the cache and reports how many rows went', async () => {
    const mod = await import('../../src/background/enrichment/orchestrator');
    // No IndexedDB under happy-dom, so the count is 0 — but the SHAPE is the
    // contract: the panel prints this number.
    const removed = await mod.clearEnrichmentCache();
    expect(typeof removed).toBe('number');
  });
});
