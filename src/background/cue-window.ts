/**
 * Pure video-time -> wall-clock window math for sentence-audio capture.
 *
 * The offscreen recorder tags every PCM/WebM chunk with a wall-clock
 * `Date.now()`. Subtitle cues, on the other hand, live in *video-time* (ms
 * offsets on the media timeline). To slice the correct audio for a cue we must
 * translate the cue's `[start, end]` video-time window into the wall-clock
 * window the recorder understands.
 *
 * The relationship (assuming 1x playback and no seek between cue and save):
 *
 *   wallClock(videoTime) = requestedAt - (videoTimeAtSave - videoTime)
 *
 * This mapping is identical on every platform — Netflix, Prime, HBO Max,
 * Disney+, YouTube, generic HTML5 — because each adapter feeds the same three
 * numbers: cue start, cue end, and the video element's `currentTime` at save.
 * Keeping it pure lets us prove that per-platform correctness with a table of
 * cases instead of a live browser.
 */

export interface CueWindowInput {
  /** Cue start in video-time ms. */
  cueStart: number;
  /** Cue end in video-time ms. */
  cueEnd: number;
  /** Video element `currentTime` (ms) at the instant the user hit save. */
  videoTimeAtSave: number;
  /** Wall-clock ms captured at the same instant (`Date.now()`). */
  requestedAt: number;
  /** Lead-in padding (ms) prepended before the cue start. */
  preRollMs: number;
  /** Tail padding (ms) appended after the cue end. */
  postRollMs: number;
}

export interface CueWindowResult {
  /** Wall-clock ms for the start of the slice (cue start - preRoll). */
  start: number;
  /** Wall-clock ms for the end of the slice (cue end + postRoll). */
  end: number;
  /**
   * How far the cue end is in the future relative to the save instant, in ms.
   * Positive means the subtitle is still being spoken and the recorder does
   * not yet hold its tail; the caller must wait this long (plus post-roll)
   * before extracting, or fall back to TTS if the video is paused.
   */
  cueEndInFuture: number;
}

/**
 * Map a cue's video-time window to the wall-clock window the rolling recorder
 * buffer is indexed by. Pure and deterministic.
 *
 * Note we anchor on `requestedAt` (the save instant), NOT a later `Date.now()`
 * taken after an await — otherwise an actively-playing cue drifts the slice
 * forward while we wait for its tail to arrive.
 */
export function computeCueWindow(input: CueWindowInput): CueWindowResult {
  const preRoll = Math.max(0, input.preRollMs);
  const postRoll = Math.max(0, input.postRollMs);

  const cueStartAgo = input.videoTimeAtSave - input.cueStart;
  const cueEndAgo = input.videoTimeAtSave - input.cueEnd;

  const start = input.requestedAt - cueStartAgo - preRoll;
  const end = input.requestedAt - cueEndAgo + postRoll;
  const cueEndInFuture = input.cueEnd - input.videoTimeAtSave;

  return { start, end, cueEndInFuture };
}

/**
 * Decide whether a live audio slice is viable, or whether the caller should
 * skip it and attach TTS instead.
 *
 * When the video was paused at save with the subtitle tail still in the
 * future, that tail can never enter the recorder buffer — asking for the full
 * cue would yield silence/partial audio. In that case the live clip is not
 * viable.
 */
export function shouldFallbackToTts(
  cueEndInFuture: number,
  videoPausedAtSave: boolean,
  thresholdMs = 100,
): boolean {
  return videoPausedAtSave && cueEndInFuture > thresholdMs;
}

/**
 * How long to wait (ms) for a still-playing cue's tail (+ post-roll) to enter
 * the recorder buffer before extracting. Clamped so a bad anchor can't hang
 * the save. Returns 0 when nothing needs waiting.
 */
export function waitForCueTailMs(
  cueEndInFuture: number,
  postRollMs: number,
  maxWaitMs = 8_000,
): number {
  if (cueEndInFuture <= 0) return 0;
  return Math.min(cueEndInFuture + Math.max(0, postRollMs) + 150, maxWaitMs);
}
