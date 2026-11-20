/**
 * RED TEST — audit round 7, P6: a whole-line (phraseLevel) save owns its
 * note — the background IGNORES a legacy word identity, and the SAME line
 * dedups to same-context by the exact selection field.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  vi.doMock('../../src/shared/db', async (importOriginal: () => Promise<unknown>) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    const cache = { get: async () => { throw new Error('no db'); }, put: async () => {} };
    return { ...(actual as object), getDB: () => ({
      saved_notes: { where: () => ({ equals: () => ({ first: async () => null }) }), put: async () => {} },
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
    extractAudioClip: vi.fn(async () => ({ ok: false })),
  }));
  vi.doMock('../../src/background/vip-settings', () => ({
    getVipSettings: async () => ({ enabled: true }),
    loadTranslateTargetLang: async () => 'es',
  }));
  return { addNote };
}

const MAPPING = {
  deckName: 'English vocab', modelName: 'Basic',
  fieldSources: { Front: 'selection', Sentence: 'cue' },
};

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  delete (globalThis as { chrome?: unknown }).chrome;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} } },
  };
});

describe('P6 — a whole-line save owns its note (identity ignored)', () => {
  it('"Running" line with a "run" note present: identity IGNORED, addNote 1', async () => {
    const m = setupMocks({
      // The quoted clauses make the match exact: lemma::run" does NOT hit
      // lemma::running".
      findNotesImpl: (q: string) => (/(lemma::run"|Front:run")/.test(q) ? [4242] : []),
      notesInfos: [{
        noteId: 4242, fields: { Front: { value: 'run' }, Sentence: { value: 'He runs.' } },
        tags: ['kivara-lingo', 'kivara::lemma::run'],
      }],
    });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const res = await createCardFromRequest({
      token: 'Running', sentence: 'Running', phraseLevel: true,
      // Legacy callers may still send the word identity — the background must
      // IGNORE it for a phrase-level save.
      identityKey: 'run', surface: 'run',
      language: 'en', deck: 'English vocab',
    } as never, MAPPING as never, undefined as never);
    expect(res.reused).toBeUndefined();
    expect(m.addNote).toHaveBeenCalledTimes(1);
    const addedCall = m.addNote.mock.calls[0] as unknown as [{ tags?: string[] }] | undefined;
    const tags: string[] = addedCall?.[0]?.tags ?? [];
    expect(tags.some((t) => t.startsWith('kivara::lemma::'))).toBe(false);
  });

  it('the SAME line twice → reused same-context (exact selection field)', async () => {
    let lookups = 0;
    setupMocks({
      findNotesImpl: () => (lookups++ === 0 ? [] : [4242]),
      notesInfos: [{
        noteId: 4242, fields: { Front: { value: 'Running' }, Sentence: { value: 'Running' } },
        tags: ['kivara-lingo'],
      }],
    });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const req = { token: 'Running', sentence: 'Running', phraseLevel: true, language: 'en', deck: 'English vocab' };
    await createCardFromRequest(req as never, MAPPING as never, undefined as never);
    const second = await createCardFromRequest(req as never, MAPPING as never, undefined as never);
    expect(second.reused).toBe('same-context');
  });
});
