/**
 * Capture the current frame of a `<video>` element as a JPEG data URL.
 *
 * Uses an `OffscreenCanvas` when available (smaller memory pressure and no
 * layout side effects) and falls back to a regular HTMLCanvasElement for
 * older browsers.
 *
 * NOTE: Some streaming platforms tag their video element as cross-origin and
 * cause `drawImage` to throw a SecurityError. We catch and return `null` so
 * the caller can build a card without the picture instead of failing.
 *
 * Quality gate: a raw capture at save-time can land on a fade-to-black, a
 * loading spinner, a solid title card or a scene transition — the exact
 * moments the user is likely to pause. `captureBestFrame` samples the cue
 * window, scores each candidate, and returns the most informative frame.
 * When every candidate is a dud it returns `null` so the orchestrator's
 * web-image fallback can take over instead of shipping a black rectangle.
 */

export interface FrameQuality {
  /** Mean luminance in [0,1]. Near 0 = black, near 1 = blown-out white. */
  luma: number;
  /** Std deviation of luminance in [0,1]. Near 0 = flat/uniform frame. */
  variance: number;
  /** Fraction of sampled pixels that are near-black (letterbox/fade). */
  darkRatio: number;
  /** Convenience verdict computed from the signals above. */
  usable: boolean;
  /** Higher is better. Used to rank multiple candidate frames. */
  score: number;
}

// Tunables. Deliberately conservative: we only reject frames that are almost
// certainly useless (a near-solid colour). A dim-but-real night scene must
// survive, so the variance floor is low.
const MIN_VARIANCE = 0.012; // below this the frame is effectively flat
const MIN_LUMA = 0.02; // below this the frame is essentially black
const MAX_LUMA = 0.985; // above this the frame is blown-out white
const MAX_DARK_RATIO = 0.97; // almost every pixel near-black → fade/transition

/**
 * Score a captured frame from raw RGBA pixel data. Pure and deterministic so
 * it can be unit-tested without a DOM.
 *
 * Luminance uses Rec. 601 coefficients on gamma-encoded sRGB. That is not
 * perceptually exact, but frame-vs-frame ranking only needs monotonicity, and
 * this keeps the hot loop branch-free and cheap.
 */
export function scoreFrameQuality(data: Uint8ClampedArray | number[]): FrameQuality {
  const pixelCount = Math.floor(data.length / 4);
  if (pixelCount === 0) {
    return { luma: 0, variance: 0, darkRatio: 1, usable: false, score: 0 };
  }

  let sum = 0;
  let sumSq = 0;
  let darkCount = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // 0.299 R + 0.587 G + 0.114 B, normalised to [0,1].
    const y = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    sum += y;
    sumSq += y * y;
    if (y < 0.06) darkCount += 1;
  }

  const luma = sum / pixelCount;
  const meanSq = sumSq / pixelCount;
  const variance = Math.sqrt(Math.max(0, meanSq - luma * luma));
  const darkRatio = darkCount / pixelCount;

  const usable =
    variance >= MIN_VARIANCE &&
    luma >= MIN_LUMA &&
    luma <= MAX_LUMA &&
    darkRatio <= MAX_DARK_RATIO;

  // Ranking score: reward detail (variance), lightly penalise extreme
  // brightness on either end so a mid-exposed frame beats a washed-out one at
  // equal detail. Unusable frames are floored so they always lose to any
  // usable candidate but keep relative order among themselves.
  const exposurePenalty = Math.abs(luma - 0.5) * 0.15;
  const rawScore = variance - exposurePenalty;
  const score = usable ? rawScore : rawScore - 1;

  return { luma, variance, darkRatio, usable, score };
}

interface CanvasLike {
  width: number;
  height: number;
}

/** Draw the current video frame to a canvas and return pixel data + a
 *  JPEG data URL, or `null` on any failure (cross-origin, no context…). */
async function grabFrame(
  video: HTMLVideoElement,
  width: number,
  height: number,
  quality: number,
): Promise<{ dataUrl: string; pixels: Uint8ClampedArray } | null> {
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, width, height);
      const pixels = ctx.getImageData(0, 0, width, height).data;
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      const dataUrl = await blobToDataUrl(blob);
      return dataUrl ? { dataUrl, pixels } : null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    return { dataUrl, pixels };
  } catch (err) {
    console.warn('[Kivara Lingo] frame capture failed', err);
    return null;
  }
}

function frameDimensions(
  video: HTMLVideoElement,
  maxWidth: number,
): CanvasLike | null {
  if (!video || video.readyState < 2 /* HAVE_CURRENT_DATA */) return null;
  const ratio = Math.min(1, maxWidth / Math.max(1, video.videoWidth));
  const width = Math.max(1, Math.round(video.videoWidth * ratio));
  const height = Math.max(1, Math.round(video.videoHeight * ratio));
  return { width, height };
}

/**
 * Capture the current frame as a JPEG data URL. Single-shot, no seeking.
 * Kept for callers that just want "whatever is on screen right now"
 * (e.g. the Alt+V manual recapture, where the user has already lined up
 * a good frame themselves).
 */
