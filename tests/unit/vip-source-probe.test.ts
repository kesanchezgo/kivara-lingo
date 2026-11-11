/**
 * VIP row actions (parity close-out point 2).
 *
 * Three seams, each tested at its own level:
 *
 *  1. `probeEnrichmentSource` — the orchestrator runs ONE source through its
 *     real `enrich`, so a "Retry" leaves the same kind of observation the
 *     daily fan-out records (timing, classification). Sources are
 *     deterministic doubles: no network, no IndexedDB, no bundled JSON.
 *  2. `vipRowAction` — which action a failing row offers (pure).
 *  3. `VipSection` — the button renders with the prototype's copy and drives
 *     the mechanism (probe via the worker, group grant, key focus).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The per-source probe re-imports the orchestrator inside the permission
// test (a registry reset is how the partial host-permissions mock becomes
// visible), which re-evaluates a heavy import graph. Under a parallel run
// that alone can cross the suite's 5 s ceiling, so this file carries its own.
vi.setConfig({ testTimeout: 20_000 });
import type { VipSettings } from '../../src/shared/types';
import { DEFAULT_VIP } from '../../src/shared/store';
import {
  classifyEnrichError,
  enrichFixKey,
  ENRICH_ERROR_KEYS,
  vipRowAction,
} from '../../src/shared/enrich-health';

const enrichBundled = vi.fn(async () => {
  await sleep(30);
  return { definitions: ['bundled sense'] };
});
const enrichTatoeba = vi.fn(async () => {
  throw new Error('HTTP 429 Too Many Requests');
});
const enrichFreeDictionary = vi.fn(async () => {
  await sleep(340);
  return { translations: ['manzana'] };
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

vi.mock('../../src/background/enrichment/sources/bundled', () => ({
  bundledSource: { id: 'bundled', label: 'Bundled', enrich: enrichBundled },
}));
vi.mock('../../src/background/enrichment/sources/tatoeba', () => ({
  tatoebaSource: { id: 'tatoeba', label: 'Tatoeba', enrich: enrichTatoeba },
}));
vi.mock('../../src/background/enrichment/sources/free-dictionary', () => ({
  freeDictionarySource: { id: 'freeDictionary', label: 'Free Dictionary', enrich: enrichFreeDictionary },
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

const VIP: VipSettings = {
  ...DEFAULT_VIP,
  enabled: true,
  tatoeba: true,
  freeDictionary: true,
  bundled: true,
  perSourceTimeoutMs: 4000,
};

describe('probeEnrichmentSource (the row Retry)', () => {
  beforeEach(() => {
    enrichBundled.mockClear();
    enrichTatoeba.mockClear();
    enrichFreeDictionary.mockClear();
  });

  it('records a real ok observation for a working source', async () => {
    const { probeEnrichmentSource } = await import('../../src/background/enrichment/orchestrator');
    const health = await probeEnrichmentSource('bundled', {
      sourceLang: 'en',
      targetLang: 'es',
      vip: VIP,
    });
    expect(enrichBundled).toHaveBeenCalledTimes(1);
    expect(enrichBundled.mock.calls[0][0]).toBe('time');
    expect(health?.state).toBe('ok');
    expect(health?.at).toBeGreaterThan(0);
  });

  it('records the classified failure for a failing source', async () => {
    const { probeEnrichmentSource } = await import('../../src/background/enrichment/orchestrator');
    const health = await probeEnrichmentSource('tatoeba', {
      sourceLang: 'en',
      targetLang: 'es',
      vip: VIP,
    });
    expect(enrichTatoeba).toHaveBeenCalledTimes(1);
    expect(health?.state).toBe('error');
    expect(health?.code).toBe('rateLimited');
    expect(health?.lastError).toContain('429');
    // The row's fix line and action must agree with the family.
    expect(enrichFixKey('tatoeba', health?.code)).toBe(ENRICH_ERROR_KEYS.rateLimited + 'Fix');
    expect(vipRowAction('tatoeba', health?.code)).toBe('retry');
  });

  it('reports a degraded source as slow, not ok', async () => {
    const { probeEnrichmentSource } = await import('../../src/background/enrichment/orchestrator');
    // A tight budget: slowMs = max(250, 0.8 * 400) = 320, so the 340 ms
    // double crosses it without slowing the suite down.
    const health = await probeEnrichmentSource('freeDictionary', {
      sourceLang: 'en',
      targetLang: 'es',
      vip: { ...VIP, perSourceTimeoutMs: 400 },
    });
    expect(health?.state).toBe('slow');
    expect(vipRowAction('freeDictionary', null)).toBeNull();
  });

  it('answers the permission family when the host is not granted', async () => {
    // The gate is what turns a missing grant into an observation. Force the
    // API to exist with NOTHING granted — the state the row's "Grant access"
    // action exists to fix. The registry reset is what makes the partial mock
    // visible to the already-imported orchestrator.
    vi.resetModules();
    vi.doMock('../../src/shared/host-permissions', async (importOriginal) => {
      const real = await importOriginal<typeof import('../../src/shared/host-permissions')>();
      return { ...real, permissionsApiAvailable: () => true, grantedOriginList: async () => [] };
    });
    const { probeEnrichmentSource } = await import('../../src/background/enrichment/orchestrator');
    const health = await probeEnrichmentSource('tatoeba', {
      sourceLang: 'en',
      targetLang: 'es',
      vip: VIP,
    });
    expect(health?.state).toBe('error');
    expect(health?.code).toBe('permission');
    expect(vipRowAction('tatoeba', health?.code)).toBe('grantAccess');
    vi.doUnmock('../../src/shared/host-permissions');
    vi.resetModules();
  });

  it('throws for an unknown source id', async () => {
    const { probeEnrichmentSource } = await import('../../src/background/enrichment/orchestrator');
    await expect(
      probeEnrichmentSource('not-a-source', { sourceLang: 'en', targetLang: 'es', vip: VIP }),
    ).rejects.toThrow(/unknown enrichment source/);
  });
});

describe('vipRowAction (which button a failing row shows)', () => {
  it('grants the group on permission failures', () => {
    expect(vipRowAction('tatoeba', 'permission')).toBe('grantAccess');
    expect(vipRowAction('unsplash', 'permission')).toBe('grantAccess');
  });

  it('sends keyed sources to their key field', () => {
    expect(vipRowAction('unsplash', 'unauthorized')).toBe('addKey');
    expect(vipRowAction('pixabay', 'rateLimited')).toBe('addKey');
    // A source without a key field has no key to add.
    expect(vipRowAction('reverso', 'unauthorized')).toBe('retry');
  });

  it('offers retry for any other classified failure', () => {
    expect(vipRowAction('reverso', 'forbidden')).toBe('retry');
    expect(vipRowAction('datamuse', 'timeout')).toBe('retry');
    expect(vipRowAction('datamuse', 'server')).toBe('retry');
  });

  it('offers nothing when there is nothing to diagnose', () => {
    expect(vipRowAction('datamuse', null)).toBeNull();
    expect(vipRowAction('datamuse', 'unknown')).toBe('retry');
  });
});

describe('VipSection rows (view wiring)', () => {
  it('renders the classified fix line and the row action button', async () => {
    const React = (await import('react')).default;
    const { render, screen, cleanup } = await import('@testing-library/react');
    const { t } = await import('../../src/shared/i18n');
    const { VipSection } = await import('../../src/app/components/tabs/VipSection');
    try {
      // tests/setup.ts already mocks the bridge; drive THAT mock so the view
      // sees the same seam production uses.
      const { sendMessage } = await import('webext-bridge/content-script');
      const answerHealth = async (type: string) => {
        if (type === 'ENRICH_SOURCE_HEALTH') {
          return {
            tatoeba: { state: 'error', lastError: 'HTTP 403 Forbidden', code: 'forbidden', at: Date.now() },
            bundled: { state: 'ok', latencyMs: 30, at: Date.now() },
          };
        }
        if (type === 'ENRICH_SOURCE_TEST') {
          return { ok: true, source: 'tatoeba', health: { state: 'ok', latencyMs: 120, at: Date.now() } };
        }
        return {};
      };
      vi.mocked(sendMessage).mockImplementation(
        answerHealth as unknown as typeof sendMessage,
      );
      const view = render(React.createElement(VipSection));
      // The classified family line, not the raw provider text.
      await vi.waitFor(() => expect(screen.getAllByText(t('vipx.err403')).length).toBeGreaterThan(0));
      // The fix line for the family (Reverso has no source variant).
      expect(screen.getAllByText(t('vipx.err403Fix')).length).toBeGreaterThan(0);
      // The row action for a classified, non-permission failure is Retry.
      const retryButtons = screen.getAllByTitle(t('vipx.retry'));
      expect(retryButtons.length).toBeGreaterThan(0);
      // Local sources read as Local, never as "not tested" — bundled,
      // WordNet and Yomitan all carry the line.
      expect(screen.getAllByText(t('vipx.local')).length).toBe(3);
      view.unmount();
      cleanup();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('classification agreement', () => {
  it('maps the probe\'s permission wording to the permission family', () => {
    expect(
      classifyEnrichError('missing host permission — the browser refused to let the extension reach this source'),
    ).toBe('permission');
  });
});
