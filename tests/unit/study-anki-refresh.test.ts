/**
 * F5 gate: `ANKI_WORD_INTERVALS` refreshes the cached intervals incrementally
 * (docs/REDESIGN-V2.md §6/§7 F5).
 *
 * On save the card is registered with interval 0 immediately (so the card is
 * never created twice and the word reads «learning» at once), and a background
 * call reads the real interval. The request uses the deck of the language
 * being learned and the field mapped to `selection`, and the answer is merged
 * value by value.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendMessage } from 'webext-bridge/content-script';
import { useKivaraStore } from '../../src/shared/store';
import { recordCardSaved, refreshAnkiIntervals } from '../../src/content/ui/study';
import { resetStudyStores, studyStores } from '../../src/shared/study/wordStatus';
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

beforeEach(() => {
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
});

describe('refresh after a save', () => {
  it('registers the card at once and merges the real interval afterwards', async () => {
    send.mockResolvedValueOnce({ words: { sane: 42 } });
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
  });

  it('keeps the cached values when Anki is unreachable', async () => {
    send.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(refreshAnkiIntervals('en')).resolves.toBeUndefined();
    expect(studyStores('en').anki.get()).toEqual({});
  });
});