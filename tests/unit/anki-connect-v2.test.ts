/**
 * F4 AnkiConnect client additions (docs/REDESIGN-V2.md §3 H8, §4.6).
 *
 * One assertion per new action (wire shape), plus the trust-boundary rules the
 * client already enforced: writes never replay on the 127.0.0.1 ↔ localhost
 * fallback, and a non-loopback URL is refused before any fetch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ankiConnect } from '../../src/background/anki-connect';

interface Call { action: string; params: Record<string, unknown>; key?: string }

function stubFetch(result: unknown): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { action: string; params: Record<string, unknown>; key?: string };
    calls.push({ action: body.action, params: body.params, key: body.key });
    return new Response(JSON.stringify({ result, error: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ankiConnect F4 actions', () => {
  it('deleteNotes posts the note ids', async () => {
    const calls = stubFetch(null);
    await ankiConnect.deleteNotes([1, 2], 'http://127.0.0.1:8765', 'secret');
    expect(calls).toEqual([{ action: 'deleteNotes', params: { notes: [1, 2] }, key: 'secret' }]);
  });

  it('addTags posts tags and note ids', async () => {
    const calls = stubFetch(null);
    await ankiConnect.addTags(['kivara::lang::en'], [7]);
    expect(calls[0].action).toBe('addTags');
    expect(calls[0].params).toEqual({ tags: ['kivara::lang::en'], notes: [7] });
  });

  it('guiBrowse posts the query and returns note ids', async () => {
    const calls = stubFetch([10, 11]);
    const ids = await ankiConnect.guiBrowse('deck:"D"', undefined, undefined);
    expect(calls[0]).toMatchObject({ action: 'guiBrowse', params: { query: 'deck:"D"' } });
    expect(ids).toEqual([10, 11]);
  });

  it('findCards posts the query', async () => {
    const calls = stubFetch([3]);
    await ankiConnect.findCards('nid:3');
    expect(calls[0]).toMatchObject({ action: 'findCards', params: { query: 'nid:3' } });
  });

  it('findNotes posts the query', async () => {
    const calls = stubFetch([21]);
    await ankiConnect.findNotes('deck:"D"');
    expect(calls[0]).toMatchObject({ action: 'findNotes', params: { query: 'deck:"D"' } });
  });

  it('notesInfo posts only the note ids and returns fields plus card ids', async () => {
    const calls = stubFetch([{
      noteId: 2,
      fields: { Word: { value: 'sane', order: 0 } },
      cards: [10, 11],
    }]);
    const info = await ankiConnect.notesInfo([2]);
    // No `render` parameter: note ids are the whole request, so Anki never
    // renders a card template for this snapshot.
    expect(calls).toEqual([{ action: 'notesInfo', params: { notes: [2] } }]);
    expect(info[0].noteId).toBe(2);
    expect(info[0].fields.Word.value).toBe('sane');
    expect(info[0].cards).toEqual([10, 11]);
  });

  it('cardsInfo returns scheduling data', async () => {
    const calls = stubFetch([{ cardId: 1, noteId: 2, interval: 21, fields: {} }]);
    const info = await ankiConnect.cardsInfo([1]);
    expect(calls[0]).toMatchObject({ action: 'cardsInfo', params: { cards: [1] } });
    expect(info[0].interval).toBe(21);
  });

  it('refuses a non-loopback URL before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(ankiConnect.deleteNotes([1], 'http://anki.example.com:8765')).rejects.toThrow(/loopback/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a write failure is not replayed on the fallback spelling', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(ankiConnect.deleteNotes([1], 'http://127.0.0.1:8765')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a read failure does try the fallback spelling', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(ankiConnect.findCards('nid:1', 'http://127.0.0.1:8765')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});