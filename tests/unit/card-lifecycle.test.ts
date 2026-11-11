/**
 * F4 card lifecycle commands (docs/REDESIGN-V2.md §4.6, H10).
 *
 * The registry is the UI's source of truth; the Dexie row is the engine's
 * retry slot. These tests cover the commands that move a card between them:
 * retry one, retry all, dismiss and undo (delete), which also drops the word
 * from the F5 interval cache.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecentCard } from '../../src/shared/cards';

interface Row {
  id?: number;
  request: {
    cardId?: string;
    token?: string;
    deck?: string;
    lang?: string;
    frame?: string;
    audio?: string;
  };
  retries: number;
  resolvedAudio?: { dataUrl: string; mime: string } | null;
}

interface FakeRegistry {
  list: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  findByNoteId: ReturnType<typeof vi.fn>;
  removeByNoteId: ReturnType<typeof vi.fn>;
}

function card(overrides: Partial<RecentCard> = {}): RecentCard {
  return {
    id: 'card-1',
    word: 'sane',
    sentence: 'It keeps her sane.',
    status: 'queued',
    kind: 'word',
    deck: 'English vocabulary',
    lang: 'en',
    createdAt: 1,
    attempts: 1,
    nextRetryAt: 2,
    tags: ['kivara::word'],
    ...overrides,
  };
}

/** Minimal chrome.storage.local the F5 interval cache (wordStatus) writes to. */
function installStorage(): Record<string, unknown> {
  const stored: Record<string, unknown> = {};
  (globalThis as unknown as { chrome: { storage: Record<string, unknown> } }).chrome = {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const out: Record<string, unknown> = {};
          for (const key of Array.isArray(keys) ? keys : [keys]) if (key in stored) out[key] = stored[key];
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(stored, items); }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key];
        }),
      },
      onChanged: { addListener: vi.fn() },
    },
  };
  return stored;
}

function setup(options: {
  cards?: RecentCard[];
  rows?: Row[];
  result?: { ok: boolean; noteId?: number; error?: string; warnings?: string[] };
  deleteResult?: { ok: boolean; error?: string; gone?: boolean };
  ownership?: 'owned' | 'foreign' | 'gone' | 'unreadable';
} = {}) {
  const cards = options.cards ?? [card()];
  const rows = options.rows ?? [{ id: 10, request: { cardId: 'card-1', token: 'sane', deck: 'English vocabulary', lang: 'en' }, retries: 1 }];
  const registry: FakeRegistry = {
    list: vi.fn(async () => cards),
    get: vi.fn(async (id: string) => cards.find((c) => c.id === id)),
    patch: vi.fn(async () => cards[0]),
    remove: vi.fn(async () => undefined),
    findByNoteId: vi.fn(async (noteId: number) => cards.find((c) => c.noteId === noteId)),
    removeByNoteId: vi.fn(async () => undefined),
  };
  const createCardFromRequest = vi.fn(async () => options.result ?? { ok: true, noteId: 900 });
  const retryPendingNotes = vi.fn(async () => ({ retried: 1, succeeded: 1 }));
  const deleteNote = vi.fn(async () => options.deleteResult ?? { ok: true });
  const noteOwnership = vi.fn(async () => options.ownership ?? 'owned');
  const pendingDelete = vi.fn(async () => undefined);
  const pendingUpdate = vi.fn(async () => undefined);
  vi.doMock('../../src/background/card-registry', () => ({ cardRegistry: registry }));
  vi.doMock('../../src/background/capture-orchestrator', () => ({ createCardFromRequest, retryPendingNotes }));
  vi.doMock('../../src/background/card-actions', () => ({
    deleteNote,
    noteOwnership,
    addContextToNote: vi.fn(),
    browseNote: vi.fn(),
    wordIntervals: vi.fn(),
  }));
  vi.doMock('../../src/shared/db', () => ({
    getDB: () => ({
      pending_notes: {
        toArray: async () => rows,
        delete: pendingDelete,
        update: pendingUpdate,
      },
    }),
  }));

  return {
    registry, createCardFromRequest, retryPendingNotes, deleteNote, noteOwnership,
    pendingDelete, pendingUpdate, rows, cards,
  };
}

const MAPPING = {
  ankiUrl: 'http://127.0.0.1:8765',
  deckName: 'Legacy deck',
  modelName: 'KivaraLingo',
  fieldSources: {},
  decks: { en: 'English vocabulary' },
};

