/**
 * RED TESTS — audit round 5 (PR B: consistency).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { senseTag, lemmaFromTags, lemmaTagVariants } from '../../src/shared/word-identity';
import { buildIdentityNoteQuery } from '../../src/shared/anki-search';

function installCardStorage(): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} } },
  };
}

function setupMocks(opts: {
  findNotesIds?: number[];
  notesInfos?: Array<{ noteId: number; fields: Record<string, { value: string }>; tags?: string[] }>;
} = {}) {
  const addNote = vi.fn(async (_note: { tags?: string[] }) => 777);
  const findNotes = vi.fn(async () => opts.findNotesIds ?? []);
  const notesInfo = vi.fn(async (_ids?: number[]) => opts.notesInfos ?? []);
  vi.doMock('../../src/background/anki-connect', () => ({
    ankiConnect: {
      addNote, findNotes, notesInfo, addTags: vi.fn(async () => null),
      storeMediaFile: vi.fn(async (f: string) => f),
      updateNoteFields: vi.fn(async () => null),
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
  return { addNote, notesInfo };
}

const MAPPING = {
  deckName: 'English vocab', modelName: 'Basic',
  fieldSources: { Front: 'selection', Sentence: 'cue' },
};

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  delete (globalThis as { chrome?: unknown }).chrome;
  installCardStorage();
});

describe('B8 — one htmlToPlain for every normalizer', () => {
  it('decodes ALL entities: named, decimal, hex, quot', async () => {
    const { htmlToPlain } = await import('../../src/shared/anki-text');
    expect(htmlToPlain('<b>Hola&#39;mundo.</b> &quot;fin&quot;&nbsp;&#65;&#x42;'))
      .toBe('Hola\'mundo. "fin" AB');
  });

  it('a sentence stored entity-encoded still classifies as SAME context', async () => {
    setupMocks({
      findNotesIds: [4242],
      notesInfos: [{
        noteId: 4242,
        fields: { Front: { value: 'run' }, Sentence: { value: 'She&#39;s fine.' } },
        tags: ['kivara-lingo', 'kivara::lemma::run'],
      }],
    });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const res = await createCardFromRequest({
      token: 'run', identityKey: 'run', surface: 'run',
      sentence: "She's fine.", language: 'en', deck: 'English vocab',
    } as never, MAPPING as never, undefined as never);
    expect(res.reused).toBe('same-context');
  });

  it('add-scene does NOT duplicate a sentence stored entity-encoded', async () => {
    const updateNoteFields = vi.fn(async () => null);
    vi.doMock('../../src/background/anki-connect', () => ({
      ankiConnect: {
        addNote: vi.fn(async () => 1), findNotes: vi.fn(async () => []),
        findCards: vi.fn(async () => []), cardsInfo: vi.fn(async () => []),
        notesInfo: vi.fn(async () => [{
          noteId: 4242,
          fields: { Front: { value: 'run' }, Sentence: { value: 'She&#39;s fine.' } },
        }]),
        addTags: vi.fn(async () => null), storeMediaFile: vi.fn(async (f: string) => f),
        updateNoteFields,
      },
      dataUrlToBase64: (s: string) => s,
      AnkiConnectError: class extends Error {},
    }));
    const { addContextToNote } = await import('../../src/background/card-actions');
    const res = await addContextToNote({
      noteId: 4242, token: 'run', sentence: "She's fine.",
      deck: 'English vocab',
    } as never, MAPPING as never);
    expect(res.ok).toBe(true);
    expect(updateNoteFields).not.toHaveBeenCalled();
    expect(res.already).toBe(true);
  });
});

describe('B9 — add-scene travels the explicit noteId', () => {
  it('addSceneToNote sends noteId when the context carries one', async () => {
    const sendMessage = vi.fn(
      async (_channel: string, _payload: unknown, _endpoint: string) =>
        ({ ok: true, noteId: 4242 }),
    );
    vi.doMock('webext-bridge/content-script', () => ({ sendMessage }));
    vi.doMock('sonner', () => {
      const toast = vi.fn();
      Object.assign(toast, { custom: vi.fn(), error: vi.fn(), success: vi.fn(), message: vi.fn(), dismiss: vi.fn(), loading: vi.fn() });
      return { toast, Toaster: () => null };
    });
    const { addSceneToNote } = await import('../../src/content/ui/save-actions');
    await addSceneToNote({
      noteId: 4242, token: 'run', sentence: "She's fine.", kind: 'word',
      deck: 'English vocab', tags: ['kivara-lingo'],
    } as never, async () => ({}));
    const call = sendMessage.mock.calls[0] as unknown as [string, Record<string, unknown>, string];
    const payload = call[1];
    expect(payload.noteId).toBe(4242);
  });
});

describe('B10 — multiple matches prefer the same sense, then the same sentence', () => {
  it('picks the note whose sense tag matches the contextual gloss', async () => {
    const allNotes = [
      { noteId: 111, fields: { Front: { value: 'run' }, Sentence: { value: 'A.' } }, tags: ['kivara-lingo', 'kivara::lemma::run', 'kivara::sense::dirigir'] },
      { noteId: 222, fields: { Front: { value: 'run' }, Sentence: { value: 'B.' } }, tags: ['kivara-lingo', 'kivara::lemma::run', 'kivara::sense::correr'] },
    ];
    const m = setupMocks({ findNotesIds: [111, 222], notesInfos: allNotes });
    m.notesInfo.mockImplementation((async (ids: number[]) => allNotes.filter((n) => ids.includes(n.noteId))) as never);
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const res = await createCardFromRequest({
      token: 'run', identityKey: 'run', surface: 'run',
      sentence: 'She runs the company.', language: 'en', deck: 'English vocab',
      contextGloss: 'correr',
    } as never, MAPPING as never, undefined as never);
    expect(res.noteId).toBe(222);
    expect(res.sense).toBe('same-sense');
  });

  it('without a gloss preference, the same sentence wins over found[0]', async () => {
    const allNotes = [
      { noteId: 111, fields: { Front: { value: 'run' }, Sentence: { value: 'Another line.' } }, tags: ['kivara-lingo'] },
      { noteId: 222, fields: { Front: { value: 'run' }, Sentence: { value: 'She runs it.' } }, tags: ['kivara-lingo'] },
    ];
    const m = setupMocks({ findNotesIds: [111, 222], notesInfos: allNotes });
    m.notesInfo.mockImplementation((async (ids: number[]) => allNotes.filter((n) => ids.includes(n.noteId))) as never);
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const res = await createCardFromRequest({
      token: 'run', identityKey: 'run', surface: 'run',
      sentence: 'She runs it.', language: 'en', deck: 'English vocab',
    } as never, MAPPING as never, undefined as never);
    expect(res.noteId).toBe(222);
    expect(res.reused).toBe('same-context');
  });
});

describe('B11 — contextGloss is cleaned at the boundary', () => {
  it('an empty, dash or em-dash gloss adds NO sense tag and echoes nothing', async () => {
    const m = setupMocks({ findNotesIds: [] });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    for (const gloss of ['', '—', '-']) {
      const res = await createCardFromRequest({
        token: 'run', identityKey: 'run', surface: 'run',
        sentence: 'She runs it.', language: 'en', deck: 'English vocab',
        contextGloss: gloss || undefined,
      } as never, MAPPING as never, undefined as never);
      expect(res.contextGloss).toBeUndefined();
    }
    for (const call of m.addNote.mock.calls) {
      const tags: string[] = call[0]?.tags ?? [];
      expect(tags.some((t) => t.startsWith('kivara::sense::'))).toBe(false);
    }
  });
});

describe('B12 — lemma tags: one helper, both variants, quoted clause', () => {
  it('lemmaFromTags decodes the tag to the spaced key', () => {
    expect(lemmaFromTags(['kivara::lemma::thank-you'])).toBe('thank you');
    expect(lemmaFromTags(['kivara::lemma::run'])).toBe('run');
    expect(lemmaFromTags([])).toBeNull();
  });

  it('lemmaTagVariants returns BOTH the spaced and the hyphenated form', () => {
    expect(lemmaTagVariants('thank you')).toContain('thank-you');
    expect(lemmaTagVariants('thank-you')).toContain('thank you');
    expect(lemmaTagVariants('run')).toEqual(['run']);
  });

  it('senseTag strips quotes from glosses', () => {
    expect(senseTag('"correr"')).toBe(senseTag('correr'));
    expect(senseTag('“correr”')).toBe(senseTag('correr'));
  });

  it('the identity query quotes the tag clause', () => {
    const q = buildIdentityNoteQuery({
      deckName: 'D', fieldName: 'Front', identityKey: 'run', surface: 'run',
    });
    expect(q).toContain('"tag:kivara::lemma::run"');
  });

  it('wordIntervals registers ONE canonical key per hyphenated lemma (round 6 P7)', async () => {
    vi.doMock('../../src/background/anki-connect', () => ({
      ankiConnect: {
        findNotes: vi.fn(async () => [1]),
        notesInfo: vi.fn(async () => [{
          noteId: 1, cards: [5, 6],
          fields: { Front: { value: 'thank you' } },
          tags: ['kivara::lemma::thank-you'],
        }]),
        findCards: vi.fn(async () => [5]),
        addNote: vi.fn(async () => 1), addTags: vi.fn(async () => null),
        storeMediaFile: vi.fn(async (f: string) => f), updateNoteFields: vi.fn(async () => null),
        cardsInfo: vi.fn(async () => []),
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
    const { wordIntervals } = await import('../../src/background/card-actions');
    const res = await wordIntervals('English vocab', 'Front', MAPPING as never);
    const words = (res as { words?: Record<string, number> }).words ?? {};
    // Round 6 P7: ONE canonical key — the variants resolve at LOOKUP time.
    expect(Object.keys(words)).toEqual(['thank you']);
    expect(Object.keys(words)).not.toContain('thank-you');
  });
});

describe('B13 — resolveContextGloss uses the light LOCAL message', () => {
  it('calls RESOLVE_WORD_LOCAL, never RESOLVE_WORD, and clears the timer', async () => {
    const sendMessage = vi.fn(
      async (_channel: string, _payload: unknown, _endpoint: string) =>
        ({ ok: true, entry: { token: 'run', type: 'word', translation: 'dirigir' } }),
    );
    vi.doMock('webext-bridge/content-script', () => ({ sendMessage }));
    vi.doMock('../../src/content/nlp/dictionary', () => ({
      lookupDictionary: vi.fn(() => ({ token: 'run', type: 'word', translation: 'correr' })),
    }));
    const { resolveContextGloss } = await import('../../src/content/resolve-context-gloss');
    await expect(resolveContextGloss('run', 'She runs.', 'en')).resolves.toEqual({ gloss: 'dirigir' });
    const called = sendMessage.mock.calls.map((c) => c[0]);
    expect(called).toContain('RESOLVE_WORD_LOCAL');
    expect(called).not.toContain('RESOLVE_WORD');
  });
});

describe('B14 — a Create click during a busy save is never lost', () => {
  it('tasks queued while the gate is closed run serially once it opens', async () => {
    const { createSaveGate } = await import('../../src/content/ui/save-gate');
    const order: string[] = [];
    let release!: () => void;
    const first = new Promise<void>((r) => { release = r; });
    const gate = createSaveGate();
    gate.push(async () => { order.push('first'); await first; });
    gate.push(async () => { order.push('second'); });
    // Nothing runs while the gate is closed (a save is in flight).
    expect(gate.size()).toBe(2);
    expect(order).toEqual([]);
    release();
    gate.open();
    await vi.waitFor(() => expect(order).toEqual(['first', 'second']));
  });
});
