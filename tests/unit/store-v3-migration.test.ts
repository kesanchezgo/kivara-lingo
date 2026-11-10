/**
 * Store v3 migration (docs/REDESIGN-V2.md §4.4).
 *
 * The migration runs over REAL persisted snapshots — the shapes the previous
 * builds actually wrote — not over a hand-invented intermediate. The three
 * additions are pure derivations of values already in the blob, which is what
 * makes the second run a no-op:
 *   • `study` comes from `translate.showDualSubtitle`;
 *   • `ankiMapping.decks` comes from the single `deckName`;
 *   • `shortcuts` gains the new actions without touching a custom combo.
 *
 * The blob-size test is the H4 guard: sync caps an item at 8 KB, and a large
 * field mapping must still leave room for the writer tag.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  DEFAULT_AI,
  DEFAULT_ANKI_MAPPING,
  DEFAULT_CAPTURE,
  DEFAULT_CLEANUP,
  DEFAULT_ONBOARDING,
  DEFAULT_SHORTCUTS,
  DEFAULT_STUDY,
  DEFAULT_SUBTITLE_STYLES,
  DEFAULT_TELEMETRY,
  DEFAULT_TRANSLATE,
  DEFAULT_TTS,
  DEFAULT_VIP,
  STORE_VERSION,
  migrateStoreState,
} from '../../src/shared/store';
import type { FieldSource } from '../../src/shared/types';

interface Snapshot {
  state?: Record<string, unknown>;
  version?: number;
}

function migrateV2(snapshot: Snapshot): Record<string, unknown> {
  const copy = structuredClone(snapshot);
  const out = migrateStoreState(copy.state, 2) as Record<string, unknown>;
  return out;
}

describe('store v3 migration', () => {
  it('is version 3', () => {
    expect(STORE_VERSION).toBe(3);
  });

  it('adds the study defaults to a snapshot that never had them', () => {
    const state = migrateV2({ state: { translate: { sourceLang: 'en' } }, version: 2 });
    expect(state.study).toEqual(DEFAULT_STUDY);
  });

  it('maps showDualSubtitle:false to a hidden translation', () => {
    const state = migrateV2({
      state: { translate: { sourceLang: 'en', showDualSubtitle: false } },
      version: 2,
    });
    expect((state.study as { translation: string }).translation).toBe('hidden');
  });

  it('maps showDualSubtitle:true (and an absent field) to visible', () => {
    const shown = migrateV2({ state: { translate: { showDualSubtitle: true } }, version: 2 });
    const absent = migrateV2({ state: { translate: {} }, version: 2 });
    expect((shown.study as { translation: string }).translation).toBe('visible');
    expect((absent.study as { translation: string }).translation).toBe('visible');
  });

  it('turns the single deckName into the deck of the learned language', () => {
    const state = migrateV2({
      state: {
        translate: { sourceLang: 'fr' },
        ankiMapping: { ...DEFAULT_ANKI_MAPPING, deckName: 'Français', fieldSources: { word: 'selection' } },
      },
      version: 2,
    });
    const mapping = state.ankiMapping as { deckName: string; decks: Record<string, string> };
    expect(mapping.deckName).toBe('Français');
    expect(mapping.decks).toEqual({ fr: 'Français' });
  });

  it('defaults the deck language to en and skips an empty deckName', () => {
    const noLang = migrateV2({ state: { ankiMapping: { deckName: 'Mine' } }, version: 2 });
    expect((noLang.ankiMapping as { decks: unknown }).decks).toEqual({ en: 'Mine' });

    const empty = migrateV2({ state: { ankiMapping: { deckName: '' } }, version: 2 });
    expect((empty.ankiMapping as { decks?: unknown }).decks).toBeUndefined();
  });

  it('never overwrites an existing deck map', () => {
    const state = migrateV2({
      state: { ankiMapping: { deckName: 'Old', decks: { de: 'Deutsch' } } },
      version: 2,
    });
    expect((state.ankiMapping as { decks: unknown }).decks).toEqual({ de: 'Deutsch' });
  });

  it('fills missing shortcuts and leaves the custom ones alone', () => {
    const state = migrateV2({
      state: { shortcuts: { save: 'Ctrl+Alt+S', replay: '' } },
      version: 2,
    });
    const shortcuts = state.shortcuts as Record<string, string>;
    expect(shortcuts.save).toBe('Ctrl+Alt+S');
    expect(shortcuts.replay).toBe('');
    for (const [id, combo] of Object.entries(DEFAULT_SHORTCUTS)) {
      expect(shortcuts[id]).toBeDefined();
      expect(typeof shortcuts[id]).toBe('string');
      if (id !== 'save' && id !== 'replay') expect(shortcuts[id]).toBe(combo);
    }
  });

  it('is idempotent', () => {
    const base: Snapshot = {
      state: {
        translate: { sourceLang: 'en', showDualSubtitle: false },
        ankiMapping: { deckName: 'Vocab', fieldSources: { word: 'selection' } },
        shortcuts: { save: 'Meta+S' },
        ai: { provider: 'anthropic', model: 'claude-3-5-haiku-latest' },
      },
      version: 2,
    };
    const once = structuredClone(base);
    const afterFirst = migrateStoreState(once.state, 2);
    const firstJson = JSON.stringify(afterFirst);

    const twice = structuredClone(base);
    migrateStoreState(twice.state, 2);
    const afterSecond = migrateStoreState(twice.state, 2);
    expect(JSON.stringify(afterSecond)).toBe(firstJson);
  });

  it('still rewrites a retired AI model on the way to v3', () => {
    const state = migrateV2({ state: { ai: { provider: 'anthropic', model: 'claude-3-5-haiku-latest' } }, version: 2 });
    expect((state.ai as { model: string }).model).toBe('claude-haiku-4-5');
  });

  it('never touches a snapshot already at the current version', () => {
    const snapshot = { study: { translation: 'blur' }, ankiMapping: { decks: {} } };
    expect(migrateStoreState(structuredClone(snapshot), 3)).toEqual(snapshot);
  });

  it('keeps a worst-case blob under the 6 KB budget', () => {
    // Deliberately hostile mapping: every field on a large note model, a deck
    // per language, and a full shortcut map. This is the ceiling the H4 test
    // exists to catch, not a realistic profile.
    const sources: FieldSource[] = [
      'selection', 'cue', 'phonetic', 'translation', 'bilingual', 'monolingual',
      'examples', 'frame', 'sentence-audio', 'word-audio', 'synonyms', 'antonyms',
      'collocations', 'frequency', 'etymology', 'mnemonic', 'image', 'video-link',
      'ai-definition', 'ai-synonyms', 'ai-collocations', 'ai-nuance', 'ai-register',
      'cloze', 'source', 'manual',
    ];
    const fieldSources: Record<string, FieldSource> = {};
    for (let i = 0; i < 40; i += 1) fieldSources[`Field with a long Anki name ${i}`] = sources[i % sources.length];
    const decks: Record<string, string> = {};
    for (const lang of ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh', 'ru']) {
      decks[lang] = `Kivara · ${lang.toUpperCase()} · vocabulary deck`;
    }

    const state = {
      enabled: true,
      subtitlesVisible: true,
      isDarkMode: true,
      mode: 'learning',
      subtitleStyles: { ...DEFAULT_SUBTITLE_STYLES, cardTheme: 'auto' },
      ankiMapping: { ...DEFAULT_ANKI_MAPPING, deckName: 'Kivara EN', decks, fieldSources, fieldRulesVersion: 2 },
      capture: { ...DEFAULT_CAPTURE },
      cleanup: { ...DEFAULT_CLEANUP },
      translate: {
        ...DEFAULT_TRANSLATE,
        tiersEnabled: { ...DEFAULT_TRANSLATE.tiersEnabled },
        freeChain: [...DEFAULT_TRANSLATE.freeChain],
        premiumChain: [...DEFAULT_TRANSLATE.premiumChain],
      },
      study: { ...DEFAULT_STUDY },
      ai: { ...DEFAULT_AI, baseUrl: 'https://api.example-provider.com/v1', apiFormat: 'openai-chat' },
      vip: { ...DEFAULT_VIP },
      tts: { ...DEFAULT_TTS },
      panelPosition: { top: 96, left: 420 },
      onboarding: { ...DEFAULT_ONBOARDING },
      telemetry: { ...DEFAULT_TELEMETRY },
      shortcuts: { ...DEFAULT_SHORTCUTS },
    };
    const blob = JSON.stringify({ state, version: STORE_VERSION });
    expect(blob.length).toBeLessThan(6 * 1024);
  });
});
/**
 * The same upgrade through the REAL persist pipeline, so the `{ state,
 * version }` envelope cannot drift from what `migrateStoreState` expects —
 * the exact failure the v1→v2 migration shipped with (its unit test fed the
 * wrong shape and stayed green).
 */
