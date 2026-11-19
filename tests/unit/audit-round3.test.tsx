/**
 * RED TESTS — phrase-level saves are decided by the SAVE PATH, not by text
 * equality with the line. A one-word line ("Running") or a two-word expression
 * occupying the line ("Thank you") is vocabulary: it keeps its lemma tag, its
 * sense tag and its contextual gloss. Only the whole-line shortcut save (and
 * selections of 2+ words covering the line, or >4 words) is phrase-level.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { toast } from 'sonner';
import { sendMessage } from 'webext-bridge/content-script';
import { SubtitleOverlay } from '../../src/content/ui/SubtitleOverlay';
import { isPhraseLevelSave } from '../../src/shared/word-identity';

vi.mock('sonner', () => {
  const toast = vi.fn();
  Object.assign(toast, {
    custom: vi.fn(), error: vi.fn(), success: vi.fn(),
    message: vi.fn(), dismiss: vi.fn(), loading: vi.fn(),
  });
  return { toast, Toaster: () => null };
});

function installCardStorage(): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} } },
  };
}

function setupMocks(opts: {
  findNotesIds?: number[];
  notesInfos?: Array<{ noteId: number; fields: Record<string, { value: string }>; tags?: string[] }>;
} = {}) {
  const addNote = vi.fn(async (_note: { tags?: string[] }) => 777);
  const findNotes = vi.fn(async () => opts.findNotesIds ?? []);
  const notesInfo = vi.fn(async () => opts.notesInfos ?? []);
  vi.doMock('../../src/background/anki-connect', () => ({
    ankiConnect: {
      addNote, findNotes, notesInfo, addTags: vi.fn(async () => null),
      storeMediaFile: vi.fn(async (f: string) => f),
    },
    dataUrlToBase64: (s: string) => s,
    AnkiConnectError: class extends Error {},
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
  return { addNote };
}

const MAPPING = {
  deckName: 'English vocab', modelName: 'Basic',
  fieldSources: { Front: 'selection', Translation: 'bilingual', Sentence: 'cue' },
};

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  delete (globalThis as { chrome?: unknown }).chrome;
  installCardStorage();
  vi.mocked(sendMessage).mockReset();
  vi.mocked(sendMessage).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('isPhraseLevelSave is decided by the save path', () => {
  it('word path: a one-word line-equal text is NOT phrase-level', () => {
    expect(isPhraseLevelSave('Running', 'Running', 'word')).toBe(false);
    expect(isPhraseLevelSave('Thank you', 'Thank you', 'word')).toBe(false);
  });

  it('line path: the whole-line shortcut save is ALWAYS phrase-level', () => {
    expect(isPhraseLevelSave('Running', 'Running', 'line')).toBe(true);
    expect(isPhraseLevelSave('Thank you', 'Thank you', 'line')).toBe(true);
  });

  it('selection path: covers the line with 2+ words, or >4 words', () => {
    expect(isPhraseLevelSave('Thank you', 'Thank you', 'selection')).toBe(true);
    expect(isPhraseLevelSave('Running', 'Running', 'selection')).toBe(false);
    expect(isPhraseLevelSave('one two three four five six', 'Different', 'selection')).toBe(true);
  });

  it('legacy default (no path): only the >4-words rule counts', () => {
    expect(isPhraseLevelSave('Running', 'Running')).toBe(false);
    expect(isPhraseLevelSave('one two three four five six')).toBe(true);
  });
});

describe('orchestrator: word saves on line-equal text keep their identity', () => {
  it('a "Running" line saved as a WORD carries lemma::run and sense::correr', async () => {
    const m = setupMocks({ findNotesIds: [] });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    await createCardFromRequest({
      token: 'Running', sentence: 'Running', identityKey: 'run', surface: 'running',
      contextGloss: 'correr', language: 'en', deck: 'English vocab',
    } as never, MAPPING as never, undefined as never);
    expect(m.addNote).toHaveBeenCalledTimes(1);
    const tags: string[] = m.addNote.mock.calls[0][0]?.tags ?? [];
    expect(tags).toContain('kivara::lemma::run');
    expect(tags).toContain('kivara::sense::correr');
  });

  it('a "thank you" expression keeps its identity on a line-equal sentence', async () => {
    const m = setupMocks({ findNotesIds: [] });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    await createCardFromRequest({
      token: 'thank you', sentence: 'Thank you', identityKey: 'thank you', surface: 'thank you',
      contextGloss: 'gracias', language: 'en', deck: 'English vocab',
    } as never, MAPPING as never, undefined as never);
    expect(m.addNote).toHaveBeenCalledTimes(1);
    const tags: string[] = m.addNote.mock.calls[0][0]?.tags ?? [];
    expect(tags).toContain('kivara::lemma::thank-you');
    expect(tags).toContain('kivara::sense::gracias');
  });

  it('phraseLevel:true marks a phrase even when the text differs from the sentence', async () => {
    const m = setupMocks({ findNotesIds: [] });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    await createCardFromRequest({
      token: 'Thank you', sentence: 'A different line entirely', phraseLevel: true,
      identityKey: 'thank you', contextGloss: 'gracias', language: 'en', deck: 'English vocab',
    } as never, MAPPING as never, undefined as never);
    expect(m.addNote).toHaveBeenCalledTimes(1);
    const tags: string[] = m.addNote.mock.calls[0][0]?.tags ?? [];
    expect(tags.some((t) => t.startsWith('kivara::lemma::'))).toBe(false);
    expect(tags.some((t) => t.startsWith('kivara::sense::'))).toBe(false);
  });

  it('phraseLevel:false keeps identity even on line-equal text', async () => {
    const m = setupMocks({ findNotesIds: [] });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    await createCardFromRequest({
      token: 'Running', sentence: 'Running', identityKey: 'run', phraseLevel: false,
      contextGloss: 'correr', language: 'en', deck: 'English vocab',
    } as never, MAPPING as never, undefined as never);
    const tags: string[] = m.addNote.mock.calls[0][0]?.tags ?? [];
    expect(tags).toContain('kivara::lemma::run');
    expect(tags).toContain('kivara::sense::correr');
  });

  it('legacy requests without phraseLevel: only the >4-words rule', async () => {
    const m = setupMocks({ findNotesIds: [] });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    await createCardFromRequest({
      token: 'She ran fast through the park', sentence: 'She ran fast through the park',
      identityKey: 'she ran fast through the park', language: 'en', deck: 'English vocab',
    } as never, MAPPING as never, undefined as never);
    const tags: string[] = m.addNote.mock.calls[0][0]?.tags ?? [];
    expect(tags.some((t) => t.startsWith('kivara::lemma::'))).toBe(false);
    expect(tags.some((t) => t.startsWith('kivara::sense::'))).toBe(false);
  });
});

describe('UI seam: the whole-line shortcut save travels as phraseLevel', () => {
  it('whole-plate save of a short line sends phraseLevel:true and no gloss', async () => {
    const onSaveCard = vi.fn(
      async (_token: string | undefined, _sentence: string, _line?: number, _gloss?: string, _phrase?: boolean) =>
        ({ ok: true }),
    );
    render(
      <SubtitleOverlay
        subtitleStyles={{} as never}
        cue={{ id: 'c0', text: 'Thank you', start: 0, end: 3000, language: 'en' }}
        altCue={null}
        mode="learning"
        saveRequestKey={1}
        onSaveCard={onSaveCard}
        onTokenHoverChange={() => {}}
        initialSavedWords={new Set()}
      />,
    );
    await vi.waitFor(() => expect(onSaveCard).toHaveBeenCalled());
    expect(onSaveCard.mock.calls[0][3]).toBeUndefined();
    expect(onSaveCard.mock.calls[0][4]).toBe(true);
    const resolveCalls = vi.mocked(sendMessage).mock.calls.filter((c) => c[0] === 'RESOLVE_WORD');
    expect(resolveCalls).toEqual([]);
  });
});
