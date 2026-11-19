/**
 * RED TESTS — audit follow-up, FALLOS B/C and the backfill minor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function installCardStorage(): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} } },
  };
}

function wire(
  notesInfos: Array<{ noteId: number; fields: Record<string, { value: string }>; tags?: string[] }>,
) {
  const addNote = vi.fn(async () => 1);
  const findNotes = vi.fn(async () => [notesInfos[0]?.noteId ?? 4242]);
  const info = vi.fn(async () => notesInfos);
  const addTags = vi.fn(async () => null);
  vi.doMock('../../src/background/anki-connect', () => ({
    ankiConnect: {
      addNote, findNotes, notesInfo: info, addTags,
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
    extractAudioClip: async () => ({ ok: false }),
  }));
  vi.doMock('../../src/background/vip-settings', () => ({
    getVipSettings: async () => ({ enabled: true }),
    loadTranslateTargetLang: async () => 'es',
  }));
  return { addNote, addTags };
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  delete (globalThis as { chrome?: unknown }).chrome;
  installCardStorage();
});

describe('FALLO B — sense from tags, never the first field', () => {
  it('no sense tag + no mapped gloss field: unknown, storedGloss empty (not "run")', async () => {
    wire([{
      noteId: 4242,
      fields: { Word: { value: 'run' }, Back: { value: 'correr' } },
      tags: ['kivara-lingo', 'kivara::lemma::run'],
    }]);
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const mapping = { deckName: 'English vocab', modelName: 'Basic', fieldSources: { Word: 'selection', Back: 'manual', Sentence: 'cue' } };
    const res = await createCardFromRequest({
      token: 'run', sentence: 'Another phrase.', language: 'en', deck: 'English vocab',
      contextGloss: 'correr',
    } as never, mapping as never, undefined as never);
    expect(res.sense).toBe('unknown');
    expect(res.storedGloss).toBeUndefined();
  });

  it('sense tag wins over a mapped gloss field that says something else', async () => {
    wire([{
      noteId: 4242,
      fields: { Word: { value: 'run' }, Bilingual: { value: 'dirigir' } },
      tags: ['kivara-lingo', 'kivara::lemma::run', 'kivara::sense::correr'],
    }]);
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const mapping = { deckName: 'English vocab', modelName: 'Basic', fieldSources: { Word: 'selection', Bilingual: 'bilingual', Sentence: 'cue' } };
    const res = await createCardFromRequest({
      token: 'run', sentence: 'Another phrase.', language: 'en', deck: 'English vocab',
      contextGloss: 'correr',
    } as never, mapping as never, undefined as never);
    expect(res.sense).toBe('same-sense');
    expect(res.storedGloss).toBe('correr');
  });

  it('HTML lists in the mapped gloss field split into semicolon-separated meanings', async () => {
    wire([{
      noteId: 4242,
      fields: { Word: { value: 'run' }, Bilingual: { value: '<ol><li>correr</li><li>dirigir</li></ol>' }, Sentence: { value: 'He runs.' } },
      tags: ['kivara-lingo', 'kivara::lemma::run'],
    }]);
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const mapping = { deckName: 'English vocab', modelName: 'Basic', fieldSources: { Word: 'selection', Bilingual: 'bilingual', Sentence: 'cue' } };
    const res = await createCardFromRequest({
      token: 'run', sentence: 'Another phrase.', language: 'en', deck: 'English vocab',
      contextGloss: 'dirigir',
    } as never, mapping as never, undefined as never);
    expect(res.storedGloss).toBe('correr;dirigir');
    expect(res.sense).toBe('same-sense');
  });
});

describe('FALLO C — no cue field means other-context and no add-scene', () => {
  it('Basic model without cue: other-context and canAddScene:false', async () => {
    wire([{
      noteId: 4242,
      fields: { Front: { value: 'run' }, Back: { value: 'correr' } },
      tags: ['kivara-lingo', 'kivara::lemma::run'],
    }]);
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const mapping = { deckName: 'English vocab', modelName: 'Basic', fieldSources: { Front: 'selection', Back: 'manual' } };
    const res = await createCardFromRequest({
      token: 'run', sentence: 'A completely different phrase.', language: 'en', deck: 'English vocab',
      contextGloss: 'correr',
    } as never, mapping as never, undefined as never);
    expect(res.reused).toBe('other-context');
    expect(res.canAddScene).toBe(false);
  });
});

describe('MINOR — lemma-tag backfill only when the selection field equals the identity', () => {
  it('surface-only hit ("saw" note, lemma "see") is reused but NOT backfilled', async () => {
    const m = wire([{
      noteId: 4242, fields: { Word: { value: 'saw' } }, tags: ['kivara-lingo'],
    }]);
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const mapping = { deckName: 'English vocab', modelName: 'Basic', fieldSources: { Word: 'selection', Sentence: 'cue' } };
    const res = await createCardFromRequest({
      token: 'saw', sentence: 'He saw it.', language: 'en', deck: 'English vocab',
      identityKey: 'see', surface: 'saw',
    } as never, mapping as never, undefined as never);
    expect(res.noteId).toBe(4242);
    expect(m.addTags).not.toHaveBeenCalled();
  });
});
