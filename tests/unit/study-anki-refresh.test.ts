/**
 * F5 gate: `ANKI_WORD_INTERVALS` answers a SNAPSHOT and the caller applies it
 * as one (docs/REDESIGN-V2.md §6/§7 F5).
 *
 * On save the card is registered with interval 0 immediately (so the card is
 * never created twice and the word reads «learning» at once), and a
 * background call replaces the cache with the deck snapshot. An error is NOT
 * an empty deck: `ok: false` (or a thrown message) keeps the cached map and
 * flips the coverage flag to `stale`; `{ ok: true, words: {} }` really
 * replaces it with nothing. The request uses the deck of the language being
 * learned and the field mapped to `selection`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendMessage } from 'webext-bridge/content-script';
import { useKivaraStore } from '../../src/shared/use-kivara-store';
import { getAnkiCoverage, recordCardSaved, refreshAnkiIntervals } from '../../src/content/ui/study';
import { replaceAnkiIntervals, hydrateStudy, resetStudyStores, setWordStatus, studyStores } from '../../src/shared/study/wordStatus';
import { DEFAULT_ANKI_MAPPING } from '../../src/shared/store';

const send = vi.mocked(sendMessage);

function installStorage() {
  const stored: Record<string, unknown> = {};
  (globalThis as unknown as { chrome: { storage: Record<string, unknown> } }).chrome.storage = {
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
    sync: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) },
  };
}

beforeEach(async () => {
  resetStudyStores();
  installStorage();
  useKivaraStore.setState({
    ankiMapping: {
      ...DEFAULT_ANKI_MAPPING,
      deckName: 'Fallback deck',
      decks: { en: 'English deck' },
      fieldSources: { Front: 'selection' },
    },
  });
  // The stores queue writes until hydration resolves; these tests read them
  // synchronously right after a set.
  await hydrateStudy('en');
});

describe('refresh after a save', () => {
  it('registers the card at once and replaces the cache with the snapshot afterwards', async () => {
    send.mockResolvedValueOnce({ ok: true, words: { sane: 42 } });
    recordCardSaved('en', 'sane');

    // The interval is written before the round trip returns.
    expect(studyStores('en').anki.get()).toEqual({ sane: { interval: 0 } });

    await vi.waitFor(() => {
      expect(studyStores('en').anki.get()).toEqual({ sane: { interval: 42 } });
    });
    expect(send).toHaveBeenCalledWith(
      'ANKI_WORD_INTERVALS',
      { lang: 'en', deck: 'English deck', fieldName: 'Front' },
      'background',
    );
    expect(getAnkiCoverage('en')).toEqual({ state: 'fresh' });
  });
});

describe('snapshot semantics', () => {
  it('a word absent from the snapshot disappears; the user mark survives', async () => {
    replaceAnkiIntervals('en', { sane: 40, old: 100 });
    setWordStatus('en', 'old', 'known');

    send.mockResolvedValueOnce({ ok: true, words: { sane: 41 } });
    await refreshAnkiIntervals('en');

    expect(studyStores('en').anki.get()).toEqual({ sane: { interval: 41 } });
    // Marks live in their own store: only the Anki-derived map was replaced.
    expect(studyStores('en').status.get()).toEqual({ old: 'known' });
  });

  it('an empty deck replaces the cache with nothing and reads fresh', async () => {
    replaceAnkiIntervals('en', { sane: 40 });

    send.mockResolvedValueOnce({ ok: true, words: {} });
    await refreshAnkiIntervals('en');

    // Empty is a real answer here: the deck was read and holds nothing.
    expect(studyStores('en').anki.get()).toEqual({});
    expect(getAnkiCoverage('en')).toEqual({ state: 'fresh' });
  });
});

describe('error vs empty deck', () => {
  it('an ok:false answer keeps the cache and flags it stale with the error', async () => {
    replaceAnkiIntervals('en', { sane: 40 });

    send.mockResolvedValueOnce({ ok: false, error: 'Anki is closed' });
    await refreshAnkiIntervals('en');

    // Failed query ≠ empty deck: the cached intervals survive untouched.
    expect(studyStores('en').anki.get()).toEqual({ sane: { interval: 40 } });
    expect(getAnkiCoverage('en')).toEqual({ state: 'stale', error: 'Anki is closed' });
  });

  it('a thrown message keeps the cache and flags it stale', async () => {
    replaceAnkiIntervals('en', { sane: 40 });

    send.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(refreshAnkiIntervals('en')).resolves.toBeUndefined();

    expect(studyStores('en').anki.get()).toEqual({ sane: { interval: 40 } });
    expect(getAnkiCoverage('en')).toEqual({ state: 'stale' });
  });

  it('coverage starts unknown before the first refresh', () => {
    expect(getAnkiCoverage('fr')).toEqual({ state: 'unknown' });
  });
});
