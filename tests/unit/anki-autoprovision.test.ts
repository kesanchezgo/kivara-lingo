/**
 * RED TESTS — round 11: Anki auto-provisioning.
 *
 * A fresh Anki has no custom decks and no KivaraLingo model. Saving into a
 * deck the user typed in the wizard used to die with "deck was not found"
 * forever (classified anki-error, never queued), and the bespoke card preview
 * silently degraded to Basic. Now the save creates what it needs, once, and
 * only on failure: 0 extra calls when the deck/model already exists.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

class FakeAnkiError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'AnkiConnectError';
  }
}

/** The 9 standard KivaraLingo fields (CardsTab FALLBACK_FIELDS order). */
const FIELDS_9 = [
  'word', 'phonetic', 'sentence', 'translation', 'bilingual',
  'monolingual', 'picture', 'sentence audio', 'word audio',
];

function setupMocks(opts: {
  addNoteImpl?: (attempt: number) => Promise<number>;
  modelNames?: string[];
} = {}) {
  let attempts = 0;
  const addNote = vi.fn(async () => {
    attempts += 1;
    return opts.addNoteImpl ? opts.addNoteImpl(attempts) : 123;
  });
  const createDeck = vi.fn(async () => 1700000000000);
  const createModel = vi.fn(async () => null);
  const modelNames = vi.fn(async () => opts.modelNames ?? []);
  const findNotes = vi.fn(async () => [] as number[]);
  const notesInfo = vi.fn(async () => []);
  const storeMediaFile = vi.fn(async (filename: string) => filename);
  const pendingAdd = vi.fn(async () => undefined);

  vi.doMock('../../src/background/anki-connect', () => ({
    ankiConnect: { addNote, createDeck, createModel, modelNames, findNotes, notesInfo, storeMediaFile },
    dataUrlToBase64: (s: string) => s,
    AnkiConnectError: FakeAnkiError,
  }));
  vi.doMock('../../src/shared/db', () => ({
    getDB: () => ({
      saved_notes: {
        where: () => ({ equals: () => ({ first: async () => null }) }),
        put: async () => undefined,
      },
      pending_notes: { add: pendingAdd, update: async () => undefined, delete: async () => undefined },
      translation_cache: { get: async () => undefined, put: async () => undefined },
      media_cache: { get: async () => undefined, put: async () => undefined },
      ai_cache: { get: async () => undefined, put: async () => undefined },
    }),
  }));
  vi.doMock('../../src/background/translate', () => ({
    translateToken: async (token: string) => ({ token, type: 'word', translation: 'cuerdo' }),
    translateText: async () => ({ ok: false, error: 'offline' }),
  }));
  vi.doMock('../../src/background/ai-enrich', () => ({
    getAiSettings: async () => ({ provider: 'disabled', enrichOnSave: false }),
    getResolvedNativeLang: async () => 'es',
    enrichWithAi: async () => ({ ok: false, error: 'disabled' }),
  }));
  vi.doMock('../../src/background/enrichment/orchestrator', () => ({
    runEnrichment: async () => ({ entry: null }),
  }));
  vi.doMock('../../src/background/tts', () => ({
    generateTtsAudio: async () => ({ ok: false, error: 'disabled' }),
  }));
  vi.doMock('../../src/background/audio-capture-manager', () => ({
    getAudioCaptureStatus: async () => ({ active: false }),
    extractAudioClip: async () => ({ ok: false }),
  }));
  vi.doMock('../../src/background/vip-settings', () => ({
    getVipSettings: async () => ({ enabled: false }),
    loadTranslateTargetLang: async () => 'es',
  }));
  vi.doMock('../../src/background/phonetic-augment', () => ({
    getMissingPhonetic: async () => '',
  }));
  vi.doMock('../../src/shared/net-guard', () => ({
    fetchMediaWithLimits: async () => { throw new Error('offline'); },
    mediaExtFor: () => 'jpg',
  }));

  return { addNote, createDeck, createModel, modelNames, pendingAdd };
}

const MAPPING = {
  ankiUrl: 'http://127.0.0.1:8765',
  deckName: 'Legacy deck',
  modelName: 'Basic',
  fieldSources: { Front: 'selection', Sentence: 'cue' },
} as const;

const REQUEST = {
  token: 'sane',
  sentence: 'It keeps her sane.',
  kind: 'word',
  lang: 'en',
  deck: 'English vocabulary',
} as const;

