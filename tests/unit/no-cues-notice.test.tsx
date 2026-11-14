/**
 * Point 2 — the notice's state machine, with fake timers.
 *
 * The countdown runs on PLAYBACK time: it only arms while the video plays,
 * it fires once ~5 s of that playback has passed with zero cues, and the
 * first cue kills it instantly. Pausing before it fires disarms the wait.
 *
 * Once it HAS fired the notice is sticky: a pause (or a seek, or the platform
 * buffering) is not "subtitles appeared", so hiding it there left the user
 * looking at a blank caption with no explanation. It goes away on the first
 * cue or when the episode changes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNoCueNotice } from '../../src/content/ui/no-cues-notice';

describe('useNoCueNotice', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stays hidden while paused, no matter how long', () => {
    const { result, rerender } = renderHook((p) => useNoCueNotice(p.playing, p.cues), {
      initialProps: { playing: false, cues: 0 },
    });
    void act(() => vi.advanceTimersByTime(60_000));
    rerender({ playing: false, cues: 0 });
    expect(result.current).toBe(false);
  });

  it('appears after ~5 s of playing with zero cues', () => {
    const { result } = renderHook(() => useNoCueNotice(true, 0));
    void act(() => vi.advanceTimersByTime(4_500));
    expect(result.current).toBe(false);
    void act(() => vi.advanceTimersByTime(700));
    expect(result.current).toBe(true);
  });

  it('disappears the moment the first cue arrives', () => {
    const { result, rerender } = renderHook((p) => useNoCueNotice(p.playing, p.cues), {
      initialProps: { playing: true, cues: 0 },
    });
    void act(() => vi.advanceTimersByTime(6_000));
    expect(result.current).toBe(true);
    rerender({ playing: true, cues: 1 });
    expect(result.current).toBe(false);
  });

  it('never arms when cues already exist', () => {
    const { result, rerender } = renderHook((p) => useNoCueNotice(p.playing, p.cues), {
      initialProps: { playing: true, cues: 3 },
    });
    void act(() => vi.advanceTimersByTime(30_000));
    rerender({ playing: true, cues: 0 });
    // Losing ALL cues mid-play re-arms the countdown (it fires 5 s later),
    // but the pre-existing-cues state never fired on its own.
    void act(() => vi.advanceTimersByTime(1_000));
    expect(result.current).toBe(false);
    void act(() => vi.advanceTimersByTime(4_500));
    expect(result.current).toBe(true);
  });

  it('pausing freezes and disarms the countdown', () => {
    const { result, rerender } = renderHook((p) => useNoCueNotice(p.playing, p.cues), {
      initialProps: { playing: true, cues: 0 },
    });
    void act(() => vi.advanceTimersByTime(3_000));
    rerender({ playing: false, cues: 0 });
    void act(() => vi.advanceTimersByTime(30_000));
    expect(result.current).toBe(false);
  });
});

describe('useNoCueNotice: sticky once shown (QA finding)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps the notice on screen when the video pauses after it fired', () => {
    const { result, rerender } = renderHook((p) => useNoCueNotice(p.playing, p.cues), {
      initialProps: { playing: true, cues: 0 },
    });
    void act(() => vi.advanceTimersByTime(6_000));
    expect(result.current).toBe(true);
    rerender({ playing: false, cues: 0 });
    void act(() => vi.advanceTimersByTime(20_000));
    expect(result.current).toBe(true);
    rerender({ playing: true, cues: 0 });
    expect(result.current).toBe(true);
  });

  it('hides on the first cue even after the sticky state', () => {
    const { result, rerender } = renderHook((p) => useNoCueNotice(p.playing, p.cues), {
      initialProps: { playing: true, cues: 0 },
    });
    void act(() => vi.advanceTimersByTime(6_000));
    rerender({ playing: false, cues: 0 });
    expect(result.current).toBe(true);
    rerender({ playing: true, cues: 1 });
    expect(result.current).toBe(false);
  });

  it('resets when the episode changes', () => {
    const { result, rerender } = renderHook(
      (p) => useNoCueNotice(p.playing, p.cues, 5_000, p.episodeKey),
      { initialProps: { playing: true, cues: 0, episodeKey: 'ep-1' } },
    );
    void act(() => vi.advanceTimersByTime(6_000));
    expect(result.current).toBe(true);
    rerender({ playing: true, cues: 0, episodeKey: 'ep-2' });
    expect(result.current).toBe(false);
    // ...and the new episode arms its own countdown.
    void act(() => vi.advanceTimersByTime(5_500));
    expect(result.current).toBe(true);
  });
});
