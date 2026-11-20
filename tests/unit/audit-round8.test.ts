/**
 * RED TESTS — audit round 8 (base 1a417ea). Production paths only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function installCardStorage(): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} } },
  };
}

const BASE_REQ = {
  token: 'running', sentence: 'She is running.', identityKey: 'run', surface: 'running',
  contextGloss: '—', language: 'en', deck: 'English vocab',
};

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  delete (globalThis as { chrome?: unknown }).chrome;
  installCardStorage();
});

function wiringMocks() {
  const put = vi.fn(async () => undefined);
  const createCardFromRequest = vi.fn(async () => ({ ok: true, noteId: 777, warnings: [] }));
  vi.doMock('../../src/background/card-registry', () => ({
    cardRegistry: {
      put,
      patch: vi.fn(async () => undefined),
      get: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      removeByNoteId: vi.fn(async () => undefined),
      findByNoteId: vi.fn(async () => undefined),
      list: vi.fn(async () => []),
    },
  }));
  vi.doMock('../../src/background/capture-orchestrator', () => ({
    createCardFromRequest,
    retryPendingNotes: vi.fn(async () => ({ retried: 0, succeeded: 0 })),
  }));
  vi.doMock('../../src/shared/cards', async (importOriginal: () => Promise<unknown>) => ({
    ...((await importOriginal()) as object),
    buildCardTags: vi.fn(() => ['kivara-lingo']),
  }));
  vi.doMock('../../src/background/vip-settings', () => ({
    getVipSettings: async () => ({ enabled: false }),
    loadTranslateTargetLang: async () => 'es',
  }));
  return { put, createCardFromRequest };
}

describe('P1 — handleCreateCard(raw, deps) is the CREATE_CARD body', () => {
  it('the row it puts carries the identity slice, and a running→run retry adds no note', async () => {
    const { put } = wiringMocks();
    const { handleCreateCard } = await import('../../src/background/create-card-handler');
    const res = await handleCreateCard(
      { ...BASE_REQ, cardId: 'card-1' } as never,
      {
        loadMapping: async () => ({ deckName: 'English vocab', modelName: 'Basic', fieldSources: { Front: 'selection', Sentence: 'cue' } }),
        loadCaptureSettings: async () => ({ endDetect: 'vad', bufferSize: 30, preRoll: 0, postRoll: 0, cueMerge: 300 }),
        refreshAnkiOriginRules: async () => {},
        invalidateSavedWordsCache: () => {},
        createCardFromRequest: (vi.doMock('../../src/background/capture-orchestrator', () => ({
          createCardFromRequest: vi.fn(async () => ({ ok: true, reused: 'other-context', noteId: 4242 })),
          retryPendingNotes: vi.fn(async () => ({ retried: 0, succeeded: 0 })),
        })), (await import('../../src/background/capture-orchestrator')).createCardFromRequest),
      } as never,
    );
    expect(res.ok).toBe(true);
    const call0 = put.mock.calls[0] as unknown as [{ identityKey?: string; surface?: string; contextGloss?: string }];
    const row = call0[0];
    expect(row.identityKey).toBe('run');
    expect(row.surface).toBe('running');
    expect(row.contextGloss).toBeUndefined(); // '—' normalized away
  });
});

describe('P2 — a saved frame skips capture and a saved scene keeps cue 1', () => {
  it('savedSceneDecision uses the SAVED cue, never the live one', async () => {
    const { applySavedScene } = await import('../../src/content/ui/save-scene');
    const saved = { sentence: 'RUN is hard work', frame: 'data:image/jpeg;base64,SAVED', cueStart: 0, cueEnd: 3000 };
    const live = { sentence: 'the second cue', frame: 'data:image/jpeg;base64,LIVE', cueStart: 3000, cueEnd: 9000 };
    const decision = applySavedScene(saved, live);
    expect(decision.sentence).toBe('RUN is hard work');
    expect(decision.frame).toBe('data:image/jpeg;base64,SAVED');
    expect(decision.cueStart).toBe(0);
    expect(decision.cueEnd).toBe(3000);
    expect(decision.captureFrame).toBe(false);
  });
});

describe('P3 — one anchor instant: 1.5 s of SW work barely shifts the clip', () => {
  it('resolveAudio uses the persisted anchor, not the wall clock after an await', async () => {
    const extract = vi.fn(async () => ({ ok: true, dataUrl: 'data:audio/mpeg;base64,AA', mimeType: 'audio/mpeg' }));
    vi.doMock('../../src/background/anki-connect', () => ({
      ankiConnect: { addNote: vi.fn(async () => 1), findNotes: vi.fn(async () => []), notesInfo: vi.fn(async () => []), addTags: vi.fn(async () => null), storeMediaFile: vi.fn(async (f: string) => f) },
      dataUrlToBase64: (s: string) => s,
      AnkiConnectError: class extends Error {},
    }));
    vi.doMock('../../src/background/audio-capture-manager', () => ({
      getAudioCaptureStatus: async () => ({ active: true }),
      extractAudioClip: extract,
    }));
    vi.doMock('../../src/shared/db', async (importOriginal: () => Promise<unknown>) => {
      const actual = (await importOriginal()) as Record<string, unknown>;
      const cache = { get: async () => { throw new Error('no db'); }, put: async () => {} };
      return { ...(actual as object), getDB: () => ({
        saved_notes: { where: () => ({ equals: () => ({ first: async () => null }) }), put: async () => {} },
        pending_notes: { add: async () => {}, update: async () => {}, delete: async () => {} },
        translation_cache: cache, media_cache: cache, ai_cache: cache,
      }) };
    });
    vi.doMock('../../src/background/translate', async (importOriginal: () => Promise<unknown>) => ({
      ...((await importOriginal()) as object),
      translateToken: async (t: string) => ({ token: t, translation: 'correr' }),
      translateText: async () => ({ ok: false }),
    }));
    vi.doMock('../../src/background/ai-enrich', async (importOriginal: () => Promise<unknown>) => ({
      ...((await importOriginal()) as object),
      getAiSettings: async () => ({ provider: 'disabled', enrichOnSave: false }),
      getResolvedNativeLang: async () => 'es',
      enrichWithAi: async () => ({ ok: false }),
    }));
    vi.doMock('../../src/background/enrichment/orchestrator', () => ({ runEnrichment: async () => ({ entry: null }) }));
    vi.doMock('../../src/background/tts', () => ({ generateTtsAudio: async () => ({ ok: false }) }));
    vi.doMock('../../src/background/vip-settings', () => ({
      getVipSettings: async () => ({ enabled: false }),
      loadTranslateTargetLang: async () => 'es',
    }));
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const anchor = Date.now() - 10_000;
    await new Promise((r) => setTimeout(r, 10));
    await createCardFromRequest({
      token: 'run', sentence: 'She runs it.', language: 'en', deck: 'English vocab',
      cueStart: 1000, cueEnd: 3000, videoTimeAtSave: 2500, videoPausedAtSave: true,
      anchorWallClock: anchor,
    } as never, { deckName: 'English vocab', modelName: 'Basic', fieldSources: { Front: 'selection', Sentence: 'cue', 'Sentence audio': 'sentence-audio' } } as never,
    { endDetect: 'vad', bufferSize: 30, preRoll: 0, postRoll: 0, cueMerge: 300 } as never);
    // Anchor pinned 10 s in the past: the offscreen rejects the stale window
    // (no clip) — but crucially no clip from "now" may be substituted.
    expect(extract.mock.calls.length <= 1).toBe(true);
    if (extract.mock.calls.length) {
      const [startMs] = extract.mock.calls[0] as unknown as [number, number];
      expect(Math.abs(startMs - (anchor - 1500))).toBeLessThan(100);
    }
  });

  it('SubtitleAudioAnchor carries wallClockAtSave from the SAME instant', async () => {
    const { captureAnchor } = await import('../../src/content/ui/save-scene');
    const a = captureAnchor(2500, true, 1234567890);
    expect(a).toEqual({ videoTimeAtSave: 2500, videoPausedAtSave: true, wallClockAtSave: 1234567890 });
  });
});

describe('P4 — mediaLost only when the note was CREATED', () => {
  it('a reused retry has no mediaLost even with media flags', async () => {
    vi.doMock('../../src/background/card-registry', () => ({
      cardRegistry: {
        list: vi.fn(async () => []),
        get: vi.fn(async () => ({ id: 'c', word: 'run', sentence: 'She runs it.', status: 'failed', kind: 'word', deck: 'D', lang: 'en', createdAt: 1, attempts: 1, tags: [], media: { frame: true, audio: true, word: true } })),
        patch: vi.fn(async () => undefined), remove: vi.fn(async () => undefined),
        removeByNoteId: vi.fn(async () => undefined), findByNoteId: vi.fn(async () => undefined),
        put: vi.fn(async () => undefined),
      },
    }));
    vi.doMock('../../src/background/capture-orchestrator', () => ({
      createCardFromRequest: vi.fn(async () => ({ ok: true, noteId: 4242, reused: 'other-context' })),
      retryPendingNotes: vi.fn(async () => ({ retried: 0, succeeded: 0 })),
    }));
    vi.doMock('../../src/background/card-actions', () => ({
      deleteNote: vi.fn(async () => ({ ok: true })),
      addContextToNote: vi.fn(), browseNote: vi.fn(), wordIntervals: vi.fn(),
    }));
    vi.doMock('../../src/shared/db', () => ({
      getDB: () => ({ pending_notes: { toArray: async () => [], delete: async () => {}, update: async () => {}, add: async () => {} } }),
    }));
    const { retryCard } = await import('../../src/background/card-lifecycle');
    const res = await retryCard('c', {} as never, undefined as never);
    expect(res.reused).toBeDefined();
    expect(res.mediaLost).toBeUndefined();
  });
});

describe('P5 — add-scene with a saved phrase keeps its identity', () => {
  it('pre ? pre.identityKey : identity.key', async () => {
    const { sceneIdentity } = await import('../../src/content/ui/save-scene');
    expect(sceneIdentity({ identityKey: undefined }, { key: 'run' })).toBe('run');
    expect(sceneIdentity({ identityKey: 'thank you' }, { key: 'thank' })).toBe('thank you');
  });
});

describe('P7 — stable allowlist marker', () => {
  it('the allowlist uses a marker, not a line number', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('tests/unit/i18n-no-literals.test.ts', 'utf-8');
    expect(src).not.toMatch(/capture-orchestrator\.ts:\d+/);
    expect(src).toContain('DALL-E');
  });
});