beforeEach(() => {
  vi.resetModules();
});

describe('a save into a deck Anki does not have yet', () => {
  it('creates the deck once and retries the SAME note to success', async () => {
    const m = setupMocks({
      addNoteImpl: (attempt) => attempt === 1
        ? Promise.reject(new FakeAnkiError('deck "English vocabulary" was not found', 'ANKI'))
        : Promise.resolve(4242),
    });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const res = await createCardFromRequest({ ...REQUEST } as never, MAPPING as never, undefined as never);

    expect(res.ok).toBe(true);
    expect(res.noteId).toBe(4242);
    expect(m.createDeck).toHaveBeenCalledTimes(1);
    expect(m.createDeck).toHaveBeenCalledWith('English vocabulary', MAPPING.ankiUrl, undefined);
    expect(m.addNote).toHaveBeenCalledTimes(2);
    expect(m.pendingAdd).not.toHaveBeenCalled();
  });

  it('an existing deck costs ZERO createDeck calls', async () => {
    const m = setupMocks();
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    await createCardFromRequest({ ...REQUEST } as never, MAPPING as never, undefined as never);
    expect(m.addNote).toHaveBeenCalledTimes(1);
    expect(m.createDeck).not.toHaveBeenCalled();
  });

  it('a deck Anki refuses to create surfaces the error, not a fake success', async () => {
    const m = setupMocks({
      addNoteImpl: () => Promise.reject(new FakeAnkiError('deck "X" was not found', 'ANKI')),
    });
    m.createDeck.mockRejectedValue(new FakeAnkiError('cannot create', 'ANKI'));
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const res = await createCardFromRequest({ ...REQUEST } as never, MAPPING as never, undefined as never);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('was not found');
  });
});

describe('the KivaraLingo model', () => {
  it('ensureKivaraModel creates it with the 9 fields and a Front/Back template when missing', async () => {
    const m = setupMocks({ modelNames: [] });
    const { ensureKivaraModel } = await import('../../src/background/anki-model');
    const res = await ensureKivaraModel(MAPPING.ankiUrl, undefined);
    expect(res).toEqual({ ok: true, created: true });
    expect(m.modelNames).toHaveBeenCalledTimes(1);
    expect(m.createModel).toHaveBeenCalledTimes(1);
    const [model] = m.createModel.mock.calls[0] as unknown as [{
      modelName: string;
      inOrderFields: string[];
      cardTemplates: Array<{ Name: string }>;
    }];
    expect(model.modelName).toBe('KivaraLingo');
    expect(model.inOrderFields).toEqual(FIELDS_9);
    expect(model.cardTemplates.map((t) => t.Name).sort()).toEqual(['Back', 'Front']);
  });

  it('is idempotent: an existing KivaraLingo costs ZERO createModel calls', async () => {
    const m = setupMocks({ modelNames: ['KivaraLingo', 'Basic'] });
    const { ensureKivaraModel } = await import('../../src/background/anki-model');
    const res = await ensureKivaraModel(MAPPING.ankiUrl, undefined);
    expect(res).toEqual({ ok: true, created: false });
    expect(m.createModel).not.toHaveBeenCalled();
  });

  it('a save naming a missing KivaraLingo installs the model and retries to success', async () => {
    const m = setupMocks({
      addNoteImpl: (attempt) => attempt === 1
        ? Promise.reject(new FakeAnkiError('model "KivaraLingo" was not found', 'ANKI'))
        : Promise.resolve(777),
    });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const res = await createCardFromRequest(
      { ...REQUEST } as never,
      { ...MAPPING, modelName: 'KivaraLingo' } as never,
      undefined as never,
    );
    expect(res.ok).toBe(true);
    expect(res.noteId).toBe(777);
    expect(m.createModel).toHaveBeenCalledTimes(1);
    expect(m.addNote).toHaveBeenCalledTimes(2);
  });

  it('a missing NON-Kivara model is not silently replaced', async () => {
    const m = setupMocks({
      addNoteImpl: () => Promise.reject(new FakeAnkiError('model "Custom" was not found', 'ANKI')),
    });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const res = await createCardFromRequest(
      { ...REQUEST } as never,
      { ...MAPPING, modelName: 'Custom' } as never,
      undefined as never,
    );
    expect(res.ok).toBe(false);
    expect(m.createModel).not.toHaveBeenCalled();
  });
});
