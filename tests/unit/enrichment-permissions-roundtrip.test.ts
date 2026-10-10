/**
 * Grant → next lookup, exercised through the real orchestrator.
 *
 * The bug this pins: with no host permission granted the orchestrator skips the
 * network sources and reports `needsAccess`. That payload used to land in BOTH
 * cache layers, so granting the origin and hovering the SAME word again
 * returned the pre-grant answer — from IndexedDB for the TTL, and from the hot
 * layer for the rest of the service worker's life. The CTA then looked broken
 * to exactly the user it was built for.
 *
 * "Granted" here means the chrome mock changes its answer between the two
 * lookups, which is what `chrome.permissions.onAdded` fires for.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runEnrichment, clearMemEnrichmentCache } from '../../src/background/enrichment/orchestrator';
import type { VipSettings } from '../../src/shared/types';

// The gloss backfill dials real translation providers; offline in this suite
// they hang and the lookups time out. It is unrelated to the permission gate.
vi.mock('../../src/background/translate', () => ({
  translateText: async () => ({ ok: false, translatedText: '' }),
  translateToken: async () => ({ ok: false, translatedText: '' }),
}));

// Cambridge is stubbed to a marker payload: the count of calls is the point of
// the test, not what the real host answers offline. `vi.hoisted` because the
// factory below is hoisted above the spy declaration.
const cambridgeCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock('../../src/background/enrichment/sources/cambridge', () => ({
  cambridgeSource: {
    id: 'cambridge',
    label: 'Cambridge',
    enrich: async () => {
      cambridgeCalls.n += 1;
      return { definitions: ['granted-path-cambridge'] };
    },
  },
}));

const VIP_WITH_CAMBRIDGE: VipSettings = {
  enabled: true, perSourceTimeoutMs: 1000, cacheTtlDays: 14,
  unsplashAccessKey: '', pixabayApiKey: '',
  // Bundled/packs stay on (local, no permission needed); Cambridge represents
  // any network source — if the permissions gate is right it is held back.
  freeDictionary: false, datamuse: false, wiktionary: false, wiktionaryHtml: false,
  wiktionaryApi: false, wiktApi: false, mobyThesaurus: false, thesaurusCom: false,
  wordHippo: false, theIdioms: false, bundled: true, yomitanPacks: true,
  britannicaDictionary: false, cambridge: true, oxfordLearners: false, longman: false,
  collins: false, merriamWebster: false, merriamWebsterThesaurus: false, oxfordCollocations: false,
  ozdic: false, pons: false, babla: false, dictCc: false, reverso: false, linguee: false,
  promtContext: false, wordReference: false, spanishDict: false, tatoeba: false,
  cambridgeAudio: true, oxfordAudio: false, forvo: false, linguaLibre: false,
  googleTtsFallback: false, unsplash: false, pixabay: false, bingImages: false,
  openverse: false, wikimediaCommons: false, youglish: false, etymonline: false,
} as never;

/** `origins` is what chrome.permissions.getAll() reports as granted. */
function installPermissions(origins: string[]): void {
  vi.stubGlobal('chrome', {
    permissions: {
      getAll: async () => ({ origins }),
      contains: async () => true,
    },
    storage: { session: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
    runtime: { getURL: (p: string) => `chrome-extension://test/${p}` },
  });
}

describe('a grant is reflected by the next lookup', () => {
  beforeEach(() => {
    cambridgeCalls.n = 0;
    clearMemEnrichmentCache();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks the held-back sources again once their access is granted', async () => {

    // Fresh install: nothing granted, so the network source is skipped.
    installPermissions([]);
    const held = await runEnrichment('run', {
      sourceLang: 'en',
      targetLang: 'es',
      vip: VIP_WITH_CAMBRIDGE,
      purpose: 'popover',
    });
    expect(held.needsAccess?.some((n) => n.source === 'cambridge')).toBe(true);
    expect(held.successfulSources).not.toContain('cambridge');

    // The user grants it. `requestHosts` asks for the WHOLE group
    // (`providerHosts(group)` = both patterns), so that is what
    // `chrome.permissions.onAdded` reports as granted.
    installPermissions(['https://*.dictionary.cambridge.org/*', 'https://dictionary.cambridge.org/*']);
    clearMemEnrichmentCache();

    const granted = await runEnrichment('run', {
      sourceLang: 'en',
      targetLang: 'es',
      vip: VIP_WITH_CAMBRIDGE,
      purpose: 'popover',
    });
    if (granted.needsAccess?.some((n) => n.source === 'cambridge')) {
      // eslint-disable-next-line no-console
      console.log('CAM DIAG', JSON.stringify(granted.needsAccess));
    }
    // The source is no longer held back: it actually ran (once, in the fresh
    // lookup) and its data is in the result — while the pre-grant lookup never
    // called it at all. The old bug replayed the held-back payload from the
    // hot cache, so `cambridge` stayed absent no matter how many times the
    // user granted and re-hovered.
    expect(granted.needsAccess ?? []).not.toContain(
      expect.objectContaining({ source: 'cambridge' }),
    );
    // It ran exactly once — on the post-grant lookup. The pre-grant lookup
    // held it back SO hard it never made a call: the old bug replayed the
    // held-back payload from the hot cache, so `cambridge` stayed absent no
    // matter how many times the user granted and re-hovered.
    expect(cambridgeCalls.n).toBe(1);
    expect(granted.successfulSources).toContain('cambridge');
    expect(held.successfulSources).not.toContain('cambridge');
  });
});
