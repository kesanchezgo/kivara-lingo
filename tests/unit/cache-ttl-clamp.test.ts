/**
 * The TTL clamp has to survive hydration, not just be computed.
 *
 * A persisted `cacheTtlDays` of `-5`, `0`, `NaN` or `9999` is not a
 * hypothetical: it arrives from an older build, a hand-edited flag or an
 * import, and each is destructive at the cache layer — a non-positive value
 * makes the reader treat every row as stale AND the pruner delete all of
 * them; an enormous one makes a row permanent.
 *
 * This test exists because the clamp used to be computed one line above the
 * spread that returned it, and then overwritten by a raw copy of the very
 * object it had just normalised.
 */
import { describe, expect, it, vi } from 'vitest';
import { normalizeTtlDays, MAX_CACHE_TTL_DAYS } from '../../src/shared/cache-ttl';

describe('normalizeTtlDays', () => {
  it('maps the destructive inputs to the caller default, not to a minimum', () => {
    for (const bad of [-5, 0, -0.5, Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
      expect(normalizeTtlDays(bad as number, 14), String(bad)).toBe(14);
    }
  });

  it('honours a per-cache default rather than a shared constant', () => {
    // The AI cache falls back to 30; a shared hard-coded 14 would silently
    // halve it.
    expect(normalizeTtlDays(null as unknown as number, 30)).toBe(30);
  });

  it('clamps the ceiling and floors a fraction to one day', () => {
    expect(normalizeTtlDays(9999)).toBe(MAX_CACHE_TTL_DAYS);
    expect(normalizeTtlDays(365)).toBe(365);
    expect(normalizeTtlDays(0.4)).toBe(1);
  });
});

describe('the VIP block a background reader keeps', () => {
  // `getVipSettings` reads chrome.storage.sync DIRECTLY, bypassing the store's
  // merge entirely — so it is the entry point where a stored -5 or 9999 can
  // reach the enrichment cache with nothing in between. It has to clamp on its
  // own.
  it('clamps the stored value the service worker reads', async () => {
    vi.resetModules();
    for (const stored of [-5, 0, 9999, Number.NaN]) {
      vi.stubGlobal('chrome', {
        storage: {
          sync: {
            get: vi.fn(async () => ({
              'kivara-lingo-state': JSON.stringify({ state: { vip: { cacheTtlDays: stored } } }),
            })),
          },
          local: { get: vi.fn(async () => ({})) },
        },
        runtime: { id: 'test-extension-id' },
      });
      vi.resetModules();
      const { getVipSettings } = await import('../../src/background/vip-settings');
      const vip = await getVipSettings();
      const expected = normalizeTtlDays(vip.cacheTtlDays);
      expect(vip.cacheTtlDays, String(stored)).toBe(expected);
      expect(vip.cacheTtlDays, String(stored)).toBeGreaterThan(0);
      expect(vip.cacheTtlDays, String(stored)).toBeLessThanOrEqual(MAX_CACHE_TTL_DAYS);
      vi.unstubAllGlobals();
    }
  });
});

