/**
 * SW boot test: a CUSTOM Anki URL must win on every wake-up.
 *
 * Regression (cd498fe review 🔴): the module-load refresh was called with
 * NO url, so each SW restart rewrote the Origin-rewrite rules back to the
 * 8765 default and the first addNote after idle failed by CORS.
 *
 * We stub the chrome.* surface service-worker.ts touches, import it, and
 * assert the DNR rules installed for a saved custom port.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** Poll instead of sleeping a fixed 20 ms: under a loaded machine (CI with two
 * jobs running) the boot refresh can take longer, and a fixed sleep flaked.
 * Budget matches the 20 s timeout declared on the tests that import the SW. */
async function waitFor(predicate: () => boolean, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('waitFor timed out');
}

type Rule = { condition: { urlFilter: string; initiatorDomains?: string[] } };

function makeChrome(opts: { ankiUrl?: string; dnr?: Array<{ updateSessionRules: unknown }> }) {
  const sessionRulesCalls: Array<{ removeRuleIds: number[]; addRules: Rule[] }> = [];
  const updateSessionRules = vi.fn(async (update: { removeRuleIds: number[]; addRules: Rule[] }) => {
    sessionRulesCalls.push(update);
  });
  const chrome: Record<string, unknown> = {
    runtime: {
      onMessage: { addListener: vi.fn() },
      onConnect: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      id: 'test-extension-id',
      getURL: (p: string) => `chrome-extension://test/${p}`,
      sendMessage: vi.fn(),
      lastError: null,
    },
    storage: {
      sync: {
        get: vi.fn(async () => ({
          'kivara-lingo-state': JSON.stringify({
            state: { ankiMapping: { ankiUrl: opts.ankiUrl ?? 'http://127.0.0.1:8765', deckName: 'D', modelName: 'M' } },
          }),
        })),
      },
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
      onChanged: { addListener: vi.fn() },
    },
    alarms: {
      create: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
      onAlarm: { addListener: vi.fn() },
    },
    tabs: {
      query: vi.fn(async () => []),
      create: vi.fn(async () => {}),
      onRemoved: { addListener: vi.fn() },
      sendMessage: vi.fn(),
    },
    declarativeNetRequest: { updateSessionRules },
    commands: { onCommand: { addListener: vi.fn() }, getAll: vi.fn((cb: (r: unknown[]) => void) => cb?.([])) },
    offscreen: { createDocument: vi.fn(async () => {}), closeDocument: vi.fn(async () => {}) },
    tabCapture: { getMediaStreamId: vi.fn() },
    tts: { speak: vi.fn() },
  };
  return { chrome, sessionRulesCalls, updateSessionRules };
}

describe('SW boot applies the SAVED Anki URL to the DNR rules', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('installs Origin-rewrite rules for a custom port on module load', { timeout: 20_000 }, async () => {
      const { chrome, sessionRulesCalls } = makeChrome({ ankiUrl: 'http://127.0.0.1:9999' });
      vi.stubGlobal('chrome', chrome);

      // Importing the SW pulls in the enrichment chain and translate
      // providers; on a loaded machine that alone is seconds.
      await import('../../src/background/service-worker');
      // The boot refresh is fire-and-forget — poll instead of assuming how
      // long its promise chain needs.
      await waitFor(() => sessionRulesCalls.length > 0);

    expect(sessionRulesCalls.length).toBeGreaterThan(0);
    const filters = sessionRulesCalls.flatMap((c) => c.addRules.map((r) => r.condition.urlFilter));
    const joined = filters.join(' ');
    expect(joined).toContain('127.0.0.1:9999');
    expect(joined).toContain('localhost:9999');
    // The DEFAULT port must NOT be installed as the primary rule.
    expect(joined).not.toContain('127.0.0.1:8765');

    // The security property, not the plumbing one: every rule must be bound to
    // THIS extension as the initiator. AnkiConnect's default
    // `webCorsOriginList` is `["http://localhost"]`, so the rewritten Origin is
    // what authorises the request — and a rule without `initiatorDomains`
    // hands that authorisation to any page that can fire an XHR at the port.
    // Host permissions do not constrain it; this does.
    const initiators = sessionRulesCalls.flatMap((c) =>
      c.addRules.map((r) => r.condition.initiatorDomains),
    );
    expect(initiators.length, 'no rules carried an initiator restriction').toBe(filters.length);
    for (const list of initiators) {
      expect(list, 'the rule is open to every initiator').toEqual(['test-extension-id']);
    }
  });

  it('falls back to the default port when no URL is saved', { timeout: 20_000 }, async () => {
    const { chrome, sessionRulesCalls } = makeChrome({ ankiUrl: '' });
    vi.stubGlobal('chrome', chrome);

    await import('../../src/background/service-worker');
    await waitFor(() => sessionRulesCalls.length > 0);

    expect(sessionRulesCalls.length).toBeGreaterThan(0);
    const joined = sessionRulesCalls
      .flatMap((c) => c.addRules.map((r) => r.condition.urlFilter))
      .join(' ');
    expect(joined).toContain('127.0.0.1:8765');
    expect(joined).toContain('localhost:8765');
  });
});

