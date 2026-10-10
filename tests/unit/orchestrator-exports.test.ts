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

  it('clears the cache and reports how many rows went', async () => {
    const mod = await import('../../src/background/enrichment/orchestrator');
    // No IndexedDB under happy-dom, so the count is 0 — but the SHAPE is the
    // contract: the panel prints this number.
    const removed = await mod.clearEnrichmentCache();
    expect(typeof removed).toBe('number');
  });
});
