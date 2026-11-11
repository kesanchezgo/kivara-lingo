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
  findNotes: ReturnType<typeof vi.fn>;
  cardsInfo: ReturnType<typeof vi.fn>;
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
    findNotes: vi.fn(async () => []),
    cardsInfo: vi.fn(async () => [{ cardId: 55, noteId: 77, interval: 21, fields: {} }]),
    notesInfo: vi.fn(async () => [
      { noteId: 77, fields: { Sentence: { value: 'First scene.' } }, cards: [55] },
    ]),
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
      findNotes: spies.findNotes,
      cardsInfo: spies.cardsInfo,
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

  it('writes the fields before the tags', async () => {
    const spies = setup();
    const order: string[] = [];
    spies.updateNoteFields.mockImplementation(async () => {
      order.push('fields');
      return null;
    });
    spies.addTags.mockImplementation(async () => {
      order.push('tags');
      return null;
    });
    const { addContextToNote } = await import('../../src/background/card-actions');
    const res = await addContextToNote({ noteId: 77, sentence: 'Order.', tags: ['kivara::word'] }, MAPPING as never);
    expect(res).toMatchObject({ ok: true });
    expect(order).toEqual(['fields', 'tags']);
  });

  it('reports a fields failure and does not try the tags', async () => {
    const spies = setup();
    spies.updateNoteFields.mockRejectedValueOnce(new FakeAnkiError('fields rejected'));
    const { addContextToNote } = await import('../../src/background/card-actions');
    const res = await addContextToNote({ noteId: 77, sentence: 'Partial.', tags: ['kivara::word'] }, MAPPING as never);
    expect(res).toMatchObject({ ok: false, noteId: 77, partial: 'fields' });
    expect(res.error).toContain('fields rejected');
    expect(spies.addTags).not.toHaveBeenCalled();
  });

  it('reports a tags failure after the scene landed', async () => {
    const spies = setup();
    spies.addTags.mockRejectedValueOnce(new FakeAnkiError('tags rejected'));
    const { addContextToNote } = await import('../../src/background/card-actions');
    const res = await addContextToNote({ noteId: 77, sentence: 'Partial.', tags: ['kivara::word'] }, MAPPING as never);
    expect(res).toMatchObject({ ok: false, noteId: 77, partial: 'tags' });
    expect(res.error).toContain('tags rejected');
    // The scene itself was written before the tag call failed.
    expect(spies.updateNoteFields).toHaveBeenCalledTimes(1);
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
 * The sentinel snapshot pipeline: findNotes → batched notesInfo → two
 * predicate findCards calls (maturity, seen). A note's word maps through its
 * `cards` array: any mature card → MATURE_DAYS, otherwise any seen card →
 * SEEN_DAYS, otherwise the note stays out. Any failed batch fails the WHOLE
 * answer loudly.
 */
describe('wordIntervals', () => {
  it('maps each note to its sentinel through its card ids', async () => {
    const notes = [
      { noteId: 1, fields: { word: { value: '<b>Sane</b>' }, Sentence: { value: 'x' } }, cards: [11] },
      // Several cards, only one mature: the note reads mature.
      { noteId: 2, fields: { word: { value: 'afford' } }, cards: [21, 22] },
      { noteId: 3, fields: { word: { value: 'day' } }, cards: [31] },
      // All cards new: no sentinel, the word stays out of the map.
      { noteId: 4, fields: { word: { value: 'unseen' } }, cards: [41] },
      // Duplicate headword, seen only: cannot downgrade the mature answer.
      { noteId: 5, fields: { word: { value: 'sane' } }, cards: [51] },
    ];
    const spies = setup({
      findNotes: vi.fn(async () => [1, 2, 3, 4, 5]),
      notesInfo: vi.fn(async () => notes),
      findCards: vi.fn(async (query: string) =>
        (query.endsWith('prop:ivl>=21') ? [11, 22] : [11, 21, 31, 51])),
    });
    const { wordIntervals, MATURE_DAYS, SEEN_DAYS } = await import('../../src/background/card-actions');
    await expect(wordIntervals('English vocabulary', 'word', MAPPING as never))
      .resolves.toEqual({ ok: true, words: { sane: MATURE_DAYS, afford: MATURE_DAYS, day: SEEN_DAYS } });
    expect(spies.findCards).toHaveBeenCalledWith(
      'deck:"English vocabulary" prop:ivl>=21',
      MAPPING.ankiUrl,
      undefined,
    );
    expect(spies.findCards).toHaveBeenCalledWith(
      'deck:"English vocabulary" -is:new',
      MAPPING.ankiUrl,
      undefined,
    );
  });

  it('reads notes with no rendered card templates', async () => {
    const spies = setup({
      findNotes: vi.fn(async () => [7]),
      notesInfo: vi.fn(async () => [
        { noteId: 8, fields: { word: { value: 'day' } }, cards: [9] },
      ]),
      findCards: vi.fn(async () => [9]),
    });
    const { wordIntervals } = await import('../../src/background/card-actions');
    await wordIntervals('English vocabulary', 'word', MAPPING as never);
    // Exactly ids, url, key — no `render` parameter ever rides along.
    expect(spies.notesInfo).toHaveBeenCalledWith([7], MAPPING.ankiUrl, undefined);
  });

  it('returns ok with an empty map when the deck has no notes', async () => {
    const spies = setup({ findNotes: vi.fn(async () => []) });
    const { wordIntervals } = await import('../../src/background/card-actions');
    await expect(wordIntervals('English vocabulary', 'word', MAPPING as never))
      .resolves.toEqual({ ok: true, words: {} });
    expect(spies.notesInfo).not.toHaveBeenCalled();
    expect(spies.findCards).not.toHaveBeenCalled();
  });

  it('returns ok with an empty map without a deck', async () => {
    const spies = setup();
    const { wordIntervals } = await import('../../src/background/card-actions');
    await expect(wordIntervals('', 'word', MAPPING as never)).resolves.toEqual({ ok: true, words: {} });
    expect(spies.findNotes).not.toHaveBeenCalled();
  });

  it('reads a deck larger than one batch in full, without truncation', async () => {
    const ids = Array.from({ length: 1201 }, (_, i) => i + 1);
    const spies = setup({
      findNotes: vi.fn(async () => ids),
      notesInfo: vi.fn(async (batch: number[]) =>
        batch.map((id) => ({ noteId: id, fields: { word: { value: `w${id}` } }, cards: [id] }))),
      findCards: vi.fn(async (query: string) => (query.endsWith('prop:ivl>=21') ? [] : ids)),
    });
    const { wordIntervals } = await import('../../src/background/card-actions');
    const res = await wordIntervals('English vocabulary', 'word', MAPPING as never);
    if (!res.ok) throw new Error(res.error);
    expect(Object.keys(res.words)).toHaveLength(1201);
    expect(res.words.w1).toBe(0);
    expect(res.words.w1201).toBe(0);
    expect(spies.findNotes).toHaveBeenCalledTimes(1);
    expect(spies.notesInfo).toHaveBeenCalledTimes(3);
    expect(spies.notesInfo.mock.calls.map((call) => (call[0] as number[]).length)).toEqual([500, 500, 201]);
  });

  it('fails the whole answer when a notesInfo batch fails (no partial map)', async () => {
    const ids = Array.from({ length: 1201 }, (_, i) => i + 1);
    setup({
      findNotes: vi.fn(async () => ids),
      notesInfo: vi.fn(async (batch: number[]) => {
        if (batch[0] === 501) throw new Error('boom'); // second batch
        return batch.map((id) => ({ noteId: id, fields: { word: { value: `w${id}` } }, cards: [id] }));
      }),
      findCards: vi.fn(async () => []),
    });
    const { wordIntervals } = await import('../../src/background/card-actions');
    const res = await wordIntervals('English vocabulary', 'word', MAPPING as never);
    expect(res).toEqual({ ok: false, error: 'boom' });
  });

  it('fails the whole answer when a predicate findCards fails', async () => {
    setup({
      findNotes: vi.fn(async () => [1]),
      notesInfo: vi.fn(async () => [
        { noteId: 2, fields: { word: { value: 'day' } }, cards: [3] },
      ]),
      findCards: vi.fn(async (query: string) => {
        if (query.endsWith('-is:new')) throw new Error('predicate failed');
        return [];
      }),
    });
    const { wordIntervals } = await import('../../src/background/card-actions');
    const res = await wordIntervals('English vocabulary', 'word', MAPPING as never);
    expect(res).toEqual({ ok: false, error: 'predicate failed' });
  });

  it('fails loudly when notesInfo answers fewer records than notes', async () => {
    setup({
      findNotes: vi.fn(async () => [1, 2, 3]),
      notesInfo: vi.fn(async () => [
        { noteId: 1, fields: { word: { value: 'a' } }, cards: [1] },
        { noteId: 2, fields: { word: { value: 'b' } }, cards: [2] },
      ]),
      findCards: vi.fn(async () => []),
    });
    const { wordIntervals } = await import('../../src/background/card-actions');
    const res = await wordIntervals('English vocabulary', 'word', MAPPING as never);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/fewer records/);
  });
});