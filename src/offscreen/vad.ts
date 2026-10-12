/**
 * Hand-written, RMS-energy based Voice Activity Detection.
 *
 * The offscreen recorder hands us a continuous WebM/Opus stream covering
 * roughly the rolling-buffer window. When the user saves a card, the
 * orchestrator only knows the cue's start/end timestamps — but the audio
 * often starts a few hundred ms before the cue text shows up and trails a
 * bit after. We want to tighten the clip to the actual spoken phrase so:
 *
 *   - the Anki audio sounds clean (no leading silence or trailing music),
 *   - the transcript step gets a well-bounded segment, and
 *   - we can answer the "speech is over" question for the auto-capture
 *     mode without forcing the user to wait for the next cue.
 *
 * The algorithm is deliberately tiny because Phase-3 ASR will replace
 * heuristic VAD in most cases. The constants below are tuned for typical
 * dialogue in streaming content (-30 dBFS speech, -50 dBFS background).
 */

const FRAME_MS = 20;
const SMOOTH_WINDOW = 5; // ~100 ms moving average
const NOISE_FLOOR_PERCENTILE = 0.2;
const SPEECH_RATIO = 2.5; // speech is at least 2.5× the noise floor
const MIN_ABSOLUTE_RMS = 0.005; // ignore frames quieter than -46 dBFS
const MIN_SPEECH_MS = 120;     // ignore blips shorter than this
const MAX_GAP_MS = 220;        // merge adjacent regions separated by <= this

export interface VadOptions {
  /** ms of padding to keep before detected speech */
  preRollMs?: number;
  /** ms of padding to keep after detected speech */
  postRollMs?: number;
  /** Override the speech/noise ratio multiplier */
  speechRatio?: number;
  /** Override the minimum sustained-speech duration */
  minSpeechMs?: number;
  /** Override the gap that still counts as the same utterance */
  maxGapMs?: number;
}

export interface SpeechRegion {
  startMs: number;
  endMs: number;
  /** Mean RMS of the region (debugging) */
  meanRms: number;
}

export interface VadResult {
  regions: SpeechRegion[];
  /** Background noise floor estimate (RMS) */
  noiseFloor: number;
  /** Sample rate the analysis ran at */
  sampleRate: number;
}

/** Compute frame-level RMS over the PCM buffer. */
function computeFrameRms(
  samples: Float32Array,
  sampleRate: number,
  frameMs: number,
): Float32Array {
  const frameLength = Math.max(1, Math.floor((frameMs / 1000) * sampleRate));
  const out = new Float32Array(Math.ceil(samples.length / frameLength));
  for (let i = 0, f = 0; i < samples.length; i += frameLength, f++) {
    let sum = 0;
    let count = 0;
    const end = Math.min(samples.length, i + frameLength);
    for (let j = i; j < end; j++) {
      const v = samples[j];
      sum += v * v;
      count++;
    }
    out[f] = count > 0 ? Math.sqrt(sum / count) : 0;
  }
  return out;
}

/** Moving average smoother to suppress short transients. */
function smoothFrames(frames: Float32Array, window: number): Float32Array {
  if (window <= 1) return frames;
  const out = new Float32Array(frames.length);
  let acc = 0;
  const half = Math.floor(window / 2);
  for (let i = 0; i < frames.length + half; i++) {
    if (i < frames.length) acc += frames[i];
    if (i >= window) acc -= frames[i - window];
    if (i >= half) {
      const denom = Math.min(window, i + 1);
      out[i - half] = acc / denom;
    }
  }
  return out;
}

/** Percentile estimator on a copy of the frames (mutating sort is fine). */
function percentile(frames: Float32Array, p: number): number {
  if (!frames.length) return 0;
  const sorted = Array.from(frames).sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[idx];
}

/**
 * Run VAD on the given PCM buffer.
 *
 *  1. Slice into 20 ms frames and compute RMS for each.
 *  2. Smooth with a 100 ms moving average so single noisy frames don't
 *     fragment otherwise-continuous speech.
 *  3. Pick the 20th percentile of frame energy as the noise floor.
 *  4. Mark frames above (max(noise * 2.5, 0.005)) as "speech".
 *  5. Coalesce frames into regions, dropping <120 ms blips and merging
 *     across gaps <=220 ms.
 *  6. Apply pre/post-roll padding.
 */
