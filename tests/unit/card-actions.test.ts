/**
 * F4 note-editing actions (docs/REDESIGN-V2.md §4.6): Undo, Add this scene,
 * See in Anki and word intervals. Each test uses a fake AnkiConnect module —
 * the service worker's handlers are thin wrappers over these functions.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

class FakeAnkiError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'AnkiConnectError';
  }
}

interface Spies {
  deleteNotes: ReturnType<typeof vi.fn>;
  addTags: ReturnType<typeof vi.fn>;
  guiBrowse: ReturnType<typeof vi.fn>;
  findCards: ReturnType<typeof vi.fn>;
  cardsInfo: ReturnType<typeof vi.fn>;
  getIntervals: ReturnType<typeof vi.fn>;
  cardFieldsInfo: ReturnType<typeof vi.fn>;
  notesInfo: ReturnType<typeof vi.fn>;
  updateNoteFields: ReturnType<typeof vi.fn>;
  storeMediaFile: ReturnType<typeof vi.fn>;
}

function setup(overrides: Partial<Spies> = {}): Spies {
  const spies: Spies = {
    deleteNotes: vi.fn(async () => null),
    addTags: vi.fn(async () => null),
    guiBrowse: vi.fn(async () => [1]),
    findCards: vi.fn(async () => [55]),
    cardsInfo: vi.fn(async () => [{ cardId: 55, noteId: 77, interval: 21, fields: {} }]),
    // Batch defaults: every card in the batch reads as an interval-0 card the
    // pipeline cannot map to a word (empty record). Tests override these.
    getIntervals: vi.fn(async (cards: number[]) => cards.map(() => 0)),
    cardFieldsInfo: vi.fn(async (cards: number[]) => cards.map(() => ({}))),
    notesInfo: vi.fn(async () => [{ noteId: 77, fields: { Sentence: { value: 'First scene.' } } }]),
    updateNoteFields: vi.fn(async () => null),
    storeMediaFile: vi.fn(async (name: string) => name),
    ...overrides,
  };
  vi.doMock('../../src/background/anki-connect', () => ({
    AnkiConnectError: FakeAnkiError,
    dataUrlToBase64: (s: string) => s.replace(/^data:[^,]+,/, ''),
    ankiConnect: {
      deleteNotes: spies.deleteNotes,
      addTags: spies.addTags,
      guiBrowse: spies.guiBrowse,
      findCards: spies.findCards,
      cardsInfo: spies.cardsInfo,
      getIntervals: spies.getIntervals,
      cardFieldsInfo: spies.cardFieldsInfo,
      notesInfo: spies.notesInfo,
      updateNoteFields: spies.updateNoteFields,
      storeMediaFile: spies.storeMediaFile,
    },
  }));
  return spies;
}

const MAPPING = {
  ankiUrl: 'http://127.0.0.1:8765',
  deckName: 'English vocabulary',
  modelName: 'KivaraLingo',
  fieldSources: {
    word: 'selection',
    Sentence: 'cue',
    Picture: 'frame',
    'Sentence audio': 'sentence-audio',
  },
} as const;

beforeEach(() => {
  vi.resetModules();
});

describe('deleteNote (Undo)', () => {
  it('deletes the note', async () => {
    const spies = setup();
    const { deleteNote } = await import('../../src/background/card-actions');
    await expect(deleteNote(42, MAPPING as never)).resolves.toEqual({ ok: true });
    expect(spies.deleteNotes).toHaveBeenCalledWith([42], MAPPING.ankiUrl, undefined);
  });

  it('treats an already-deleted note as a successful undo', async () => {
    const spies = setup({
      deleteNotes: vi.fn(async () => {
        throw new FakeAnkiError('Note not found', 'ANKI');
      }),
    });
    const { deleteNote } = await import('../../src/background/card-actions');
    await expect(deleteNote(42, MAPPING as never)).resolves.toEqual({ ok: true, gone: true });
    expect(spies.deleteNotes).toHaveBeenCalledTimes(1);
  });

  it('reports any other failure', async () => {
    setup({
      deleteNotes: vi.fn(async () => {
        throw new FakeAnkiError('Anki is closed', 'NETWORK');
      }),
    });
    const { deleteNote } = await import('../../src/background/card-actions');
    const res = await deleteNote(42, MAPPING as never);
    expect(res).toMatchObject({ ok: false, error: 'Anki is closed' });
  });
});

describe('addContextToNote (Add this scene)', () => {
  it('appends the sentence, escapes it and adds the tags', async () => {
    const spies = setup();
    const { addContextToNote } = await import('../../src/background/card-actions');
    const res = await addContextToNote({
      noteId: 77,
      sentence: 'A new <scene> & line.',
      tags: ['kivara::lang::en', 'kivara::lang::en', 'kivara::word'],
    }, MAPPING as never);

    expect(res).toMatchObject({ ok: true, noteId: 77 });
    expect(spies.addTags).toHaveBeenCalledWith(
      ['kivara::lang::en', 'kivara::word'],
      [77],
      MAPPING.ankiUrl,
      undefined,
    );
    const fields = spies.updateNoteFields.mock.calls[0][1] as Record<string, string>;
    expect(fields.Sentence).toBe('First scene.<br><br>A new &lt;scene&gt; &amp; line.');
  });

  it('does not append the same scene twice (HTML-insensitive compare)', async () => {
    const spies = setup({
      notesInfo: vi.fn(async () => [
        { noteId: 77, fields: { Sentence: { value: 'First&nbsp;<b>scene</b>.<!-- x -->' } } },
      ]),
    });
    const { addContextToNote } = await import('../../src/background/card-actions');
    await addContextToNote({ noteId: 77, sentence: 'First scene.', tags: [] }, MAPPING as never);
    expect(spies.updateNoteFields).not.toHaveBeenCalled();
  });

  it('resolves the note id from the headword when the caller has none', async () => {
    const spies = setup();
    const { addContextToNote } = await import('../../src/background/card-actions');
    const res = await addContextToNote({ token: 'sane', sentence: 'Another line.', tags: [] }, MAPPING as never);
    expect(res).toMatchObject({ ok: true, noteId: 77 });
    expect(spies.findCards).toHaveBeenCalledWith(
      'deck:"English vocabulary" note:"KivaraLingo" "word:sane"',
      MAPPING.ankiUrl,
      undefined,
    );
    expect(spies.cardsInfo).toHaveBeenCalledWith([55], MAPPING.ankiUrl, undefined);
  });

  it('stores a frame and audio when supplied', async () => {
    const spies = setup();
    const { addContextToNote } = await import('../../src/background/card-actions');
    await addContextToNote({
      noteId: 77,
      sentence: 'Another line.',
      frame: 'data:image/jpeg;base64,AAAA',
      audio: 'data:audio/mpeg;base64,BBBB',
      tags: [],
    }, MAPPING as never);
    expect(spies.storeMediaFile).toHaveBeenCalledTimes(2);
    const fields = spies.updateNoteFields.mock.calls[0][1] as Record<string, string>;
    expect(fields.Picture).toContain('<img src="kivara-context-77-');
    expect(fields['Sentence audio']).toContain('[sound:kivara-context-77-');
  });
});

describe('browseNote (See in Anki)', () => {
  it('opens a note by id', async () => {
    const spies = setup();
    const { browseNote } = await import('../../src/background/card-actions');
    const res = await browseNote({ noteId: 9 }, MAPPING as never);
    expect(spies.guiBrowse).toHaveBeenCalledWith('nid:9', MAPPING.ankiUrl, undefined);
    expect(res).toEqual({ ok: true, noteIds: [1] });
  });

  it('opens a raw query and refuses an empty one', async () => {
    const spies = setup();
    const { browseNote } = await import('../../src/background/card-actions');
    await browseNote({ query: 'deck:"D"' }, MAPPING as never);
    expect(spies.guiBrowse).toHaveBeenCalledWith('deck:"D"', MAPPING.ankiUrl, undefined);
    await expect(browseNote({}, MAPPING as never)).resolves.toMatchObject({ ok: false });
  });
});

/**
 * The interval snapshot pipeline: findCards → getIntervals → field-filtered
 * cardsInfo. Days come from `getIntervals` (negative = seconds → 0), the
 * headword from the explicitly requested note fields, max per word, and any
 * batch failure fails the WHOLE answer loudly — the old path silently cut to
 * the last 5000 cards and swallowed every error.
 */
