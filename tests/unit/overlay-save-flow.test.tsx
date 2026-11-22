/**
 * Tests the audit's "sin test" bullet for the save → green highlight path.
 *
 * Shaped as a real render against `SubtitleOverlay`, not a code-shape
 * regex: the assertion is "the token element carries the saved style only
 * when the promise resolved ok". Reverting App.tsx's success-path
 * `return { ok: true, … }` back to the shared tail
 * `return { ok: false, error: 'unhandled' }` turns the first test red.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, type RenderResult } from '@testing-library/react';
import { t } from '../../src/shared/i18n';
import { SubtitleOverlay } from '../../src/content/ui/SubtitleOverlay';
import type { CreateCardResponse } from '../../src/shared/types';

afterEach(() => {
  cleanup();
});

type SaveFn = (token: string | undefined, sentence: string) => Promise<CreateCardResponse>;

const CUE = { id: 'c0', text: 'hello', start: 0, end: 3000, language: 'en' };

// A study binding whose ONLY new word is 'hello': the Ctrl+Shift+S shortcut
// then takes the WORD save path (a bare plate save on a one-token cue is
// phrase-level since round 6, and a phrase paints nothing).
const study = {
  statusOf: (key: string) => (key.toLowerCase() === 'hello' ? 'new' : 'known'),
  detailOf: () => ({ status: 'new', source: 'estimated' } as never),
  setStatus: () => {},
  inAnki: () => false,
  userStatusOf: () => undefined,
};

function overlay(saveRequestKey: number, onSaveCard: SaveFn, initialSavedWords: Set<string> = new Set()) {
  return (
    <div data-popover-boundary>
    <SubtitleOverlay
      subtitleStyles={{} as never}
      cue={CUE}
      altCue={null}
      mode="learning"
      saveRequestKey={saveRequestKey}
      onSaveCard={onSaveCard}
      onTokenHoverChange={() => {}}
      initialSavedWords={initialSavedWords}
      study={study as never}
    />
    </div>
  );
}

function tokenEl(): HTMLElement {
  return screen.queryByText('hello')! as HTMLElement;
}

/** Ctrl+Shift+S on the page: App bumps `saveRequestKey`, the overlay saves. */
async function mountAndSave(onSave: SaveFn) {
  const onSaveCard = vi.fn(onSave);
  const view: RenderResult = render(overlay(0, onSaveCard));
  // Guard against a vacuous suite: render() must bail out if the token
  // never mounts, and only then do the assertions below mean anything.
  expect(screen.queryByText('hello')).not.toBeNull();
  view.rerender(overlay(1, onSaveCard));
  await new Promise((r) => setTimeout(r, 0));
  return { onSaveCard, view };
}

describe('saved-word highlighting tracks the real promise (#14 + App.tsx ok:true)', () => {
  it('marks the token green when the save resolves ok', async () => {
    const onSave: SaveFn = async () => ({ ok: true, noteId: 1 });
    const { onSaveCard } = await mountAndSave(onSave);
    expect(onSaveCard).toHaveBeenCalled();
    fireEvent.mouseEnter(tokenEl());
    await vi.waitFor(() => expect(screen.queryByText(t('wp.inYourDeck'))).not.toBeNull());
  });

  it('does NOT mark the token green when the save fails', async () => {
    const onSave: SaveFn = async () => ({ ok: false, error: 'Anki closed' });
    const { onSaveCard } = await mountAndSave(onSave);
    expect(onSaveCard).toHaveBeenCalled();
    fireEvent.mouseEnter(tokenEl());
    expect(screen.queryByText(t('wp.inYourDeck'))).toBeNull();
  });

  it('runs the merge path for words already saved before mount (#13)', async () => {
    const onSave: SaveFn = async () => ({ ok: false, error: 'nope' });
    render(overlay(0, vi.fn(onSave), new Set(['hello'])));
    fireEvent.mouseEnter(tokenEl());
    await vi.waitFor(() => expect(screen.queryByText(t('wp.inYourDeck'))).not.toBeNull());
  });
});
