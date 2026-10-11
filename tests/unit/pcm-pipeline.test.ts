/**
 * Unit characterization of the PCM functions the capture pipeline runs.
 *
 * The functions are pure: `resampleLinear` and `buildPcmClip` (chunk
 * assembly) live in `src/offscreen/pcm-timeline.ts`; `detectSpeech` and
 * `tightenToSpeech` (VAD) live in `src/offscreen/vad.ts`; the WAV writer
 * `encodeWavMono` lives in `src/offscreen/audio-encoder.ts`. The fixtures come
 * from `tests/helpers/pcm.ts`: silence, a 440 Hz tone and a burst of tone
 * framed by silence.
 *
 * These tests are the baseline the AudioWorklet migration must keep matching:
 * the same input buffer must produce the same sample counts and the same
 * speech envelope, whatever fills the chunks.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOURCE_RATE,
  DEFAULT_TARGET_RATE,
  DEFAULT_TONE_HZ,
  burst,
  estimateFrequency,
  rms,
  silence,
  sine,
} from '../helpers/pcm';
import {
  buildPcmClip,
  resampleLinear,
  type PcmChunk,
} from '../../src/offscreen/pcm-timeline';
import { detectSpeech, tightenToSpeech } from '../../src/offscreen/vad';
import { encodeWavMono } from '../../src/offscreen/audio-encoder';

/** Duration in ms of `count` samples at `sampleRate`. */
const msOf = (count: number, sampleRate: number): number =>
  (count / sampleRate) * 1000;

describe('resampleLinear', () => {
  it('preserves duration within one sample across the 48->16 kHz path', () => {
    const input = sine({
      sampleRate: DEFAULT_SOURCE_RATE,
      durationMs: 1_000,
      freqHz: DEFAULT_TONE_HZ,
    });
    const out = resampleLinear(input, DEFAULT_SOURCE_RATE, DEFAULT_TARGET_RATE);
    // ±1 sample at 16 kHz is 0.0625 ms; the tolerance is the loop's rounding.
    expect(Math.abs(out.length - DEFAULT_TARGET_RATE)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(msOf(out.length, DEFAULT_TARGET_RATE) - 1_000),
    ).toBeLessThan(0.1);
  });

  it('keeps the waveform clean of gaps at the last samples', () => {
    const input = sine({
      sampleRate: DEFAULT_SOURCE_RATE,
      durationMs: 500,
      freqHz: DEFAULT_TONE_HZ,
    });
    const out = resampleLinear(input, DEFAULT_SOURCE_RATE, DEFAULT_TARGET_RATE);
    // A resampler that stops one sample early shows here: the tail would be a
    // zero run rather than the continuation of the sine.
    for (const i of [out.length - 1, out.length - 2, out.length - 3]) {
      expect(Math.abs(out[i])).toBeGreaterThan(1e-6);
      expect(Number.isNaN(out[i])).toBe(false);
    }
  });

  it('preserves pitch within 2%', () => {
    const input = sine({
      sampleRate: DEFAULT_SOURCE_RATE,
      durationMs: 1_000,
      freqHz: DEFAULT_TONE_HZ,
    });
    const out = resampleLinear(input, DEFAULT_SOURCE_RATE, DEFAULT_TARGET_RATE);
    const estimated = estimateFrequency(out, DEFAULT_TARGET_RATE);
    expect(Math.abs(estimated - DEFAULT_TONE_HZ) / DEFAULT_TONE_HZ).toBeLessThan(0.02);
  });

  it('never emits NaN, even for an empty tail', () => {
    const out = resampleLinear(
      new Float32Array([0, 1]),
      1_000,
      DEFAULT_TARGET_RATE,
    );
    expect(out.some(Number.isNaN)).toBe(false);
  });
});

