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

describe('wordIntervals', () => {
  it('maps the headword field to its interval', async () => {
    setup({
      cardsInfo: vi.fn(async () => [
        { cardId: 1, noteId: 2, interval: 42, fields: { word: { value: '<b>Sane</b>' }, Sentence: { value: 'x' } } },
        { cardId: 3, noteId: 4, interval: 0, fields: { word: { value: 'afford' }, Sentence: { value: 'y' } } },
      ]),
    });
    const { wordIntervals } = await import('../../src/background/card-actions');
    await expect(wordIntervals('English vocabulary', 'word', MAPPING as never))
      .resolves.toEqual({ words: { sane: 42, afford: 0 } });
  });

  it('returns an empty map without a deck', async () => {
    setup();
    const { wordIntervals } = await import('../../src/background/card-actions');
    await expect(wordIntervals('', 'word', MAPPING as never)).resolves.toEqual({ words: {} });
  });
});