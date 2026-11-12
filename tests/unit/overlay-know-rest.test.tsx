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
import { useWordStudy, type StudyBinding } from '../../src/content/ui/study';
import {
  resetStudyStores, setWordStatus, studyStores, type WordStatus,
} from '../../src/shared/study/wordStatus';

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
  // The study stores are module singletons: a mark left behind would leak
  // into the next test's snapshot.
  resetStudyStores('en');
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

/**
 * The overlay bound to the REAL study hook. `useWordStudy` is the same binding
 * App hands the overlay in production, so the marks it resolves come from the
 * per-language chrome store — nothing here is a mock of the status layer.
 */
function OverlayWithRealStudy() {
  const wordStudy = useWordStudy('en');
  const study: StudyBinding = {
    statusOf: wordStudy.statusOf,
    detailOf: wordStudy.detailOf,
    setStatus: wordStudy.setStatus,
    inAnki: wordStudy.inAnki,
    userStatusOf: wordStudy.userStatusOf,
  };
  return (
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
    />
  );
}

/** Current marks map straight out of the per-language store. */
function marksOf(): Record<string, string> {
  return studyStores('en').status.get() as unknown as Record<string, string>;
}

/** Flush the store's async write + notification chain. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** In-memory `chrome.storage.local` for the real study stores. */
function installFakeStorage(): { restore: () => void } {
  const stored: Record<string, unknown> = {};
  const listeners: Array<(changes: Record<string, { newValue?: unknown }>, area: string) => void> = [];
  const original = (globalThis as unknown as { chrome: { storage: { local: unknown; onChanged: unknown } } }).chrome.storage;
  (globalThis as unknown as { chrome: { storage: Record<string, unknown> } }).chrome.storage = {
    ...original,
    local: {
      get: async (keys: string | string[]) => {
        const wanted = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const key of wanted) if (key in stored) out[key] = stored[key];
        return out;
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(stored, items);
        for (const [key, newValue] of Object.entries(items)) {
          for (const cb of listeners) cb({ [key]: { newValue } }, 'local');
        }
      },
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key];
      },
    },
    onChanged: { addListener: (cb: (typeof listeners)[number]) => { listeners.push(cb); } },
  };
  return {
    restore: () => {
      (globalThis as unknown as { chrome: { storage: unknown } }).chrome.storage = original;
    },
  };
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

  /**
   * The Undo runs 5 s after the click, from a closure built in an EARLIER
   * render. With a fake binding whose `userStatusOf` reads a mutable object
   * the bug was invisible; here the overlay gets the REAL `useWordStudy`
   * binding, so `userStatusOf` reads the marks map captured in the render that
   * painted the button — exactly the production failure (the guard saw every
   * word it had just marked as "not known" and reverted nothing).
   */
  it('Undo reverts every word it marked, but not the one the user changed', async () => {
    const storage = installFakeStorage();
    await setWordStatus('en', 'the', 'new');
    await setWordStatus('en', 'quick', 'new');
    await setWordStatus('en', 'fox', 'new');

    const view = render(<OverlayWithRealStudy />);
    openToolbar();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t('ovl.knowRest', { n: 3 }) }));
      await settle();
    });

    const options = vi.mocked(toast).mock.calls[0][1] as {
      action: { label: string; onClick: () => void };
    };
    expect(options.action.label).toBe(t('recent.undo'));
    // The three are now known in the REAL store.
    expect(marksOf()).toMatchObject({ the: 'known', quick: 'known', fox: 'known' });

    // The user re-marks one as learning before pressing Undo: that hand mark
    // must survive — Undo only reverts what is still «known».
    await setWordStatus('en', 'fox', 'learning');

    await act(async () => {
      options.action.onClick();
      await settle();
    });

    expect(marksOf()).toMatchObject({ the: 'new', quick: 'new', fox: 'learning' });
    view.unmount();
    storage.restore();
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