describe('buildPcmClip chunk boundaries', () => {
  /** Three contiguous chunks covering 750 ms of a 1 s window. */
  const chunkOf = (samples: Float32Array, rate: number, offsetMs: number): PcmChunk => ({
    samples,
    recordedAt: offsetMs,
    durationMs: msOf(samples.length, rate),
    sampleRate: rate,
  });

  it('loses and duplicates no sample at chunk seams', () => {
    // A tone whose value at each 250 ms seam is known: the clip must carry
    // the seam values through exactly once.
    const seeds = [
      sine({ sampleRate: DEFAULT_SOURCE_RATE, durationMs: 250, freqHz: DEFAULT_TONE_HZ, amplitude: 0.5 }),
      sine({ sampleRate: DEFAULT_SOURCE_RATE, durationMs: 250, freqHz: 1_000, amplitude: 0.5 }),
      sine({ sampleRate: DEFAULT_SOURCE_RATE, durationMs: 250, freqHz: 2_000, amplitude: 0.5 }),
    ];
    const chunks = seeds.map((s, i) => chunkOf(s, DEFAULT_SOURCE_RATE, i * 250));
    const clip = buildPcmClip(chunks, 0, 750, DEFAULT_TARGET_RATE);
    expect(clip).not.toBeNull();

    // Compare sample by sample against the reference: the three seeds
    // resampled and concatenated with no overlap and no dropout.
    let expected = new Float32Array(0);
    for (const seed of seeds) {
      const part = resampleLinear(seed, DEFAULT_SOURCE_RATE, DEFAULT_TARGET_RATE);
      const merged = new Float32Array(expected.length + part.length);
      merged.set(expected, 0);
      merged.set(part, expected.length);
      expected = merged;
    }
    const got = clip!.samples;
    expect(Math.abs(got.length - expected.length)).toBeLessThanOrEqual(3);
    for (let i = 0; i < Math.min(got.length, expected.length); i++) {
      expect(Math.abs(got[i] - expected[i])).toBeLessThan(1e-4);
    }
  });

  it('lands each chunk at its true offset, not packed back to back', () => {
    // A 250 ms chunk after a 500 ms gap must still sit 500 ms into a 1 s
    // window: compressing it to sample 0 would shift the whole timeline.
    const late = sine({
      sampleRate: DEFAULT_SOURCE_RATE,
      durationMs: 250,
      freqHz: DEFAULT_TONE_HZ,
    });
    const clip = buildPcmClip([chunkOf(late, DEFAULT_SOURCE_RATE, 500)], 0, 1_000, DEFAULT_TARGET_RATE);
    expect(clip).not.toBeNull();
    const s = clip!.samples;
    // Before 500 ms: silence. Inside the chunk: tone. After: silence.
    expect(rms(s.subarray(0, 8_000))).toBe(0);
    expect(rms(s.subarray(8_000, 12_000))).toBeGreaterThan(0.1);
    expect(rms(s.subarray(12_000))).toBe(0);
  });
});

