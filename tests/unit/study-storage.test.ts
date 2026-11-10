/**
 * F5 gate: per-language profiles on `chrome.storage.local`
 * (docs/REDESIGN-V2.md §3 H4, §4.3, §7 F5, §8).
 *
 * What matters:
 *   • the one-time migration moves the pre-profile global keys into the
 *     language being learned, is idempotent and never overwrites a
 *     per-language value that is already there;
 *   • marks live under `kvl:wordStatus:<lang>`, one key per language, and an
 *     `onChanged` from another context is adopted (a second tab sees it);
 *   • saving a card turns a «known» hand mark into the card (`learning`), and
 *     the word is never saved twice because it is now in Anki;
 *   • the interval refresh is a SNAPSHOT: the cached map is replaced, a word
 *     that left Anki disappears, marks are untouched, and an unchanged answer
 *     does not re-notify or rewrite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ankiSummaryOf, applyVocabTest, hydrateStudy, isInAnki, migrateToLanguageProfiles,
  noteCardSaved, removeAnkiWord, replaceAnkiIntervals, resetStudyStores, setSelfLevel,
  setWordStatus, studyStores,
  type LocalStorageArea,
} from '../../src/shared/study/wordStatus';

type ChangesCb = (changes: Record<string, { newValue?: unknown }>, area: string) => void;

interface FakeChrome {
  stored: Record<string, unknown>;
  area: LocalStorageArea;
  set: ReturnType<typeof vi.fn>;
  listeners: ChangesCb[];
}

function installChrome(initial: Record<string, unknown> = {}): FakeChrome {
  const stored = { ...initial };
  const listeners: ChangesCb[] = [];
  const set = vi.fn(async (items: Record<string, unknown>) => {
    Object.assign(stored, items);
  });
  const area: LocalStorageArea = {
    get: vi.fn(async (keys: string | string[]) => {
      const wanted = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const key of wanted) if (key in stored) out[key] = stored[key];
      return out;
    }),
    set,
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key];
    }),
  };
  const chromeMock = (globalThis as unknown as {
    chrome: { storage: { local: LocalStorageArea; onChanged: { addListener(cb: ChangesCb): void } } };
  }).chrome;
  chromeMock.storage.local = area;
  chromeMock.storage.onChanged = { addListener: (cb) => { listeners.push(cb); } };
  return { stored, area, set, listeners };
}

beforeEach(() => {
  resetStudyStores();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('migrateToLanguageProfiles', () => {
  it('moves the global keys into the active language once, keeping an existing profile', async () => {
    const { stored, area, set } = installChrome({
      'kvl:wordStatus': { sane: 'known' },
      'kvl:ankiWords': { sane: { interval: 30 } },
      'kvl:levelProfile': { knownUpTo: 'B1' },
      // A per-language value that must win over the legacy one.
      'kvl:wordStatus:fr': { jour: 'learning' },
    });

    await migrateToLanguageProfiles('fr', area);

    expect(stored['kvl:wordStatus:fr']).toEqual({ jour: 'learning' });
    expect(stored['kvl:ankiWords:fr']).toEqual({ sane: { interval: 30 } });
    expect(stored['kvl:levelProfile:fr']).toEqual({ knownUpTo: 'B1' });
    expect('kvl:wordStatus' in stored).toBe(false);
    expect('kvl:ankiWords' in stored).toBe(false);
    expect('kvl:levelProfile' in stored).toBe(false);
    expect(stored['kvl:profilesV']).toBe('1');

    // Idempotent: the flag short-circuits before any write.
    const writes = set.mock.calls.length;
    await migrateToLanguageProfiles('fr', area);
    expect(set.mock.calls.length).toBe(writes);
  });

  it('hydrates the moved profile through the legacy reviver', async () => {
    installChrome({
      'kvl:wordStatus': { sane: 'known' },
      'kvl:levelProfile': { knownUpTo: 'B1' },
    });
    await hydrateStudy('fr');
    const s = studyStores('fr');
    expect(s.status.get()).toEqual({ sane: 'known' });
    expect(s.profile.get().selfLevel).toBe('B1');
  });
});

describe('word status storage', () => {
  it('writes one key per language and adopts an onChanged from another context', async () => {
    const { stored, listeners } = installChrome();
    resetStudyStores();
    setWordStatus('en', 'Sane', 'known');
    expect(studyStores('en').status.get()).toEqual({ sane: 'known' });
    await studyStores('en').status.flush();
    expect(stored['kvl:wordStatus:en']).toEqual({ sane: 'known' });

    // Another tab marks another word: this context adopts it.
    const change = { 'kvl:wordStatus:en': { newValue: { day: 'new' } } };
    listeners.forEach((cb) => cb(change, 'local'));
    expect(studyStores('en').status.get()).toEqual({ day: 'new' });

    // A mark in another language does not leak into this profile.
    setWordStatus('fr', 'jour', 'learning');
    expect(studyStores('fr').status.get()).toEqual({ jour: 'learning' });
    expect(studyStores('en').status.get()).toEqual({ day: 'new' });
  });

  it('clears the hand mark with null, giving control back to Anki', () => {
    installChrome();
    resetStudyStores();
    setWordStatus('en', 'sane', 'known');
    setWordStatus('en', 'sane', null);
    expect(studyStores('en').status.get()).toEqual({});
  });

  it('a saved card turns a «known» mark into learning and is never saved twice', () => {
    installChrome();
    resetStudyStores();
    setWordStatus('en', 'sane', 'known');
    noteCardSaved('en', 'sane');

    expect(studyStores('en').status.get()).toEqual({});
    expect(studyStores('en').anki.get()).toEqual({ sane: { interval: 0 } });
    expect(isInAnki('en', 'sane')).toBe(true);
    expect(ankiSummaryOf(studyStores('en').anki.get())).toEqual({ total: 1, mature: 0, learning: 1 });
  });

  it('keeps a «new» mark when the word is saved', () => {
    installChrome();
    resetStudyStores();
    setWordStatus('en', 'sane', 'new');
    noteCardSaved('en', 'sane');
    expect(studyStores('en').status.get()).toEqual({ sane: 'new' });
    expect(isInAnki('en', 'sane')).toBe(true);
  });

  it('replaces the cached map with the snapshot: a word absent from Anki disappears', async () => {
    const { set } = installChrome();
    resetStudyStores();
    const anki = studyStores('en').anki;

    replaceAnkiIntervals('en', { day: 0, time: 30 });
    await anki.flush();
    expect(set).toHaveBeenCalledTimes(1);
    expect(anki.get()).toEqual({ day: { interval: 0 }, time: { interval: 30 } });

    // The snapshot is the whole truth: `day` is no longer in the answer, so it
    // leaves the cache instead of keeping its stale value.
    replaceAnkiIntervals('en', { time: 45 });
    await anki.flush();
    expect(set).toHaveBeenCalledTimes(2);
    expect(anki.get()).toEqual({ time: { interval: 45 } });
  });

  it('does not rewrite storage when the snapshot equals the cache', async () => {
    const { set } = installChrome();
    resetStudyStores();
    const anki = studyStores('en').anki;

    replaceAnkiIntervals('en', { day: 0, time: 30 });
    await anki.flush();
    expect(set).toHaveBeenCalledTimes(1);

    replaceAnkiIntervals('en', { day: 0, time: 30 });
    await anki.flush();
    expect(set).toHaveBeenCalledTimes(1);
    expect(anki.get()).toEqual({ day: { interval: 0 }, time: { interval: 30 } });
  });

  it('a snapshot never touches the user marks', () => {
    installChrome();
    resetStudyStores();
    setWordStatus('en', 'old', 'known');
    replaceAnkiIntervals('en', { sane: 21 });
    expect(studyStores('en').status.get()).toEqual({ old: 'known' });
    expect(studyStores('en').anki.get()).toEqual({ sane: { interval: 21 } });
  });

  it('ignores malformed intervals instead of poisoning the snapshot', () => {
    installChrome();
    resetStudyStores();
    replaceAnkiIntervals('en', { day: Number.NaN, time: -2, sane: 21 } as unknown as Record<string, number>);
    expect(studyStores('en').anki.get()).toEqual({ sane: { interval: 21 } });
  });

  it('undo removes the word from the cache (removeAnkiWord), marks untouched', () => {
    installChrome();
    resetStudyStores();
    setWordStatus('en', 'sane', 'new');
    replaceAnkiIntervals('en', { sane: 12, time: 30 });
    expect(isInAnki('en', 'sane')).toBe(true);

    removeAnkiWord('en', 'sane');

    expect(studyStores('en').anki.get()).toEqual({ time: { interval: 30 } });
    expect(isInAnki('en', 'sane')).toBe(false);
    // The hand mark is not the Anki cache — undo never deletes it.
    expect(studyStores('en').status.get()).toEqual({ sane: 'new' });
    // Same normalization as the cache keys: «Sane» hits «sane».
    removeAnkiWord('en', 'Time');
    expect(studyStores('en').anki.get()).toEqual({});
  });
});

describe('level profile storage', () => {
  it('persists the self-assessment and a check per language', async () => {
    const { stored } = installChrome();
    resetStudyStores();
    setSelfLevel('en', 'B2');
    applyVocabTest('en', ['time', 'day'], { time: 'ok' }, ['time', 'day']);
    await studyStores('en').profile.flush();

    const saved = stored['kvl:levelProfile:en'] as { selfLevel: string; vocabTest: { answers: string[]; checks: Record<string, string>; shown: string[] } };
    expect(saved.selfLevel).toBe('B2');
    expect(saved.vocabTest.answers).toEqual(['time', 'day']);
    expect(saved.vocabTest.checks).toEqual({ time: 'ok' });
    expect(saved.vocabTest.shown).toEqual(['time', 'day']);
  });
});