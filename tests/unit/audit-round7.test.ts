/**
 * RED TESTS — audit round 7 (main @ 60a605c). Production paths only:
 * rows are built by the production builders, the ledger by the real put.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let stored: Record<string, unknown>;

function installCardStorage(): void {
  stored = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const out: Record<string, unknown> = {};
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            if (key in stored) out[key] = stored[key];
          }
          return out;
        },
        set: async (items: Record<string, unknown>) => { Object.assign(stored, items); },
      },
    },
  };
}

function rows(): Array<{ id: string; status: string }> {
  return (stored['kvl:cards.recent'] as Array<{ id: string; status: string }> | undefined) ?? [];
}

function setupMocks(opts: {
  findNotesImpl?: (query: string) => number[];
  notesInfos?: Array<{ noteId: number; fields: Record<string, { value: string }>; tags?: string[] }>;
  extractAudioClip?: (startMs: number, endMs: number) => { ok: boolean; dataUrl?: string; mimeType?: string };
  captureStatus?: { active: boolean };
} = {}) {
  const addNote = vi.fn(async () => 777);
  const findNotes = vi.fn(async (query: string) => opts.findNotesImpl?.(query) ?? []);
  const notesInfo = vi.fn(async () => opts.notesInfos ?? []);
  const extractAudioClip = vi.fn(async (startMs: number, endMs: number) =>
    opts.extractAudioClip?.(startMs, endMs) ?? { ok: false, error: 'inactive' });
  vi.doMock('../../src/background/anki-connect', () => ({
    ankiConnect: {
      addNote, findNotes, notesInfo, addTags: vi.fn(async () => null),
      storeMediaFile: vi.fn(async (f: string) => f),
    },
    dataUrlToBase64: (s: string) => s,
    AnkiConnectError: class extends Error {},
  }));
  vi.doMock('../../src/background/audio-capture-manager', () => ({
    getAudioCaptureStatus: async () => opts.captureStatus ?? { active: false },
    extractAudioClip,
  }));
  const ledger = new Map<string, { ankiNoteId: number; cardId?: string; token: string; language: string; sentence: string; deckName: string }>();
  vi.doMock('../../src/shared/db', async (importOriginal: () => Promise<unknown>) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    const cache = { get: async () => { throw new Error('no db'); }, put: async () => {} };
    return { ...(actual as object), getDB: () => ({
      saved_notes: {
        where: (idx: string) => ({
          equals: (v: unknown) => ({
            first: async () => {
              for (const row of ledger.values()) {
                if (idx === 'ankiNoteId' && row.ankiNoteId === v) return row;
                if (Array.isArray(v)
                  && row.token === v[0] && row.language === v[1]
                  && row.sentence === v[2] && row.deckName === v[3]) return row;
              }
              return null;
            },
          }),
        }),
        put: async (row: { token: string; language: string; sentence: string; deckName: string; ankiNoteId: number }) => {
          ledger.set(`${row.token}|${row.language}|${row.sentence}|${row.deckName}`, row);
        },
      },
      pending_notes: { add: async () => {}, update: async () => {}, delete: async () => {} },
      translation_cache: cache, media_cache: cache, ai_cache: cache,
    }) };
  });
  vi.doMock('../../src/background/translate', async (importOriginal: () => Promise<unknown>) => ({
    ...((await importOriginal()) as object),
    translateToken: async (token: string) => ({ token, type: 'word', translation: 'correr' }),
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
    getVipSettings: async () => ({ enabled: true }),
    loadTranslateTargetLang: async () => 'es',
  }));
  return { addNote, findNotes, extractAudioClip, ledger };
}

const MAPPING = {
  deckName: 'English vocab', modelName: 'Basic',
  fieldSources: { Front: 'selection', Sentence: 'cue', 'Sentence audio': 'sentence-audio' },
};

const BASE_REQ = {
  token: 'run', identityKey: 'run', surface: 'run',
  sentence: 'She runs it.', language: 'en', deck: 'English vocab',
};

const CAPTURE = { endDetect: 'vad', bufferSize: 30, preRoll: 0, postRoll: 0, cueMerge: 300 };

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  delete (globalThis as { chrome?: unknown }).chrome;
  installCardStorage();
});

describe('P1 — buildCreateCardRow builds the SW row (identity slice included)', () => {
  it('the helper normalizes the gloss and carries identity + flags', async () => {
    const { buildCreateCardRow } = await import('../../src/shared/cards');
    const row = buildCreateCardRow(
      { token: 'running', sentence: 'She is running.', identityKey: 'run', surface: 'running', contextGloss: '—', phraseLevel: false, forceNewSense: true },
      { cardId: 'card-1', deck: 'English vocab', lang: 'en', kind: 'word', tags: ['kivara-lingo'] },
    );
    expect(row.id).toBe('card-1');
    expect(row.word).toBe('running');
    expect(row.identityKey).toBe('run');
    expect(row.contextGloss).toBeUndefined();
    expect(row.forceNewSense).toBe(true);
  });

  it('a FAILED "running" save (row built by the helper) retries to a REUSE, 0 addNote', async () => {
    const { buildCreateCardRow } = await import('../../src/shared/cards');
    const { cardRegistry } = await import('../../src/background/card-registry');
    const m = setupMocks({
      findNotesImpl: (q: string) => (/Front:run"/.test(q) ? [4242] : []),
      notesInfos: [{
        noteId: 4242, fields: { Front: { value: 'run' }, Sentence: { value: 'He runs.' } },
        tags: ['kivara-lingo', 'kivara::lemma::run'],
      }],
    });
    const { newRecentCard } = await import('../../src/shared/cards');
    const base = newRecentCard({
      id: 'card-run', word: 'running', sentence: 'She is running.',
      kind: 'word', deck: 'English vocab', lang: 'en', tags: ['kivara-lingo'],
    });
    await cardRegistry.put({
      ...base,
      ...buildCreateCardRow(
        { token: 'running', sentence: 'She is running.', identityKey: 'run', surface: 'running' },
        { cardId: 'card-run', deck: 'English vocab', lang: 'en', kind: 'word', tags: ['kivara-lingo'] },
      ),
      status: 'failed', error: 'timeout',
    });
    const { retryCard } = await import('../../src/background/card-lifecycle');
    const res = await retryCard('card-run', MAPPING as never, undefined as never);
    expect(res.ok).toBe(true);
    expect(res.reused).toBeDefined();
    expect(m.addNote).not.toHaveBeenCalled();
    expect(rows().find((r) => r.id === 'card-run')).toBeUndefined();
  });
});

describe('P2 — resolveAudio slices the SAVED window via anchorWallClock', () => {
  it('requestedAt comes from the anchor, not Date.now()', async () => {
    const m = setupMocks({
      captureStatus: { active: true },
      extractAudioClip: (startMs: number, endMs: number) => ({ ok: true, dataUrl: 'data:audio/mpeg;base64,AA', mimeType: 'audio/mpeg', startMs, endMs }),
    });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const anchor = Date.now() - 5_000; // saved 5 s ago — still inside the buffer
    await createCardFromRequest({
      ...BASE_REQ,
      cueStart: 1000, cueEnd: 3000, videoTimeAtSave: 2500, videoPausedAtSave: false,
      anchorWallClock: anchor,
      frame: 'data:image/jpeg;base64,AAAA',
    } as never, MAPPING as never, CAPTURE as never);
    expect(m.extractAudioClip).toHaveBeenCalledTimes(1);
    const [startMs, endMs] = vi.mocked(m.extractAudioClip).mock.calls[0] as [number, number];
    // window = anchor - (videoTimeAtSave - cueStart) ± roll — the SAVED instant.
    expect(Math.abs(startMs - (anchor - 1500))).toBeLessThan(80);
    expect(Math.abs(endMs - (anchor + 500))).toBeLessThan(80);
  });
});

describe('P3 — EXTRACT_CUE_CLIP converts video time → wall clock', () => {
  it('the SW handler computes the window from the saved anchor', async () => {
    const m = setupMocks({
      captureStatus: { active: true },
      extractAudioClip: (startMs: number, endMs: number) => ({ ok: true, dataUrl: 'data:audio/mpeg;base64,AA', mimeType: 'audio/mpeg', startMs, endMs }),
    });
    const { extractCueClip } = await import('../../src/background/cue-clip');
    const anchor = Date.now() - 1_000;
    const res = await extractCueClip(
      { cueStartMs: 1000, cueEndMs: 3000, videoTimeAtSave: 2500, requestedAt: anchor },
      { extractAudioClip: m.extractAudioClip as never, preRollMs: 0, postRollMs: 0 },
    ) as { ok: boolean; dataUrl?: string };
    expect(res.ok).toBe(true);
    const [startMs, endMs] = vi.mocked(m.extractAudioClip).mock.calls[0] as [number, number];
    expect(Math.abs(startMs - (anchor - 1500))).toBeLessThan(80);
    expect(Math.abs(endMs - (anchor + 500))).toBeLessThan(80);
  });
});

describe('P4 — the pending-row retry reports reused too', () => {
  it('retryCard (pending row) propagates reused', async () => {
    vi.doMock('../../src/background/card-registry', () => ({
      cardRegistry: {
        list: vi.fn(async () => []), get: vi.fn(async () => ({ id: 'card-p', word: 'run', sentence: 'She runs it.', status: 'queued', kind: 'word', deck: 'English vocab', lang: 'en', createdAt: 1, attempts: 1, tags: [] })),
        patch: vi.fn(async () => undefined), remove: vi.fn(async () => undefined),
        findByNoteId: vi.fn(async () => undefined), removeByNoteId: vi.fn(async () => undefined),
        put: vi.fn(async () => undefined),
      },
    }));
    vi.doMock('../../src/background/capture-orchestrator', () => ({
      createCardFromRequest: vi.fn(async () => ({ ok: true, noteId: 900, reused: 'other-context', warnings: [] })),
      retryPendingNotes: vi.fn(async () => ({ retried: 0, succeeded: 0 })),
    }));
    vi.doMock('../../src/background/card-actions', () => ({
      deleteNote: vi.fn(async () => ({ ok: true })),
      addContextToNote: vi.fn(), browseNote: vi.fn(), wordIntervals: vi.fn(),
    }));
    vi.doMock('../../src/shared/db', () => ({
      getDB: () => ({
        pending_notes: {
          toArray: async () => [{ id: 7, request: { cardId: 'card-p', token: 'run', deck: 'English vocab', lang: 'en' }, retries: 1, lastError: null, createdAt: 1, nextAttemptAt: 1 }],
          delete: async () => {}, update: async () => {}, add: async () => {},
        },
        saved_notes: { where: () => ({ equals: () => ({ first: async () => null }) }), put: async () => {} },
      }),
    }));
    const { retryCard } = await import('../../src/background/card-lifecycle');
    const res = await retryCard('card-p', MAPPING as never, undefined as never);
    expect(res.ok).toBe(true);
    expect(res.reused).toBe('other-context');
  });
});
