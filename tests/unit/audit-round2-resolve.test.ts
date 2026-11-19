/**
 * RED TESTS — audit round 2, item 3: resolveContextGloss must give up on a
 * hanging RESOLVE_WORD (~500 ms) and fall back to the bundled dictionary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe('resolveContextGloss timeout', () => {
  it('a hanging RESOLVE_WORD resolves with the dictionary gloss before 600 ms', async () => {
    const sendMessage = vi.fn(() => new Promise<never>(() => { /* never settles */ }));
    vi.doMock('webext-bridge/content-script', () => ({ sendMessage }));
    vi.doMock('../../src/content/nlp/dictionary', () => ({
      lookupDictionary: vi.fn(() => ({ token: 'run', type: 'word', translation: 'correr' })),
    }));
    const { resolveContextGloss } = await import('../../src/content/resolve-context-gloss');
    const t0 = Date.now();
    await expect(resolveContextGloss('run', 'She runs.', 'en')).resolves.toEqual({ gloss: 'correr' });
    expect(Date.now() - t0).toBeLessThan(600);
  }, 2000);
});
