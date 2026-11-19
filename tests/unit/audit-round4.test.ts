/**
 * RED TESTS — audit round 4, PR A (save/undo/retry safety).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { classifySense } from '../../src/shared/word-identity';
import { autoMapFields } from '../../src/shared/anki-field-detect';

interface StoredRow {
  id: string;
  word: string;
  sentence: string;
  status: string;
  kind: string;
  deck: string;
  lang: string;
  createdAt: number;
  attempts: number;
  tags: string[];
  noteId?: number;
  [k: string]: unknown;
}

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

function rows(): StoredRow[] {
  return (stored['kvl:cards.recent'] as StoredRow[] | undefined) ?? [];
}

function seedRow(overrides: Partial<StoredRow>): void {
  const row: StoredRow = {
    id: 'card-x', word: 'run', sentence: 'She runs it.', status: 'sending',
    kind: 'word', deck: 'English vocab', lang: 'en', createdAt: Date.now(),
    attempts: 0, tags: ['kivara-lingo'], ...overrides,
  };
  stored['kvl:cards.recent'] = [...rows().filter((r) => r.id !== row.id), row];
}

function setupMocks(opts: {
  findNotesIds?: number[];
  notesInfos?: Array<{ noteId: number; fields: Record<string, { value: string }>; tags?: string[] }>;
  ledgerRow?: { ankiNoteId: number; cardId?: string; token?: string; sentence?: string; deckName?: string };
} = {}) {
  const addNote = vi.fn(async (_note: { tags?: string[] }) => 777);
  const findNotes = vi.fn(async () => opts.findNotesIds ?? []);
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
    const lr = opts.ledgerRow;
    return { ...(actual as object), getDB: () => ({
      saved_notes: {
        where: (idx: string) => ({
          equals: (v: unknown) => ({
            first: async () => {
              if (!lr) return null;
              if (idx === 'ankiNoteId') return lr.ankiNoteId === v ? lr : null;
              if (Array.isArray(v)) {
                return (lr.token === v[0] && lr.sentence === v[2] && lr.deckName === v[3]) ? lr : null;
              }
              return null;
            },
          }),
        }),
        put: async () => {},
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
  return { addNote };
}

const MAPPING = {
  deckName: 'English vocab', modelName: 'Basic',
  fieldSources: { Front: 'selection', Translation: 'bilingual', Sentence: 'cue' },
};

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

describe('A1 — a reused save leaves NO registry row', () => {
  it('the pre-inserted row is removed when the note is reused', async () => {
    seedRow({ id: 'card-r1', status: 'sending' });
    const m = setupMocks({
      findNotesIds: [4242],
      notesInfos: [{
        noteId: 4242, fields: { Front: { value: 'run' }, Sentence: { value: 'An old sentence.' } },
        tags: ['kivara-lingo', 'kivara::lemma::run'],
      }],
    });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const res = await createCardFromRequest(
      { ...BASE_REQ, cardId: 'card-r1' } as never, MAPPING as never, undefined as never,
    );
    expect(res.reused).toBe('other-context');
    expect(rows().find((r) => r.id === 'card-r1')).toBeUndefined();
    expect(m.addNote).not.toHaveBeenCalled();
  });
});

describe('A2/A3 — a retried card that only REUSED a note is never marked saved', () => {
  it('reuse → retry → no saved row for that cardId, no addNote', async () => {
    seedRow({ id: 'card-r2', status: 'sending' });
    const m = setupMocks({
      findNotesIds: [4242],
      notesInfos: [{
        noteId: 4242, fields: { Front: { value: 'run' }, Sentence: { value: 'An old sentence.' } },
        tags: ['kivara-lingo', 'kivara::lemma::run'],
      }],
    });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const req = { ...BASE_REQ, cardId: 'card-r2' };
    await createCardFromRequest(req as never, MAPPING as never, undefined as never);
    const res2 = await createCardFromRequest(req as never, MAPPING as never, undefined as never, { fromRetry: true });
    expect(res2.reused).toBeDefined();
    expect(m.addNote).not.toHaveBeenCalled();
    const row = rows().find((r) => r.id === 'card-r2');
    expect(row?.status).not.toBe('saved');
    expect(row).toBeUndefined();
  });

  it('retry other-context via the identity query does not addNote', async () => {
    const m = setupMocks({
      findNotesIds: [4242],
      notesInfos: [{
        noteId: 4242, fields: { Front: { value: 'run' }, Sentence: { value: 'He runs every day.' } },
        tags: ['kivara-lingo', 'kivara::lemma::run'],
      }],
    });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const res = await createCardFromRequest(
      { ...BASE_REQ, sentence: 'A completely different phrase.', cardId: 'card-r3' } as never,
      MAPPING as never, undefined as never, { fromRetry: true },
    );
    expect(res.reused).toBe('other-context');
    expect(m.addNote).not.toHaveBeenCalled();
    expect(rows().find((r) => r.id === 'card-r3')).toBeUndefined();
  });

describe('A3 — the ledger proves creation by THIS cardId', () => {
  it('a ledger row for another cardId means reused, not saved', async () => {
    const m = setupMocks({
      findNotesIds: [4242],
      notesInfos: [{
        noteId: 4242, fields: { Front: { value: 'run' }, Sentence: { value: 'She runs it.' } },
        tags: ['kivara-lingo', 'kivara::lemma::run'],
      }],
      ledgerRow: { ankiNoteId: 4242, cardId: 'other-card', token: 'run', sentence: 'She runs it.', deckName: 'English vocab' },
    });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const res = await createCardFromRequest(
      { ...BASE_REQ, cardId: 'card-mine' } as never, MAPPING as never, undefined as never, { fromRetry: true },
    );
    expect(res.reused).toBeDefined();
    expect(m.addNote).not.toHaveBeenCalled();
    expect(rows().find((r) => r.id === 'card-mine')).toBeUndefined();
  });

  it('a ledger row for THIS cardId is still a legitimate save (Undo stays)', async () => {
    const m = setupMocks({
      ledgerRow: { ankiNoteId: 98765, cardId: 'card-mine', token: 'hola', sentence: 'Hola mundo.', deckName: 'Spanish vocab' },
    });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const res = await createCardFromRequest(
      { token: 'hola', sentence: 'Hola mundo.', language: 'es', deck: 'Spanish vocab', cardId: 'card-mine' } as never,
      { deckName: 'Spanish vocab', modelName: 'Basic', fieldSources: { Front: 'selection' } } as never,
      undefined as never, { fromRetry: true },
    );
    expect(res.reused).toBeUndefined();
    expect(res.noteId).toBe(98765);
    expect(m.addNote).not.toHaveBeenCalled();
  });
});

describe('A5 — forceNewSense allows the duplicate on retry', () => {
  it('a forced retry with only a different-sense note present CREATES', async () => {
    const m = setupMocks({
      findNotesIds: [4242],
      notesInfos: [{
        noteId: 4242, fields: { Front: { value: 'run' }, Sentence: { value: 'She runs it.' } },
        tags: ['kivara-lingo', 'kivara::lemma::run', 'kivara::sense::correr'],
      }],
    });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const res = await createCardFromRequest({
      ...BASE_REQ, contextGloss: 'dirigir', forceNewSense: true, allowDuplicate: true, cardId: 'card-f1',
    } as never, MAPPING as never, undefined as never, { fromRetry: true });
    expect(m.addNote).toHaveBeenCalledTimes(1);
    const tags: string[] = m.addNote.mock.calls[0][0]?.tags ?? [];
    expect(tags).toContain('kivara::lemma::run');
    expect(tags).toContain('kivara::sense::dirigir');
    expect(res.reused).toBeUndefined();
  });
});

describe('A6 — sense reading: bilingual field only, normalized glosses', () => {
  it('classifySense ignores (v.)/(n.), HTML and entities', () => {
    expect(classifySense('correr', '(v.) correr')).toBe('same-sense');
    expect(classifySense('correr', '<b>correr</b> &amp; trotar')).toBe('same-sense');
    expect(classifySense('correr', '(n.) carrera')).toBe('new-sense');
  });

  it('an automapped KivaraLingo model never reads the sentence translation as the sense', async () => {
    const m = setupMocks({
      findNotesIds: [4242],
      notesInfos: [{
        noteId: 4242,
        fields: {
          Word: { value: 'run' },
          Sentence: { value: 'She runs it.' },
          'Sentence Translation': { value: 'to run the company' },
        },
        tags: ['kivara-lingo', 'kivara::lemma::run'],
      }],
    });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const mapping = {
      deckName: 'English vocab', modelName: 'KivaraLingo',
      fieldSources: autoMapFields(['Word', 'Sentence', 'Sentence Translation']),
    };
    const res = await createCardFromRequest({
      token: 'run', sentence: 'A different sentence.', language: 'en', deck: 'English vocab',
      contextGloss: 'correr',
    } as never, mapping as never, undefined as never);
    expect(res.sense).toBe('unknown');
    expect(res.storedGloss).toBeUndefined();
    expect(m.addNote).not.toHaveBeenCalled();
  });

  it('a field mapped translation/translate is NOT a gloss field', async () => {
    const m = setupMocks({
      findNotesIds: [4242],
      notesInfos: [{
        noteId: 4242,
        fields: { Front: { value: 'run' }, Translation: { value: 'correr' }, Sentence: { value: 'She runs it.' } },
        tags: ['kivara-lingo', 'kivara::lemma::run'],
      }],
    });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const mapping = {
      deckName: 'English vocab', modelName: 'Basic',
      fieldSources: { Front: 'selection', Translation: 'translation', Sentence: 'cue' },
    };
    const res = await createCardFromRequest({
      token: 'run', sentence: 'Another sentence.', language: 'en', deck: 'English vocab',
      contextGloss: 'correr',
    } as never, mapping as never, undefined as never);
    expect(res.sense).toBe('unknown');
    expect(m.addNote).not.toHaveBeenCalled();
  });
});
});
