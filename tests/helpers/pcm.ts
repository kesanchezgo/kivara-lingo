/**
 * Deterministic PCM fixtures for the audio pipeline tests.
 *
 * Everything here is a pure `Float32Array` generator: no `AudioContext`, no
 * `Blob`, no filesystem — so the same helper feeds the vitest units and the
 * Playwright smoke (which plays it inside the browser through an
 * `AudioContext`). The shapes match what the capture path actually records: a
 * pure tone, dead silence, and a burst of tone framed by silence (the shape a
 * spoken phrase makes, which is what the VAD has to find).
 *
 * The generators are deliberately exact — `sin(2*pi*f*n/rate)` computed per
 * sample, never accumulated by phase addition — so a caller can rely on the
 * zero crossings for a frequency assertion and on the RMS for a VAD threshold.
 */

export interface PcmSpec {
  /** Sample rate in Hz the buffer is generated at. */
  sampleRate: number;
  /** Duration of the generated buffer in milliseconds. */
  durationMs: number;
  /** Amplitude in [0, 1]; 1.0 is full scale. */
  amplitude?: number;
}

function sampleCount(spec: PcmSpec): number {
  return Math.round((spec.durationMs / 1000) * spec.sampleRate);
}

/** Dead silence: every sample exactly 0. */
export function silence(spec: PcmSpec): Float32Array {
  return new Float32Array(sampleCount(spec));
}

/**
 * A pure sine of `freqHz`. Zero crossings land where the maths puts them, so a
 * frequency estimate by crossing count is exact for a whole number of cycles.
 */
export function sine(spec: PcmSpec & { freqHz: number }): Float32Array {
  const n = sampleCount(spec);
  const amp = spec.amplitude ?? 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * spec.freqHz * i) / spec.sampleRate);
  }
  return out;
}

/**
 * A burst of tone framed by silence: `leadMs` of silence, `toneMs` of tone,
 * `tailMs` of silence. This is the shape `detectSpeech` has to find, and the
 * one a boundary test cannot fake with a constant signal.
 */
export function burst(
  spec: PcmSpec & {
    freqHz: number;
    leadMs: number;
    toneMs: number;
    tailMs: number;
  },
): Float32Array {
  const parts = [
    silence({ sampleRate: spec.sampleRate, durationMs: spec.leadMs }),
    sine({ ...spec, durationMs: spec.toneMs }),
    silence({ sampleRate: spec.sampleRate, durationMs: spec.tailMs }),
  ];
  const total = parts.reduce((acc, p) => acc + p.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Root-mean-square amplitude of a buffer; 0 for silence by definition. */
export function rms(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/**
 * Zero-crossing frequency estimate. Exact for a buffer holding a whole number
 * of cycles, and exact within one cycle otherwise — enough to catch a
 * resampler that quietly changes pitch or loses samples at the tail.
 */
export function estimateFrequency(
  samples: Float32Array,
  sampleRate: number,
): number {
  if (samples.length < 2) return 0;
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i - 1] < 0 && samples[i] >= 0) || (samples[i - 1] > 0 && samples[i] <= 0)) {
      crossings++;
    }
  }
  return (crossings * sampleRate) / (2 * samples.length);
}

/**
 * Encode mono Float32 as RIFF/WAVE PCM16, byte for byte matching
 * `encodeWavMono`: 44-byte header, 16-bit samples. Returns raw bytes so the
 * Playwright global setup can write the file without a DOM.
 */
export function encodeWavBytes(
  samples: Float32Array,
  sampleRate: number,
): Uint8Array {
  const bytesPerSample = 2;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    let s = samples[i];
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

/** Decode mono PCM16 back to Float32; inverse of `encodeWavBytes`. */
export function decodeWavBytes(bytes: Uint8Array): {
  samples: Float32Array;
  sampleRate: number;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sampleRate = view.getUint32(24, true);
  const dataLength = view.getUint32(40, true);
  const samples = new Float32Array(dataLength / 2);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(44 + i * 2, true) / 0x8000;
  }
  return { samples, sampleRate };
}

/** Default tone: 440 Hz (A4). */
export const DEFAULT_TONE_HZ = 440;
/** Device/context rate the fixtures start at. */
export const DEFAULT_SOURCE_RATE = 48_000;
/** The pipeline's destination rate (Anki and any downstream consumer). */
export const DEFAULT_TARGET_RATE = 16_000;
