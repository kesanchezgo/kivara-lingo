/**
 * RED TEST — audit round 6, P7: ONE canonical key per note in the interval
 * snapshot; two notes with the same lemma tag → total 2, not variant-inflated.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  delete (globalThis as { chrome?: unknown }).chrome;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} } },
  };
});

describe('P7 — the interval snapshot carries one canonical key per note', () => {
  it('two notes → ankiSummary.total = 2 (no variant inflation)', async () => {
    vi.doMock('../../src/background/anki-connect', () => ({
      ankiConnect: {
        findNotes: vi.fn(async () => [1, 2]),
        notesInfo: vi.fn(async () => [
          { noteId: 1, cards: [5], fields: { Front: { value: 'thank you' } }, tags: ['kivara::lemma::thank-you'] },
          { noteId: 2, cards: [6], fields: { Front: { value: 'run' } }, tags: ['kivara::lemma::run'] },
        ]),
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
    const MAPPING = { deckName: 'English vocab', modelName: 'Basic', fieldSources: { Front: 'selection' } };
    const res = await wordIntervals('English vocab', 'Front', MAPPING as never);
    const words = (res as { words?: Record<string, number> }).words ?? {};
    expect(Object.keys(words)).toHaveLength(2);
    const { replaceAnkiIntervals, studyStores, ankiSummaryOf } =
      await import('../../src/shared/study/wordStatus');
    replaceAnkiIntervals('en', words);
    await new Promise((r) => setTimeout(r, 0));
    expect(ankiSummaryOf(studyStores('en').anki.get()).total).toBe(2);
  });
});
