/**
 * RED TESTS — audit round 6 (main @ 5a8391c). Every test drives the
 * PRODUCTION path (real registry writes, real ledger semantics).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { classifySense } from '../../src/shared/word-identity';

interface StoredRow {
  id: string;
  word: string;
  sentence: string;
  status: string;
  kind: string;
  deck: string;
  lang: string;
  createdAt: number;
  attempts: number;
  tags: string[];
  noteId?: number;
  identityKey?: string;
  surface?: string;
  contextGloss?: string;
  phraseLevel?: boolean;
  forceNewSense?: boolean;
  [k: string]: unknown;
}

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

function rows(): StoredRow[] {
  return (stored['kvl:cards.recent'] as StoredRow[] | undefined) ?? [];
}

function setupMocks(opts: {
  findNotesImpl?: (query: string) => number[];
  notesInfos?: Array<{ noteId: number; fields: Record<string, { value: string }>; tags?: string[] }>;
  addNoteImpl?: () => Promise<number>;
} = {}) {
  const addNote = vi.fn(opts.addNoteImpl ?? (async () => 777));
  const findNotes = vi.fn(async (query: string) => opts.findNotesImpl?.(query) ?? []);
  const notesInfo = vi.fn(async () => opts.notesInfos ?? []);
  vi.doMock('../../src/background/anki-connect', () => ({
    ankiConnect: {
      addNote, findNotes, notesInfo, addTags: vi.fn(async () => null),
      storeMediaFile: vi.fn(async (f: string) => f),
    },
    dataUrlToBase64: (s: string) => s,
    AnkiConnectError: class extends Error {},
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
  vi.doMock('../../src/background/audio-capture-manager', () => ({
    getAudioCaptureStatus: async () => ({ active: false }),
    extractAudioClip: async () => ({ ok: false }),
  }));
  vi.doMock('../../src/background/vip-settings', () => ({
    getVipSettings: async () => ({ enabled: true }),
    loadTranslateTargetLang: async () => 'es',
  }));
  return { addNote, ledger };
}

const MAPPING = {
  deckName: 'English vocab', modelName: 'Basic',
  fieldSources: { Front: 'selection', Sentence: 'cue' },
};

const BASE_REQ = {
  token: 'run', identityKey: 'run', surface: 'run',
  sentence: 'She runs it.', language: 'en', deck: 'English vocab',
};

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  delete (globalThis as { chrome?: unknown }).chrome;
  installCardStorage();
});

describe('P1 — addNote options decide allowDuplicate in the background', () => {
  it('a normal save passes options.allowDuplicate FALSE', async () => {
    setupMocks({ findNotesImpl: () => [] });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    await createCardFromRequest(BASE_REQ as never, MAPPING as never, undefined as never);
    const call = vi.mocked((await import('../../src/background/anki-connect')).ankiConnect.addNote);
    const note = call.mock.calls[0][0] as { options: { allowDuplicate: boolean } };
    expect(note.options.allowDuplicate).toBe(false);
  });

  it('a forced save passes options.allowDuplicate TRUE', async () => {
    setupMocks({ findNotesImpl: () => [] });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    await createCardFromRequest({
      ...BASE_REQ, contextGloss: 'dirigir', forceNewSense: true,
    } as never, MAPPING as never, undefined as never);
    const call = vi.mocked((await import('../../src/background/anki-connect')).ankiConnect.addNote);
    const note = call.mock.calls[0][0] as { options: { allowDuplicate: boolean } };
    expect(note.options.allowDuplicate).toBe(true);
  });
});

describe('P2 — registryRowFromRequest feeds the SW row and the retry rebuild', () => {
  it('the helper normalizes the gloss and carries identity + flags', async () => {
    const { registryRowFromRequest } = await import('../../src/shared/cards');
    expect(registryRowFromRequest({
      identityKey: 'run', surface: 'running', contextGloss: '—',
      phraseLevel: false, forceNewSense: true,
    })).toEqual({
      identityKey: 'run', surface: 'running',
      contextGloss: undefined, phraseLevel: false, forceNewSense: true,
    });
  });

  it('retryCard "running" over a "run" note (row built by the helper) reuses, 0 addNote', async () => {
    const { registryRowFromRequest } = await import('../../src/shared/cards');
    const { cardRegistry } = await import('../../src/background/card-registry');
    const { newRecentCard } = await import('../../src/shared/cards');
    const base = newRecentCard({
      id: 'card-run', word: 'running', sentence: 'She is running.',
      kind: 'word', deck: 'English vocab', lang: 'en', tags: ['kivara-lingo'],
    });
    await cardRegistry.put({ ...base, ...registryRowFromRequest({ identityKey: 'run', surface: 'running' }) });
    const m = setupMocks({
      findNotesImpl: (q: string) => (/Front:run"/.test(q) ? [4242] : []),
      notesInfos: [{
        noteId: 4242, fields: { Front: { value: 'run' }, Sentence: { value: 'He runs.' } },
        tags: ['kivara-lingo', 'kivara::lemma::run'],
      }],
    });
    const { retryCard } = await import('../../src/background/card-lifecycle');
    const res = await retryCard('card-run', MAPPING as never, undefined as never);
    expect(res.ok).toBe(true);
    expect(res.reused).toBeDefined();
    expect(m.addNote).not.toHaveBeenCalled();
    expect(rows().find((r) => r.id === 'card-run')).toBeUndefined();
  });

  it('the rebuild also carries forceNewSense', async () => {
    const { registryRowFromRequest } = await import('../../src/shared/cards');
    const { cardRegistry } = await import('../../src/background/card-registry');
    const { newRecentCard } = await import('../../src/shared/cards');
    const base = newRecentCard({
      id: 'card-f', word: 'run', sentence: 'She runs it.',
      kind: 'word', deck: 'English vocab', lang: 'en', tags: ['kivara-lingo'],
      status2: undefined,
    } as never);
    await cardRegistry.put({ ...base, status: 'failed', error: 'timeout', nextRetryAt: 1,
      ...registryRowFromRequest({ identityKey: 'run', surface: 'run', forceNewSense: true }) });
    const createCardFromRequest = vi.fn(
      async (_req: unknown, _m: unknown, _c: unknown, _o: unknown) =>
        ({ ok: false, error: 'x', queued: true }),
    );
    vi.doMock('../../src/background/capture-orchestrator', () => ({
      createCardFromRequest, retryPendingNotes: vi.fn(async () => ({ retried: 0, succeeded: 0 })),
    }));
    vi.doMock('../../src/background/card-actions', () => ({
      deleteNote: vi.fn(async () => ({ ok: true })),
      addContextToNote: vi.fn(), browseNote: vi.fn(), wordIntervals: vi.fn(),
    }));
    vi.doMock('../../src/shared/db', () => ({
      getDB: () => ({
        pending_notes: { toArray: async () => [], delete: async () => {}, update: async () => {}, add: async () => {} },
        saved_notes: { where: () => ({ equals: () => ({ first: async () => null }) }), put: async () => {} },
      }),
    }));
    const { retryCard } = await import('../../src/background/card-lifecycle');
    await retryCard('card-f', MAPPING as never, undefined as never);
    const req = createCardFromRequest.mock.calls[0][0] as Record<string, unknown>;
    expect(req.forceNewSense).toBe(true);
    expect(req.identityKey).toBe('run');
  });
});

describe('P7 — one canonical key per note; variants resolve at lookup', () => {
  it('isInAnki resolves hyphen/space variants of the canonical key', async () => {
    const { replaceAnkiIntervals, isInAnki } = await import('../../src/shared/study/wordStatus');
    replaceAnkiIntervals('en', { 'thank you': 0 });
    await new Promise((r) => setTimeout(r, 0));
    expect(isInAnki('en', 'thank-you')).toBe(true);
    expect(isInAnki('en', 'thank you')).toBe(true);
  });
});

describe('P8 — classifySense normalizes through htmlToPlain', () => {
  it('an entity-encoded comma still splits meanings', () => {
    expect(classifySense('correr, trotar', 'correr&#44; trotar')).toBe('same-sense');
  });
});

describe('P10 — a retried card that only REUSED reports it', () => {
  it('retryCard propagates reused to CardRetryResponse', async () => {
    vi.doMock('../../src/background/card-registry', () => ({
      cardRegistry: {
        list: vi.fn(async () => []), get: vi.fn(async () => ({ id: 'card-z', word: 'run', sentence: 'She runs it.', status: 'queued', kind: 'word', deck: 'English vocab', lang: 'en', createdAt: 1, attempts: 1, tags: [] })),
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
      getDB: () => ({ pending_notes: { toArray: async () => [], delete: async () => {}, update: async () => {}, add: async () => {} } }),
    }));
    const { retryCard } = await import('../../src/background/card-lifecycle');
    const res = await retryCard('card-z', MAPPING as never, undefined as never);
    expect(res.ok).toBe(true);
    expect(res.reused).toBe('other-context');
  });
});

describe('P6 — the popover save gloss comes from the LOCAL source', () => {
  it('saveGloss prefers the local entry; placeholders never travel', async () => {
    const { saveGloss } = await import('../../src/content/ui/WordPopover');
    expect(saveGloss({ translation: 'correr' } as never, 'to run')).toBe('correr');
    expect(saveGloss({ translation: '—' } as never, 'to run')).toBe('to run');
    expect(saveGloss({ translation: '—' } as never, '—')).toBeUndefined();
    expect(saveGloss(null, '')).toBeUndefined();
  });
});

describe('P6 — resolveLocalEntry can skip the IPA augment on the gloss path', () => {
  it('augmentIpa:false never calls getMissingPhonetic', async () => {
    const getMissingPhonetic = vi.fn(async () => '/ɹʌn/');
    vi.doMock('../../src/background/phonetic-augment', () => ({ getMissingPhonetic }));
    vi.doMock('../../src/content/nlp/yomitan', () => ({ lookupYomitanTerm: vi.fn(async () => null) }));
    vi.doMock('../../src/content/nlp/dictionary', () => ({
      lookupDictionary: vi.fn(() => ({ token: 'run', type: 'word', translation: 'correr' })),
    }));
    const { resolveLocalEntry } = await import('../../src/background/resolve-word');
    const res = await resolveLocalEntry('run', 'en', { augmentIpa: false });
    expect(res.entry?.translation).toBe('correr');
    expect(getMissingPhonetic).not.toHaveBeenCalled();
  });
});
