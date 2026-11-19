/**
 * RED TESTS — audit follow-up, FALLO A (P2).
 *
 * "Crear tarjeta para este significado" must be an explicit, one-shot create:
 * with a pre-existing lemma note present, forceNewSense WITHOUT a gloss must
 * still create a fresh note; with a gloss it creates a note tagged with both
 * the lemma and that meaning when only a DIFFERENT sense is on file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function installCardStorage(): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} } },
  };
}

function setupMocks() {
  const addNote = vi.fn(async (_note: { tags?: string[] }) => 777);
  const findNotes = vi.fn(async () => [4242]);
  const notesInfo = vi.fn(async () => [{
    noteId: 4242,
    fields: { Word: { value: 'run' }, Bilingual: { value: 'correr' } },
    tags: ['kivara-lingo', 'kivara::lemma::run', 'kivara::sense::correr'],
  }]);
  const addTags = vi.fn(async () => null);
  const storeMediaFile = vi.fn(async (f: string) => f);
  vi.doMock('../../src/background/anki-connect', () => ({
    ankiConnect: { addNote, findNotes, notesInfo, addTags, storeMediaFile },
    dataUrlToBase64: (s: string) => s,
    AnkiConnectError: class extends Error {},
  }));
  vi.doMock('../../src/shared/db', async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    const cache = { get: async () => { throw new Error('no db'); }, put: async () => {} };
    return {
      ...(actual as object),
      getDB: () => ({
        saved_notes: { where: () => ({ equals: () => ({ first: async () => null }) }), put: async () => {} },
        pending_notes: { add: async () => {}, update: async () => {}, delete: async () => {} },
        translation_cache: cache, media_cache: cache, ai_cache: cache,
      }),
    };
  });
  vi.doMock('../../src/background/translate', async (importOriginal) => ({
    ...((await importOriginal()) as object),
    translateToken: async (token: string) => ({ token, type: 'word', translation: 'correr' }),
    translateText: async () => ({ ok: false, error: 'no network' }),
  }));
  vi.doMock('../../src/background/ai-enrich', async (importOriginal) => ({
    ...((await importOriginal()) as object),
    getAiSettings: async () => ({ provider: 'disabled', enrichOnSave: false }),
    getResolvedNativeLang: async () => 'es',
    enrichWithAi: async () => ({ ok: false, error: 'disabled' }),
  }));
  vi.doMock('../../src/background/enrichment/orchestrator', () => ({ runEnrichment: async () => ({ entry: null }) }));
  vi.doMock('../../src/background/tts', () => ({ generateTtsAudio: async () => ({ ok: false }) }));
  vi.doMock('../../src/background/audio-capture-manager', () => ({
    getAudioCaptureStatus: async () => ({ active: false }),
    extractAudioClip: async () => ({ ok: false }),
  }));
  vi.doMock('../../src/background/vip-settings', () => ({
    getVipSettings: async () => ({ enabled: true, youglish: true }),
    loadTranslateTargetLang: async () => 'es',
  }));
  return { addNote, findNotes, notesInfo };
}

const MAPPING = {
  deckName: 'English vocab', modelName: 'Basic',
  fieldSources: { Word: 'selection', Bilingual: 'bilingual', Sentence: 'cue' },
};

describe('FALLO A — forceNewSense is an explicit create', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    delete (globalThis as { chrome?: unknown }).chrome;
    installCardStorage();
  });

  it('no contextGloss + pre-existing lemma note: CREATES (addNote 1, no reused)', async () => {
    const m = setupMocks();
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const res = await createCardFromRequest({
      token: 'run', identityKey: 'run', surface: 'run',
      sentence: 'She runs the company.', language: 'en', deck: 'English vocab',
      forceNewSense: true,
    } as never, MAPPING as never, undefined as never);
    expect(res.ok).toBe(true);
    expect(res.reused).toBeUndefined();
    expect(m.addNote).toHaveBeenCalledTimes(1);
  });

  it('contextGloss with only a DIFFERENT sense on file: creates lemma+sense tagged note', async () => {
    const m = setupMocks();
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const res = await createCardFromRequest({
      token: 'run', identityKey: 'run', surface: 'run',
      sentence: 'She runs the company.', language: 'en', deck: 'English vocab',
      contextGloss: 'dirigir', forceNewSense: true,
    } as never, MAPPING as never, undefined as never);
    expect(res.reused).toBeUndefined();
    expect(m.addNote).toHaveBeenCalledTimes(1);
    const tags = m.addNote.mock.calls[0][0]?.tags ?? [];
    expect(tags).toContain('kivara::lemma::run');
    expect(tags).toContain('kivara::sense::dirigir');
  });
});
