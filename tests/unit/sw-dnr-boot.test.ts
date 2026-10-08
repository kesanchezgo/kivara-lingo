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

type Rule = { condition: { urlFilter: string } };

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
    commands: { onCommand: { addListener: vi.fn() }, getAll: vi.fn((cb: unknown) => cb?.([])) },
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

  it('installs Origin-rewrite rules for a custom port on module load', async () => {
    const { chrome, sessionRulesCalls } = makeChrome({ ankiUrl: 'http://127.0.0.1:9999' });
    vi.stubGlobal('chrome', chrome);

    await import('../../src/background/service-worker');
    // The boot refresh is fire-and-forget — let its promise chain settle.
    await new Promise((r) => setTimeout(r, 20));

    expect(sessionRulesCalls.length).toBeGreaterThan(0);
    const filters = sessionRulesCalls.flatMap((c) => c.addRules.map((r) => r.condition.urlFilter));
    const joined = filters.join(' ');
    expect(joined).toContain('127.0.0.1:9999');
    expect(joined).toContain('localhost:9999');
    // The DEFAULT port must NOT be installed as the primary rule.
    expect(joined).not.toContain('127.0.0.1:8765');
  });

  it('falls back to the default port when no URL is saved', async () => {
    const { chrome, sessionRulesCalls } = makeChrome({ ankiUrl: '' });
    vi.stubGlobal('chrome', chrome);

    await import('../../src/background/service-worker');
    await new Promise((r) => setTimeout(r, 20));

    expect(sessionRulesCalls.length).toBeGreaterThan(0);
    const joined = sessionRulesCalls
      .flatMap((c) => c.addRules.map((r) => r.condition.urlFilter))
      .join(' ');
    expect(joined).toContain('127.0.0.1:8765');
  });
});
