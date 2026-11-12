/**
 * The jump guard compares the VIDEO advance against the REAL time elapsed at
 * the current rate, not against a fixed gap.
 *
 * A hidden tab throttles the 100 ms poll to about one tick per second. That is
 * a normal tick — the video advanced ~1 s because ~1 s of wall clock passed —
 * so the cue end it crosses must fire loop/auto-pause. The old fixed floor
 * (`1000 ms`, strict `>`) let an equality through but swallowed the ordinary
 * 1 s-plus overshoot of a coalesced tick; a seek, by contrast, moves the video
 * by seconds while the clock barely moved.
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { useStudyPlayback } from '../../src/content/ui/useStudyPlayback';
import { useKivaraStore } from '../../src/shared/use-kivara-store';
import type {
  PlaybackController,
  SubtitleCue,
} from '../../src/content/platform-adapters/types';
import type { StudySettings } from '../../src/shared/types';

const CUES: SubtitleCue[] = [
  { id: 'a', start: 0, end: 1000, text: 'first cue', language: 'en' },
  { id: 'b', start: 1000, end: 2000, text: 'second cue', language: 'en' },
];

interface FakeController {
  api: PlaybackController;
  setTime(ms: number): void;
  pause: Mock;
}

function fakeController(): FakeController {
  let timeMs = 0;
  let rate = 1;
  const pause = vi.fn();
  const api: PlaybackController = {
    seek: vi.fn(async (ms: number) => {
      timeMs = ms;
    }),
    play: vi.fn(async () => {}),
    pause,
    getRate: () => rate,
    setRate: (next: number) => {
      rate = next;
    },
    isPaused: () => false,
    currentTimeMs: () => timeMs,
  };
  return { api, setTime: (ms) => (timeMs = ms), pause };
}

let nowMs = 0;
let studyBefore: StudySettings;

beforeEach(() => {
  vi.useFakeTimers();
  nowMs = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  const state = useKivaraStore.getState();
  studyBefore = state.study;
  // auto-pause is the observable effect of a genuine crossing here.
  useKivaraStore.setState({ study: { ...state.study, autoPauseCue: true } });
});

afterEach(() => {
  cleanup();
  useKivaraStore.setState({ study: studyBefore });
  vi.useRealTimers();
});

/**
 * One poll: the controller reports `videoMs`, wall clock reports `wallMs`.
 * The poll interval itself is 100 ms of fake time; the clock is what the guard
 * must trust, not the interval budget.
 */
function tick(controller: FakeController, videoMs: number, wallMs: number): void {
  controller.setTime(videoMs);
  nowMs = wallMs;
  act(() => {
    vi.advanceTimersByTime(100);
  });
}

function mount(controller: FakeController): void {
  const pausedByKivara = { current: false };
  renderHook(() =>
    useStudyPlayback({ controller: controller.api, cues: CUES, pausedByKivara }),
  );
}

describe('study jump guard uses real elapsed time', () => {
  it('fires when a normal throttled tick crosses the cue end (1 s real, 1 s video)', () => {
    const exact = fakeController();
    mount(exact);
    expect(exact.pause).not.toHaveBeenCalled();
    tick(exact, 1000, 1000);
    expect(exact.pause).toHaveBeenCalledTimes(1);
  });

  it('fires on a coalesced 1 s tick whose video advance overshoots the old floor', () => {
    // The regression the fixed threshold introduced: +1000 ms of wall clock,
    // +1100 ms of video is still normal playback in a hidden tab, and the cue
    // end it crosses must fire instead of being swallowed as a scrub.
    const overshoot = fakeController();
    mount(overshoot);
    expect(overshoot.pause).not.toHaveBeenCalled();
    tick(overshoot, 1100, 1000);
    expect(overshoot.pause).toHaveBeenCalledTimes(1);
  });

  it('reads a seek (100 ms real, 3000 ms video) as a jump and does not fire', () => {
    const seek = fakeController();
    mount(seek);
    tick(seek, 3000, 100);
    expect(seek.pause).not.toHaveBeenCalled();
  });
});
