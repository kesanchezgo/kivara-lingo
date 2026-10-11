/**
 * The PCM consumer, shared by the AudioWorklet path and the ScriptProcessor
 * fallback.
 *
 * Both paths end with the same job: turn one block of interleaved float
 * audio into a MONO `Float32Array` and stamp it on the rolling buffer with the
 * wall-clock time it *covers* (`recordedAt = eventtime - durationMs`), which is
 * what `buildPcmClip` uses to put a chunk at its true temporal offset. Doing
 * that once, here, is the whole point: the two capturers differ only in how
 * the block arrives, never in what they do with it.
 *
 * The block shape differs between the two paths, and this is where that gets
 * normalised:
 *   - ScriptProcessor: `{ inputBuffer }` (an AudioBuffer, N channels)
 *   - AudioWorklet: `{ input }` (one AudioBuffer per frame, N channels)
 * Both expose `numberOfChannels`, `length` and `sampleRate`, so after
 * downmixing they are the same object.
 */

/** The block shape both the processor and the worklet receive. */
export interface PcmBlock {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  /**
   * Direct views of each channel. Used in preference to `getChannelData` so a
   * worklet can post its raw channel arrays without allocating a fake buffer.
   */
  channels: Float32Array[];
  /** Legacy accessor for AudioBuffer-shaped blocks (ScriptProcessor). */
  getChannelData?(channel: number): Float32Array;
}

export interface PcmChunkRecord {
  samples: Float32Array;
  recordedAt: number;
  durationMs: number;
  sampleRate: number;
}

/** Where a finished mono chunk is handed to (the rolling buffer in the caller). */
export type PcmSink = (chunk: PcmChunkRecord) => void;

/**
 * Downmix a block to mono and hand one chunk to the sink.
 *
 * Exported so both the processor callback and the worklet's `process()` can
 * call it directly — see `wirePcmCapture` for the pre-bound form the
 * offscreen document uses.
 */
/**
 * Downmix a block to mono and hand one chunk to the sink.
 *
 * Exported so both the processor callback and the worklet's `process()` can
 * call it directly — see `wirePcmCapture` for the pre-bound form the
 * offscreen document uses.
 */
export function downmixBlock(block: PcmBlock, nowMs: number = Date.now()): PcmChunkRecord {
  const length = Math.max(0, block.length | 0);
  const channels = Math.max(1, block.numberOfChannels | 0);
  const mono = new Float32Array(length);
  // Channel views are only read up to `length`: a block can be shorter than
  // the underlying render buffer, and reading the whole view would pull in
  // samples from the NEXT quantum.
  const views = block.channels;
  for (let ch = 0; ch < channels; ch++) {
    const data = views[ch] ?? views[views.length - 1];
    if (!data) continue;
    const stop = Math.min(length, data.length);
    for (let i = 0; i < stop; i++) mono[i] += data[i] / channels;
  }
  const durationMs = (length / block.sampleRate) * 1000;
  return {
    samples: mono,
    recordedAt: nowMs - durationMs,
    durationMs,
    sampleRate: block.sampleRate,
  };
}

/** Downmix and push, for callers that just want the side effect. */
export function emitBlock(block: PcmBlock, sink: PcmSink, nowMs: number = Date.now()): void {
  sink(downmixBlock(block, nowMs));
}

/**
 * Build the `onaudioprocess`-shaped callback for a ScriptProcessorNode.
 * Same body the offscreen document has run since the first PCM buffer — only
 * the graph wiring lives in the caller.
 */
export function makeProcessorHandler(sink: PcmSink): (event: AudioProcessingEvent) => void {
  return (event) => {
    const buffer = event.inputBuffer;
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      channels.push(buffer.getChannelData(ch));
    }
    emitBlock({
      numberOfChannels: buffer.numberOfChannels,
      length: buffer.length,
      sampleRate: buffer.sampleRate,
      channels,
      getChannelData: (ch) => buffer.getChannelData(ch),
    }, sink);
  };
}
