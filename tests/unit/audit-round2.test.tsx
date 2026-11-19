/**
 * RED TESTS — audit round 2 (main @ c2d10cc).
 *
 * 1. forcedMatch: a forced (explicit click) request that lands on a note with
 *    the SAME sense tag must never offer "Crear" again — the response says so.
 * 2. Whole-line / >4-word saves are NOT lemma+sense identities: no lemma or
 *    sense tags, no gloss resolution.
 * 3. The saved notice closes after a SUCCESSFUL undo (and only then).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { toast } from 'sonner';
import { sendMessage } from 'webext-bridge/content-script';
import { SubtitleOverlay } from '../../src/content/ui/SubtitleOverlay';
import { showCardSaved, showCardReused } from '../../src/content/ui/save-actions';

vi.mock('sonner', () => {
  const toast = vi.fn();
  Object.assign(toast, {
    custom: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    message: vi.fn(),
    dismiss: vi.fn(),
    loading: vi.fn(),
  });
  return { toast, Toaster: () => null };
});

beforeEach(() => {
  vi.mocked(sendMessage).mockReset();
  vi.mocked(sendMessage).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* ── orchestrator harness (same shape as audit-followup.test.ts) ── */

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
});

describe('forcedMatch — a forced request never re-offers Create', () => {
  it('force + gloss matching the stored sense tag: reused with forcedMatch:true', async () => {
    const m = setupMocks({
      findNotesIds: [4242],
      notesInfos: [{
        noteId: 4242,
        fields: { Front: { value: 'run' }, Translation: { value: 'correr' }, Sentence: { value: 'He runs.' } },
        tags: ['kivara-lingo', 'kivara::lemma::run', 'kivara::sense::correr'],
      }],
    });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    const res = await createCardFromRequest({
      token: 'run', identityKey: 'run', surface: 'run',
      sentence: 'She runs the company.', language: 'en', deck: 'English vocab',
      contextGloss: 'correr', forceNewSense: true,
    } as never, MAPPING as never, undefined as never);
    expect(res.reused).toBe('other-context');
    expect(res.sense).toBe('same-sense');
    expect(res.forcedMatch).toBe(true);
    expect(m.addNote).not.toHaveBeenCalled();
  });
});

describe('phrase-level saves carry no lemma/sense identity', () => {
  it('a >4-word save adds a note WITHOUT lemma or sense tags', async () => {
    const m = setupMocks({ findNotesIds: [] });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    await createCardFromRequest({
      token: 'She ran fast through the park',
      sentence: 'She ran fast through the park',
      identityKey: 'she ran fast through the park',
      language: 'en', deck: 'English vocab',
    } as never, MAPPING as never, undefined as never);
    expect(m.addNote).toHaveBeenCalledTimes(1);
    const tags: string[] = m.addNote.mock.calls[0][0]?.tags ?? [];
    expect(tags.some((t) => t.startsWith('kivara::lemma::'))).toBe(false);
    expect(tags.some((t) => t.startsWith('kivara::sense::'))).toBe(false);
    expect(tags).toContain('kivara-lingo');
  });

  it('a whole-line save flagged phraseLevel adds a note WITHOUT lemma or sense tags', async () => {
    const m = setupMocks({ findNotesIds: [] });
    const { createCardFromRequest } = await import('../../src/background/capture-orchestrator');
    await createCardFromRequest({
      token: 'RUN is hard work',
      sentence: 'RUN is hard work',
      identityKey: 'run is hard work',
      phraseLevel: true,
      language: 'en', deck: 'English vocab',
    } as never, MAPPING as never, undefined as never);
    expect(m.addNote).toHaveBeenCalledTimes(1);
    const tags: string[] = m.addNote.mock.calls[0][0]?.tags ?? [];
    expect(tags.some((t) => t.startsWith('kivara::lemma::'))).toBe(false);
    expect(tags.some((t) => t.startsWith('kivara::sense::'))).toBe(false);
  });
});

