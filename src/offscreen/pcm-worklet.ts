/**
 * `pcm-worklet` — the AudioWorklet capture path.
 *
 * An `AudioWorkletProcessor` runs on the audio thread, which is the point:
 * `ScriptProcessor` runs on the main thread and a throttled or busy tab drops
 * its callbacks, which is the gap the PCM ring buffer already has to paper
 * over (see `pcm-timeline.ts`). The worklet's render quantum is fixed, so
 * capture survives a busy tab.
 *
 * The processor does NOT know about chunks, timestamps or the sink: it posts
 * the raw block and the document owns all of that (`pcm-block.ts`). That keeps
 * the unit-testable decision — mono, timing, pruning — out of the audio
 * thread, where nothing can be tested anyway.
 */
// @ts-expect-error `AudioWorkletProcessor` is only declared inside the worklet
// scope; a main-thread module has no type for it.
class PcmCaptureProcessor extends AudioWorkletProcessor {
  port!: { postMessage(message: unknown): void; close(): void };

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    // Keep the processor alive while it reads: returning false prunes the
    // node at the next render quantum.
    void outputs;
    const input = inputs[0];
    if (input && input.length) {
      // The engine upmixes a mono source into two identical channels here.
      // Posting every channel means the document downmixes them all, which
      // cancels nothing but doubles the work; posting just the first keeps
      // the block identical (the same samples) and lets `pcm-block` stay
      // the single place channel identity is decided.
      const source = input[0] ?? input;
      const channels = [source.slice()];
      this.port.postMessage({ channels, length: channels[0]?.length ?? 0 });
    }
    return true;
  }
}

// The worklet global scope only knows the name from a registration call, so
// the registration has to walk the indirection manually.
const scope = globalThis as unknown as {
  registerProcessor: (name: string, ctor: unknown) => void;
};
scope.registerProcessor('pcm-capture', PcmCaptureProcessor);
