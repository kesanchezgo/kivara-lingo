/**
 * F3 gate, verified at F9: the overlay's keyboard walk.
 *
 * The line is ONE Tab stop (roving tabindex) and the words are walked with
 * ←/→ plus Home/End; Shift+←/→ extends the selection. Native players listen
 * for the same keys (they seek the video), so the handler must
 * `preventDefault()` — asserted below, because a regression would seek the
 * film every time somebody reads a subtitle with the keyboard.
 *
 * Rendered in happy-dom against the real `SubtitleOverlay`: the focus moves
 * are observable through `document.activeElement`, which is exactly what a
 * keyboard user gets.
 */
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, fireEvent, cleanup, act, type RenderResult } from '@testing-library/react';
import { SubtitleOverlay } from '../../src/content/ui/SubtitleOverlay';

afterEach(cleanup);

const CUE = { id: 'c0', text: 'alpha beta gamma delta', start: 0, end: 4000, language: 'en' };

function mount(): { view: RenderResult; words: HTMLElement[] } {
  const view = render(
    <SubtitleOverlay
      subtitleStyles={{} as never}
      cue={CUE}
      altCue={null}
      mode="learning"
      saveRequestKey={0}
      onSaveCard={async () => ({ ok: true, noteId: 1 })}
      onTokenHoverChange={() => {}}
      initialSavedWords={new Set()}
    />,
  );
  const words = [...view.container.querySelectorAll<HTMLElement>('[data-tok-idx]')];
  // Guard against a vacuous suite: the walk needs at least four stops.
  expect(words.length).toBeGreaterThanOrEqual(4);
  return { view, words };
}

/** Focusing a word opens its card, whose lookup resolves asynchronously. */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('overlay keyboard walk (F3)', () => {
  it('is a single Tab stop, held by the first word', async () => {
    const { words } = mount();
    expect(words.map((w) => w.tabIndex)).toEqual([0, -1, -1, -1]);
    await flush();
  });

  it('walks with arrows and jumps with Home/End', async () => {
    const { words } = mount();
    words[0].focus();
    expect(document.activeElement).toBe(words[0]);

    fireEvent.keyDown(words[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(words[1]);
    fireEvent.keyDown(words[1], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(words[2]);

    fireEvent.keyDown(words[2], { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(words[1]);

    fireEvent.keyDown(words[1], { key: 'End' });
    expect(document.activeElement).toBe(words[words.length - 1]);
    fireEvent.keyDown(words[words.length - 1], { key: 'Home' });
    expect(document.activeElement).toBe(words[0]);
    await flush();
  });

  it('stops at the edges instead of wrapping', async () => {
    const { words } = mount();
    words[0].focus();
    fireEvent.keyDown(words[0], { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(words[0]);
    words[words.length - 1].focus();
    fireEvent.keyDown(words[words.length - 1], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(words[words.length - 1]);
    await flush();
  });

  it('keeps the arrow keys away from the player and extends with Shift', async () => {
    const { words } = mount();
    words[0].focus();

    // fireEvent returns false when the synthetic event was cancelled — the
    // signal the player's own seek handler reads as "already handled".
    const notCancelled = fireEvent.keyDown(words[0], { key: 'ArrowRight' });
    expect(notCancelled).toBe(false);
    expect(document.activeElement).toBe(words[1]);

    fireEvent.keyDown(words[1], { key: 'ArrowRight', shiftKey: true });
    expect(document.activeElement).toBe(words[2]);
    expect(words[1].getAttribute('data-active')).not.toBeNull();
    expect(words[2].getAttribute('data-active')).not.toBeNull();
    await flush();
  });

  it('ignores the walk while a modifier is held (browser/extension shortcuts)', async () => {
    const { words } = mount();
    words[0].focus();
    fireEvent.keyDown(words[0], { key: 'ArrowRight', altKey: true });
    expect(document.activeElement).toBe(words[0]);
    await flush();
  });
});
