/**
 * Regression tests for the review chain (e2af3d3 → cd498fe → …):
 *  - shared anki-search escape + exact query shape.
 *  - retry idempotency: a retry whose card already exists (TIMEOUT after
 *    a successful server-side add) must NOT call addNote again.
 *  - ORDER: the check runs before any provider call or media upload.
 *  - SAME WORD, DIFFERENT SENTENCE: must be a NEW card, never a dedup hit.
 *  - HTML cue fields are compared after normalization, not raw.
 *  - retry carries request.audio (content-script clip) instead of TTS.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { escapeAnkiSearchTerm, buildExactNoteQuery } from '../../src/shared/anki-search';

describe('shared anki-search helpers', () => {
  it('escapes quotes, backslashes and wildcards', () => {
    expect(escapeAnkiSearchTerm('My "Best" Deck')).toBe('My \\"Best\\" Deck');
    expect(escapeAnkiSearchTerm('a*b_c')).toBe('a\\*b\\_c');
    expect(escapeAnkiSearchTerm('plain')).toBe('plain');
  });

  it('builds an exact, fully-quoted query (deck + note type + field:value)', () => {
    const q = buildExactNoteQuery({
      deckName: 'My "Best" Deck',
      modelName: 'Basic',
      fieldName: 'Word',
      value: 'hola',
    });
    expect(q).toBe('deck:"My \\"Best\\" Deck" note:"Basic" "Word:hola"');
  });

  it('returns null when deck or value is missing (never an over-broad query)', () => {
    expect(buildExactNoteQuery({ deckName: '', value: 'x' })).toBeNull();
    expect(buildExactNoteQuery({ deckName: 'D', value: '' })).toBeNull();
    expect(buildExactNoteQuery({})).toBeNull();
  });
});

/** Wire all module mocks the orchestrator pulls in. Returns the spies. */
function setupMocks(opts: {
  findNotesIds?: number[];
  notesInfos?: Array<{ noteId: number; fields: Record<string, { value: string }> }>;
  addNoteImpl?: () => Promise<number>;
} = {}) {
  const addNote = vi.fn(opts.addNoteImpl ?? (async () => 123));
  const findNotes = vi.fn(async () => opts.findNotesIds ?? []);
  const notesInfo = vi.fn(async () => opts.notesInfos ?? []);
  const storeMediaFile = vi.fn(async (filename: string) => filename);
  const ledgerPut: unknown[][] = [];
  const translateCalls = { n: 0 };

  vi.doMock('../../src/background/anki-connect', () => ({
    ankiConnect: { addNote, findNotes, notesInfo, storeMediaFile },
    dataUrlToBase64: (s: string) => s,
    AnkiConnectError: class extends Error {},
  }));
  vi.doMock('../../src/shared/db', async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    const throwingCache = {
      get: async () => {
        throw new Error('no db in test');
      },
      put: async () => {},
    };
    return {
      ...(actual as object),
      getDB: () => ({
        saved_notes: {
          where: () => ({ equals: () => ({ first: async () => null }) }),
          put: async (row: unknown) => ledgerPut.push(row as never),
        },
        pending_notes: { add: async () => {}, update: async () => {}, delete: async () => {} },
        translation_cache: throwingCache,
        media_cache: throwingCache,
        ai_cache: throwingCache,
      }),
    };
  });
  vi.doMock('../../src/background/translate', async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return {
      ...(actual as object),
      translateToken: async (token: string) => {
        translateCalls.n += 1;
        return { token, type: 'word', translation: 'hola' };
      },
      translateText: async () => ({ ok: false, error: 'no network in test' }),
    };
  });
  vi.doMock('../../src/background/ai-enrich', async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return {
      ...(actual as object),
      getAiSettings: async () => ({ provider: 'disabled', enrichOnSave: false }),
      getResolvedNativeLang: async () => 'es',
      enrichWithAi: async () => ({ ok: false, error: 'disabled in test' }),
    };
  });
  vi.doMock('../../src/background/enrichment/orchestrator', () => ({
    runEnrichment: async () => ({ entry: null }),
  }));
  vi.doMock('../../src/background/tts', () => ({
    generateTtsAudio: async () => ({ ok: false, error: 'disabled in test' }),
  }));
  vi.doMock('../../src/background/audio-capture-manager', () => ({
    getAudioCaptureStatus: async () => ({ active: false }),
    extractAudioClip: async () => ({ ok: false, error: 'disabled in test' }),
  }));

  return { addNote, findNotes, notesInfo, storeMediaFile, ledgerPut, translateCalls };
}

