/**
 * PR #170 · 1 — a lookup session opened by the pointer or the KEYBOARD must
 * survive focus moving into the card.
 *
 * Two root causes shipped together:
 *   • the card is rendered through `createPortal` into `[data-popover-boundary]`,
 *     OUTSIDE the token wrapper's DOM subtree, so the wrapper's
 *     `e.currentTarget.contains(e.relatedTarget)` check is false the moment
 *     focus lands on "Guardar" — the card closed and the video resumed under
 *     the user's hands;
 *   • the card was not a `[data-kivara-hover-zone]`, so `overKivaraZone()`
 *     answered "not over Kivara" while the pointer sat on the card and App's
 *     350 ms watchdog played the video mid-lookup.
 *
 * These are DOM facts: an attribute on the card/bridge, and whether the
 * session's hover signal goes false after focus moves into the card.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { SubtitleOverlay } from '../../src/content/ui/SubtitleOverlay';
import { WordPopover, type WordPopoverProps } from '../../src/content/ui/WordPopover';
import { t } from '../../src/shared/i18n';
import type { StudyBinding } from '../../src/content/ui/study';

const CUE = { id: 'c1', text: 'the quick fox jumps', start: 0, end: 3000, language: 'en' };

const study: StudyBinding = {
  statusOf: () => 'new',
  detailOf: () => ({ status: 'new' }) as never,
  setStatus: () => {},
  inAnki: () => false,
  userStatusOf: () => undefined,
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

function renderOverlay(onTokenHoverChange = vi.fn()) {
  render(
    <div data-popover-boundary>
      <SubtitleOverlay
        subtitleStyles={{ keepNativeLineBreaks: false } as never}
        cue={CUE}
        altCue={null}
        mode="learning"
        saveRequestKey={null}
        onSaveCard={vi.fn(async () => ({ ok: true }))}
        onTokenHoverChange={onTokenHoverChange}
        initialSavedWords={new Set()}
        playing={false}
        study={study}
      />
    </div>,
  );
  return { onTokenHoverChange };
}

const tokenEl = () => document.querySelector<HTMLElement>('[data-tok-idx="0"]')!;
const cardEl = () => document.querySelector<HTMLElement>('[role="dialog"]');
const saveButton = () => within(cardEl()!).getByRole('button', { name: t('wp.save') });

describe('PR #170 · the card is a Kivara hover zone', () => {
  it('marks the card and its hover bridges as zones', () => {
    renderOverlay();
    fireEvent.mouseEnter(tokenEl());
    const card = cardEl();
    expect(card, 'hovering a token opens the card').not.toBeNull();
    // Without this the global watchdog reads "the pointer is not on Kivara"
    // while the pointer is on the card, and plays the video mid-lookup.
    expect(card!.getAttribute('data-kivara-hover-zone')).toBe('true');
    const zones = card!.querySelectorAll('[data-kivara-hover-zone="true"]');
    // The two bridge strips (the visible arrow gap and the 12px strip) are the
    // path a hand travels from the word to the card.
    expect(zones.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the card open when focus moves from the token into the card', () => {
    vi.useFakeTimers();
    const { onTokenHoverChange } = renderOverlay();
    const token = tokenEl();
    fireEvent.mouseEnter(token);
    fireEvent.focus(token);
    expect(onTokenHoverChange).toHaveBeenLastCalledWith(true);

    // Tab/click from the word to "Guardar": the card is portaled outside the
    // token wrapper, which is exactly why the DOM contains() check failed.
    act(() => {
      fireEvent.blur(token, { relatedTarget: saveButton() });
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(onTokenHoverChange, 'the lookup session must survive the focus move')
      .not.toHaveBeenLastCalledWith(false);
    expect(cardEl(), 'the card is still open').not.toBeNull();
  });

  it('still closes when focus leaves both the card and the word', () => {
    vi.useFakeTimers();
    const { onTokenHoverChange } = renderOverlay();
    const token = tokenEl();
    fireEvent.mouseEnter(token);
    fireEvent.focus(token);

    const outside = document.createElement('button');
    document.body.appendChild(outside);
    act(() => {
      fireEvent.blur(token, { relatedTarget: outside });
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(onTokenHoverChange, 'leaving for good still ends the session')
      .toHaveBeenLastCalledWith(false);
  });
});

describe('PR #170 · WordPopover owns its focus lifecycle', () => {
  const cardProps = (overrides: Partial<WordPopoverProps> = {}): WordPopoverProps => ({
    visible: true,
    onMouseEnter: vi.fn(),
    onMouseLeave: vi.fn(),
    token: 'run',
    lookupToken: 'run',
    sentence: 'She ran home.',
    sourceLang: 'en',
    includeAi: false,
    kind: 'word',
    lemma: 'run',
    isExpanded: false,
    isSaved: false,
    parentMWE: null,
    onToggleExpand: () => {},
    onRejoinParent: () => {},
    onSave: () => {},
    ...overrides,
  } as unknown as WordPopoverProps);

  it('entering the card with the keyboard starts/keeps the session', () => {
    const onMouseEnter = vi.fn();
    const onMouseLeave = vi.fn();
    render(
      <div data-popover-boundary>
        <span data-tok-idx="0">run</span>
        <WordPopover {...cardProps({ anchorIndex: 0, onMouseEnter, onMouseLeave })} />
      </div>,
    );
    const card = cardEl()!;
    fireEvent.focus(card);
    expect(onMouseEnter, 'focus inside the card keeps the lookup alive').toHaveBeenCalled();
    expect(onMouseLeave).not.toHaveBeenCalled();
  });

  it('leaving the card for the anchor word does not end the session', () => {
    const onMouseLeave = vi.fn();
    render(
      <div data-popover-boundary>
        <span data-tok-idx="0">run</span>
        <WordPopover {...cardProps({ anchorIndex: 0, onMouseLeave })} />
      </div>,
    );
    const card = cardEl()!;
    fireEvent.blur(card, { relatedTarget: document.querySelector('[data-tok-idx="0"]') });
    expect(onMouseLeave, 'the token itself is still part of the session').not.toHaveBeenCalled();
  });

  it('leaving the card and the word for good ends the session', () => {
    const onMouseLeave = vi.fn();
    render(
      <div data-popover-boundary>
        <span data-tok-idx="0">run</span>
        <WordPopover {...cardProps({ anchorIndex: 0, onMouseLeave })} />
      </div>,
    );
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    fireEvent.blur(cardEl()!, { relatedTarget: outside });
    expect(onMouseLeave).toHaveBeenCalled();
  });
});