export function detectSpeech(
  samples: Float32Array,
  sampleRate: number,
  options: VadOptions = {},
): VadResult {
  if (!samples.length) {
    return { regions: [], noiseFloor: 0, sampleRate };
  }
  const speechRatio = options.speechRatio ?? SPEECH_RATIO;
  const minSpeechMs = options.minSpeechMs ?? MIN_SPEECH_MS;
  const maxGapMs = options.maxGapMs ?? MAX_GAP_MS;
  const preRollMs = options.preRollMs ?? 120;
  const postRollMs = options.postRollMs ?? 180;

  const frames = computeFrameRms(samples, sampleRate, FRAME_MS);
  const smoothed = smoothFrames(frames, SMOOTH_WINDOW);
  const noiseFloor = percentile(smoothed, NOISE_FLOOR_PERCENTILE);
  const threshold = Math.max(noiseFloor * speechRatio, MIN_ABSOLUTE_RMS);

  // Identify continuous frames over threshold
  const rawRegions: { start: number; end: number; meanRms: number }[] = [];
  let inSpeech = false;
  let regionStart = 0;
  let regionSum = 0;
  let regionCount = 0;
  for (let i = 0; i < smoothed.length; i++) {
    const isSpeech = smoothed[i] >= threshold;
    if (isSpeech && !inSpeech) {
      inSpeech = true;
      regionStart = i;
      regionSum = smoothed[i];
      regionCount = 1;
    } else if (isSpeech) {
      regionSum += smoothed[i];
      regionCount++;
    } else if (!isSpeech && inSpeech) {
      rawRegions.push({
        start: regionStart,
        end: i,
        meanRms: regionSum / Math.max(1, regionCount),
      });
      inSpeech = false;
    }
  }
  if (inSpeech) {
    rawRegions.push({
      start: regionStart,
      end: smoothed.length,
      meanRms: regionSum / Math.max(1, regionCount),
    });
  }

  // Merge regions separated by <= maxGap
  const maxGapFrames = Math.ceil(maxGapMs / FRAME_MS);
  const merged: typeof rawRegions = [];
  for (const r of rawRegions) {
    const last = merged[merged.length - 1];
    if (last && r.start - last.end <= maxGapFrames) {
      const totalFrames = last.end - last.start + (r.end - r.start);
      last.end = r.end;
      last.meanRms =
        (last.meanRms * (last.end - last.start) + r.meanRms * (r.end - r.start)) /
        Math.max(1, totalFrames);
    } else {
      merged.push({ ...r });
    }
  }

  // Drop too-short regions
  const minFrames = Math.ceil(minSpeechMs / FRAME_MS);
  const regions: SpeechRegion[] = merged
    .filter((r) => r.end - r.start >= minFrames)
    .map((r) => ({
      startMs: Math.max(0, r.start * FRAME_MS - preRollMs),
      endMs: Math.min(
        Math.round((samples.length / sampleRate) * 1000),
        r.end * FRAME_MS + postRollMs,
      ),
      meanRms: r.meanRms,
    }));

  return { regions, noiseFloor, sampleRate };
}

/**
 * Convenience helper: given a desired cue range, find the tightest speech
 * envelope that overlaps it. Falls back to the original range if VAD
 * didn't find anything (e.g., the captured chunk was silent).
 */
export function tightenToSpeech(
  samples: Float32Array,
  sampleRate: number,
  desiredStartMs: number,
  desiredEndMs: number,
  options: VadOptions = {},
): { startMs: number; endMs: number; usedVad: boolean } {
  const { regions } = detectSpeech(samples, sampleRate, options);
  if (!regions.length) {
    return { startMs: desiredStartMs, endMs: desiredEndMs, usedVad: false };
  }

  // Pick the region(s) that overlap the desired window. If none overlaps,
  // fall back to the closest region.
  const overlapping = regions.filter(
    (r) => r.endMs >= desiredStartMs && r.startMs <= desiredEndMs,
  );
  const chosen = overlapping.length ? overlapping : regions;
  const startMs = Math.min(...chosen.map((r) => r.startMs));
  const endMs = Math.max(...chosen.map((r) => r.endMs));
  return { startMs, endMs, usedVad: true };
}