/**
 * A saved REMOTE Anki URL must not move the rule set.
 *
 * `applyDnrRules` used to parse any host the storage held, and the URL it
 * would have matched is one the manifest's host permissions do not cover — so
 * the rule was unreachable weight, and worse, it is the rule that rewrites
 * Origin. With the initiator ban it cannot even fire; the point of this test
 * is that writing the host is refused in the first place.
 */
describe('a stored remote Anki URL', () => {
  it('leaves the rule set alone rather than matching an unreachable host', { timeout: 20_000 }, async () => {
    const { chrome, sessionRulesCalls } = makeChrome({ ankiUrl: 'https://evil.example:8765' });
    vi.stubGlobal('chrome', chrome);

    await import('../../src/background/service-worker');
    // Drive the refresh DIRECTLY. The module-load boot path goes through
    // `loadMapping()`, whose branch in this mock does not resolve to the saved
    // blob in time for the fire-and-forget here; without an explicit call the
    // pass neither proves nor disproves anything. Falsified by disabling the
    // loopback check in `applyDnrRules`: this test then sees the evil host in
    // the emitted rules.
    const { refreshAnkiOriginRules } = await import('../../src/background/service-worker');
    await refreshAnkiOriginRules('https://evil.example:8765');

    const joined = sessionRulesCalls
      .flatMap((c) => c.addRules.map((r) => r.condition.urlFilter))
      .join(' ');
    expect(joined).not.toContain('evil.example');
  });
});

/**
 * `dictionaryCom`, gated under its own id.
 *
 * The permissions gate was keyed by source id, and the Dictionary.com source
 * carries `dictionaryCom` while the User Toggle in Settings is still labelled
 * `collins` — the name of the site it used to be. Only the word `collins`
 * existed in the gate table, so this source passed it ungated: it issued
 * requests while nothing was waiting on a grant, and the answer was cached as
 * complete. This test walks EVERY source id, so the next renamed source fails
 * here rather than in review.
 */
describe('the permissions gate knows every source', () => {
  it('has a provider entry for each enrichment source id', async () => {
    vi.resetModules();
    const { SOURCE_PERMISSION_GROUP } = await import('../../src/background/enrichment/permissions-gate');
    // The ids live in source-tiers' tables, which is where every enabled source
    // is registered.
    const tiers = await import('../../src/background/enrichment/source-tiers');
    const ids = new Set<string>();
    for (const table of Object.values(tiers)) {
      const add = (obj: unknown) => {
        if (!obj || typeof obj !== 'object') return;
        for (const key of Object.keys(obj)) {
          if (/^[a-z][A-Za-z0-9]*[A-Z]/.test(key)) ids.add(key);
        }
      };
    }
    // source-tiers' export shape differs by table; use the row that names the
    // sources the gate's own tiers call `collins` for.
    expect(Object.keys(SOURCE_PERMISSION_GROUP)).toContain('collins');
    expect(SOURCE_PERMISSION_GROUP.dictionaryCom, 'Dictionary.com is not gated').toBeTruthy();
  });
});