beforeEach(() => {
  vi.resetModules();
});

describe('retryCard', () => {
  it('moves queued → sending → saved through the pending row', async () => {
    const f = setup();
    const { retryCard } = await import('../../src/background/card-lifecycle');
    const res = await retryCard('card-1', MAPPING as never, {} as never);

    expect(res).toEqual({ ok: true, noteId: 900 });
    expect(f.registry.patch).toHaveBeenCalledWith('card-1', expect.objectContaining({ status: 'sending' }));
    const [request, mapping, , opts] = f.createCardFromRequest.mock.calls[0] as unknown as [
      { cardId: string; deck: string },
      { deckName: string },
      unknown,
      { fromRetry: boolean; retryRowId: number },
    ];
    expect(request.cardId).toBe('card-1');
    expect(request.deck).toBe('English vocabulary');
    expect(mapping.deckName).toBe('English vocabulary');
    expect(opts).toMatchObject({ fromRetry: true, retryRowId: 10 });
    expect(f.pendingDelete).toHaveBeenCalledWith(10);
  });

  it('keeps the row and schedules it again when the retry fails', async () => {
    const f = setup({ result: { ok: false, error: 'NETWORK' } });
    const { retryCard } = await import('../../src/background/card-lifecycle');
    const res = await retryCard('card-1', MAPPING as never, {} as never);
    expect(res).toMatchObject({ ok: false, error: 'NETWORK' });
    expect(f.pendingUpdate).toHaveBeenCalledWith(10, expect.objectContaining({ retries: 2, lastError: 'NETWORK' }));
  });

  it('is a no-op for a saved card', async () => {
    const f = setup({ cards: [card({ status: 'saved', noteId: 5 })] });
    const { retryCard } = await import('../../src/background/card-lifecycle');
    await expect(retryCard('card-1', MAPPING as never, {} as never)).resolves.toEqual({ ok: true, noteId: 5 });
    expect(f.createCardFromRequest).not.toHaveBeenCalled();
  });

  it('rebuilds a minimal request when a failed card has no queued row', async () => {
    const f = setup({ cards: [card({ status: 'failed', attempts: 10 })], rows: [] });
    const { retryCard } = await import('../../src/background/card-lifecycle');
    await retryCard('card-1', MAPPING as never, {} as never);
    const [request] = f.createCardFromRequest.mock.calls[0] as unknown as [{
      token: string; sentence: string; cardId: string; deck: string; lang: string;
    }];
    expect(request).toMatchObject({
      token: 'sane',
      sentence: 'It keeps her sane.',
      cardId: 'card-1',
      deck: 'English vocabulary',
      lang: 'en',
    });
  });

  it('returns an error for an unknown card', async () => {
    setup({ cards: [] });
    const { retryCard } = await import('../../src/background/card-lifecycle');
    await expect(retryCard('nope', MAPPING as never, {} as never)).resolves.toMatchObject({ ok: false });
  });

  it('carries the original frame and audio from a queued row after a permanent failure', async () => {
    const frame = 'data:image/jpeg;base64,FRAME';
    const audio = 'data:audio/webm;base64,AUDIO';
    const f = setup({
      cards: [card({ status: 'failed', media: { frame: true, audio: true } })],
      rows: [{ id: 10, request: { cardId: 'card-1', token: 'sane', deck: 'English vocabulary', lang: 'en', frame, audio }, retries: 1 }],
    });
    const { retryCard } = await import('../../src/background/card-lifecycle');
    const res = await retryCard('card-1', MAPPING as never, {} as never);

    const [request] = f.createCardFromRequest.mock.calls[0] as unknown as [{ frame?: string; audio?: string }];
    // The row still holds the payload, so the retry re-attaches it verbatim.
    expect(request.frame).toBe(frame);
    expect(request.audio).toBe(audio);
    expect(res).toMatchObject({ ok: true, noteId: 900 });
    expect(res.mediaLost).toBeUndefined();
  });

  it('reports lost media when a permanent failure left no row to rebuild from', async () => {
    const f = setup({
      cards: [card({ status: 'failed', attempts: 10, media: { frame: true, audio: true } })],
      rows: [],
      result: { ok: true, noteId: 901, warnings: ['Reintento sin audio original: se usará TTS de la frase.'] },
    });
    const { retryCard } = await import('../../src/background/card-lifecycle');
    const res = await retryCard('card-1', MAPPING as never, {} as never);

    const [request] = f.createCardFromRequest.mock.calls[0] as unknown as [{ frame?: string; audio?: string }];
    // Nothing in the registry holds the blobs: the rebuild cannot carry them.
    expect(request.frame).toBeUndefined();
    expect(request.audio).toBeUndefined();
    // The caller is told, instead of receiving a silent media-less save.
    expect(res).toMatchObject({ ok: true, noteId: 901, mediaLost: true });
    expect(res.warnings).toEqual(['Reintento sin audio original: se usará TTS de la frase.']);
  });

  it('leaves a queued row that still has its pending payload untouched', async () => {
    const frame = 'data:image/jpeg;base64,FRAME';
    const audio = 'data:audio/webm;base64,AUDIO';
    const rows = [{ id: 10, request: { cardId: 'card-1', token: 'sane', deck: 'English vocabulary', lang: 'en', frame, audio }, retries: 0 }];
    const f = setup({ cards: [card({ status: 'queued', media: { frame: true, audio: true } })], rows });
    const { retryCard } = await import('../../src/background/card-lifecycle');
    await retryCard('card-1', MAPPING as never, {} as never);

    const [request] = f.createCardFromRequest.mock.calls[0] as unknown as [{ frame?: string; audio?: string }];
    expect(request.frame).toBe(frame);
    expect(request.audio).toBe(audio);
    // Only the status moves: the row's media flags are never rewritten here.
    const patch = f.registry.patch.mock.calls[0]?.[1] as unknown as { status: string; media?: unknown };
    expect(patch.status).toBe('sending');
    expect(patch.media).toEqual({ frame: true, audio: true });
  });
});

