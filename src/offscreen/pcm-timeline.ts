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
  /**
   * Set when the AudioContext's rate changed INSIDE this chunk.
   *
   * A device or context change lands wherever the render quantum happens to be,
   * not at a capture-block boundary, so the samples after that point decode at
   * a different rate than the ones before it. `midStreamAtMs` says where inside
   * the chunk the change landed (defaults to the end when a writer only knows
   * that it did).
   */
  midStreamRate?: number;
  midStreamAtMs?: number;
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
 * A chunk whose context changed rate inside it is read as two same-rate
 * segments rather than as one buffer.
 *
 * The window is laid out at the SOURCE rate and resampled ONCE, at the end.
 * Resampling per chunk instead re-bases the output grid at every chunk
 * boundary, so each seam lands wherever that chunk's rounding put it — and the
 * error is proportional to the seam count, which is the block size: 11 seams a
 * second at 4096 samples a block, 375 at a 128-sample AudioWorklet quantum.
 * Measured on identical input, that made the two capture paths disagree
 * (correlation 0.998 rather than 1, per-seam phase step up to one source
 * sample). One resampler over the whole window is what makes the block size
 * stop mattering to the samples that come out.
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

  // The rate the window is laid out at: the fastest any segment of it can run,
  // so the paste can never overflow its buffer.
  let sourceRate = pcmChunks[0].sampleRate;
  for (const chunk of pcmChunks) {
    if (chunk.sampleRate > sourceRate) sourceRate = chunk.sampleRate;
    if (chunk.midStreamRate && chunk.midStreamRate > sourceRate) {
      sourceRate = chunk.midStreamRate;
    }
  }

  const sourceLength = Math.max(1, Math.round((windowMs / 1000) * sourceRate));
  const laid = new Float32Array(sourceLength);
  let wrote = 0;

  for (const chunk of pcmChunks) {
    const chunkStart = chunk.recordedAt;
    const chunkEnd = chunk.recordedAt + chunk.durationMs;
    if (chunkEnd < sliceStart || chunkStart > sliceEnd) continue;

    const localStartMs = Math.max(0, sliceStart - chunkStart);
    const localEndMs = Math.min(chunk.durationMs, sliceEnd - chunkStart);
    if (localEndMs <= localStartMs) continue;

    // Read the overlap in whatever rate each part of the chunk ran at, then
    // paste by sample count — no arithmetic on the output grid happens here,
    // which is what keeps chunk boundaries from moving the samples.
    let cursorMs = 0;
    for (const seg of chunkSegments(chunk)) {
      const segEndMs = cursorMs + seg.durationMs;
      const fromMs = Math.max(localStartMs, cursorMs);
      const toMs = Math.min(localEndMs, segEndMs);
      // Millisecond offsets inside THIS segment, so a segment that starts at
      // 250 ms still reads its own first sample: a common clock fed straight
      // into the tail's own rate indexes past the end and pastes nothing.
      const segFromMs = Math.max(0, fromMs - cursorMs);
      const segToMs = Math.min(seg.durationMs, toMs - cursorMs);
      cursorMs = segEndMs;
      if (segToMs <= segFromMs) continue;

      const fromIdx = Math.max(0, Math.floor((segFromMs / 1000) * seg.sampleRate));
      const toIdx = Math.min(seg.samples.length, Math.ceil((segToMs / 1000) * seg.sampleRate));
      if (toIdx <= fromIdx) continue;

      const offsetMs = chunkStart + fromMs - sliceStart;
      let outIdx = Math.max(0, Math.round((offsetMs / 1000) * sourceRate));
      if (outIdx >= sourceLength) continue;
      const writable = Math.min(toIdx - fromIdx, sourceLength - outIdx);
      if (writable <= 0) continue;
      laid.set(seg.samples.subarray(fromIdx, fromIdx + writable), outIdx);
      wrote += writable;
    }
  }

  if (!wrote) return null;
  return {
    samples: resampleLinear(laid, sourceRate, targetSampleRate),
    sampleRate: targetSampleRate,
  };
}

/**
 * A chunk as one or two same-rate runs of samples.
 *
 * `midStreamRate` marks an AudioContext sample-rate change INSIDE the chunk:
 * everything before `midStreamAtMs` runs at `sampleRate`, everything after runs
 * at the new rate. Splitting here rather than at each call site keeps one place
 * that knows a chunk can hold two rates.
 */
function chunkSegments(
  chunk: PcmChunk,
): Array<{ samples: Float32Array; durationMs: number; sampleRate: number }> {
  if (!chunk.midStreamRate || chunk.midStreamRate === chunk.sampleRate) {
    return [{
      samples: chunk.samples,
      durationMs: chunk.durationMs,
      sampleRate: chunk.sampleRate,
    }];
  }
  // Unless the writer says where the change landed, the cheap assumption is the
  // end of the chunk: the tail then reads at the new rate, and a caller that
  // knows better sets `midStreamAtMs`.
  const splitMs = Math.min(Math.max(chunk.midStreamAtMs ?? chunk.durationMs, 0), chunk.durationMs);
  const splitIdx = Math.min(
    chunk.samples.length,
    Math.max(0, Math.round((splitMs / 1000) * chunk.sampleRate)),
  );
  /**
   * The tail takes the REST of the chunk's declared duration, not whatever its
   * sample count implies.
   *
   * Deriving `(remaining samples / midStreamRate)` manufactures a duration: a
   * 250 ms tail captured at 48 kHz would become 750 ms of 16 kHz audio, the
   * paste lands at three times its real offset, and everything after the change
   * reads as stretched. The chunk's `durationMs` is the span the writer
   * observed, so the split is `durationMs - splitMs` by definition and the tail
   * is exactly the samples that remain.
   */
  const tailMs = chunk.durationMs - splitMs;
  return [
    {
      samples: chunk.samples.subarray(0, splitIdx),
      durationMs: splitMs,
      sampleRate: chunk.sampleRate,
    },
    {
      samples: chunk.samples.subarray(splitIdx),
      durationMs: tailMs,
      sampleRate: chunk.midStreamRate,
    },
  ];
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
