/**
 * ENRICH_SOURCE_HEALTH (docs/REDESIGN-V2.md §3 H8, §4.6).
 *
 * The orchestrator times every source itself, so the reported number is the
 * one the fan-out actually waited, and a source that throws still leaves an
 * observation. Sources are deterministic doubles: no network, no IndexedDB,
 * no bundled JSON.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VipSettings } from '../../src/shared/types';
import { DEFAULT_VIP } from '../../src/shared/store';

// Node timers may fire a fraction of a millisecond early on a loaded
// runner, so a 5 ms sleep cannot be asserted as `>= 5`. The floor is 30 ms
// and the assertion compares against 20.
const DELAYS = { bundled: 30, freeDictionary: 360 };

const enrichBundled = vi.fn(async () => {
  await sleep(DELAYS.bundled);
  return { definitions: ['bundled sense'] };
});
const enrichFreeDictionary = vi.fn(async () => {
  await sleep(DELAYS.freeDictionary);
  return { translations: ['manzana'] };
});
const enrichTatoeba = vi.fn(async () => {
  throw new Error('tatoeba is down');
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

vi.mock('../../src/background/enrichment/sources/bundled', () => ({
  bundledSource: { id: 'bundled', label: 'Bundled', enrich: enrichBundled },
}));
vi.mock('../../src/background/enrichment/sources/free-dictionary', () => ({
  freeDictionarySource: { id: 'freeDictionary', label: 'Free Dictionary', enrich: enrichFreeDictionary },
}));
vi.mock('../../src/background/enrichment/sources/tatoeba', () => ({
  tatoebaSource: { id: 'tatoeba', label: 'Tatoeba', enrich: enrichTatoeba },
}));
// Imported by the orchestrator at module load; stubbed so the suite never
// touches bundled assets, Yomitan's IndexedDB or the network.
vi.mock('../../src/background/enrichment/sources/yomitan-packs', () => ({
  yomitanPacksSource: { id: 'yomitanPacks', label: 'Yomitan', enrich: async () => ({}) },
}));
vi.mock('../../src/background/enrichment/sources/wordnet', () => ({
  wordnetSource: { id: 'wordnet', label: 'WordNet', enrich: async () => ({}) },
}));
vi.mock('../../src/background/enrichment/sources/cambridge', () => ({
  cambridgeSource: { id: 'cambridge', label: 'Cambridge', enrich: async () => ({}) },
}));
vi.mock('../../src/background/enrichment/sources/openverse', () => ({
  openverseSource: { id: 'openverse', label: 'Openverse', enrich: async () => ({}) },
}));
vi.mock('../../src/background/enrichment/sources/britannica-dictionary', () => ({
  britannicaDictionarySource: { id: 'britannicaDictionary', label: 'Britannica', enrich: async () => ({}) },
}));
vi.mock('../../src/shared/db', () => ({ getDB: () => ({}) }));
vi.mock('../../src/background/translate', () => ({
  translateText: async () => ({ ok: true, translatedText: 'ES', provider: 'mymemory', cached: false }),
}));

const { clearMemEnrichmentCache, clearEnrichmentSourceHealth, getEnrichmentSourceHealth, runEnrichment } =
  await import('../../src/background/enrichment/orchestrator');

function vipWith(...enabled: Array<keyof VipSettings>): VipSettings {
  const base = Object.fromEntries(
    Object.entries(DEFAULT_VIP).map(([key, value]) => [key, typeof value === 'boolean' ? false : value]),
  ) as VipSettings;
  for (const key of enabled) (base as unknown as Record<string, unknown>)[key] = true;
  // Keep the fan-out small and the slow threshold deterministic (320 ms).
  return { ...base, perSourceTimeoutMs: 400 };
}

describe('ENRICH_SOURCE_HEALTH', () => {
  beforeEach(() => {
    clearEnrichmentSourceHealth();
    clearMemEnrichmentCache();
    vi.clearAllMocks();
  });

  it('reports ok, slow and error per source', async () => {
    await runEnrichment('apple', {
      sourceLang: 'en',
      targetLang: 'es',
      sentence: 'She ate a ripe apple.',
      vip: vipWith('bundled', 'freeDictionary', 'tatoeba'),
      purpose: 'card',
    });

    const health = getEnrichmentSourceHealth();
    expect(health.bundled).toMatchObject({ state: 'ok' });
    expect(health.bundled.latencyMs).toBeGreaterThanOrEqual(DELAYS.bundled - 10);
    expect(health.freeDictionary?.state).toBe('slow');
    expect(health.freeDictionary?.latencyMs).toBeGreaterThanOrEqual(320);
    expect(health.tatoeba).toMatchObject({ state: 'error', lastError: 'tatoeba is down' });
    expect(typeof health.bundled.at).toBe('number');
  });

  it('only reports sources the run actually attempted', async () => {
    await runEnrichment('apple', {
      sourceLang: 'en',
      targetLang: 'es',
      vip: vipWith('bundled'),
      purpose: 'card',
    });
    const health = getEnrichmentSourceHealth();
    expect(Object.keys(health)).toEqual(['bundled']);
  });

  it('keeps the last observation per source across runs', async () => {
    await runEnrichment('apple', {
      sourceLang: 'en',
      targetLang: 'es',
      vip: vipWith('tatoeba'),
      purpose: 'card',
      bypassCache: true,
    });
    expect(getEnrichmentSourceHealth().tatoeba?.state).toBe('error');

    await runEnrichment('pear', {
      sourceLang: 'en',
      targetLang: 'es',
      vip: vipWith('bundled'),
      purpose: 'card',
      bypassCache: true,
    });
    const health = getEnrichmentSourceHealth();
    // The successful run does not erase the other source's last failure.
    expect(health.tatoeba?.state).toBe('error');
    expect(health.bundled?.state).toBe('ok');
  });
});
