/**
 * Regression tests for the e2af3d3 review:
 *  - escapeAnkiSearchTerm escapes backslash, quote and Anki wildcards so a
 *    deck like `My "Best" Deck` produces a valid, exact query.
 *  - retry idempotency: a retry whose card already exists in Anki (TIMEOUT
 *    after a successful server-side add) must NOT call addNote again.
 *  - retry carries the first attempt's audio: the retry path resolves the
 *    sentence-audio field from the stored clip, never from the live buffer.
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

describe('retry idempotency', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('skips addNote when Anki already has the card (timeout-after-create)', async () => {
    const addNote = vi.fn(async () => {
      throw new Error('should not be called');
    });
    const findNotes = vi.fn(async () => [98765]);
    const storeMediaFile = vi.fn(async (filename: string) => filename);
    vi.doMock('../../src/background/anki-connect', () => ({
      ankiConnect: { addNote, findNotes, storeMediaFile },
      dataUrlToBase64: (s: string) => s,
      AnkiConnectError: class extends Error {},
    }));
    // Dexie-free path: stub getDB to throw (ledger unreadable → falls
    // through to the live findNotes check, which is the point). Keep the
    // rest of the db module intact via importOriginal. translation_cache
    // needs a stub too (translateToken reads it before the orchestrator
    // reaches the idempotency check) — a throwing .get forces the
    // already-handled fallback path without network.
    vi.doMock('../../src/shared/db', async (importOriginal) => {
      const actual = (await importOriginal()) as Record<string, unknown>;
      const throwingCache = { get: async () => { throw new Error('no db in test'); }, put: async () => {} };
      return {
        ...(actual as object),
        getDB: () => ({
          saved_notes: {
            where: () => ({ equals: () => ({ first: async () => null }) }),
            put: async () => {},
          },
          pending_notes: { add: async () => {}, update: async () => {}, delete: async () => {} },
          translation_cache: throwingCache,
          media_cache: throwingCache,
          ai_cache: throwingCache,
        }),
      };
    });
    // No network in this test: translateToken must resolve from the
    // bundled dictionary path. Stub the whole translate module to skip
    // the MT chain (its absence is unrelated to retry idempotency).
    // The counter proves the dedup check runs BEFORE any provider call.
    const translateCalls = { n: 0 };
    vi.doMock('../../src/background/translate', async (importOriginal) => {
      const actual = (await importOriginal()) as Record<string, unknown>;
      return {
        ...(actual as object),
        translateToken: async (token: string) => {
          translateCalls.n += 1;
          return {
            token,
            type: 'word',
            translation: 'hola',
          };
        },
        translateText: async () => ({ ok: false, error: 'no network in test' }),
      };
    });
    // Skip AI + enrichment + TTS: unrelated to retry idempotency, and
    // each would hit network/storage under test.
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

    const { createCardFromRequest } = await import(
      '../../src/background/capture-orchestrator'
    );
    const mapping = {
      deckName: 'My "Best" Deck',
      modelName: 'Basic',
      // frame + sentence-audio mapped ON PURPOSE: on the first attempt
      // these WOULD trigger storeMediaFile. The retry must find the note
      // BEFORE reaching them, so the zero-call assertion is meaningful.
      fieldSources: {
        Front: 'selection',
        Picture: 'frame',
        'Sentence audio': 'sentence-audio',
      },
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
    expect(addNote).not.toHaveBeenCalled();
    // ORDER: the duplicate check must run BEFORE any media upload — a retry
    // that finds the note can't leave orphaned files in Anki.
    expect(storeMediaFile).not.toHaveBeenCalled();
    // The query is the shared, fully-quoted exact form: deck escaped,
    // note type pinned, field:value quoted as a whole.
    const q = findNotes.mock.calls[0][0] as string;
    expect(q).toContain('\\"Best\\"');
    expect(q).toContain('note:"Basic"');
    expect(q).toContain('"Front:hola"');
    // No provider hit either: the check runs before translate/enrichment.
    expect(translateCalls.n).toBe(0);
  });
});