describe('wordIntervals', () => {
  it('maps the headword field to its interval and keeps the max per word', async () => {
    const intervalOf = new Map<number, number>([[1, 42], [3, 0], [5, 128]]);
    const infoOf = new Map<number, { noteId: number; fields: Record<string, { value: string }> }>([
      [1, { noteId: 2, fields: { word: { value: '<b>Sane</b>' }, Sentence: { value: 'x' } } }],
      [3, { noteId: 4, fields: { word: { value: 'afford' } } }],
      [5, { noteId: 6, fields: { word: { value: 'sane' } } }], // duplicate word → max(42, 128)
    ]);
    setup({
      findCards: vi.fn(async () => [1, 3, 5]),
      getIntervals: vi.fn(async (cards: number[]) => cards.map((c) => intervalOf.get(c) ?? 0)),
      cardFieldsInfo: vi.fn(async (cards: number[]) => cards.map((c) => infoOf.get(c) ?? {})),
    });
    const { wordIntervals } = await import('../../src/background/card-actions');
    await expect(wordIntervals('English vocabulary', 'word', MAPPING as never))
      .resolves.toEqual({ ok: true, words: { sane: 128, afford: 0 } });
  });

  it('requests the note fields explicitly through the filtered cardsInfo shape', async () => {
    const spies = setup({
      findCards: vi.fn(async () => [7]),
      cardFieldsInfo: vi.fn(async () => [{ noteId: 8, fields: { word: { value: 'day' } } }]),
    });
    const { wordIntervals } = await import('../../src/background/card-actions');
    await wordIntervals('English vocabulary', 'word', MAPPING as never);
    expect(spies.cardFieldsInfo.mock.calls[0][0]).toEqual([7]);
    expect(spies.cardFieldsInfo.mock.calls[0][1]).toEqual(['noteId', 'fields']);
  });

  it('reads negative intervals (seconds, learning step) as 0 days', async () => {
    setup({
      findCards: vi.fn(async () => [1, 2]),
      getIntervals: vi.fn(async () => [-600, 0]),
      cardFieldsInfo: vi.fn(async () => [
        { noteId: 10, fields: { word: { value: 'day' } } },
        { noteId: 11, fields: { word: { value: 'night' } } },
      ]),
    });
    const { wordIntervals } = await import('../../src/background/card-actions');
    await expect(wordIntervals('English vocabulary', 'word', MAPPING as never))
      .resolves.toEqual({ ok: true, words: { day: 0, night: 0 } });
  });

  it('returns ok with an empty map when the deck has no cards', async () => {
    const spies = setup({ findCards: vi.fn(async () => []) });
    const { wordIntervals } = await import('../../src/background/card-actions');
    await expect(wordIntervals('English vocabulary', 'word', MAPPING as never))
      .resolves.toEqual({ ok: true, words: {} });
    expect(spies.getIntervals).not.toHaveBeenCalled();
    expect(spies.cardFieldsInfo).not.toHaveBeenCalled();
  });

  it('returns ok with an empty map without a deck', async () => {
    setup();
    const { wordIntervals } = await import('../../src/background/card-actions');
    await expect(wordIntervals('', 'word', MAPPING as never)).resolves.toEqual({ ok: true, words: {} });
  });

  it('covers a deck larger than the old 5000-card cap (batched, no truncation)', async () => {
    const ids = Array.from({ length: 5001 }, (_, i) => i + 1);
    const spies = setup({
      findCards: vi.fn(async () => ids),
      getIntervals: vi.fn(async (cards: number[]) => cards.map((c) => c)),
      cardFieldsInfo: vi.fn(async (cards: number[]) => cards.map((c) => ({ noteId: c, fields: { word: { value: `w${c}` } } }))),
    });
    const { wordIntervals } = await import('../../src/background/card-actions');
    const res = await wordIntervals('English vocabulary', 'word', MAPPING as never);
    if (!res.ok) throw new Error(res.error);
    // Every card of the deck is in the answer — the old slice(-5000) would
    // have dropped the first one.
    expect(Object.keys(res.words)).toHaveLength(5001);
    expect(res.words.w1).toBe(1);
    expect(res.words.w5001).toBe(5001);
    // 5001 cards read in 1000-card batches: 6 calls per read.
    expect(spies.getIntervals).toHaveBeenCalledTimes(6);
    expect(spies.cardFieldsInfo).toHaveBeenCalledTimes(6);
  });

  it('fails loudly when a read batch fails (no partial map)', async () => {
    const ids = Array.from({ length: 2500 }, (_, i) => i + 1);
    setup({
      findCards: vi.fn(async () => ids),
      cardFieldsInfo: vi.fn(async (cards: number[]) => {
        if (cards[0] !== ids[0]) throw new Error('boom'); // second batch
        return cards.map((c) => ({ noteId: c, fields: { word: { value: `w${c}` } } }));
      }),
    });
    const { wordIntervals } = await import('../../src/background/card-actions');
    const res = await wordIntervals('English vocabulary', 'word', MAPPING as never);
    expect(res).toEqual({ ok: false, error: 'boom' });
  });

  it('fails loudly when getIntervals answers fewer intervals than cards', async () => {
    setup({
      findCards: vi.fn(async () => [1, 2, 3]),
      getIntervals: vi.fn(async () => [0, 0]),
    });
    const { wordIntervals } = await import('../../src/background/card-actions');
    const res = await wordIntervals('English vocabulary', 'word', MAPPING as never);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/fewer intervals/);
  });
});