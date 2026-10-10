/**
 * The deep-link consume: hash first, session slot second, each read ONCE.
 *
 * The moment that matters is the second deep link in the SAME page: the popover
 * strip can be clicked again while Options is already open. React StrictMode
 * runs the effect twice, so overlapping calls must not race their own
 * `remove()` and lose the section. But a latch that is never released answers
 * every later call with the FIRST section and abandons the new slot — which is
 * the bug this suite exists to catch, so the dedup clears on settle.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  consumeOpenSettingsSection,
  OPEN_SETTINGS_SECTION_KEY,
} from '../../src/shared/open-settings-section';

/** A session store whose contents the test controls per call. */
function installSession(sections: Array<Record<string, string> | {}>): void {
  const store: Record<string, Record<string, string>> = { 0: {}, 1: {}, 2: {} };
  sections.forEach((s, i) => {
    store[i] = s as Record<string, string>;
  });
  let call = 0;
  vi.stubGlobal('chrome', {
    storage: {
      session: {
        get: async () => {
          const snapshot = store[call] ?? {};
          call += 1;
          return snapshot;
        },
        remove: async (keys: Record<string, string>) => {
          const key = Object.keys(keys)[0];
          for (const s of Object.values(store)) delete s[key];
        },
        set: async () => {},
      },
    },
    runtime: { getURL: (p: string) => `chrome-extension://test/${p}` },
  });
}

describe('consumeOpenSettingsSection', () => {
  beforeEach(() => {
    // The module caches nothing per test run, but a previous test's hash can
    // linger on the shared location: reset it so the slot path is what is read.
    window.location.hash = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.location.hash = '';
  });

  it('reads the slot and removes it', async () => {
    installSession([{ [OPEN_SETTINGS_SECTION_KEY]: 'perm' }]);
    expect(await consumeOpenSettingsSection()).toBe('perm');
    // Removed: a later plain open of the panel must not jump to Permisos.
    installSession([{}, {}, {}]);
    expect(await consumeOpenSettingsSection()).toBeUndefined();
  });

  it('returns the hash without letting a stale slot leak to the next visit', async () => {
    // A hash AND a slot at once: the hash wins on the URL, and the slot is
    // still consumed here so the next plain open does not jump to it.
    const removed: string[] = [];
    vi.stubGlobal('chrome', {
      storage: {
        session: {
          get: async () => ({ [OPEN_SETTINGS_SECTION_KEY]: 'tts' }),
          set: async () => {},
          remove: async (key: string) => {
            removed.push(key);
          },
        },
      },
      runtime: { getURL: (p: string) => `chrome-extension://test/${p}` },
    });
    window.location.hash = '#ia';
    expect(await consumeOpenSettingsSection()).toBe('ia');
    expect(removed).toEqual([OPEN_SETTINGS_SECTION_KEY]);
  });

  it('a second deep link in the same page returns its OWN section', async () => {
    installSession([{ [OPEN_SETTINGS_SECTION_KEY]: 'perm' }]);
    expect(await consumeOpenSettingsSection()).toBe('perm');
    // The user clicked the strip again: a NEW section arrives while the page is
    // still open. A permanent latch would answer 'perm' again and orphan it.
    installSession([{ [OPEN_SETTINGS_SECTION_KEY]: 'tts' }]);
    expect(await consumeOpenSettingsSection()).toBe('tts');
  });

  it('two overlapping calls (StrictMode) remove the slot exactly once', async () => {
    // DIFFERENT snapshots per call on purpose: with one shared snapshot both
    // calls read the same value even with no dedup, so the previous version of
    // this test proved nothing. Distinct snapshots mean an un-deduplicated pair
    // reads one value and gets it erased under the other.
    const calls = [
      { [OPEN_SETTINGS_SECTION_KEY]: 'perm' },
      { [OPEN_SETTINGS_SECTION_KEY]: 'tts' },
    ];
    const removed: string[] = [];
    let read = 0;
    vi.stubGlobal('chrome', {
      storage: {
        session: {
          get: async () => {
            const snapshot = calls[read] ?? {};
            read += 1;
            return snapshot;
          },
          set: async () => {},
          remove: async (key: string) => {
            removed.push(key);
          },
        },
      },
      runtime: { getURL: (p: string) => `chrome-extension://test/${p}` },
    });
    const [first, second] = await Promise.all([
      consumeOpenSettingsSection(),
      consumeOpenSettingsSection(),
    ]);
    // Both callers get the SAME answer (the first snapshot), and the slot is
    // erased once — not once per caller, which is what left a second read
    // landing on an already-cleared key.
    expect(first).toBe('perm');
    expect(second).toBe('perm');
    expect(removed).toEqual([OPEN_SETTINGS_SECTION_KEY]);
  });
});