describe('retry idempotency', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('skips addNote when Anki already has the card (timeout-after-create)', async () => {
    const m = setupMocks({ findNotesIds: [98765] });
    m.addNote.mockImplementation(async () => {
      throw new Error('should not be called');
    });
    // cue field mapped so the sentence check runs; notesInfo must MATCH.
    m.notesInfo.mockResolvedValue([
      { noteId: 98765, fields: { Front: { value: 'hola' }, Sentence: { value: 'Hola mundo.' } } },
    ]);

    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const mapping = {
      deckName: 'My "Best" Deck',
      modelName: 'Basic',
      fieldSources: { Front: 'selection', Sentence: 'cue', 'Sentence audio': 'sentence-audio' },
    };
    const request = {
      token: 'hola',
      sentence: 'Hola mundo.',
      language: 'es',
      frame: 'data:image/jpeg;base64,AAAA',
      cueStart: 1000,
      cueEnd: 2000,
    };
    const res = await createCardFromRequest(request as never, mapping as never, undefined as never, {
      fromRetry: true,
      retryRowId: 1,
      carriedAudio: null,
    });
    expect(res.ok).toBe(true);
    expect(res.noteId).toBe(98765);
    expect(m.addNote).not.toHaveBeenCalled();
    // ORDER: the duplicate check runs BEFORE any media upload.
    expect(m.storeMediaFile).not.toHaveBeenCalled();
    const q = m.findNotes.mock.calls[0][0] as string;
    expect(q).toContain('\\"Best\\"');
    expect(q).toContain('note:"Basic"');
    expect(q).toContain('"Front:hola"');
    // No provider hit either.
    expect(m.translateCalls.n).toBe(0);
    // The verified match IS written to the ledger for the next retry.
    expect(m.ledgerPut).toHaveLength(1);
  });

  it('same word + DIFFERENT sentence → creates a NEW card (no false dedup)', async () => {
    const m = setupMocks({ findNotesIds: [555] });
    // Anki finds the word, but the note's cue is a different sentence —
    // and the field carries HTML, so only the normalized compare works.
    m.notesInfo.mockResolvedValue([
      {
        noteId: 555,
        fields: {
          Front: { value: 'hola' },
          Sentence: { value: '<b>Otra frase</b> del mismo&nbsp;token.' },
        },
      },
    ]);

    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const mapping = {
      deckName: 'Deck',
      modelName: 'Basic',
      fieldSources: { Front: 'selection', Sentence: 'cue' },
    };
    const request = { token: 'hola', sentence: 'Esta es la frase original.', language: 'es' };
    const res = await createCardFromRequest(request as never, mapping as never, undefined as never, {
      fromRetry: true,
      retryRowId: 1,
    });
    // Proceeded to create → addNote was reached, ledger untouched by dedup.
    expect(m.addNote).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
    expect(res.noteId).toBe(123);
    // Only the SUCCESS write below — no false-positive dedup ledger row.
    expect(m.ledgerPut).toHaveLength(1);
    expect(m.ledgerPut[0]).toMatchObject({ ankiNoteId: 123 });
  });

  it('matches a cue stored with HTML after normalization', async () => {
    const m = setupMocks({ findNotesIds: [777] });
    m.notesInfo.mockResolvedValue([
      {
        noteId: 777,
        fields: {
          Front: { value: 'hola' },
          Sentence: { value: 'Hola&nbsp;mundo.<!-- editorial -->' },
        },
      },
    ]);
    m.addNote.mockImplementation(async () => {
      throw new Error('dedup should have matched');
    });

    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const mapping = {
      deckName: 'Deck',
      modelName: 'Basic',
      fieldSources: { Front: 'selection', Sentence: 'cue' },
    };
    const request = { token: 'hola', sentence: 'Hola mundo.', language: 'es' };
    const res = await createCardFromRequest(request as never, mapping as never, undefined as never, {
      fromRetry: true,
      retryRowId: 1,
    });
    expect(res.ok).toBe(true);
    expect(res.noteId).toBe(777);
    expect(m.addNote).not.toHaveBeenCalled();
  });

  it('retry reuses request.audio (content-script clip) instead of falling back to TTS', async () => {
    const m = setupMocks({ findNotesIds: [] }); // no existing note
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const mapping = {
      deckName: 'Deck',
      modelName: 'Basic',
      fieldSources: { Front: 'selection', 'Sentence audio': 'sentence-audio' },
    };
    const request = {
      token: 'hola',
      sentence: 'Hola mundo.',
      language: 'es',
      audio: 'data:audio/webm;base64,AAAA',
    };
    const res = await createCardFromRequest(request as never, mapping as never, undefined as never, {
      fromRetry: true,
      retryRowId: 1,
      carriedAudio: null, // first attempt stashed nothing — request.audio must cover it
    });
    expect(res.ok).toBe(true);
    // The human clip was uploaded, not a TTS fallback.
    expect(m.storeMediaFile).toHaveBeenCalledTimes(1);
    expect(m.storeMediaFile.mock.calls[0][0]).toContain('hola');
    const fields = m.addNote.mock.calls[0][0] as { fields: Record<string, string> };
    expect(Object.values(fields.fields).join(' ')).toContain('[sound:');
  });
});
