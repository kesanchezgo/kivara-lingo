/**
 * F4 card registry (docs/REDESIGN-V2.md §3 H10, §7 F4).
 *
 * Covers the hierarchical tags plus the legacy tag (D3), every registry
 * transition the SW owns, the 50-row cap, the revive rules and the
 * read-modify-write registry over an in-memory storage.
 */
import { describe, expect, it } from 'vitest';
import {
  LEGACY_CARD_TAG,
  RECENT_LIMIT,
  beginRetry,
  buildCardTags,
  cardSourceFromMedia,
  hasAudio,
  hasFrame,
  markFailed,
  markQueued,
  markSaved,
  mediaFromSource,
  newRecentCard,
  reviveCards,
  trimCards,
  type NewRecentCard,
  type RecentCard,
} from '../../src/shared/cards';
import { createCardRegistry } from '../../src/background/card-registry';

const BASE: NewRecentCard = {
  id: 'c1',
  word: 'sane',
  sentence: 'It keeps her sane.',
  kind: 'word',
  deck: 'English vocabulary',
  lang: 'en',
  tags: [],
  createdAt: 1_000,
};

const MEDIA = {
  platform: 'hbo' as const,
  title: 'Winter is Coming',
  series: 'Game of Thrones',
  season: 1,
  episode: 1,
  url: 'https://play.hbomax.com/x',
};

describe('card tags v2', () => {
  it('adds language, platform, source and kind tags plus the legacy tag', () => {
    expect(buildCardTags('word', MEDIA, 'en')).toEqual([
      'kivara::lang::en',
      'kivara::platform::hbo_max',
      'kivara::game_of_thrones::s01e01',
      'kivara::word',
      LEGACY_CARD_TAG,
    ]);
  });

  it('keeps the legacy tag even without media or language', () => {
    expect(buildCardTags('cloze')).toEqual(['kivara::cloze', LEGACY_CARD_TAG]);
  });

  it('maps the adapter platform id onto the tag platform slug', () => {
    expect(cardSourceFromMedia(MEDIA)).toMatchObject({ platform: 'max', series: 'Game of Thrones' });
    expect(mediaFromSource({ platform: 'max', title: 'X' })).toMatchObject({ platform: 'hbo' });
  });

  it('never repeats a tag', () => {
    const tags = buildCardTags('word', MEDIA, 'en');
    expect(new Set(tags).size).toBe(tags.length);
  });
});

describe('registry state machine', () => {
  it('starts in sending', () => {
    expect(newRecentCard(BASE).status).toBe('sending');
  });

  it('sending → saved records the note id and clears the retry', () => {
    const card = newRecentCard(BASE);
    const queued = markQueued(card, 'TIMEOUT', 10_000);
    const saved = markSaved(queued, 123, 20_000);
    expect(saved).toMatchObject({ status: 'saved', noteId: 123, savedAt: 20_000, attempts: 0 });
    expect(saved.nextRetryAt).toBeUndefined();
    expect(saved.error).toBeUndefined();
  });

  it('sending → queued keeps a backoff that mirrors the engine', () => {
    const card = newRecentCard(BASE);
    const first = markQueued(card, 'NETWORK', 10_000);
    expect(first).toMatchObject({ status: 'queued', attempts: 1, error: 'NETWORK' });
    expect(first.nextRetryAt).toBe(10_000 + 60_000);
    const second = markQueued(first, 'NETWORK', 20_000);
    expect(second.attempts).toBe(2);
    expect(second.nextRetryAt).toBe(20_000 + 120_000);
  });

  it('sending → failed drops the retry schedule', () => {
    const failed = markFailed(newRecentCard(BASE), 'API key');
    expect(failed).toMatchObject({ status: 'failed', error: 'API key' });
    expect(failed.nextRetryAt).toBeUndefined();
  });

  it('retry moves queued and failed back to sending', () => {
    for (const status of ['queued', 'failed'] as const) {
      const card: RecentCard = {
        ...newRecentCard(BASE),
        status,
        attempts: 2,
        nextRetryAt: 99,
        error: 'NETWORK',
      };
      const retrying = beginRetry(card);
      expect(retrying.status).toBe('sending');
      expect(retrying.nextRetryAt).toBeUndefined();
      expect(retrying.error).toBeUndefined();
      expect(retrying.attempts).toBe(2);
    }
  });

  it('a full retry cycle ends saved', () => {
    const queued = markQueued(newRecentCard(BASE), 'TIMEOUT', 1);
    const saved = markSaved(beginRetry(queued), 77, 2);
    expect(saved).toMatchObject({ status: 'saved', noteId: 77 });
  });

  it('markSaved replaces the media flags with what the worker actually stored', () => {
    const card = newRecentCard({ ...BASE, media: { frame: true, audio: true, word: true } });
    const saved = markSaved(card, 9, 2, { frame: false, audio: true });
    // A retry saved the note, but the frame it intended is not on the note.
    expect(saved.media).toEqual({ frame: false, audio: true, word: true });
    expect(hasFrame(saved)).toBe(false);
    expect(hasAudio(saved)).toBe(true);
  });

  it('markSaved keeps the flags when the stored media was not inspected', () => {
    // Idempotency hit: the note already existed and its media was not read,
    // so the row must not claim the media is gone.
    const card = newRecentCard({ ...BASE, media: { frame: true, audio: true } });
    const saved = markSaved(card, 9, 2);
    expect(saved.media).toEqual({ frame: true, audio: true });
    expect(hasFrame(saved)).toBe(true);
    expect(hasAudio(saved)).toBe(true);
  });

  it('media helpers never claim media for a card that is not saved yet', () => {
    const queued = markQueued(newRecentCard({ ...BASE, media: { frame: true, audio: true } }), 'NETWORK', 1);
    expect(hasFrame(queued)).toBe(false);
    expect(hasAudio(queued)).toBe(false);
  });
});

