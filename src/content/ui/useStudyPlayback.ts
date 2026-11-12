/**
 * Study playback (F6): auto-pause, loop, previous/next line, replay, slow
 * repeat and speed, on top of the platform PlaybackController
 * (docs/REDESIGN-V2.md §7 F6, §4.5).
 *
 * Every jump and rate change goes through the controller; nothing here reads
 * or writes `video.currentTime`. The behaviours mirror the prototype
 * (`kvl:autoPauseCue` becomes `store.study.autoPauseCue`; loop and speed are
 * per-device UI state, so they live in `chrome.storage.local`).
 *
 * Pause ownership is the repo's rule (`kivaraPausedRef`): only a pause Kivara
 * requested is a pause Kivara may undo. A user gesture (play button, line
 * click, previous/next) resumes unconditionally — that is what they asked for.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MutableRefObject,
} from 'react';
import { useKivaraStore } from '../../shared/use-kivara-store';
import { createChromeLocalStore } from '../../shared/chrome-local-store';
import { useChromeLocal } from '../../ui/hooks/useChromeLocal';
import type { PlaybackController, SubtitleCue } from '../platform-adapters/types';
import { PLAYBACK_SPEEDS, SLOW_REPLAY_RATE } from '../platform-adapters/playback';

/* ── Clock, outside React ────────────────────────────────────────────────
 * The transcript's per-line progress bar is the only surface that follows the
 * playhead; keeping the time in a module store means App re-renders on cue
 * boundaries only, not at 10 Hz.
 */
let clockMs = 0;
const clockListeners = new Set<() => void>();

function publishTime(ms: number): void {
  clockMs = ms;
  clockListeners.forEach((listener) => listener());
}

function subscribeClock(listener: () => void): () => void {
  clockListeners.add(listener);
  return () => clockListeners.delete(listener);
}

/** Live playhead, ms. Re-renders the caller on every tick: use it in leaves only. */
export function usePlaybackTimeMs(): number {
  return useSyncExternalStore(subscribeClock, () => clockMs, () => clockMs);
}

/** Test seam: reset the module clock between mounts. */
export function resetPlaybackClockForTests(): void {
  clockMs = 0;
  clockListeners.clear();
}

/** Playhead polling period, ms. */
const TICK_MS = 100;
/** Floor for the "this was a jump, not playback" gap. */
const JUMP_FLOOR_MS = 1000;
/** A gap of more than this many ticks (scaled by the rate) is a jump. */
const JUMP_TICKS = 3;

const loopStore = createChromeLocalStore<boolean>('kvl:study.loop', false);
const speedStore = createChromeLocalStore<number>('kvl:study.speed', 1, (raw) =>
  typeof raw === 'number' && PLAYBACK_SPEEDS.includes(raw) ? raw : 1,
);

export interface StudyPlaybackOptions {
  controller: PlaybackController | null;
  cues: readonly SubtitleCue[];
  /** The element, so a platform-initiated play clears our auto-pause state. */
  video?: HTMLVideoElement | null;
  /** The owner's pause flag (App's `kivaraPausedRef`). */
  pausedByKivara: MutableRefObject<boolean>;
  /** True while a capture is recording: no loop, no auto-pause, speed 1×. */
  suspended?: boolean;
}

export interface StudyPlayback {
  /** Index of the cue under the playhead right now (read live, not rendered). */
  getActiveIndex(): number;
  /** Jump to a cue. `play` defaults to true (a line click starts playing). */
  seekCue(index: number, play?: boolean): void;
  prev(): void;
  next(): void;
  replay(): void;
  /** One pass of the active cue at 0.75×, ending paused; the general rate is restored. */
  replaySlow(): void;
  togglePlay(): void;
  /** Pause that Kivara owns (auto-pause, explain, lookup). Safe to resume later. */
  pauseForStudy(): void;
  /** Resume only when Kivara is the one that paused. */
  resumeIfKivaraPaused(): void;
  resume(): void;
  loop: boolean;
  setLoop(value: boolean): void;
  speed: number;
  setSpeed(value: number): void;
  stepSpeed(direction: 1 | -1): number;
  /** True when the last pause came from the end-of-cue auto-pause. */
  autoPaused: boolean;
  /** The same flag as a ref, for listeners that must not re-subscribe. */
  autoPausedRef: MutableRefObject<boolean>;
}

