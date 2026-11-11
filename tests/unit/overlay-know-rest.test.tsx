/**
 * "Know the rest" and the copy failure, on the subtitle overlay (parity block
 * 4).
 *
 * The prototype's sentence toolbar carries a count of the NEW words in the line
 * and marks them all known in one click; the toast's Undo reverts only what
 * nobody has touched since — the same rule the recent-cards list uses. These
 * tests drive the real overlay with a StudyBinding fake and assert the store
 * calls, not the markup shape.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { toast } from 'sonner';
import { t } from '../../src/shared/i18n';
import { SubtitleOverlay } from '../../src/content/ui/SubtitleOverlay';
import type { StudyBinding } from '../../src/content/ui/study';
import type { WordStatus } from '../../src/shared/study/wordStatus';

vi.mock('sonner', () => {
  const toast = vi.fn();
  Object.assign(toast, {
    custom: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    dismiss: vi.fn(),
    loading: vi.fn(),
    message: vi.fn(),
  });
  return { toast, Toaster: () => null };
});

afterEach(() => {
  cleanup();
  vi.mocked(toast).mockReset();
  vi.mocked(toast.error).mockReset();
});

const CUE = { id: 'c1', text: 'the quick fox', start: 0, end: 3000, language: 'en' };

/** Status map the fake resolves from; unknown words read as `new`. */
function binding(statuses: Record<string, WordStatus>) {
  const setStatus = vi.fn((key: string, status: WordStatus | null) => {
    if (status === null) delete statuses[key];
    else statuses[key] = status;
  });
  const study: StudyBinding = {
    statusOf: (key) => statuses[key] ?? 'new',
    detailOf: (key) => ({ status: statuses[key] ?? 'new' }) as never,
    setStatus,
    inAnki: () => false,
    userStatusOf: (key) => statuses[key],
  };
  return { study, setStatus, statuses };
}

function renderOverlay(study?: StudyBinding) {
  return render(
    <SubtitleOverlay
      subtitleStyles={{ keepNativeLineBreaks: false } as never}
      cue={CUE}
      altCue={null}
      mode="learning"
      saveRequestKey={null}
      onSaveCard={vi.fn(async () => ({ ok: true }))}
      onTokenHoverChange={() => {}}
      initialSavedWords={new Set()}
      playing={false}
      study={study}
    />,
  );
}

/** Hover the subtitle plate so the sentence toolbar opens. */
function openToolbar(): void {
  const plate = document.querySelector('[data-kivara-hover-zone="true"]') as HTMLElement;
  expect(plate).not.toBeNull();
  fireEvent.mouseEnter(plate);
}

describe('know the rest', () => {
  it('shows how many new words the line has', () => {
    renderOverlay(binding({}).study);
    openToolbar();
    expect(screen.getByRole('button', { name: t('ovl.knowRest', { n: 3 }) })).toBeTruthy();
  });

  it('marks every new word known and reports the count', () => {
    const { study, setStatus } = binding({});
    renderOverlay(study);
    openToolbar();
    fireEvent.click(screen.getByRole('button', { name: t('ovl.knowRest', { n: 3 }) }));
    expect(setStatus).toHaveBeenCalledTimes(3);
    for (const call of setStatus.mock.calls) expect(call[1]).toBe('known');
    expect(vi.mocked(toast)).toHaveBeenCalledWith(t('ovl.knewRestDone', { n: 3 }), expect.anything());
  });

  it('uses the singular copy for a single new word', () => {
    const { study } = binding({ the: 'known', quick: 'known' });
    renderOverlay(study);
    openToolbar();
    expect(screen.getByRole('button', { name: t('ovl.knowRestOne') })).toBeTruthy();
  });

  it('offers Undo and reverts only words still marked known', () => {
    const { study, statuses } = binding({});
    renderOverlay(study);
    openToolbar();
    fireEvent.click(screen.getByRole('button', { name: t('ovl.knowRest', { n: 3 }) }));
    const options = vi.mocked(toast).mock.calls[0][1] as {
      action: { label: string; onClick: () => void };
    };
    expect(options.action.label).toBe(t('recent.undo'));

    // The user marks one of them learning again before pressing Undo: that
    // hand mark must survive — Undo only reverts what is still «known».
    statuses.fox = 'learning';
    act(() => options.action.onClick());

    expect(statuses.fox).toBe('learning');
    expect(statuses.the).toBeUndefined();
    expect(statuses.quick).toBeUndefined();
  });

  it('renders no button when the line has no new words', () => {
    const { study } = binding({ the: 'known', quick: 'known', fox: 'known' });
    renderOverlay(study);
    openToolbar();
    expect(screen.queryByRole('button', { name: t('ovl.knowRest', { n: 3 }) })).toBeNull();
  });

  it('renders no button without a study profile', () => {
    renderOverlay(undefined);
    openToolbar();
    expect(screen.queryByRole('button', { name: /known/i })).toBeNull();
  });
});

describe('copy failure', () => {
  it('says so instead of failing silently', async () => {
    // No navigator.clipboard and no execCommand: copyText answers false.
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const originalExec = document.execCommand;
    document.execCommand = vi.fn(() => false);

    renderOverlay(binding({}).study);
    openToolbar();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t('overlay.copySentenceTitle') }));
      await Promise.resolve();
    });
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(t('overlay.copyFailed'), { duration: 2400 });

    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
    document.execCommand = originalExec;
  });
});
