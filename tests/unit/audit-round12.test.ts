/**
 * RED TESTS — round 12 (base main@64f4f70). Five independent points.
 * Read-only source assertions where the contract is structural, real module
 * imports where behavior is at stake. Every test here FAILS on 64f4f70.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const modelSrc = () => readFileSync('src/shared/anki-model.ts', 'utf-8');
const orchSrc = () => readFileSync('src/background/capture-orchestrator.ts', 'utf-8');
const busSrc = () => readFileSync('src/content/platform-adapters/intercepted-bus.ts', 'utf-8');
const indexSrc = () => readFileSync('src/content/index.tsx', 'utf-8');
const netflixSrc = () => readFileSync('src/content/platform-adapters/netflix.ts', 'utf-8');
const popoverSrc = () => readFileSync('src/content/ui/WordPopover.tsx', 'utf-8');

describe('P1 — ONE KivaraLingo card template', () => {
  it('buildKivaraModel emits exactly ONE template named Card 1 with Front/Back', async () => {
    const { buildKivaraModel } = await import('../../src/shared/anki-model');
    const model = buildKivaraModel();
    expect(model.cardTemplates).toHaveLength(1);
    expect(model.cardTemplates[0]?.Name).toBe('Card 1');
    expect(model.cardTemplates[0]?.Back).toContain('{{FrontSide}}<hr id="answer">');
  });

  it('KIVARA_MODEL_FIELDS is exported for the automap path', async () => {
    const m = await import('../../src/shared/anki-model');
    expect((m as unknown as { KIVARA_MODEL_FIELDS?: readonly string[] }).KIVARA_MODEL_FIELDS)
      .toEqual(['word', 'phonetic', 'sentence', 'translation', 'bilingual', 'monolingual', 'picture', 'sentence audio', 'word audio']);
  });
});

describe('P2 — full auto-provision of model + deck in ONE save', () => {
  class FakeAnkiError extends Error {
    constructor(message: string, public readonly code?: string) {
      super(message);
      this.name = 'AnkiConnectError';
    }
  }

  function mocks(opts: { modelError?: boolean; deckError?: boolean; deckMissing?: boolean } = {}) {
    let attempt = 0;
    const addNoteImpl = async () => {
      attempt += 1;
      if (attempt === 1 && opts.modelError) throw new FakeAnkiError('model "KivaraLingo" was not found');
      if ((attempt === 1 && !opts.modelError) || (attempt === 2 && opts.modelError && opts.deckError)) {
        if (opts.deckError || opts.deckMissing) throw new FakeAnkiError('deck "English vocabulary" was not found');
      }
      return 900;
    };
    const addNote = vi.fn(addNoteImpl);
    const createDeck = vi.fn(async () => 1);
    const createModel = vi.fn(async () => null);
    const modelNames = vi.fn(async () => [] as string[]);
    const findNotes = vi.fn(async () => [] as number[]);
    const notesInfo = vi.fn(async () => []);
    const storeMediaFile = vi.fn(async (f: string) => f);
    vi.doMock('../../src/background/anki-connect', () => ({
      ankiConnect: { addNote, createDeck, createModel, modelNames, findNotes, notesInfo, storeMediaFile },
      dataUrlToBase64: (s: string) => s,
      AnkiConnectError: FakeAnkiError,
    }));
    vi.doMock('../../src/shared/db', () => ({
      getDB: () => ({
        saved_notes: { where: () => ({ equals: () => ({ first: async () => null }) }), put: async () => undefined },
        pending_notes: { add: async () => undefined, update: async () => undefined, delete: async () => undefined },
        translation_cache: { get: async () => undefined, put: async () => undefined },
        media_cache: { get: async () => undefined, put: async () => undefined },
        ai_cache: { get: async () => undefined, put: async () => undefined },
      }),
    }));
    vi.doMock('../../src/background/translate', () => ({
      translateToken: async (token: string) => ({ token, type: 'word', translation: 'correr' }),
      translateText: async () => ({ ok: false, error: 'offline' }),
    }));
    vi.doMock('../../src/background/ai-enrich', () => ({
      getAiSettings: async () => ({ provider: 'disabled', enrichOnSave: false }),
      getResolvedNativeLang: async () => 'es',
      enrichWithAi: async () => ({ ok: false, error: 'disabled' }),
    }));
    vi.doMock('../../src/background/enrichment/orchestrator', () => ({ runEnrichment: async () => ({ entry: null }) }));
    vi.doMock('../../src/background/tts', () => ({ generateTtsAudio: async () => ({ ok: false }) }));
    vi.doMock('../../src/background/audio-capture-manager', () => ({
      getAudioCaptureStatus: async () => ({ active: false }),
      extractAudioClip: async () => ({ ok: false }),
    }));
    vi.doMock('../../src/background/vip-settings', () => ({
      getVipSettings: async () => ({ enabled: false }),
      loadTranslateTargetLang: async () => 'es',
    }));
    vi.doMock('../../src/background/phonetic-augment', () => ({ getMissingPhonetic: async () => '' }));
    vi.doMock('../../src/shared/net-guard', () => ({
      fetchMediaWithLimits: async () => { throw new Error('offline'); },
      mediaExtFor: () => 'jpg',
    }));
    return { addNote, createDeck, createModel, modelNames };
  }

  beforeEach(() => vi.resetModules());

  it('empty fieldSources + KivaraLingo automaps the 9 fields; both missing pieces are created in one save', async () => {
    const m = mocks({ modelError: true, deckError: true });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const res = await createCardFromRequest({
      token: 'run', sentence: 'RUN is hard work', lang: 'en', kind: 'word', deck: 'English vocabulary',
    } as never, {
      ankiUrl: 'http://127.0.0.1:8765', deckName: '', modelName: 'KivaraLingo', fieldSources: {},
    } as never, undefined as never);
    expect(res.ok).toBe(true);
    expect(m.createModel).toHaveBeenCalledTimes(1);
    expect(m.createDeck).toHaveBeenCalledTimes(1);
    expect(m.addNote).toHaveBeenCalledTimes(3);
    const lastCall = m.addNote.mock.calls.at(-1) as unknown as [{ fields: Record<string, string> }] | undefined;
    const fields = lastCall?.[0]?.fields ?? {};
    expect(Object.keys(fields).sort()).toEqual([
      'bilingual', 'monolingual', 'word', 'phonetic', 'picture', 'sentence',
      'sentence audio', 'translation', 'word audio',
    ].sort());
  });

  it('the wizard model button installs KivaraLingo with no free-text name', () => {
    const src = readFileSync('src/onboarding/steps/MappingStep.tsx', 'utf-8');
    // The new-model branch must FIX the name, not let the user type one.
    expect(src).toContain("KIVARA_MODEL_NAME");
    const modelInput = /modelCreateMode\s*\?\s*\(\s*<input/.test(src);
    expect(modelInput).toBe(false);
  });
});

describe('P3 — DASH src vs tgt background flag', () => {
  it('downloadAndPublishDashTrack takes isBackground: src adopts, tgt stays auxiliary', () => {
    const src = busSrc();
    expect(src).toMatch(/async function downloadAndPublishDashTrack\(\n\s*track:[^\n]*\n\s*langKey: string,\n\s*isBackground: boolean,/);
    expect(src).toContain('isBackground ? true : undefined');
    expect(src).toContain('if (!isBackground) lastTrack = tTrack;');
  });
});

describe('P4 — manifest lifecycle across nav vs language change', () => {
  it('lastNetflixManifest is saved BEFORE the language filter', () => {
    const src = busSrc();
    const atSave = src.indexOf('lastNetflixManifest = { tracks, nativeBody, nativeUrl };');
    const atFilter = src.indexOf('if (!targetPrimary || tracksByLang.has(targetPrimary)) return;');
    expect(atSave).toBeGreaterThan(-1);
    expect(atSave).toBeLessThan(atFilter);
  });

  it('clearBus takes keepManifests; language changes keep, navigation clears', () => {
    const bus = busSrc();
    expect(bus).toContain('keepManifests?: boolean');
    const index = indexSrc();
    // Both language-change blocks (source and target) preserve manifests.
    expect((index.match(/clearBus\(\{ keepManifests: true \}\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('the Netflix auto-track watcher ignores auxiliary tracks in hasTrackFor', () => {
    expect(netflixSrc()).toContain('!t.background');
  });
});

describe('P5 — full-bleed button geometry inside the padded body', () => {
  it('the three bottom buttons use the calc width, not w-full', () => {
    const src = popoverSrc();
    expect((src.match(/-mx-3\.5 w-\[calc\(100%\+1\.75rem\)\]/g) ?? []).length).toBe(3);
    expect(src).not.toMatch(/-mx-3\.5 w-full/);
  });
});