describe('retryAllCards', () => {
  it('retries every pending card and also drains legacy rows', async () => {
    const f = setup({ cards: [card(), card({ id: 'card-2', status: 'failed' })] });
    const { retryAllCards } = await import('../../src/background/card-lifecycle');
    const res = await retryAllCards(MAPPING as never, {} as never);
    expect(res).toEqual({ ok: true, retried: 2, succeeded: 2 });
    expect(f.createCardFromRequest).toHaveBeenCalledTimes(2);
    expect(f.retryPendingNotes).toHaveBeenCalledWith(MAPPING, {});
  });
});

describe('dismissCard', () => {
  it('removes the registry row and its queued row', async () => {
    const f = setup();
    const { dismissCard } = await import('../../src/background/card-lifecycle');
    await expect(dismissCard('card-1')).resolves.toEqual({ ok: true });
    expect(f.registry.remove).toHaveBeenCalledWith('card-1');
    expect(f.pendingDelete).toHaveBeenCalledWith(10);
  });

  it('leaves other queued rows alone', async () => {
    const f = setup({
      rows: [
        { id: 10, request: { cardId: 'card-1' }, retries: 0 },
        { id: 11, request: { cardId: 'other' }, retries: 0 },
      ],
    });
    const { dismissCard } = await import('../../src/background/card-lifecycle');
    await dismissCard('card-1');
    expect(f.pendingDelete).toHaveBeenCalledTimes(1);
    expect(f.pendingDelete).toHaveBeenCalledWith(10);
  });
});

