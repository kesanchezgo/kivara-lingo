/**
 * F4 CREATE_CARD v2 (docs/REDESIGN-V2.md §7 F4).
 *
 * The engine keeps its idempotency and retry queue; this covers the new
 * payload: kind, language, per-language deck, MediaInfo tags, cloze and the
 * `source` field, plus the retryable/queued envelope the registry reads.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

class FakeAnkiError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'AnkiConnectError';
  }
}

function setupMocks(addNoteImpl?: () => Promise<number>) {
  const addNote = vi.fn(addNoteImpl ?? (async () => 123));
  const findNotes = vi.fn(async () => [] as number[]);
  const notesInfo = vi.fn(async () => [] as Array<{ noteId: number; fields: Record<string, { value: string }> }>);
  const storeMediaFile = vi.fn(async (filename: string) => filename);
  const pendingAdd = vi.fn(async () => undefined);

  vi.doMock('../../src/background/anki-connect', () => ({
    ankiConnect: { addNote, findNotes, notesInfo, storeMediaFile },
    dataUrlToBase64: (s: string) => s,
    AnkiConnectError: FakeAnkiError,
  }));
  vi.doMock('../../src/shared/db', () => ({
    getDB: () => ({
      saved_notes: {
        where: () => ({ equals: () => ({ first: async () => null }) }),
        put: async () => undefined,
      },
      pending_notes: {
        add: pendingAdd,
        update: async () => undefined,
        delete: async () => undefined,
      },
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
  vi.doMock('../../src/background/cue-window', () => ({
    computeCueWindow: () => ({ start: 0, end: 0, cueEndInFuture: false }),
    shouldFallbackToTts: () => true,
    waitForCueTailMs: () => 0,
  }));
  vi.doMock('../../src/shared/net-guard', () => ({
    fetchMediaWithLimits: async () => {
      throw new Error('offline');
    },
    mediaExtFor: () => 'jpg',
  }));

  return { addNote, pendingAdd };
}

const MAPPING = {
  ankiUrl: 'http://127.0.0.1:8765',
  deckName: 'Legacy deck',
  modelName: 'Basic',
  fieldSources: {
    Front: 'selection',
    Sentence: 'cue',
    Cloze: 'cloze',
    Origin: 'source',
  },
} as const;

const MEDIA = {
  platform: 'hbo' as const,
  title: 'Winter is Coming',
  series: 'Game of Thrones',
  season: 1,
  episode: 2,
  url: 'https://play.hbomax.com/x',
};

beforeEach(() => {
  vi.resetModules();
});

describe('CREATE_CARD v2 payload', () => {
  it('uses the per-language deck, hierarchical tags, cloze and source', async () => {
    const m = setupMocks();
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const res = await createCardFromRequest({
      token: 'sane',
      sentence: 'It keeps her sane.',
      kind: 'cloze',
      lang: 'en',
      deck: 'English vocabulary',
      media: MEDIA,
    }, MAPPING as never, undefined as never);

    expect(res.ok).toBe(true);
    const note = (m.addNote.mock.calls as unknown as Array<[{
      deckName: string;
      tags: string[];
      fields: Record<string, string>;
    }]>)[0][0];
    expect(note.deckName).toBe('English vocabulary');
    expect(note.tags).toEqual([
      'kivara::lang::en',
      'kivara::platform::hbo_max',
      'kivara::game_of_thrones::s01e02',
      'kivara::cloze',
      'kivara-lingo',
    ]);
    expect(note.fields.Cloze).toContain('<b>sane</b>');
    expect(note.fields.Origin).toBe('Game of Thrones · S1 E2 · HBO Max');
  });

  it('infers expression for a multi-word token and honours an explicit cloze', async () => {
    const m = setupMocks();
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    await createCardFromRequest({
      token: 'look up',
      sentence: 'Maybe we should look up flights.',
      lang: 'en',
      deck: 'English vocabulary',
      cloze: 'Maybe we should [look up] flights.',
    }, MAPPING as never, undefined as never);

    const note = (m.addNote.mock.calls as unknown as Array<[{
      tags: string[];
      fields: Record<string, string>;
    }]>)[0][0];
    expect(note.tags).toContain('kivara::expression');
    expect(note.tags).toContain('kivara-lingo');
    expect(note.fields.Cloze).toBe('Maybe we should [look up] flights.');
  });

  it('falls back to the legacy deckName and language spelling', async () => {
    const m = setupMocks();
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    await createCardFromRequest({
      token: 'sane',
      sentence: 'It keeps her sane.',
      language: 'en',
    }, MAPPING as never, undefined as never);

    const note = (m.addNote.mock.calls as unknown as Array<[{
      deckName: string;
      tags: string[];
    }]>)[0][0];
    expect(note.deckName).toBe('Legacy deck');
    expect(note.tags).toContain('kivara::lang::en');
    expect(note.tags).toContain('kivara-lingo');
  });

  it('queues a transport failure and reports queued in the envelope', async () => {
    const m = setupMocks(async () => {
      throw new FakeAnkiError('Anki is closed', 'NETWORK');
    });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const res = await createCardFromRequest({
      token: 'sane',
      sentence: 'It keeps her sane.',
      kind: 'word',
      lang: 'en',
      deck: 'English vocabulary',
      cardId: 'card-1',
      media: MEDIA,
    }, MAPPING as never, undefined as never);

    expect(res).toMatchObject({ ok: false, queued: true });
    const row = (m.pendingAdd.mock.calls as unknown as Array<[{
      request: { cardId: string; deck: string; lang: string; kind: string };
    }]>)[0][0];
    expect(row.request).toMatchObject({
      cardId: 'card-1',
      deck: 'English vocabulary',
      lang: 'en',
      kind: 'word',
    });
  });

  it('marks a permanent failure as not queued', async () => {
    setupMocks(async () => {
      throw new FakeAnkiError('API key is invalid', 'API_KEY');
    });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const res = await createCardFromRequest({
      token: 'sane',
      sentence: 'It keeps her sane.',
      lang: 'en',
      deck: 'English vocabulary',
    }, MAPPING as never, undefined as never);
    expect(res).toMatchObject({ ok: false, queued: false });
  });
});
