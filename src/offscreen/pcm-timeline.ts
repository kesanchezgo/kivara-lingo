/**
 * Pure, dependency-free PCM timeline math for the offscreen audio processor.
 *
 * These functions carry the load-bearing logic behind "perfect phrase audio":
 * turning a rolling buffer of timestamped PCM chunks into a clip whose duration
 * and internal timing exactly match the requested `[sliceStart, sliceEnd]`
 * wall-clock window — regardless of dropped ScriptProcessor callbacks (gaps),
 * mid-stream sample-rate changes, or which streaming platform produced the
 * audio. Nothing here touches `AudioContext`, `MediaRecorder`, or any DOM API,
 * so it is fully unit-testable and platform-agnostic (Netflix, Prime, HBO,
 * Disney+, YouTube, generic HTML5 — they all feed the same shape).
 */

/** A single decoded PCM chunk as captured by the ScriptProcessorNode. */
export interface PcmChunk {
  samples: Float32Array;
  /** Wall-clock ms at the moment the chunk's audio started. */
  recordedAt: number;
  /** Chunk duration in ms. */
  durationMs: number;
  /** Sample rate this chunk was captured at (can drift mid-stream). */
  sampleRate: number;
}

/**
 * Linear-interpolation resampler. Deterministic and allocation-light.
 *
 * Frame-vs-frame ranking or ASR only needs a faithful time-domain signal, not
 * a brick-wall anti-alias filter, so linear interpolation is the right cost.
 * Returns the input unchanged when the rate already matches.
 */
export function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) return input;
  const outLength = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const output = new Float32Array(outLength);
  const ratio = fromRate / toRate;
  for (let i = 0; i < outLength; i += 1) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const right = Math.min(input.length - 1, left + 1);
    const frac = pos - left;
    output[i] = input[left] * (1 - frac) + input[right] * frac;
  }
  return output;
}

/**
 * Assemble a mono PCM clip for the exact `[sliceStart, sliceEnd]` window.
 *
 * The clip is laid out on a real timeline anchored at `sliceStart`, so every
 * chunk lands at its true temporal offset. This matters because the PCM ring
 * buffer is filled by a `ScriptProcessorNode`, which a backgrounded/throttled
 * tab (common while streaming) can starve — dropping callbacks and leaving
 * time gaps between chunks. Concatenating survivors back-to-back would
 * compress the audio in time and desync VAD/Whisper against the requested
 * window. Instead we allocate the full window up front (silence) and paste
 * each chunk at `recordedAt - sliceStart`, so gaps stay as silence and the
 * clip's duration always equals `sliceEnd - sliceStart`.
 *
 * Each chunk is resampled to `targetSampleRate` on its own, so a mid-stream
 * device/context sample-rate change can't corrupt the merge.
 *
 * Returns `null` when there is nothing to write into the window.
 */
export function buildPcmClip(
  pcmChunks: readonly PcmChunk[],
  sliceStart: number,
  sliceEnd: number,
  targetSampleRate: number,
): { samples: Float32Array; sampleRate: number } | null {
  if (!pcmChunks.length) return null;
  const windowMs = sliceEnd - sliceStart;
  if (windowMs <= 0) return null;

  const outLength = Math.max(1, Math.round((windowMs / 1000) * targetSampleRate));
  const merged = new Float32Array(outLength);
  let wrote = 0;

  for (const chunk of pcmChunks) {
    const chunkStart = chunk.recordedAt;
    const chunkEnd = chunk.recordedAt + chunk.durationMs;
    if (chunkEnd < sliceStart || chunkStart > sliceEnd) continue;

    // Clip the chunk to the requested window, in chunk-local ms.
    const localStartMs = Math.max(0, sliceStart - chunkStart);
    const localEndMs = Math.min(chunk.durationMs, sliceEnd - chunkStart);
    const startIdx = Math.max(0, Math.floor((localStartMs / 1000) * chunk.sampleRate));
    const endIdx = Math.min(
      chunk.samples.length,
      Math.ceil((localEndMs / 1000) * chunk.sampleRate),
    );
    if (endIdx <= startIdx) continue;

    // Resample this chunk on its own so a mid-stream rate change is isolated.
    const part = resampleLinear(
      chunk.samples.subarray(startIdx, endIdx),
      chunk.sampleRate,
      targetSampleRate,
    );

    // Position the chunk on the output timeline anchored at sliceStart.
    const offsetMs = chunkStart + localStartMs - sliceStart;
    let outIdx = Math.round((offsetMs / 1000) * targetSampleRate);
    if (outIdx < 0) outIdx = 0;
    if (outIdx >= outLength) continue;
    const writable = Math.min(part.length, outLength - outIdx);
    if (writable <= 0) continue;
    merged.set(part.subarray(0, writable), outIdx);
    wrote += writable;
  }

  if (!wrote) return null;
  return { samples: merged, sampleRate: targetSampleRate };
}

/**
 * Fold the min-start / max-end wall-clock bounds over one or more chunk
 * buffers without spreading into `Math.min(...arr)` (a full 30 s ring buffer
 * holds hundreds of chunks and the spread form can blow the call stack).
 *
 * Returns `null` when no finite bound exists (both buffers empty).
 */
export function bufferBounds(
  ...buffers: ReadonlyArray<ReadonlyArray<{ recordedAt: number; durationMs: number }>>
): { minStart: number; maxEnd: number } | null {
  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const buffer of buffers) {
    for (const c of buffer) {
      if (c.recordedAt < minStart) minStart = c.recordedAt;
      const end = c.recordedAt + c.durationMs;
      if (end > maxEnd) maxEnd = end;
    }
  }
  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) return null;
  return { minStart, maxEnd };
}
