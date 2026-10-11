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
  /**
   * `declare`, not `port!`: an initialised field would emit a class property
   * that DEFINES `port` to undefined, clobbering the real `MessagePort` the
   * base class installs — every `postMessage` then throws inside `process()`,
   * the audio thread swallows it, and the document receives zero blocks and
   * silently records nothing (all samples measured at 440/3 came from the
   * WebM fallback path, which is why the pitch looked resample-related).
   */
  declare readonly port: MessagePort;

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    void outputs;
    const input = inputs[0];
    if (input && input.length) {
      const source = input[0];
      if (source) {
        this.port.postMessage({
          channels: [source.slice()],
          length: source.length,
          sampleRate,
        });
      }
    }
    return true;
  }
}
// The worklet global scope only knows the name from a registration call, so
// the registration has to walk the indirection manually.
const scope = globalThis as unknown as {
  sampleRate: number;
  registerProcessor: (name: string, ctor: unknown) => void;
};

/**
 * The render rate of the context this processor belongs to.
 *
 * Read once at module evaluation, when the processor is being constructed for
 * a specific context. Publishing it with every block means the block carries
 * its own rate instead of having one inferred for it on the main thread.
 */
const sampleRate = scope.sampleRate;

scope.registerProcessor('pcm-capture', PcmCaptureProcessor);