describe('registry cap and revive', () => {
  it('keeps every pending card and only 50 saved ones', () => {
    const pending = Array.from({ length: 5 }, (_, i) =>
      markQueued(newRecentCard({ ...BASE, id: `q${i}` }), 'NETWORK', i));
    const saved = Array.from({ length: 60 }, (_, i) =>
      markSaved(newRecentCard({ ...BASE, id: `s${i}` }), i, i));
    const trimmed = trimCards([...pending, ...saved]);
    expect(trimmed.filter((c) => c.status !== 'saved')).toHaveLength(5);
    expect(trimmed.filter((c) => c.status === 'saved')).toHaveLength(RECENT_LIMIT - 5);
  });

  it('converts an interrupted sending row back to queued', () => {
    const revived = reviveCards([{ ...newRecentCard(BASE), status: 'sending' }]);
    expect(revived[0]).toMatchObject({ status: 'queued' });
    expect(revived[0].nextRetryAt).toBeGreaterThan(Date.now());
  });

  it('drops malformed rows and defaults missing metadata', () => {
    const revived = reviveCards([
      null,
      { id: 1, word: 'x', sentence: 'y', status: 'saved' },
      { id: 'ok', word: 'x', sentence: 'y', status: 'saved' },
    ]);
    expect(revived).toHaveLength(1);
    expect(revived[0]).toMatchObject({ id: 'ok', kind: 'word', lang: 'en', attempts: 0, tags: [] });
  });

  it('returns [] for a non-array value', () => {
    expect(reviveCards({})).toEqual([]);
  });
});

describe('card registry storage', () => {
  function memoryRegistry() {
    let value: unknown = undefined;
    const registry = createCardRegistry({
      async read() {
        return value;
      },
      async write(cards) {
        value = cards;
      },
    });
    return { registry, stored: () => value as RecentCard[] };
  }

  it('publishes every transition to storage', async () => {
    const { registry, stored } = memoryRegistry();
    await registry.put(newRecentCard(BASE));
    expect(stored()).toHaveLength(1);
    expect(stored()[0].status).toBe('sending');

    await registry.patch('c1', { status: 'saved', noteId: 9 });
    expect(stored()[0]).toMatchObject({ status: 'saved', noteId: 9 });
  });

  it('does not resurrect a dismissed card', async () => {
    const { registry } = memoryRegistry();
    await registry.put(newRecentCard(BASE));
    await registry.remove('c1');
    const patched = await registry.patch('c1', { status: 'saved', noteId: 9 });
    expect(patched).toBeUndefined();
    expect(await registry.list()).toEqual([]);
  });

  it('finds a card by note id and removes it with the undo', async () => {
    const { registry } = memoryRegistry();
    await registry.put(markSaved(newRecentCard(BASE), 44, 1));
    expect((await registry.findByNoteId(44))?.id).toBe('c1');
    await registry.removeByNoteId(44);
    expect(await registry.list()).toEqual([]);
  });

  it('replaces an existing record instead of duplicating it', async () => {
    const { registry } = memoryRegistry();
    await registry.put(newRecentCard(BASE));
    await registry.put(markSaved(newRecentCard(BASE), 5, 1));
    expect(await registry.list()).toHaveLength(1);
  });

  it('persists the media the worker actually stored, not the intent', async () => {
    const { registry, stored } = memoryRegistry();
    await registry.put(newRecentCard({ ...BASE, media: { frame: true, audio: true } }));
    const current = await registry.get('c1');
    if (!current) throw new Error('seeded card missing');
    // The retry ran from a rebuilt request: no frame, TTS audio attached.
    await registry.patch('c1', markSaved(current, 9, 1, { frame: false, audio: true }));
    expect(stored()[0].media).toEqual({ frame: false, audio: true });
    expect(hasFrame(stored()[0])).toBe(false);
    expect(hasAudio(stored()[0])).toBe(true);
  });
});