describe('showCardReused forcedMatch', () => {
  function renderNotice(): { texts: string[]; buttons: Array<{ text: string; onClick?: () => void }> } {
    const custom = toast.custom as unknown as ReturnType<typeof vi.fn>;
    const renderFn = custom.mock.calls[0]?.[0] as (id: string) => React.ReactElement;
    const host = render(renderFn('toast-id'));
    const texts = Array.from(host.container.querySelectorAll('button, div')).map((n) => n.textContent ?? '');
    const buttons = Array.from(host.container.querySelectorAll('button')).map((b) => ({
      text: b.textContent ?? '',
      onClick: () => { fireEvent.click(b); },
    }));
    return { texts, buttons };
  }

  it('forcedMatch: no Crear, "Ya tienes" copy, add-scene kept', () => {
    const onAdd = vi.fn();
    const onCreate = vi.fn();
    showCardReusedForced(onAdd, onCreate);
    const { texts, buttons } = renderNotice();
    expect(texts.join(' ')).toContain('Ya tienes');
    expect(buttons.some((b) => b.text.includes('Crear tarjeta'))).toBe(false);
    const add = buttons.find((b) => b.text.includes('Añadir esta escena'));
    expect(add).toBeDefined();
    if (add?.onClick) add.onClick();
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});

/** The forcedMatch call uses the full 10-arg shape (8th canAddScene, 9th id, 10th forcedMatch). */
function showCardReusedForced(onAdd: () => void, onCreate: () => void): void {
  (showCardReused as (
    reused: 'same-context' | 'other-context',
    word: string,
    onAddScene?: () => void,
    sense?: 'new-sense' | 'same-sense' | 'unknown',
    storedGloss?: string,
    contextGloss?: string,
    onCreateSense?: () => void,
    canAddScene?: boolean,
    toastId?: string,
    forcedMatch?: boolean,
  ) => void
  )('other-context', 'run', onAdd, 'same-sense', 'correr', 'correr', onCreate, true, 'toast-id', true);
}

describe('saved notice closes after a SUCCESSFUL undo', () => {
  function renderSavedToast(noteId: number) {
    showCardSaved({ noteId, text: 'hello', deck: 'English', cardId: 'card-42' });
    const calls = vi.mocked(toast.custom).mock.calls;
    const renderFn = calls[calls.length - 1][0] as (id: string) => React.ReactElement;
    return render(renderFn('save-toast'));
  }

  function undoButton(): HTMLElement | null {
    return screen.queryByRole('button', { name: /Deshacer/ });
  }

  it('successful undo dismisses the saved notice by its stable id', async () => {
    vi.mocked(sendMessage).mockResolvedValue({ ok: true } as never);
    renderSavedToast(42);
    fireEvent.click(undoButton()!);
    await vi.waitFor(() => {
      expect(toast.dismiss).toHaveBeenCalledWith('kivara-saved-42');
    });
  });

  it('failed undo keeps the notice (no dismissal at all)', async () => {
    vi.mocked(sendMessage).mockResolvedValue({ ok: false, error: 'Anki closed' } as never);
    renderSavedToast(42);
    fireEvent.click(undoButton()!);
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith('ANKI_DELETE_NOTE', expect.anything(), 'background');
    });
    expect(toast.dismiss).not.toHaveBeenCalled();
  });
});

describe('handleSaveToken skips gloss resolution for a whole-line save', () => {
  it('whole-plate shortcut save sends NO RESOLVE_WORD and gloss undefined', async () => {
    const onSaveCard = vi.fn(
      async (_token: string | undefined, _sentence: string, _line?: number, _gloss?: string) =>
        ({ ok: true }),
    );
    render(
      <SubtitleOverlay
        subtitleStyles={{} as never}
        cue={{ id: 'c0', text: 'RUN is hard work', start: 0, end: 3000, language: 'en' }}
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
    const resolveCalls = vi.mocked(sendMessage).mock.calls.filter((c) => c[0] === 'RESOLVE_WORD');
    expect(resolveCalls).toEqual([]);
  });
});