describe('store v3 through zustand persist', () => {
  const KEY = 'kivara-lingo-state';
  const snapshots = new Map<string, string>();
  const prevChrome = (globalThis as unknown as { chrome?: unknown }).chrome;

  afterEach(() => {
    (globalThis as unknown as { chrome?: unknown }).chrome = prevChrome;
    vi.resetModules();
  });

  it('hydrates a v2 snapshot into study + decks', async () => {
    snapshots.set(KEY, JSON.stringify({
      state: {
        translate: { sourceLang: 'fr', showDualSubtitle: false },
        ankiMapping: { deckName: 'Français', modelName: 'KivaraLingo', fieldSources: {} },
        shortcuts: { save: 'Ctrl+Alt+S' },
      },
      version: 2,
    }));
    const pick = (keys: string[] | string) => {
      const out: Record<string, unknown> = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) if (snapshots.has(k)) out[k] = snapshots.get(k);
      return out;
    };
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: {
        sync: {
          get: async (keys: string[] | string) => pick(keys),
          set: async (items: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(items)) snapshots.set(k, String(v));
          },
          remove: async (k: string) => { snapshots.delete(k); },
        },
        local: {
          get: async () => ({}),
          set: async () => {},
          remove: async () => {},
        },
        onChanged: { addListener: () => {}, removeListener: () => {} },
      },
      runtime: { id: 'test', lastError: undefined, getURL: (p: string) => `chrome-extension://test/${p}` },
      i18n: { getUILanguage: () => 'en' },
    };
    vi.resetModules();
    const mod = await import('../../src/shared/store');
    await mod.useKivaraStore.persist.rehydrate();

    const state = mod.useKivaraStore.getState();
    expect(state.study.translation).toBe('hidden');
    expect(state.study.pauseOnLookup).toBe(true);
    expect(state.ankiMapping.decks).toEqual({ fr: 'Français' });
    expect(state.shortcuts.save).toBe('Ctrl+Alt+S');

    await vi.waitFor(() => {
      const written = JSON.parse(snapshots.get(KEY) ?? '{}') as { state?: { study?: unknown }; version?: number };
      expect(written.version).toBe(3);
      expect(written.state?.study).toBeTruthy();
    });
  });
});
