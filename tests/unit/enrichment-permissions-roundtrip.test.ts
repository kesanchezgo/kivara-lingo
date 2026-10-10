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
 * `writeCache` refuses to store such an answer at all, `memGet` and the
 * IndexedDB read both treat one as a miss, and the granted path is proven by
 * counting the calls the blocked source made: held back means never dialed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  runEnrichment,
  clearMemEnrichmentCache,
} from '../../src/background/enrichment/orchestrator';

// The gloss backfill dials real translation providers; offline in this suite
// they hang and the lookups time out. It is unrelated to the permission gate.
vi.mock('../../src/background/translate', () => ({
  translateText: async () => ({ ok: false, translatedText: '' }),
  translateToken: async () => ({ ok: false, translatedText: '' }),
}));

// Cambridge is stubbed to a marker payload: the count of calls is the point of
// the test, not what the real host answers offline. `vi.hoisted` because the
// factory below is hoisted above any top-level declaration.
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

// A second, independent source, so a lookup can mix a DIALED source with a
// HELD-BACK one — the payload the old caching bug stored.
const merriamCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock('../../src/background/enrichment/sources/merriam-webster', () => ({
  merriamWebsterSource: {
    id: 'merriamWebster',
    label: 'Merriam-Webster',
    enrich: async () => {
      merriamCalls.n += 1;
      return { definitions: ['granted-path-merriam'] };
    },
  },
}));

type VipSettings = Record<string, unknown>;

const VIP_WITH_CAMBRIDGE: VipSettings = {
  enabled: true,
  perSourceTimeoutMs: 0,
  cacheTtlDays: 14,
  unsplashAccessKey: '',
  pixabayApiKey: '',
  // Bundled/packs stay OFF and only Cambridge is on: the permission gate is
  // the single variable this suite exercises, so no other source may fold
  // anything into the result.
  freeDictionary: false,
  datamuse: false,
  wiktionary: false,
  wiktionaryHtml: false,
  wiktionaryApi: false,
  wiktApi: false,
  mobyThesaurus: false,
  thesaurusCom: false,
  wordHippo: false,
  theIdioms: false,
  bundled: false,
  yomitanPacks: false,
  britannicaDictionary: false,
  cambridge: true,
  oxfordLearners: false,
  longman: false,
  collins: false,
  merriamWebsterThesaurus: false,
  oxfordCollocations: false,
  ozdic: false,
  pons: false,
  babla: false,
  dictCc: false,
  reverso: false,
  linguee: false,
  promtContext: false,
  wordReference: false,
  spanishDict: false,
  tatoeba: false,
  cambridgeAudio: false,
  merriamWebster: true,
  forvo: false,
  linguaLibre: false,
  googleTtsFallback: false,
  unsplash: false,
  pixabay: false,
  bingImages: false,
  openverse: false,
  wikimediaCommons: false,
  youglish: false,
  etymonline: false,
} as unknown as VipSettings;

/** `origins` is what chrome.permissions.getAll() reports as granted. */
function installPermissions(origins: string[]): void {
  vi.stubGlobal('chrome', {
    permissions: {
      getAll: async () => ({ origins }),
      contains: async () => true,
    },
    storage: {
      session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    },
    runtime: { getURL: (p: string) => `chrome-extension://test/${p}` },
  });
}

describe('a grant is reflected by the next lookup', () => {
  beforeEach(() => {
    cambridgeCalls.n = 0;
    merriamCalls.n = 0;
    clearMemEnrichmentCache();
  });
  afterEach(() => vi.unstubAllGlobals());

  const LOOKUP = { sourceLang: 'en', targetLang: 'es', vip: VIP_WITH_CAMBRIDGE, purpose: 'popover' as const };
  const run = () => runEnrichment('run', LOOKUP);
  const CAMBRIDGE = ['https://*.dictionary.cambridge.org/*', 'https://dictionary.cambridge.org/*'];
  const MERRIAM = ['https://www.merriam-webster.com/*', 'https://media.merriam-webster.com/*'];

  it('holds the source back and dials it right after the grant', async () => {
    installPermissions([]);
    const held = await run();
    expect(held.needsAccess ?? []).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'cambridge' })]),
    );
    expect(held.successfulSources).not.toContain('cambridge');
    // Held back means never dialed — this is what the old hot-cache bug hid.
    expect(cambridgeCalls.n).toBe(0);

    installPermissions(CAMBRIDGE);
    const granted = await run();
    expect(granted.needsAccess ?? []).not.toContain(
      expect.objectContaining({ source: 'cambridge' }),
    );
    expect(granted.successfulSources).toContain('cambridge');
    expect(cambridgeCalls.n).toBe(1);
  });

  it('never writes a still-held-back answer into either cache layer', async () => {
    installPermissions([...CAMBRIDGE]);
    const intermediate = await run();
    // Let the fire-and-forget `writeCache` land before the next read: without
    // this the flip below races the singleton promise and the poisoned row can
    // appear seconds after the lookup it needs to influence.
    await new Promise((r) => setTimeout(r, 50));
    expect(cambridgeCalls.n).toBe(1);
    expect(merriamCalls.n).toBe(0);
    expect(intermediate.needsAccess ?? []).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'merriamWebster' })]),
    );
    expect(intermediate.successfulSources).toContain('cambridge');

    // Grant everything and ask again. If the intermediate row had been
    // written, this is served FROM IT: the row still lists merriamWebster as
    // missing, so the granted answer would come back looking held back. Only
    // a genuine miss produces an answer with sources actually dialed.
    installPermissions([...CAMBRIDGE, ...MERRIAM]);
    const again = await run();
    expect(again.needsAccess ?? []).not.toContain(
      expect.objectContaining({ source: 'merriamWebster' }),
    );
    expect(again.successfulSources).toContain('cambridge');
    expect(again.successfulSources).toContain('merriamWebster');
    expect(cambridgeCalls.n).toBe(2);
    expect(merriamCalls.n).toBe(1);
  });

  it('the read side is not served a poisoned row', async () => {
    // HOW THIS SERIES IS FALSIFIABLE, verified by flipping orchestrator.ts:
    //   both guards off   → all three tests fail (the held-back row IS served,
    //                       so the granted sources never re-dial)
    //   write refusal off → pass, because the read guard is still in force
    //   read guard off    → pass, because nothing is written in the first place
    // The two guards are therefore JOINTLY the invariant, and only the pair
    // flip breaks them. Under happy-dom there is no IndexedDB (vip_cache.put
    // throws and is swallowed), so the exercises layer is the hot one; the
    // IndexedDB miss path is covered by inspection in `readCache`.
    installPermissions([...CAMBRIDGE]);
    await run();
    expect(cambridgeCalls.n).toBe(1);
    expect(merriamCalls.n).toBe(0);

    // Grant the source the row was still waiting on and ask again. A served
    // row would keep both counters exactly where they are, and merriamWebster
    // would still be reported missing.
    installPermissions([...CAMBRIDGE, ...MERRIAM]);
    const granted = await run();
    expect(granted.needsAccess ?? []).not.toContain(
      expect.objectContaining({ source: 'merriamWebster' }),
    );
    expect(granted.successfulSources).toContain('cambridge');
    expect(granted.successfulSources).toContain('merriamWebster');
    expect(cambridgeCalls.n).toBe(2);
    expect(merriamCalls.n).toBe(1);
  });
});
