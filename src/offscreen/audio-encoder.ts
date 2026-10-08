import { t } from '../shared/i18n';
/**
 * Hand-rolled WAV/PCM encoder used by the offscreen audio processor.
 *
 * The platform-recorded clip is always WebM/Opus (or whatever MIME the
 * browser supports for `MediaRecorder`). To attach a clip to an Anki note
 * we need a format that:
 *   1. Plays in Anki's bundled mpv (so the user can hear the cue while
 *      reviewing). mpv handles WebM/Opus, MP3 and WAV out of the box.
 *   2. Has predictable size / sample rate, so we can also feed it to
 *      Whisper.cpp (16 kHz mono PCM) for the on-device ASR path.
 *   3. Doesn't require shipping or pulling a heavyweight encoder. Browsers
 *      can decode anything they record (via `AudioContext`) but the only
 *      encoder they expose is the original `MediaRecorder` — i.e., still
 *      WebM/Opus. There is no public browser MP3 encoder.
 *
 * WAV/PCM hits all three: trivial to write by hand (RIFF + PCM samples),
 * Anki plays it, and the same PCM buffer feeds straight into Whisper.
 *
 * `convertBlobToWav` is the one entry point. It decodes the recorded blob,
 * downmixes to mono, resamples to a target rate (default 16 kHz) and writes
 * the result as a WAV blob.
 */

/** Decode an audio blob into a Float32 PCM channel (mono, target rate). */
export async function decodeToMonoPcm(
  blob: Blob,
  targetSampleRate = 16_000,
): Promise<{ samples: Float32Array; sampleRate: number; durationMs: number }> {
  const arrayBuffer = await blob.arrayBuffer();
  // `OfflineAudioContext` lets us decode + resample in a single pass without
  // emitting audio to the user's speakers. We render at the *target* rate so
  // the result is already resampled to e.g. 16 kHz.
  const decoderCtx = new (typeof OfflineAudioContext !== 'undefined'
    ? OfflineAudioContext
    : (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
        .webkitOfflineAudioContext)(1, 2, targetSampleRate);

  // First decode at the native sample rate to discover the actual duration,
  // then re-render at the target rate using a second OfflineAudioContext.
  const decoded = await decoderCtx.decodeAudioData(arrayBuffer.slice(0));

  const offline = new OfflineAudioContext(
    1, // mono output
    Math.max(1, Math.ceil(decoded.duration * targetSampleRate)),
    targetSampleRate,
  );

  const source = offline.createBufferSource();
  source.buffer = decoded;

  // Downmix any number of channels to mono using a ChannelMergerNode-free
  // pattern: a GainNode receives every channel from the source and the
  // OfflineAudioContext destination is mono, so the engine averages them.
  const mixer = offline.createGain();
  mixer.gain.value = 1 / Math.max(1, decoded.numberOfChannels);
  source.connect(mixer).connect(offline.destination);
  source.start(0);

  const rendered = await offline.startRendering();
  const samples = rendered.getChannelData(0).slice(); // detach from the buffer

  return {
    samples,
    sampleRate: targetSampleRate,
    durationMs: Math.round((samples.length / targetSampleRate) * 1000),
  };
}

/** Trim a PCM buffer to the [startMs, endMs] window. */
export function trimPcm(
  samples: Float32Array,
  sampleRate: number,
  startMs: number,
  endMs: number,
): Float32Array {
  const startIdx = Math.max(0, Math.floor((startMs / 1000) * sampleRate));
  const endIdx = Math.min(samples.length, Math.ceil((endMs / 1000) * sampleRate));
  if (endIdx <= startIdx) return new Float32Array(0);
  return samples.subarray(startIdx, endIdx);
}

/**
 * Wrap a mono Float32 PCM buffer in a WAV/RIFF container.
 *
 * Layout (44-byte header + 16-bit PCM samples):
 *   "RIFF" <size-8> "WAVE"
 *   "fmt " 16 <PCM=1> <channels=1> <rate> <byterate> <block> <bits=16>
 *   "data" <size> <samples...>
 */
export function encodeWavMono(
  samples: Float32Array,
  sampleRate: number,
): Blob {
  const bytesPerSample = 2; // 16-bit PCM
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  // RIFF header
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true); // file size - 8
  writeAscii(view, 8, 'WAVE');

  // fmt chunk
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);             // fmt chunk size (PCM = 16)
  view.setUint16(20, 1, true);              // audio format (1 = PCM)
  view.setUint16(22, 1, true);              // channels (1 = mono)
  view.setUint32(24, sampleRate, true);     // sample rate
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true);             // bits per sample

  // data chunk
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // PCM samples (clamped to [-1, 1] then mapped to signed int16)
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    let s = samples[i];
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/** End-to-end: WebM/Opus (or any browser-decodable blob) → 16 kHz mono WAV. */
export async function convertBlobToWav(
  blob: Blob,
  options: {
    targetSampleRate?: number;
    /** Optional trim window in ms relative to the start of the decoded clip */
    startMs?: number;
    endMs?: number;
  } = {},
): Promise<{ blob: Blob; sampleRate: number; durationMs: number; samples: Float32Array }> {
  const target = options.targetSampleRate ?? 16_000;
  const decoded = await decodeToMonoPcm(blob, target);

  let samples = decoded.samples;
  if (options.startMs != null || options.endMs != null) {
    samples = trimPcm(
      samples,
      target,
      options.startMs ?? 0,
      options.endMs ?? decoded.durationMs,
    );
  }

  const wav = encodeWavMono(samples, target);
  return {
    blob: wav,
    sampleRate: target,
    durationMs: Math.round((samples.length / target) * 1000),
    samples,
  };
}