describe('undoDeleteNote (Undo)', () => {
  it('deletes the note, drops the registry row and removes the word from the interval cache', async () => {
    installStorage();
    const f = setup({ cards: [card({ status: 'saved', noteId: 77 })] });
    // The F5 cache holds the word the undo must flip back to «new/estimate».
    const { replaceAnkiIntervals, studyStores } = await import('../../src/shared/study/wordStatus');
    replaceAnkiIntervals('en', { sane: 12, time: 30 });

    const { undoDeleteNote } = await import('../../src/background/card-lifecycle');
    const res = await undoDeleteNote(77, MAPPING as never);

    expect(res).toEqual({ ok: true });
    expect(f.deleteNote).toHaveBeenCalledWith(77, MAPPING);
    expect(f.registry.removeByNoteId).toHaveBeenCalledWith(77);
    // The word leaves the cache at once; the other words keep their intervals.
    expect(studyStores('en').anki.get()).toEqual({ time: { interval: 30 } });
  });

  it('reads the language from the registry row (en-US folds to the en profile)', async () => {
    installStorage();
    const f = setup({ cards: [card({ status: 'saved', noteId: 77, lang: 'en-US', word: 'Sane' })] });
    const { replaceAnkiIntervals, studyStores } = await import('../../src/shared/study/wordStatus');
    replaceAnkiIntervals('en', { sane: 12 });

    const { undoDeleteNote } = await import('../../src/background/card-lifecycle');
    await undoDeleteNote(77, MAPPING as never);

    expect(f.registry.findByNoteId).toHaveBeenCalledWith(77);
    expect(studyStores('en').anki.get()).toEqual({});
  });

  it('keeps the word when the delete fails', async () => {
    installStorage();
    const f = setup({ cards: [card({ status: 'saved', noteId: 77 })], deleteResult: { ok: false, error: 'Anki is closed' } });
    const { replaceAnkiIntervals, studyStores } = await import('../../src/shared/study/wordStatus');
    replaceAnkiIntervals('en', { sane: 12 });

    const { undoDeleteNote } = await import('../../src/background/card-lifecycle');
    const res = await undoDeleteNote(77, MAPPING as never);

    expect(res).toMatchObject({ ok: false, error: 'Anki is closed' });
    expect(f.registry.removeByNoteId).not.toHaveBeenCalled();
    expect(studyStores('en').anki.get()).toEqual({ sane: { interval: 12 } });
  });

  it('an already-deleted note is still a complete undo (gone)', async () => {
    installStorage();
    const f = setup({ cards: [card({ status: 'saved', noteId: 77 })], deleteResult: { ok: true, gone: true } });
    const { replaceAnkiIntervals, studyStores } = await import('../../src/shared/study/wordStatus');
    replaceAnkiIntervals('en', { sane: 12 });

    const { undoDeleteNote } = await import('../../src/background/card-lifecycle');
    await expect(undoDeleteNote(77, MAPPING as never)).resolves.toEqual({ ok: true, gone: true });
    expect(f.registry.removeByNoteId).toHaveBeenCalledWith(77);
    expect(studyStores('en').anki.get()).toEqual({});
  });

  /**
   * Ownership guard (issue #39): no registry row means the tag must vouch for
   * the note. A foreign note is refused before any network write.
   */
  it('deletes a note with no registry row when the tag says it is ours', async () => {
    installStorage();
    const f = setup({ cards: [], ownership: 'owned' });
    const { undoDeleteNote } = await import('../../src/background/card-lifecycle');

    await expect(undoDeleteNote(77, MAPPING as never)).resolves.toEqual({ ok: true });
    expect(f.noteOwnership).toHaveBeenCalledWith(77, MAPPING);
    expect(f.deleteNote).toHaveBeenCalledWith(77, MAPPING);
  });

  it('refuses a note that is neither in the registry nor tagged as ours', async () => {
    installStorage();
    const f = setup({ cards: [], ownership: 'foreign' });
    const { undoDeleteNote } = await import('../../src/background/card-lifecycle');

    const res = await undoDeleteNote(77, MAPPING as never);
    expect(res).toMatchObject({ ok: false });
    expect(res.error).toMatch(/not created by Kivara Lingo/);
    expect(f.deleteNote).not.toHaveBeenCalled();
    expect(f.registry.removeByNoteId).not.toHaveBeenCalled();
  });

  it('refuses when the ownership check itself cannot read Anki', async () => {
    installStorage();
    const f = setup({ cards: [], ownership: 'unreadable' });
    const { undoDeleteNote } = await import('../../src/background/card-lifecycle');

    const res = await undoDeleteNote(77, MAPPING as never);
    expect(res).toMatchObject({ ok: false });
    expect(res.error).toMatch(/could not verify/);
    expect(f.deleteNote).not.toHaveBeenCalled();
  });

  it('treats an unknown, already-gone id as a complete undo with no delete call', async () => {
    installStorage();
    const f = setup({ cards: [], ownership: 'gone' });
    const { undoDeleteNote } = await import('../../src/background/card-lifecycle');

    await expect(undoDeleteNote(77, MAPPING as never)).resolves.toEqual({ ok: true, gone: true });
    expect(f.deleteNote).not.toHaveBeenCalled();
  });
});
