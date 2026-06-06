/// <reference types="chrome" />

/**
 * Offscreen audio processor.
 *
 * Lifecycle:
 *  1. Service worker calls `chrome.offscreen.createDocument` with reasons
 *     `USER_MEDIA` + `AUDIO_PLAYBACK` and gives this document a `streamId`
 *     from `chrome.tabCapture.getMediaStreamId`.
 *  2. We open the tab media stream via `navigator.mediaDevices.getUserMedia`
 *     using the legacy `chromeMediaSource` constraints — those still work in
 *     MV3 offscreen documents.
 *  3. We re-route the captured audio to `AudioContext.destination` so the
 *     user keeps hearing the tab.
 *  4. `MediaRecorder` records continuously into a rolling buffer of N seconds
 *     worth of chunks (timeslice 250 ms).
 *  5. When the background asks `OFFSCREEN_EXTRACT_AUDIO_CLIP`, we splice the
 *     relevant chunks, optionally trim to detected speech (RMS-based VAD),
 *     transcode to 16 kHz mono WAV (Anki-friendly and Whisper-ready) and
 *     ship a base64 data URL back.
 *  6. `OFFSCREEN_TRANSCRIBE_CLIP` runs the same pipeline but additionally
 *     hands the PCM buffer to Whisper.cpp WASM and returns the recognised
 *     text — used when the platform doesn't expose subtitles.
 *  7. `OFFSCREEN_TTS_SPEAK` delegates to `speechSynthesis` (Web Speech API)
 *     — the fallback for browsers / platforms where `chrome.tts` fails.
 *
 * The whole document lives only while audio capture is active OR while a
 * TTS/transcription request is in flight. The service worker tears it down
 * with `chrome.offscreen.closeDocument()` via the refcount in
 * `audio-capture-manager.ts`.
 */

import {
  convertBlobToWav,
  convertBlobToMp3,
  blobToDataUrl,
  encodeWavMono,
  encodeMp3Mono,
  trimPcm,
} from './audio-encoder';
import { tightenToSpeech, type VadOptions } from './vad';
import { speakViaSpeechSynthesis } from './tts-fallback';
import {
  setWhisperConfig,
  transcribePcm,
  unloadWhisper,
  onModelProgress,
  type WhisperConfig,
  type WhisperResult,
} from './whisper-asr';

// Bridge Whisper model-download progress events from the offscreen document
// to the rest of the extension (popup, side panel, options page). Anyone
// can subscribe with `chrome.runtime.onMessage` and filter by
// `type === 'OFFSCREEN_WHISPER_MODEL_PROGRESS'`. Cheap fire-and-forget;
// errors are swallowed because the receivers are optional.
onModelProgress((info) => {
  try {
    chrome.runtime.sendMessage({
      type: 'OFFSCREEN_WHISPER_MODEL_PROGRESS',
      ...info,
    });
  } catch {
    /* no listeners, no problem */
  }
});

interface OffscreenMessage {
  type: string;
  streamId?: string;
  startMs?: number;
  endMs?: number;
  bufferSizeSec?: number;
  requestId?: string;
  /** TTS fields */
  text?: string;
  lang?: string;
  rate?: number;
  pitch?: number;
  /** Whisper / VAD fields */
  format?: 'mp3' | 'wav' | 'webm';
  useVad?: boolean;
  preRollMs?: number;
  postRollMs?: number;
  /** MP3 bitrate (kbps) for Anki output. Defaults to 64 in `extractClip`. */
  mp3BitrateKbps?: number;
  language?: string;
  whisperConfig?: Partial<WhisperConfig>;
}

interface ChunkRecord {
  blob: Blob;
  /** Wall-clock ms at the moment the chunk was emitted by MediaRecorder */
  recordedAt: number;
  /** Approximate duration in ms (timeslice) */
  durationMs: number;
}

interface PcmChunkRecord {
  samples: Float32Array;
  recordedAt: number;
  durationMs: number;
  sampleRate: number;
}

const TIMESLICE_MS = 250;
const TARGET_SAMPLE_RATE = 16_000;

let mediaRecorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let audioCtx: AudioContext | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let processorNode: ScriptProcessorNode | null = null;
let silentGain: GainNode | null = null;
let chunks: ChunkRecord[] = [];
let pcmChunks: PcmChunkRecord[] = [];
let recorderHeader: Blob | null = null;
let bufferSizeMs = 30_000;
let recordedMime = '';
/** wall-clock ms when MediaRecorder was started — anchor for all timestamps */
let recordingStartedAt = 0;

function pickMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const mime of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch {
      // ignore
    }
  }
  return '';
}

async function startCapture(
  streamId: string,
  bufferSec: number,
): Promise<{ ok: boolean; mimeType?: string; error?: string }> {
  if (mediaRecorder) await stopCapture();
  bufferSizeMs = Math.max(5, bufferSec) * 1000;

  try {
    stream = await (
      navigator.mediaDevices as MediaDevices & {
        getUserMedia(constraints: unknown): Promise<MediaStream>;
      }
    ).getUserMedia({
      audio: {
        mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId },
      },
      video: false,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'getUserMedia failed';
    console.warn('[Kivara Lingo] offscreen getUserMedia failed', err);
    return { ok: false, error: reason };
  }

  // Re-route audio back to the user's speakers so the tab keeps making sound.
  try {
    audioCtx = new AudioContext();
    sourceNode = audioCtx.createMediaStreamSource(stream);
    sourceNode.connect(audioCtx.destination);

    // Keep a PCM ring buffer in parallel with MediaRecorder. This is more
    // reliable for Anki sentence audio than reconstructing old WebM chunks:
    // once MediaRecorder's initial header falls out of the rolling window,
    // decodeAudioData can fail with EncodingError. PCM is already decoded and
    // timestamped, so extraction is deterministic.
    processorNode = audioCtx.createScriptProcessor(4096, 2, 1);
    silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;
    processorNode.onaudioprocess = (event) => {
      const input = event.inputBuffer;
      const length = input.length;
      const channels = Math.max(1, input.numberOfChannels);
      const mono = new Float32Array(length);
      for (let ch = 0; ch < channels; ch += 1) {
        const data = input.getChannelData(ch);
        for (let i = 0; i < length; i += 1) mono[i] += data[i] / channels;
      }
      const durationMs = (length / input.sampleRate) * 1000;
      pcmChunks.push({
        samples: mono,
        recordedAt: Date.now() - durationMs,
        durationMs,
        sampleRate: input.sampleRate,
      });
      pruneOld();
    };
    sourceNode.connect(processorNode);
    processorNode.connect(silentGain).connect(audioCtx.destination);
  } catch (err) {
    console.warn('[Kivara Lingo] failed to wire audio passthrough', err);
  }

  const mimeType = pickMimeType();
  try {
    mediaRecorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'MediaRecorder failed';
    return { ok: false, error: reason };
  }

  recordedMime = mediaRecorder.mimeType || mimeType || 'audio/webm';
  recordingStartedAt = Date.now();
  chunks = [];
  pcmChunks = [];
  recorderHeader = null;

  mediaRecorder.ondataavailable = (event: BlobEvent) => {
    if (!event.data || !event.data.size) return;
    if (!recorderHeader) recorderHeader = event.data;
    chunks.push({
      blob: event.data,
      recordedAt: Date.now(),
      durationMs: TIMESLICE_MS,
    });
    pruneOld();
  };

  mediaRecorder.start(TIMESLICE_MS);
  console.log('[Kivara Lingo] offscreen recording', { mime: recordedMime, bufferSizeMs });
  return { ok: true, mimeType: recordedMime };
}

function pruneOld() {
  const horizon = Date.now() - bufferSizeMs;
  if (chunks.length) {
    let firstKeep = 0;
    while (firstKeep < chunks.length && chunks[firstKeep].recordedAt < horizon) firstKeep++;
    if (firstKeep > 0) chunks.splice(0, firstKeep);
  }
  if (pcmChunks.length) {
    let firstKeep = 0;
    while (
      firstKeep < pcmChunks.length &&
      pcmChunks[firstKeep].recordedAt + pcmChunks[firstKeep].durationMs < horizon
    ) firstKeep++;
    if (firstKeep > 0) pcmChunks.splice(0, firstKeep);
  }
}

async function stopCapture(): Promise<void> {
  try {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  } catch (err) {
    console.warn('[Kivara Lingo] mediaRecorder.stop failed', err);
  }
  mediaRecorder = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  try {
    sourceNode?.disconnect();
  } catch {
    // ignore
  }
  sourceNode = null;
  try {
    processorNode?.disconnect();
  } catch {
    // ignore
  }
  processorNode = null;
  try {
    silentGain?.disconnect();
  } catch {
    // ignore
  }
  silentGain = null;
  try {
    await audioCtx?.close();
  } catch {
    // ignore
  }
  audioCtx = null;
  chunks = [];
  pcmChunks = [];
  recorderHeader = null;
  recordedMime = '';
  recordingStartedAt = 0;
  // Free the (potentially large) Whisper model when capture stops — we'll
  // reload it on the next request if needed.
  unloadWhisper();
}

/** Build a self-contained WebM blob that is contiguous up to sliceEnd. */
function buildWebmBlob(_sliceStart: number, sliceEnd: number): Blob | null {
  if (!chunks.length) return null;

  // MediaRecorder's first chunk carries the container header. Previous code
  // concatenated only [header + overlapping chunks], skipping the middle of
  // the rolling buffer. Decoding that blob made clip-local offsets invalid
  // and caused sentence-audio extraction to trim the wrong region. Keep the
  // stream contiguous from the first buffered chunk through sliceEnd; the
  // caller then trims the requested [sliceStart, sliceEnd] window in PCM.
  const parts = chunks
    .filter((c) => c.recordedAt <= sliceEnd)
    .map((c) => c.blob);
  if (recorderHeader && !parts.includes(recorderHeader)) parts.unshift(recorderHeader);

  return parts.length ? new Blob(parts, { type: recordedMime || 'audio/webm' }) : null;
}

function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
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

function buildPcmClip(sliceStart: number, sliceEnd: number): { samples: Float32Array; sampleRate: number } | null {
  if (!pcmChunks.length) return null;
  const sampleRate = pcmChunks[0].sampleRate;
  const segments: Float32Array[] = [];
  let total = 0;
  for (const chunk of pcmChunks) {
    const chunkStart = chunk.recordedAt;
    const chunkEnd = chunk.recordedAt + chunk.durationMs;
    if (chunkEnd < sliceStart || chunkStart > sliceEnd) continue;
    const startMs = Math.max(0, sliceStart - chunkStart);
    const endMs = Math.min(chunk.durationMs, sliceEnd - chunkStart);
    const startIdx = Math.max(0, Math.floor((startMs / 1000) * chunk.sampleRate));
    const endIdx = Math.min(chunk.samples.length, Math.ceil((endMs / 1000) * chunk.sampleRate));
    if (endIdx <= startIdx) continue;
    const part = chunk.samples.slice(startIdx, endIdx);
    segments.push(part);
    total += part.length;
  }
  if (!total) return null;
  const merged = new Float32Array(total);
  let offset = 0;
  for (const segment of segments) {
    merged.set(segment, offset);
    offset += segment.length;
  }
  return { samples: resampleLinear(merged, sampleRate, TARGET_SAMPLE_RATE), sampleRate: TARGET_SAMPLE_RATE };
}

interface ExtractOptions {
  startMs: number;
  endMs: number;
  /**
   * Output container.
   *  - `'mp3'` (default for Anki): smallest, ~10× smaller than WAV.
   *    Browsers and Anki play MP3 natively. Encoded via `lamejs`.
   *  - `'wav'`: 16 kHz mono PCM. Used internally by Whisper. Bigger but
   *    no encode cost beyond the RIFF header.
   *  - `'webm'`: raw recorder output, no transcoding. Useful for
   *    debugging or if the consumer wants to handle decoding itself.
   */
  format?: 'mp3' | 'wav' | 'webm';
  useVad?: boolean;
  preRollMs?: number;
  postRollMs?: number;
  /** MP3 bitrate (kbps). Only honoured when `format = 'mp3'`. Default 64. */
  mp3BitrateKbps?: number;
}

interface ExtractedClip {
  ok: boolean;
  dataUrl?: string;
  mimeType?: string;
  durationMs?: number;
  /** When `useVad` was true, the actual speech window (relative to clip start) */
  speechStartMs?: number;
  speechEndMs?: number;
  /** PCM buffer (only when format = 'wav') for downstream Whisper */
  pcm?: Float32Array;
  pcmSampleRate?: number;
  error?: string;
}

async function extractClip(opts: ExtractOptions): Promise<ExtractedClip> {
  if (!chunks.length && !pcmChunks.length) return { ok: false, error: 'No audio buffered yet' };

  const starts = [
    ...chunks.map((c) => c.recordedAt),
    ...pcmChunks.map((c) => c.recordedAt),
  ];
  const ends = [
    ...chunks.map((c) => c.recordedAt + c.durationMs),
    ...pcmChunks.map((c) => c.recordedAt + c.durationMs),
  ];
  const minStart = Math.min(...starts);
  const maxEnd = Math.max(...ends);
  const sliceStart = Math.max(opts.startMs, minStart);
  const sliceEnd = Math.min(opts.endMs, maxEnd);
  if (sliceEnd <= sliceStart) {
    return { ok: false, error: 'Requested clip is outside the rolling buffer window' };
  }

  const pcmClip = buildPcmClip(sliceStart, sliceEnd);
  if (pcmClip && opts.format !== 'webm') {
    let speechStartMs = 0;
    let speechEndMs = Math.round((pcmClip.samples.length / TARGET_SAMPLE_RATE) * 1000);
    let usedVad = false;
    if (opts.useVad) {
      const tightened = tightenToSpeech(
        pcmClip.samples,
        TARGET_SAMPLE_RATE,
        speechStartMs,
        speechEndMs,
        { preRollMs: opts.preRollMs ?? 120, postRollMs: opts.postRollMs ?? 180 },
      );
      speechStartMs = tightened.startMs;
      speechEndMs = tightened.endMs;
      usedVad = tightened.usedVad;
    }
    const finalPcm = trimPcm(pcmClip.samples, TARGET_SAMPLE_RATE, speechStartMs, speechEndMs);
    const outputBlob = encodeWavMono(finalPcm, TARGET_SAMPLE_RATE);
    const dataUrl = await blobToDataUrl(outputBlob);
    return {
      ok: true,
      dataUrl,
      mimeType: 'audio/wav',
      durationMs: Math.round((finalPcm.length / TARGET_SAMPLE_RATE) * 1000),
      speechStartMs: usedVad ? speechStartMs : undefined,
      speechEndMs: usedVad ? speechEndMs : undefined,
      pcm: finalPcm,
      pcmSampleRate: TARGET_SAMPLE_RATE,
    };
  }

  const webmBlob = buildWebmBlob(sliceStart, sliceEnd);
  if (!webmBlob) return { ok: false, error: 'Could not assemble audio chunks' };

  // Cheap path: caller just wants the raw WebM/Opus clip (no decoding).
  if (opts.format === 'webm') {
    const dataUrl = await blobToDataUrl(webmBlob);
    return {
      ok: true,
      dataUrl,
      mimeType: recordedMime || 'audio/webm',
      durationMs: sliceEnd - sliceStart,
    };
  }

  // WAV path: decode → optional VAD trim → encode WAV. The full-clip PCM
  // is also returned so the caller can run Whisper without decoding twice.
  try {
    const decoded = await convertBlobToWav(webmBlob, { targetSampleRate: TARGET_SAMPLE_RATE });

    // The decoded buffer is anchored at the start of the FIRST chunk in
    // the rolling buffer (because we always prepend the header). Translate
    // the requested window into "clip-local ms" so VAD only looks at the
    // relevant region.
    const clipLocalStart = Math.max(0, sliceStart - chunks[0].recordedAt);
    const clipLocalEnd = Math.min(decoded.durationMs, sliceEnd - chunks[0].recordedAt);

    let speechStartMs = clipLocalStart;
    let speechEndMs = clipLocalEnd;
    let usedVad = false;
    if (opts.useVad) {
      const vadOpts: VadOptions = {
        preRollMs: opts.preRollMs ?? 120,
        postRollMs: opts.postRollMs ?? 180,
      };
      const tightened = tightenToSpeech(
        decoded.samples,
        TARGET_SAMPLE_RATE,
        clipLocalStart,
        clipLocalEnd,
        vadOpts,
      );
      speechStartMs = tightened.startMs;
      speechEndMs = tightened.endMs;
      usedVad = tightened.usedVad;
    }

    const finalPcm = trimPcm(
      decoded.samples,
      TARGET_SAMPLE_RATE,
      speechStartMs,
      speechEndMs,
    );

    // Anki path: default to MP3 (~10× smaller than WAV PCM) so the user's
    // sync stays fast and the media folder doesn't balloon. WAV is still
    // emitted internally on the `pcm` field so Whisper can re-use the
    // decoded buffer without a second decode pass.
    const useMp3 = opts.format !== 'wav';
    let outputBlob: Blob;
    let outputMime: string;
    if (useMp3) {
      try {
        outputBlob = await encodeMp3Mono(
          finalPcm,
          TARGET_SAMPLE_RATE,
          opts.mp3BitrateKbps ?? 64,
        );
        outputMime = 'audio/mpeg';
      } catch (mp3Err) {
        // Fall back to WAV if lamejs fails to load (CSP issues, missing
        // dynamic import support, etc.). The card still gets audio,
        // just larger.
        console.warn('[Kivara Lingo] MP3 encode failed, falling back to WAV', mp3Err);
        outputBlob = encodeWavMono(finalPcm, TARGET_SAMPLE_RATE);
        outputMime = 'audio/wav';
      }
    } else {
      outputBlob = encodeWavMono(finalPcm, TARGET_SAMPLE_RATE);
      outputMime = 'audio/wav';
    }
    const dataUrl = await blobToDataUrl(outputBlob);

    return {
      ok: true,
      dataUrl,
      mimeType: outputMime,
      durationMs: Math.round((finalPcm.length / TARGET_SAMPLE_RATE) * 1000),
      speechStartMs: usedVad ? speechStartMs : undefined,
      speechEndMs: usedVad ? speechEndMs : undefined,
      pcm: finalPcm,
      pcmSampleRate: TARGET_SAMPLE_RATE,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'wav decode/encode failed';
    console.warn('[Kivara Lingo] WAV conversion failed; using sentence TTS fallback', err);
    return { ok: false, error: reason };
  }
}

async function transcribeClip(
  opts: ExtractOptions & { language?: string; whisperConfig?: Partial<WhisperConfig> },
): Promise<{ clip: ExtractedClip; transcription: WhisperResult }> {
  if (opts.whisperConfig) setWhisperConfig(opts.whisperConfig);

  const clip = await extractClip({ ...opts, format: 'wav', useVad: opts.useVad ?? true });
  if (!clip.ok || !clip.pcm) {
    return {
      clip,
      transcription: {
        ok: false,
        error: clip.error ?? 'No PCM available for transcription',
      },
    };
  }
  const transcription = await transcribePcm(
    clip.pcm,
    clip.pcmSampleRate ?? TARGET_SAMPLE_RATE,
    opts.language ?? 'auto',
  );
  return { clip, transcription };
}

chrome.runtime.onMessage.addListener((rawMsg: unknown, _sender, sendResponse) => {
  const msg = (rawMsg ?? {}) as OffscreenMessage;
  if (!msg.type || !msg.type.startsWith('OFFSCREEN_')) return false;

  if (msg.type === 'OFFSCREEN_START_AUDIO_CAPTURE' && msg.streamId) {
    void startCapture(msg.streamId, msg.bufferSizeSec ?? 30).then((result) => {
      sendResponse(result);
    });
    return true;
  }

  if (msg.type === 'OFFSCREEN_STOP_AUDIO_CAPTURE') {
    void stopCapture().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (
    msg.type === 'OFFSCREEN_EXTRACT_AUDIO_CLIP' &&
    typeof msg.startMs === 'number' &&
    typeof msg.endMs === 'number'
  ) {
    void extractClip({
      startMs: msg.startMs,
      endMs: msg.endMs,
      format: msg.format ?? 'mp3',
      useVad: msg.useVad ?? true,
      preRollMs: msg.preRollMs,
      postRollMs: msg.postRollMs,
      mp3BitrateKbps: msg.mp3BitrateKbps,
    }).then((result) => {
      // Strip the PCM buffer before responding — it's not transferable via
      // chrome.runtime.sendMessage anyway and would just bloat the IPC.
      const { pcm: _pcm, pcmSampleRate: _rate, ...response } = result;
      void _pcm;
      void _rate;
      sendResponse(response);
    });
    return true;
  }

  if (
    msg.type === 'OFFSCREEN_TRANSCRIBE_CLIP' &&
    typeof msg.startMs === 'number' &&
    typeof msg.endMs === 'number'
  ) {
    void transcribeClip({
      startMs: msg.startMs,
      endMs: msg.endMs,
      useVad: msg.useVad ?? true,
      preRollMs: msg.preRollMs,
      postRollMs: msg.postRollMs,
      language: msg.language,
      whisperConfig: msg.whisperConfig,
    }).then(({ clip, transcription }) => {
      const { pcm: _pcm, pcmSampleRate: _rate, ...clipOut } = clip;
      void _pcm;
      void _rate;
      sendResponse({ clip: clipOut, transcription });
    });
    return true;
  }

  if (msg.type === 'OFFSCREEN_TTS_SPEAK' && typeof msg.text === 'string') {
    void speakViaSpeechSynthesis({
      text: msg.text,
      lang: msg.lang ?? 'en',
      rate: msg.rate,
      pitch: msg.pitch,
    }).then((result) => sendResponse(result));
    return true;
  }

  if (msg.type === 'OFFSCREEN_STATUS') {
    sendResponse({
      ok: true,
      active: !!mediaRecorder,
      mimeType: recordedMime,
      bufferedChunks: chunks.length,
      recordingStartedAt,
    });
    return false;
  }

  return false;
});

console.log('[Kivara Lingo] offscreen audio worker ready');
