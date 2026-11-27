/** PR #170: the two audit contracts (focus retained in the card, speed restored). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, within } from '@testing-library/react';
import { SubtitleOverlay } from '../../src/content/ui/SubtitleOverlay';
import { rateOnSuspensionChange, useStudyPlayback } from '../../src/content/ui/useStudyPlayback';
import { t } from '../../src/shared/i18n';
import type { StudyBinding } from '../../src/content/ui/study';
import type { PlaybackController } from '../../src/content/platform-adapters/types';

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

describe('PR #170 audit · activating a card control keeps the focus (and the card)', () => {
  it('keeps the focus on "Reproducir pronunciación" instead of blurring it to <body>', () => {
    const { onTokenHoverChange } = renderOverlay();
    const token = document.querySelector<HTMLElement>('[data-tok-idx="0"]')!;
    fireEvent.mouseEnter(token);
    fireEvent.focus(token);
    const card = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const speak = within(card).getByRole('button', { name: t('popover.playPronunciation') });

    // A keyboard user reaches the button, then presses Enter.
    speak.focus();
    expect(document.activeElement).toBe(speak);
    // The mount notification ("not hovered") is not what this test is about:
    // only calls made BY the activation count.
    onTokenHoverChange.mockClear();
    fireEvent.click(speak);

    // The inherited `.blur()` sent the focus to <body>; the card closed on the
    // next blur/leave and the video resumed mid-listen.
    expect(document.activeElement, 'the focus is still the button').toBe(speak);
    expect(onTokenHoverChange, 'and the session never ended').not.toHaveBeenCalledWith(false);
    expect(document.querySelector('[role="dialog"]'), 'the card is still open').not.toBeNull();
  });

});

describe('PR #170 audit · suspension ends with the user speed back', () => {
  const controller = () => ({
    seek: vi.fn(async () => {}),
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    getRate: () => 1,
    setRate: vi.fn(),
    isPaused: () => false,
    currentTimeMs: () => 0,
  } as unknown as PlaybackController);

  it('pins 1x while suspended and gives the user their speed back when it lifts', () => {
    expect(rateOnSuspensionChange(true, 1.25), 'a capture or an off switch plays at 1x').toBe(1);
    expect(rateOnSuspensionChange(false, 1.25), 'the study speed returns with the user').toBe(1.25);
    expect(rateOnSuspensionChange(false, 0.75)).toBe(0.75);
  });

  it('applies that decision to the media on every suspension change', () => {
    const fake = controller();
    const { result, rerender } = renderHook(
      ({ suspended }: { suspended: boolean }) => useStudyPlayback({
        controller: fake, cues: [], video: null, pausedByKivara: { current: false }, suspended,
      }),
      { initialProps: { suspended: false } },
    );
    const userSpeed = result.current.speed;

    vi.mocked(fake.setRate).mockClear();
    rerender({ suspended: true });
    expect(fake.setRate, 'suspending pins 1x').toHaveBeenCalledWith(1);

    vi.mocked(fake.setRate).mockClear();
    rerender({ suspended: true });
    expect(fake.setRate, 'and repeating the state does nothing').not.toHaveBeenCalled();

    vi.mocked(fake.setRate).mockClear();
    rerender({ suspended: false });
    expect(fake.setRate, 'leaving the suspension re-applies the study speed').toHaveBeenCalledWith(userSpeed);
  });
});
