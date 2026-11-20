/**
 * RED TESTS — round 9 P1: the saved state stays coherent through Undo.
 * The CARD_UNDONE_EVENT carries { token, identityKey } (never emitted when
 * the lemma still has a live note), and the overlay drops BOTH keys from its
 * saved marks — saving "running" paints the LEMMA "run", so deleting the raw
 * surface used to leave the green mark stuck.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { sendMessage } from 'webext-bridge/content-script';
import { CARD_UNDONE_EVENT, resetAudioHintForTests, undoSavedNote } from '../../src/content/ui/save-actions';
import { SubtitleOverlay } from '../../src/content/ui/SubtitleOverlay';

vi.mock('webext-bridge/content-script', () => ({
  sendMessage: vi.fn(async () => ({ ok: true })),
}));
vi.mock('sonner', () => {
  const toast = vi.fn();
  Object.assign(toast, { custom: vi.fn(), error: vi.fn(), success: vi.fn(), message: vi.fn(), dismiss: vi.fn(), loading: vi.fn(), warning: vi.fn() });
  return { toast, Toaster: () => null };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetAudioHintForTests();
});

/** Resolved once the undo listener would have run — the event is sync. */
function undoneDetails(): Array<Record<string, unknown>> {
  const details: Array<Record<string, unknown>> = [];
  window.addEventListener(CARD_UNDONE_EVENT, (e) => {
    details.push((e as CustomEvent<Record<string, unknown>>).detail ?? {});
  }, { once: true });
  return details;
}

describe('undoSavedNotice event contract', () => {
  it('emits { token, identityKey } after a successful undo', async () => {
    const details = undoneDetails();
    const ok = await undoSavedNote(42, 'running', 'card-1', 'run');
    expect(ok).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith('ANKI_DELETE_NOTE', { noteId: 42, origin: 'undo', cardId: 'card-1' }, 'background');
    expect(details).toEqual([{ token: 'running', identityKey: 'run' }]);
  });

  it('a stillInDeck undo achieves the goal but emits NOTHING — the word is still saved', async () => {
    vi.mocked(sendMessage).mockResolvedValue({ ok: true, stillInDeck: true } as never);
    const details = undoneDetails();
    const ok = await undoSavedNote(42, 'running', 'card-1', 'run');
    expect(ok).toBe(true);
    expect(details).toEqual([]);
  });
});

describe('SubtitleOverlay saved marks after undo', () => {
  const SAVED_CLS = 'border-emerald-400/70';

  function renderRunCue(initialSavedWords: Set<string>): HTMLElement {
    render(
      <SubtitleOverlay
        subtitleStyles={{} as never}
        cue={{ id: 'c0', text: 'RUN is hard work', start: 0, end: 3000, language: 'en' }}
        altCue={null}
        mode="learning"
        onSaveCard={vi.fn(async () => ({ ok: true }) as never)}
        onTokenHoverChange={() => {}}
        initialSavedWords={initialSavedWords}
      />,
    );
    return screen.getByText('RUN');
  }

  it('saving "running" painted the lemma run; undo by identityKey unpaints it', () => {
    const run = renderRunCue(new Set(['run']));
    expect(run.className).toContain(SAVED_CLS);
    // The event a REAL undo dispatches: raw surface + the saved lemma key.
    fireEvent(window, new CustomEvent(CARD_UNDONE_EVENT, { detail: { token: 'running', identityKey: 'run' } }));
    expect(run.className).not.toContain(SAVED_CLS);
  });

  it('an undo whose lemma STILL has a note keeps the mark (no event sent)', () => {
    const run = renderRunCue(new Set(['run']));
    expect(run.className).toContain(SAVED_CLS);
    // stillInDeck → save-actions never dispatches; a bare token event without
    // identityKey must not touch the lemma mark either.
    fireEvent(window, new CustomEvent(CARD_UNDONE_EVENT, { detail: { token: 'running' } }));
    expect(run.className).toContain(SAVED_CLS);
  });
});