export function useStudyPlayback({
  controller,
  cues,
  video = null,
  pausedByKivara,
  suspended = false,
}: StudyPlaybackOptions): StudyPlayback {
  const autoPause = useKivaraStore((state) => state.study.autoPauseCue);
  const loop = useChromeLocal(loopStore);
  const speed = useChromeLocal(speedStore);
  const [autoPaused, setAutoPaused] = useState(false);
  const autoPausedRef = useRef(false);

  /** Single place that keeps the state and the ref in step. */
  const markAutoPaused = (value: boolean) => {
    autoPausedRef.current = value;
    setAutoPaused(value);
  };

  // Latest values for the interval, which is created once per controller.
  const cuesRef = useRef(cues);
  cuesRef.current = cues;
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const autoPauseRef = useRef(autoPause);
  autoPauseRef.current = autoPause;
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
  const slowOnceRef = useRef(false);
  const lastTimeRef = useRef(0);
  /** The cue that contained the previous tick. Contiguous VTT cues start
   * exactly where the previous one ends, so at the crossing tick the cue
   * under the playhead is ALREADY the next one — the end that was crossed
   * belongs to this one. Comparing against the current cue never fires. */
  const activeCueRef = useRef<SubtitleCue | null>(null);
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  const getActiveIndex = useCallback((): number => {
    const active = controllerRef.current;
    if (!active) return -1;
    return cueIndexAt(cuesRef.current, active.currentTimeMs());
  }, []);

  /**
   * Point the crossing bookkeeping at the cue under `timeMs`, without treating
   * the move that got us there as playback.
   *
   * A SEEK is a jump, not a tick: the playhead skips a span of time, so the
   * previous/current pair says nothing about the cue having played out. Both
   * halves must be re-anchored at the DESTINATION, exactly as `seekCue` always
   * did — otherwise a forward jump looks like crossing the end of the cue we
   * left (loop yanks the user back, or auto-pause fires mid-cue) and a
   * backward jump leaves `activeCueRef` pointing at a cue the playhead is no
   * longer near.
   */
  const anchorAt = useCallback((timeMs: number): void => {
    const list = cuesRef.current;
    const index = cueIndexAt(list, timeMs);
    lastTimeRef.current = timeMs;
    activeCueRef.current = index >= 0 ? list[index] : null;
  }, []);

  useEffect(() => {
    if (!controller) return;
    let disposed = false;
    const tick = () => {
      if (disposed) return;
      const time = controller.currentTimeMs();
      publishTime(time);
      const list = cuesRef.current;
      const index = cueIndexAt(list, time);
      const cue = index >= 0 ? list[index] : null;
      const previous = lastTimeRef.current;
      lastTimeRef.current = time;
      // The cue we were in last tick is the one whose end we may have just
      // passed; `cue` may already be the next one (or null in a gap).
      const endedCue = activeCueRef.current;
      activeCueRef.current = cue;
      if (suspendedRef.current) {
        slowOnceRef.current = false;
        return;
      }
      // Crossing the end of the cue. Loop wins over auto-pause; a slow pass
      // always ends paused (you asked to hear THAT line).
      //
      // Belt and braces on top of the seek listeners: a tick that advanced by
      // more than a few ticks worth of playing time is a JUMP — a scrub, a
      // platform chapter marker, a seek that landed between two ticks — so the
      // end it appears to cross was never played. A genuine end-of-cue tick
      // moves by a few ms, well under the floor.
      const rate = controller.getRate();
      const jumpGapMs = Math.max(
        JUMP_FLOOR_MS,
        JUMP_TICKS * TICK_MS * (Number.isFinite(rate) && rate > 0 ? rate : 1),
      );
      const crossed = !(time - previous > jumpGapMs)
        && endedCue !== null
        && previous < endedCue.end
        && time >= endedCue.end;
      if (!crossed) return;
      const endedSlow = slowOnceRef.current;
      slowOnceRef.current = false;
      if (endedSlow) {
        controller.setRate(speedRef.current);
        pausedByKivara.current = true;
        controller.pause();
        markAutoPaused(true);
        return;
      }
      if (loopRef.current) {
        const start = endedCue.start;
        // Anchor BEFORE the seek resolves: the loop's own jump is a seek, and
        // the next tick may land inside the media element's seek.
        anchorAt(start + 10);
        void controller
          .seek(start + 10)
          .then(() => {
            anchorAt(start + 10);
            void controller.play().catch(() => {});
          })
          .catch(() => {
            /* unseekable platform: the loop simply does not run */
          });
        return;
      }
      if (autoPauseRef.current) {
        pausedByKivara.current = true;
        controller.pause();
        markAutoPaused(true);
      }
    };
    const handle = window.setInterval(tick, 100);
    tick();
    return () => {
      disposed = true;
      window.clearInterval(handle);
    };
  }, [controller, pausedByKivara, anchorAt]);

  /**
   * Seek listeners: a user scrub, the platform's own controls, or anything
   * else that moves the media element re-anchors the crossing bookkeeping at
   * the destination. Without this, the first tick after a forward jump sees
   * `previous` inside the old cue and `time` past its end — indistinguishable
   * from the cue having played out.
   */
  useEffect(() => {
    if (!video) return;
    const onSeek = () => anchorAt(video.currentTime * 1000);
    video.addEventListener('seeking', onSeek);
    video.addEventListener('seeked', onSeek);
    return () => {
      video.removeEventListener('seeking', onSeek);
      video.removeEventListener('seeked', onSeek);
    };
  }, [video, anchorAt]);

  // A platform- or user-initiated play means the auto-pause is over, so the
  // hover-resume watchdog must stop treating the pause as ours.
  useEffect(() => {
    if (!video) return;
    const onPlay = () => {
      autoPausedRef.current = false;
      setAutoPaused(false);
    };
    video.addEventListener('play', onPlay);
    return () => video.removeEventListener('play', onPlay);
  }, [video]);

  // Switching the study speed sets the live rate, except during a slow pass.
  useEffect(() => {
    if (!controller || slowOnceRef.current) return;
    controller.setRate(speed);
  }, [controller, speed]);

  const seekCue = useCallback(
    (index: number, play = true) => {
      if (!controller) return;
      const list = cuesRef.current;
      if (list.length === 0) return;
      const safe = Math.max(0, Math.min(list.length - 1, index));
      const target = list[safe];
      slowOnceRef.current = false;
      controller.setRate(speedRef.current);
      // Re-anchor at the DESTINATION before the seek lands: the controller may
      // resolve after one or more ticks, and during a jump `previous` still
      // points into the cue we are leaving.
      anchorAt(target.start + 10);
      void controller
        .seek(target.start + 10)
        .then(() => {
          anchorAt(target.start + 10);
          markAutoPaused(false);
          if (play) {
            pausedByKivara.current = false;
            void controller.play().catch(() => {});
          }
        })
        .catch(() => {
          // Netflix without its player API: the line is not seekable. Nothing
          // is written to the element, so playback just keeps going.
        });
    },
    [controller, pausedByKivara, anchorAt],
  );

  const prev = useCallback(() => seekCue(getActiveIndex() - 1), [getActiveIndex, seekCue]);
  const next = useCallback(() => seekCue(getActiveIndex() + 1), [getActiveIndex, seekCue]);
  const replay = useCallback(() => seekCue(getActiveIndex()), [getActiveIndex, seekCue]);

  const replaySlow = useCallback(() => {
    if (!controller) return;
    const index = getActiveIndex();
    if (index < 0) return;
    slowOnceRef.current = true;
    controller.setRate(SLOW_REPLAY_RATE);
    seekCue(index);
    // seekCue restores the general rate on its own; the slow pass re-applies
    // its own rate AFTER that promise's synchronous body, so the order holds
    // on HTML5 and on the Netflix bridge alike.
    controller.setRate(SLOW_REPLAY_RATE);
  }, [controller, getActiveIndex, seekCue]);

  const togglePlay = useCallback(() => {
    if (!controller) return;
    if (controller.isPaused()) {
      pausedByKivara.current = false;
      markAutoPaused(false);
      void controller.play().catch(() => {});
    } else {
      pausedByKivara.current = false;
      controller.pause();
    }
  }, [controller, pausedByKivara]);

  const pauseForStudy = useCallback(() => {
    if (!controller) return;
    if (controller.isPaused()) return;
    pausedByKivara.current = true;
    controller.pause();
  }, [controller, pausedByKivara]);

  const resume = useCallback(() => {
    if (!controller) return;
    markAutoPaused(false);
    pausedByKivara.current = false;
    void controller.play().catch(() => {});
  }, [controller, pausedByKivara]);

  const resumeIfKivaraPaused = useCallback(() => {
    if (!controller || !pausedByKivara.current) return;
    markAutoPaused(false);
    pausedByKivara.current = false;
    void controller.play().catch(() => {});
  }, [controller, pausedByKivara]);

  const setLoop = useCallback((value: boolean) => loopStore.set(value), []);
  const setSpeed = useCallback((value: number) => {
    if (!PLAYBACK_SPEEDS.includes(value)) return;
    speedStore.set(value);
  }, []);

  const stepSpeed = useCallback(
    (direction: 1 | -1): number => {
      const current = speedRef.current;
      const index = PLAYBACK_SPEEDS.indexOf(current);
      const base = index < 0 ? PLAYBACK_SPEEDS.indexOf(1) : index;
      const target = PLAYBACK_SPEEDS[Math.max(0, Math.min(PLAYBACK_SPEEDS.length - 1, base + direction))];
      if (target !== current) setSpeed(target);
      return target;
    },
    [setSpeed],
  );

  return {
    getActiveIndex,
    seekCue,
    prev,
    next,
    replay,
    replaySlow,
    togglePlay,
    pauseForStudy,
    resumeIfKivaraPaused,
    resume,
    loop,
    setLoop,
    speed,
    setSpeed,
    stepSpeed,
    autoPaused,
    autoPausedRef,
  };
}

/** Index of the cue under `timeMs`, or -1 before the first cue. */
export function cueIndexAt(cues: readonly SubtitleCue[], timeMs: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= timeMs) {
      if (timeMs <= cues[mid].end) return mid;
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  // Between cues: keep the line just passed (the prototype does the same), so
  // auto-pause has an end to compare against and the rail has an active row.
  return found;
}

/** Cue index plus whether the playhead sits inside a cue. */
export function activeCueOf(
  cues: readonly SubtitleCue[],
  timeMs: number,
): SubtitleCue | null {
  const index = cueIndexAt(cues, timeMs);
  if (index < 0) return null;
  const cue = cues[index];
  return timeMs <= cue.end ? cue : null;
}

/** Exposed for the study bar's speed readout. */
export { PLAYBACK_SPEEDS, SLOW_REPLAY_RATE };
