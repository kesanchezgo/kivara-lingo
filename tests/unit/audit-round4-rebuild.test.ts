/**
 * RED TEST — the retry rebuild carries the identity fields stored on the
 * registry row, so a permanent-failure retry dedups by identity like a
 * first save.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe('retryCard rebuild carries identity fields', () => {
  it('rebuilds the minimal request from the row identity fields', async () => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: {
          get: async () => ({}), set: async () => {},
        },
      },
    };
    const row = {
      id: 'card-r4', word: 'run', sentence: 'She runs it.', status: 'failed',
      kind: 'word', deck: 'English vocab', lang: 'en', createdAt: Date.now(),
      attempts: 1, tags: ['kivara-lingo'], error: 'timeout',
      identityKey: 'run', surface: 'running', contextGloss: 'correr', phraseLevel: false,
    };
    const stored: Record<string, unknown> = { 'kvl:cards.recent': [row] };
    (globalThis as unknown as { chrome: { storage: { local: Record<string, unknown> } } }).chrome.storage.local = {
      get: async (keys: string | string[]) => {
        const out: Record<string, unknown> = {};
        for (const k of Array.isArray(keys) ? keys : [keys]) if (k in stored) out[k] = stored[k];
        return out;
      },
      set: async (items: Record<string, unknown>) => { Object.assign(stored, items); },
    };
    const createCardFromRequest = vi.fn(
      async (_req: unknown, _m: unknown, _c: unknown, _o: unknown) =>
        ({ ok: false, error: 'x', queued: true }),
    );
    vi.doMock('../../src/background/capture-orchestrator', () => ({
      createCardFromRequest, retryPendingNotes: vi.fn(async () => ({ retried: 0, succeeded: 0 })),
    }));
    vi.doMock('../../src/background/card-actions', () => ({
      deleteNote: vi.fn(async () => ({ ok: true })),
      noteOwnership: vi.fn(async () => 'owned'),
      addContextToNote: vi.fn(), browseNote: vi.fn(), wordIntervals: vi.fn(),
    }));
    vi.doMock('../../src/shared/db', () => ({
      getDB: () => ({
        pending_notes: {
          toArray: async () => [], delete: async () => {}, update: async () => {}, add: async () => {},
        },
        saved_notes: { where: () => ({ equals: () => ({ first: async () => null }) }), put: async () => {} },
      }),
    }));
    const { retryCard } = await import('../../src/background/card-lifecycle');
    const MAPPING = { deckName: 'English vocab', modelName: 'Basic', fieldSources: { Front: 'selection' } };
    await retryCard('card-r4', MAPPING as never, undefined as never);
    const req = createCardFromRequest.mock.calls[0][0] as Record<string, unknown>;
    expect(req.identityKey).toBe('run');
    expect(req.surface).toBe('running');
    expect(req.contextGloss).toBe('correr');
    expect(req.phraseLevel).toBe(false);
  });
});