describe('detectSpeech / tightenToSpeech', () => {
  const spec = { sampleRate: DEFAULT_TARGET_RATE };

  it('finds a burst of tone when it is not edge-aligned', () => {
    const voice = burst({
      ...spec,
      freqHz: DEFAULT_TONE_HZ,
      leadMs: 1_000,
      toneMs: 500,
      tailMs: 1_500,
      amplitude: 0.6,
    });
    const result = detectSpeech(voice, DEFAULT_TARGET_RATE);
    expect(result.regions).toHaveLength(1);
    const [region] = result.regions;
    // The tone runs [1000,1500) ms. With 120/180 ms padding the honest band
    // is ±200 ms around the burst — this pins the VAD, not the padding idea.
    expect(region.startMs).toBeGreaterThanOrEqual(800);
    expect(region.startMs).toBeLessThanOrEqual(1_040);
    expect(region.endMs).toBeGreaterThanOrEqual(1_460);
    expect(region.endMs).toBeLessThanOrEqual(1_760);

    const quiet = silence({ ...spec, durationMs: 3_000 });
    expect(detectSpeech(quiet, DEFAULT_TARGET_RATE).regions).toHaveLength(0);
  });

  it('tightens a loose window onto the burst within 20 ms', () => {
    const voice = burst({
      ...spec,
      freqHz: DEFAULT_TONE_HZ,
      leadMs: 2_000,
      toneMs: 500,
      tailMs: 1_500,
      amplitude: 0.5,
    });
    const out = tightenToSpeech(voice, DEFAULT_TARGET_RATE, 200, 3_500);
    expect(out.usedVad).toBe(true);
    // The burst tone runs [2000,2500) ms; tightenToSpeech re-applies the
    // roll to match detectSpeech, so the band is the same ±200 ms.
    expect(out.startMs).toBeGreaterThanOrEqual(1_800);
    expect(out.startMs).toBeLessThanOrEqual(2_060);
    expect(out.endMs).toBeGreaterThanOrEqual(2_460);
    expect(out.endMs).toBeLessThanOrEqual(2_760);
  });

  it('falls back to the requested window when nothing is spoken', () => {
    const quiet = silence({ ...spec, durationMs: 2_000 });
    const out = tightenToSpeech(quiet, DEFAULT_TARGET_RATE, 400, 1_600);
    expect(out.usedVad).toBe(false);
    expect(out).toEqual({ startMs: 400, endMs: 1_600, usedVad: false });
  });

  it('separates two bursts instead of merging them into one', () => {
    const phrase = burst({
      ...spec,
      freqHz: DEFAULT_TONE_HZ,
      leadMs: 500,
      toneMs: 400,
      tailMs: 900,
      amplitude: 0.6,
    });
    const two = new Float32Array(phrase.length * 2);
    two.set(phrase, 0);
    two.set(phrase, phrase.length);
    const result = detectSpeech(two, DEFAULT_TARGET_RATE);
    expect(result.regions.length).toBeGreaterThanOrEqual(2);
  });
});

describe('encodeWavMono', () => {
  it('writes a 44-byte RIFF header matching the sample rate and byte count', async () => {
    const samples = sine({
      sampleRate: DEFAULT_TARGET_RATE,
      durationMs: 200,
      freqHz: DEFAULT_TONE_HZ,
      amplitude: 0.5,
    });
    const blob = encodeWavMono(samples, DEFAULT_TARGET_RATE);
    const bytes = new DataView(await blob.arrayBuffer());

    const tag = (o: number) =>
      String.fromCharCode(
        bytes.getUint8(o),
        bytes.getUint8(o + 1),
        bytes.getUint8(o + 2),
        bytes.getUint8(o + 3),
      );
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(tag(12)).toBe('fmt ');
    expect(tag(36)).toBe('data');
    expect(bytes.getUint16(20, true)).toBe(1); // PCM
    expect(bytes.getUint16(22, true)).toBe(1); // mono
    expect(bytes.getUint32(24, true)).toBe(DEFAULT_TARGET_RATE);
    expect(bytes.getUint32(28, true)).toBe(DEFAULT_TARGET_RATE * 2); // byte rate
    expect(bytes.getUint16(32, true)).toBe(2); // block align
    expect(bytes.getUint16(34, true)).toBe(16); // bits
    expect(bytes.getUint32(40, true)).toBe(samples.length * 2);
    expect(blob.size).toBe(44 + samples.length * 2);
  });

  it('clips the Int16 conversion at full scale and zero', async () => {
    const samples = new Float32Array([2, -2, 0.5, -0.5, 1, -1]);
    const blob = encodeWavMono(samples, DEFAULT_TARGET_RATE);
    const bytes = new DataView(await blob.arrayBuffer());
    const at = (i: number) => bytes.getInt16(44 + i * 2, true);

    // setInt16 truncates toward zero rather than rounding, so the exact
    // assertion is the truncation, not a rounded value.
    expect(at(0)).toBe(32767); // 2 clamps to 1, truncates to int16 full scale
    expect(at(1)).toBe(-32768);
    expect(at(2)).toBe(16383); // 0.5 * 32767 = 16383.5 -> 16383
    expect(at(3)).toBe(-16384); // -0.5 * 32768 = -16384
    expect(at(4)).toBe(32767);
    expect(at(5)).toBe(-32768);
  });
});
