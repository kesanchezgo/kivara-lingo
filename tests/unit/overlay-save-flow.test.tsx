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
import { render, screen, cleanup, type RenderResult } from '@testing-library/react';
import { SubtitleOverlay } from '../../src/content/ui/SubtitleOverlay';
import type { CreateCardResponse } from '../../src/shared/types';

afterEach(() => {
  cleanup();
});

type SaveFn = (token: string | undefined, sentence: string) => Promise<CreateCardResponse>;

const CUE = { id: 'c0', text: 'hello', start: 0, end: 3000, language: 'en' };

function overlay(saveRequestKey: number, onSaveCard: SaveFn) {
  return (
    <SubtitleOverlay
      subtitleStyles={{} as never}
      cue={CUE}
      altCue={null}
      mode="learning"
      saveRequestKey={saveRequestKey}
      onSaveCard={onSaveCard}
      onTokenHoverChange={() => {}}
      initialSavedWords={new Set()}
    />
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
    expect(tokenEl().className).toContain('border-emerald');
  });

  it('does NOT mark the token green when the save fails', async () => {
    const onSave: SaveFn = async () => ({ ok: false, error: 'Anki closed' });
    const { onSaveCard } = await mountAndSave(onSave);
    expect(onSaveCard).toHaveBeenCalled();
    expect(tokenEl().className).not.toContain('border-emerald');
  });

  it('runs the merge path for words already saved before mount (#13)', async () => {
    const onSave: SaveFn = async () => ({ ok: false, error: 'nope' });
    render(
      <SubtitleOverlay
        subtitleStyles={{} as never}
        cue={CUE}
        altCue={null}
        mode="learning"
        saveRequestKey={0}
        onSaveCard={vi.fn(onSave)}
        onTokenHoverChange={() => {}}
        initialSavedWords={new Set(['hello'])}
      />,
    );
    // initialSavedWords arrives before the useState initializer for late
    // mounts — the effect that merges it must paint green without any save.
    expect(tokenEl().className).toContain('border-emerald');
  });
});