export async function captureFrame(
  video: HTMLVideoElement,
  options: { quality?: number; maxWidth?: number } = {},
): Promise<string | null> {
  const dims = frameDimensions(video, options.maxWidth ?? 1280);
  if (!dims) return null;
  const grab = await grabFrame(video, dims.width, dims.height, options.quality ?? 0.82);
  return grab?.dataUrl ?? null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve once the compositor has presented a fresh frame, using
 * `requestVideoFrameCallback` when the platform exposes it. This lets us grab
 * the *next* decoded frame of a PLAYING video without seeking (no visible
 * jump), and gives a paused seek time to actually paint before we read pixels.
 * Falls back to a short timeout so nothing hangs the save.
 */
function nextPresentedFrame(video: HTMLVideoElement, timeoutMs = 120): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const rvfc = (
      video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
      }
    ).requestVideoFrameCallback;
    if (typeof rvfc === 'function') {
      try {
        rvfc.call(video, finish);
      } catch {
        finish();
        return;
      }
    }
    void wait(timeoutMs).then(finish);
  });
}

/** Seek a video to `seconds` and resolve once a fresh frame is presented.
 *  Falls back to a short timeout so a player that never fires `seeked`
 *  (or already sat at the target time) can't hang the save. */
function seekTo(video: HTMLVideoElement, seconds: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', finish);
      resolve();
    };
    video.addEventListener('seeked', finish, { once: true });
    try {
      video.currentTime = seconds;
    } catch {
      finish();
      return;
    }
    // Safety net: some players decode a paused seek without emitting `seeked`.
    void wait(220).then(finish);
  });
}

/**
 * Capture the best frame for a cue.
 *
 * Strategy:
 *  - Always grab the current on-screen frame first (zero cost, no seek).
 *  - If the video is PAUSED and we know the cue window, sample a few extra
 *    instants inside it (start, middle, and a nudge before the current time),
 *    restoring the original playhead afterwards. This rescues the common
 *    "paused on a fade/transition" case without disturbing playback.
 *  - Never seek a PLAYING video — a visible jump would ruin the viewing
 *    experience and fight the audio-capture anchor. Instead, if the current
 *    frame of a playing video is a dud, wait for the next decoded frame
 *    (`requestVideoFrameCallback`) and re-sample without moving the playhead.
 *  - Return the highest-scoring usable frame; if none is usable, return
 *    `null` so the caller's web-image fallback can take over.
 */
export async function captureBestFrame(
  video: HTMLVideoElement,
  cue?: { start?: number; end?: number },
  options: { quality?: number; maxWidth?: number } = {},
): Promise<string | null> {
  const dims = frameDimensions(video, options.maxWidth ?? 1280);
  if (!dims) return null;
  const quality = options.quality ?? 0.82;

  const candidates: Array<{ dataUrl: string; q: FrameQuality }> = [];

  const grabAndScore = async () => {
    const grab = await grabFrame(video, dims.width, dims.height, quality);
    if (grab) candidates.push({ dataUrl: grab.dataUrl, q: scoreFrameQuality(grab.pixels) });
  };

  // 1. Current on-screen frame — always sampled.
  await grabAndScore();

  const best = () =>
    candidates.length === 0
      ? null
      : candidates.reduce((a, b) => (b.q.score > a.q.score ? b : a));

  // Fast path: if the very first frame is already good, ship it. No seeking.
  const first = best();
  if (first?.q.usable) return first.dataUrl;

  // 2a. Playing-video rescue — we can't seek without a visible jump, but we
  //     can ride out a transient dud (spinner flash, one-frame fade) by
  //     waiting for the next few decoded frames and re-sampling in place.
  if (!video.paused && !video.ended) {
    for (let i = 0; i < 3; i += 1) {
      await nextPresentedFrame(video);
      await grabAndScore();
      if (best()?.q.usable) break;
    }
  }

  const afterPlaying = best();
  if (afterPlaying?.q.usable) return afterPlaying.dataUrl;

  // 2b. Paused rescue path — only for a paused video with a known cue window.
  const canSeek =
    video.paused &&
    cue?.start != null &&
    cue?.end != null &&
    Number.isFinite(cue.start) &&
    Number.isFinite(cue.end) &&
    cue.end > cue.start;

  if (canSeek) {
    const startS = (cue!.start as number) / 1000;
    const endS = (cue!.end as number) / 1000;
    const midS = (startS + endS) / 2;
    const original = video.currentTime;
    // Sample distinct instants; a fade rarely spans the whole cue.
    const samples = [midS, startS + 0.15, endS - 0.15].filter(
      (s) => Number.isFinite(s) && Math.abs(s - original) > 0.08,
    );
    try {
      for (const s of samples) {
        await seekTo(video, s);
        // Give the compositor a beat to present the seeked frame before we
        // read pixels, so we don't score a stale pre-seek frame.
        await nextPresentedFrame(video);
        await grabAndScore();
        if (best()?.q.usable) break; // stop early once we have a keeper
      }
    } finally {
      // Restore the playhead so the user sees exactly where they paused.
      // Guard the assignment: if it throws we still don't want to leave the
      // user parked on a rescue sample.
      try {
        await seekTo(video, original);
      } catch {
        try {
          video.currentTime = original;
        } catch {
          /* nothing more we can safely do */
        }
      }
    }
  }

  const winner = best();
  // If nothing cleared the quality bar, hand back null: a web image or the
  // graceful "no picture" path beats a black/flat rectangle on the card.
  return winner?.q.usable ? winner.dataUrl : null;
}

function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}
