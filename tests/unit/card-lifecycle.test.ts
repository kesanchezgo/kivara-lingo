/**
 * F4 card lifecycle commands (docs/REDESIGN-V2.md §4.6, H10).
 *
 * The registry is the UI's source of truth; the Dexie row is the engine's
 * retry slot. These tests cover the three commands that move a card between
 * them: retry one, retry all and dismiss.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecentCard } from '../../src/shared/cards';

interface Row {
  id?: number;
  request: { cardId?: string; token?: string; deck?: string; lang?: string };
  retries: number;
  resolvedAudio?: { dataUrl: string; mime: string } | null;
}

interface FakeRegistry {
  list: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
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

function setup(options: {
  cards?: RecentCard[];
  rows?: Row[];
  result?: { ok: boolean; noteId?: number; error?: string };
} = {}) {
  const cards = options.cards ?? [card()];
  const rows = options.rows ?? [{ id: 10, request: { cardId: 'card-1', token: 'sane', deck: 'English vocabulary', lang: 'en' }, retries: 1 }];
  const registry: FakeRegistry = {
    list: vi.fn(async () => cards),
    get: vi.fn(async (id: string) => cards.find((c) => c.id === id)),
    patch: vi.fn(async () => cards[0]),
    remove: vi.fn(async () => undefined),
  };
  const createCardFromRequest = vi.fn(async () => options.result ?? { ok: true, noteId: 900 });
  const retryPendingNotes = vi.fn(async () => ({ retried: 1, succeeded: 1 }));
  const pendingDelete = vi.fn(async () => undefined);
  const pendingUpdate = vi.fn(async () => undefined);
  vi.doMock('../../src/background/card-registry', () => ({ cardRegistry: registry }));
  vi.doMock('../../src/background/capture-orchestrator', () => ({ createCardFromRequest, retryPendingNotes }));
  vi.doMock('../../src/shared/db', () => ({
    getDB: () => ({
      pending_notes: {
        toArray: async () => rows,
        delete: pendingDelete,
        update: pendingUpdate,
      },
    }),
  }));

  return { registry, createCardFromRequest, retryPendingNotes, pendingDelete, pendingUpdate, rows, cards };
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