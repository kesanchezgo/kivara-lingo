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
 *   - AudioWorklet: `{ channels, sampleRate }` posted by the processor
 * Both expose `numberOfChannels`, `length` and `sampleRate`, so after
 * downmixing they are the same object.
 *
 * `sampleRate` is not optional and has no default. A block labelled with the
 * wrong rate does not throw: `resampleLinear` short-circuits when
 * `fromRate === toRate`, so 48 kHz samples stamped as 16 kHz are written into
 * a 16 kHz timeline untouched — a 440 Hz tone then reads as 48000/16000 of it,
 * 146.7 Hz, and nothing downstream can tell that from a real recording. The
 * rate travels with the block and a missing one is an error, not a guess.
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
export function downmixBlock(block: PcmBlock, nowMs: number = Date.now()): PcmChunkRecord {
  const length = Math.max(0, block.length | 0);
  const channels = Math.max(1, block.numberOfChannels | 0);
  if (!Number.isFinite(block.sampleRate) || block.sampleRate <= 0) {
    throw new Error(
      `pcm-block: block has no usable sampleRate (got ${String(block.sampleRate)}); ` +
        'a wrong rate is indistinguishable from a true recording downstream',
    );
  }
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

/** What a worklet posts for one render quantum. */
export interface PcmBlockMessage {
  channels: Float32Array[];
  length: number;
  /** The worklet scope's own rate; not optional — see the module header. */
  sampleRate: number;
}

/**
 * Turn a worklet message into a block, refusing a rate that is absent or does
 * not match the context the node belongs to.
 *
 * The cross-check is the point. A worklet processor renders at its context's
 * rate, so a disagreeing number can only mean the message is stale or
 * clobbered — and accepting it would mislabel the block, which downstream is
 * indistinguishable from a real recording (see the module header). The rate is
 * typed optional because a message can come from a sender that does not post
 * one; that is exactly the case this refuses rather than guesses.
 */
export function blockFromMessage(
  msg: { channels: Float32Array[]; length: number; sampleRate?: number },
  contextSampleRate: number,
): PcmBlock {
  const rate = msg.sampleRate;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`pcm-block: worklet message carries no sampleRate (${String(rate)})`);
  }
  if (rate !== contextSampleRate) {
    throw new Error(
      `pcm-block: worklet block rate ${rate} != context rate ${contextSampleRate}`,
    );
  }
  return {
    numberOfChannels: msg.channels.length,
    length: msg.length,
    sampleRate: rate,
    channels: msg.channels,
  };
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