/**
 * Encode a mono Float32 PCM buffer as MP3 using `lamejs`. We use a default
 * bitrate of 64 kbps which is plenty for spoken word at 16 kHz mono and
 * shrinks the per-clip size by ~10× compared to WAV PCM (a 3 s clip drops
 * from ~96 kB to ~24 kB). That matters because Anki collections sync the
 * full media folder; trimming the audio side is the easiest way to keep
 * AnkiWeb / AnkiMobile responsive.
 *
 * `lamejs` expects Int16 PCM samples (the same shape we already write
 * inside the WAV encoder), so the conversion is a single tight loop.
 */
export async function encodeMp3Mono(
  samples: Float32Array,
  sampleRate: number,
  bitrateKbps = 64,
): Promise<Blob> {
  // lamejs must be imported at the top level because its internal globals
  // (`MPEGMode`, `Lame`, etc.) break when loaded via dynamic import() in
  // some bundlers (Vite treats it as a separate async chunk and the UMD
  // globals don't initialise). We use a synchronous require-style import
  // via the static `import` at the top of this file instead.
  const { default: lamejs } = await import('lamejs');
  const Mp3Encoder = (lamejs as unknown as { Mp3Encoder: new (ch: number, sr: number, br: number) => LameEncoder }).Mp3Encoder;
  if (typeof Mp3Encoder !== 'function') {
    throw new Error(t('audio.encoderMissing'));
  }

  // Convert Float32 [-1, 1] to Int16.
  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    let s = samples[i];
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const encoder = new Mp3Encoder(1, sampleRate, bitrateKbps);
  const blockSize = 1152;
  const chunks: Int8Array[] = [];

  for (let i = 0; i < int16.length; i += blockSize) {
    const chunk = int16.subarray(i, i + blockSize);
    const encoded = encoder.encodeBuffer(chunk);
    if (encoded.length > 0) chunks.push(encoded);
  }
  const tail = encoder.flush();
  if (tail.length > 0) chunks.push(tail);

  return new Blob(chunks as BlobPart[], { type: 'audio/mpeg' });
}

interface LameEncoder {
  encodeBuffer(input: Int16Array): Int8Array;
  flush(): Int8Array;
}

/**
 * End-to-end pipeline that produces an MP3 ready to attach to Anki. Same
 * semantics as `convertBlobToWav` but smaller output.
 */
export async function convertBlobToMp3(
  blob: Blob,
  options: {
    targetSampleRate?: number;
    bitrateKbps?: number;
    startMs?: number;
    endMs?: number;
  } = {},
): Promise<{ blob: Blob; sampleRate: number; durationMs: number; samples: Float32Array }> {
  const target = options.targetSampleRate ?? 16_000;
  const decoded = await decodeToMonoPcm(blob, target);

  let samples = decoded.samples;
  if (options.startMs != null || options.endMs != null) {
    samples = trimPcm(
      samples,
      target,
      options.startMs ?? 0,
      options.endMs ?? decoded.durationMs,
    );
  }

  const mp3 = await encodeMp3Mono(samples, target, options.bitrateKbps ?? 64);
  return {
    blob: mp3,
    sampleRate: target,
    durationMs: Math.round((samples.length / target) * 1000),
    samples,
  };
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/** Convert a Blob to a `data:...;base64,...` URL using FileReader. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Failed to encode audio blob'));
    reader.onerror = () => reject(new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}
