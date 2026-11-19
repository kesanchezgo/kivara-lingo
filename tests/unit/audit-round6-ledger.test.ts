/**
 * RED TEST — audit round 6, P3: the ledger row written by a fresh add carries
 * the cardId, so a retry with the SAME cardId is the SAME save (row SAVED).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let stored: Record<string, unknown>;

function installCardStorage(): void {
  stored = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const out: Record<string, unknown> = {};
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            if (key in stored) out[key] = stored[key];
          }
          return out;
        },
        set: async (items: Record<string, unknown>) => { Object.assign(stored, items); },
      },
    },
  };
}

function rows(): Array<{ id: string; status: string }> {
  return (stored['kvl:cards.recent'] as Array<{ id: string; status: string }> | undefined) ?? [];
}

const MAPPING = {
  deckName: 'English vocab', modelName: 'Basic',
  fieldSources: { Front: 'selection', Sentence: 'cue' },
};

function setupMocks(opts: {
  findNotesImpl?: (query: string) => number[];
  notesInfos?: Array<{ noteId: number; fields: Record<string, { value: string }>; tags?: string[] }>;
} = {}) {
  const addNote = vi.fn(async () => 777);
  const findNotes = vi.fn(async (query: string) => opts.findNotesImpl?.(query) ?? []);
  const notesInfo = vi.fn(async () => opts.notesInfos ?? []);
  vi.doMock('../../src/background/anki-connect', () => ({
    ankiConnect: {
      addNote, findNotes, notesInfo, addTags: vi.fn(async () => null),
      storeMediaFile: vi.fn(async (f: string) => f),
    },
    dataUrlToBase64: (s: string) => s,
    AnkiConnectError: class extends Error {},
  }));
  const ledger = new Map<string, { ankiNoteId: number; cardId?: string; token: string; language: string; sentence: string; deckName: string }>();
  vi.doMock('../../src/shared/db', async (importOriginal: () => Promise<unknown>) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    const cache = { get: async () => { throw new Error('no db'); }, put: async () => {} };
    return { ...(actual as object), getDB: () => ({
      saved_notes: {
        where: (idx: string) => ({
          equals: (v: unknown) => ({
            first: async () => {
              for (const row of ledger.values()) {
                if (idx === 'ankiNoteId' && row.ankiNoteId === v) return row;
                if (Array.isArray(v)
                  && row.token === v[0] && row.language === v[1]
                  && row.sentence === v[2] && row.deckName === v[3]) return row;
              }
              return null;
            },
          }),
        }),
        put: async (row: { token: string; language: string; sentence: string; deckName: string; ankiNoteId: number }) => {
          ledger.set(`${row.token}|${row.language}|${row.sentence}|${row.deckName}`, row);
        },
      },
      pending_notes: { add: async () => {}, update: async () => {}, delete: async () => {} },
      translation_cache: cache, media_cache: cache, ai_cache: cache,
    }) };
  });
  vi.doMock('../../src/background/translate', async (importOriginal: () => Promise<unknown>) => ({
    ...((await importOriginal()) as object),
    translateToken: async (token: string) => ({ token, type: 'word', translation: 'correr' }),
    translateText: async () => ({ ok: false }),
  }));
  vi.doMock('../../src/background/ai-enrich', async (importOriginal: () => Promise<unknown>) => ({
    ...((await importOriginal()) as object),
    getAiSettings: async () => ({ provider: 'disabled', enrichOnSave: false }),
    getResolvedNativeLang: async () => 'es',
    enrichWithAi: async () => ({ ok: false }),
  }));
  vi.doMock('../../src/background/enrichment/orchestrator', () => ({ runEnrichment: async () => ({ entry: null }) }));
  vi.doMock('../../src/background/tts', () => ({ generateTtsAudio: async () => ({ ok: false }) }));
  vi.doMock('../../src/background/audio-capture-manager', () => ({
    getAudioCaptureStatus: async () => ({ active: false }),
    extractAudioClip: async () => ({ ok: false }),
  }));
  vi.doMock('../../src/background/vip-settings', () => ({
    getVipSettings: async () => ({ enabled: true }),
    loadTranslateTargetLang: async () => 'es',
  }));
  return { addNote, ledger };
}

const BASE_REQ = {
  token: 'run', identityKey: 'run', surface: 'run',
  sentence: 'She runs it.', language: 'en', deck: 'English vocab',
};

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  delete (globalThis as { chrome?: unknown }).chrome;
  installCardStorage();
});

describe('P3 — the ledger records the cardId that CREATED the note', () => {
  it('fresh add → retry with the same cardId → row SAVED (not removed)', async () => {
    let lookups = 0;
    const m = setupMocks({ findNotesImpl: () => (lookups++ === 0 ? [] : [4242]) });
    // The SW registers the row BEFORE sending — production row builder.
    const { cardRegistry } = await import('../../src/background/card-registry');
    const { newRecentCard } = await import('../../src/shared/cards');
    await cardRegistry.put(newRecentCard({
      id: 'card-own', word: 'run', sentence: 'She runs it.',
      kind: 'word', deck: 'English vocab', lang: 'en', tags: ['kivara-lingo'],
    }));
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const req = { ...BASE_REQ, cardId: 'card-own' };
    const first = await createCardFromRequest(req as never, MAPPING as never, undefined as never);
    expect(first.ok).toBe(true);
    // The ledger row written by the fresh add carries THIS cardId.
    const ledgerRow = [...m.ledger.values()][0];
    expect(ledgerRow.cardId).toBe('card-own');
    // A retry with the same cardId is the SAME save: the row is SAVED.
    const second = await createCardFromRequest(req as never, MAPPING as never, undefined as never, { fromRetry: true });
    expect(second.reused).toBeUndefined();
    const row = rows().find((r) => r.id === 'card-own');
    expect(row?.status).toBe('saved');
  });
});
