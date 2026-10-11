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
import { buildPcmClip as buildPcmClipPure, bufferBounds } from './pcm-timeline';
import { blockFromMessage, emitBlock, makeProcessorHandler, type PcmChunkRecord } from './pcm-block';
// Emitted by the `pcm-worklet-url` vite plugin: the hashed URL of the built
// worklet chunk. Importing the virtual module is what ties the two together.
import pcmWorkletUrl from 'virtual:__PCM_WORKLET_URL__';
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
  /** E2E-only capture-path override: 'audio-worklet' | 'script-processor'. */
  pcmPath?: 'audio-worklet' | 'script-processor';
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

const TIMESLICE_MS = 250;
const TARGET_SAMPLE_RATE = 16_000;
/** Ceiling for the rolling buffer. The settings slider tops out at 30 s;
 * anything larger would be a caller bug, and pinning memory for it is worse
 * than truncating (a clip simply cannot be older than this). */
const MAX_BUFFER_MS = 120_000;
/** Guards the start path against a second START arriving mid-setup. */
let startInFlight = false;

let mediaRecorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let audioCtx: AudioContext | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let processorNode: ScriptProcessorNode | null = null;
let workletNode: AudioWorkletNode | null = null;
/** Which PCM path is live: 'audio-worklet' or 'script-processor'. */
let pcmPath: 'audio-worklet' | 'script-processor' | null = null;
/** Worklet clock: total samples emitted, and the wall-clock start. */
let workletSamplesSeen = 0;
let workletStartMs = 0;
/** Worklet diagnostics: blocks received, and the first error seen. */
let workletBlocksSeen = 0;
let workletSetupError: string | null = null;
let workletFirstError: string | null = null;
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
  // Serialized: two STARTs fired back to back (the SW sends one, a pending
  // retry sends another) used to interleave `stopCapture` + `getUserMedia`
  // and leave the second stream recording over the first. Serializing also
  // makes the "already recording" case deterministic.
  if (startInFlight) {
    return { ok: false, error: 'Capture is already starting' };
  }
  startInFlight = true;
  try {
    if (mediaRecorder) await stopCapture();
    // Floor AND ceiling: `Math.max(5, …)` clamped the value from below only,
    // so a user (or a malformed message) could ask for an hour of audio and
    // pin that much memory for the whole offscreen session.
    bufferSizeMs = Math.min(MAX_BUFFER_MS, Math.max(5, bufferSec) * 1000);
    return await beginCapture(streamId);
  } finally {
    startInFlight = false;
  }
}

/** E2E-only synthetic stream holder (see `openStream`). */
let e2eStream: MediaStream | null = null;
/** Loop timers for the synthetic stream's repeating burst (E2E only). */
const e2eRepeaters: Array<() => void> = [];

/**
 * Open the stream to record.
 *
 * Production path: `chrome.tabCapture.getMediaStreamId` + `getUserMedia` with
 * the legacy `chromeMediaSource: 'tab'` constraints — the stream of whatever
 * tab the service worker was asked to capture.
 *
 * E2E path (`__E2E__` only, so a production build has no copy of this code):
 * tab capture needs the active-tab permission, which a headless test cannot
 * grant — no user will click around to invoke the extension per tab. Instead
 * of shipping a fake recorder, the offscreen builds its OWN synthetic stream
 * (a 440 Hz sine with the same burst envelope as the e2e fixture) and records
 * that through MediaRecorder and the PCM ScriptProcessor like any other stream.
 * Everything downstream — chunking, VAD, resampling, WAV output — is the real
 * code on a real stream; only the tab-capture hop is skipped, and that gap is
 * the one thing this file's e2e does NOT cover.
 */
async function openStream(streamId: string): Promise<MediaStream> {
  if (__E2E__ && streamId === 'kivara-e2e-synthetic') {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 440;
    const gate = ctx.createGain();
    const burst = (startSec: number): void => {
      const g = gate.gain;
      g.cancelScheduledValues(startSec);
      g.setValueAtTime(0, startSec + 1);
      g.linearRampToValueAtTime(0.85, startSec + 1.06);
      g.setValueAtTime(0.85, startSec + 4);
      g.linearRampToValueAtTime(0, startSec + 4.06);
    };
    // Envelope identical to tests/e2e/fixtures/audio-player.html (1 s of
    // silence, 3 s of tone, 1 s of silence) so both the spec and this
    // recorder agree on the burst shape by construction. Looped: one burst
    // every 5 s forever, because the smoke asks for its window whenever the
    // buffer has filled, and a single burst would leave later asks with
    // nothing but silence in them.
    burst(ctx.currentTime);
    const repeat = setInterval(() => burst(ctx.currentTime), 5_000);
    osc.connect(gate);
    const dest = ctx.createMediaStreamDestination();
    gate.connect(dest);
    osc.start();
    e2eStream = dest.stream;
    e2eRepeaters.push(() => clearInterval(repeat));
    return dest.stream;
  }
  return await (navigator.mediaDevices as MediaDevices & {
    getUserMedia(constraints: unknown): Promise<MediaStream>;
  }).getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false,
  });
}

/**
 * Install the PCM capture path on the live graph.
 *
 * Capability is probed ONCE (per graph, not per call): if the AudioWorklet
 * module can be registered, the worklet is used; anything else — missing
 * constructor, a rejected `addModule` (an unreachable URL), a context that
 * already has a worklet installed — falls back to ScriptProcessor. Both
 * branches converge on `emitBlock`, so a chunk in the ring buffer is
 * indistinguishable regardless of capture path.
 *
 * The worklet must be connected into the graph with a destination, otherwise
 * the runtime never calls its `process()` (a node with no downstream consumer
 * is pruned); `silentGain` keeps it alive while muting what the user hears.
 */
/**
 * E2E-only capture-path override.
 *
 * The value arrives as part of `OFFSCREEN_START_AUDIO_CAPTURE` (the SW
 * forwards it from the E2E bridge), NOT from a page global: the offscreen
 * document is created by `chrome.offscreen.createDocument`, outside the tab
 * the test drives, so Playwright's init script never touches it. Leaving the
 * value as a *message* also keeps the override test-observable, because the
 * path the document actually used is reported back by `OFFSCREEN_STATUS`.
 */
let forcedPathOverride: 'audio-worklet' | 'script-processor' | null = null;

/**
 * Whether an unforced run defaults to AudioWorklet when the browser has one.
 *
 * `false` on purpose, and it is the one line to flip: the worklet path was
 * wrong for its whole first life because the processor's `port` field was
 * declared with an initialiser, which clobbered the real `MessagePort` and
 * silently dropped every block. It is correct now, and the smoke proves both
 * halves on the same input, so the switch stays closed only until the next
 * round opens it — not because anything is broken.
 */
const PCM_WORKLET_DEFAULT = false;

async function wirePcmCapture(): Promise<void> {
  const ctx = audioCtx!;
  const source = sourceNode!;
  const sink: (chunk: PcmChunkRecord) => void = (chunk) => {
    pcmChunks.push(chunk);
    pruneOld();
  };

  // An explicit override wins; otherwise capability decides.
  //
  // Both paths converge on `emitBlock`, which is where the rate a chunk is
  // labelled with is validated (see `pcm-block.ts`), so the two are the same
  // code path after this branch.
  const useWorklet =
    forcedPathOverride === 'audio-worklet' ||
    (forcedPathOverride === null && !__E2E__ && typeof AudioWorkletNode === 'function' && PCM_WORKLET_DEFAULT);

  if (!useWorklet) {
    console.log('[Kivara Lingo] ScriptProcessor path (forced or unavailable)');
  } else {
    try {
      await ctx.audioWorklet.addModule(pcmWorkletUrl);
      workletNode = new AudioWorkletNode(ctx, 'pcm-capture');
      workletSamplesSeen = 0;
      workletStartMs = Date.now();
      workletNode.port.onmessage = (
        event: MessageEvent<{ channels: Float32Array[]; length: number; sampleRate?: number }>,
      ) => {
        const { channels, length } = event.data;
        workletBlocksSeen += 1;
        try {
          // The block carries its own rate; a message without one (or with one
          // that is not the context's own) is a broken post, and guessing it
          // would stamp 48 kHz samples as 16 kHz — see `pcm-block.ts`.
          const block = blockFromMessage(event.data, ctx.sampleRate);
          // Timestamp by render quantum, not by drain time. `Date.now()` is
          // sampled when the message reaches the main thread, which under load
          // is milliseconds behind the render it describes. These blocks arrive
          // in render order, so the sample count IS the clock.
          workletSamplesSeen += length;
          emitBlock(block, sink, workletStartMs + (workletSamplesSeen / ctx.sampleRate) * 1000);
        } catch (err) {
          workletFirstError = err instanceof Error ? err.message : String(err);
        }
      };
      source.connect(workletNode);
      workletNode.connect(silentGain!).connect(ctx.destination);
      pcmPath = 'audio-worklet';
      return;
    } catch (err) {
      console.warn('[Kivara Lingo] AudioWorklet setup failed, using ScriptProcessor', err);
      workletSetupError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
  }

  processorNode = ctx.createScriptProcessor(4096, 2, 1);
  processorNode.onaudioprocess = makeProcessorHandler(sink);
  source.connect(processorNode);
  processorNode.connect(silentGain!).connect(ctx.destination);
  pcmPath = 'script-processor';
}

/** Capture setup proper, always under `startInFlight`. */
async function beginCapture(
  streamId: string,
): Promise<{ ok: boolean; mimeType?: string; error?: string }> {

  try {
    stream = await openStream(streamId);
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
    //
    // The block arrives either as an AudioWorklet frame (non-throttled) or a
    // ScriptProcessor event (main-thread); both normalise in `pcm-block.ts`,
    // so the chunk that lands in the ring buffer is identical either way.
    silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;
    await wirePcmCapture();
  } catch (err) {
    console.warn('[Kivara Lingo] failed to wire audio passthrough', err);
  }

  const mimeType = pickMimeType();
  try {
    mediaRecorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
  } catch (err) {
    // The stream, the AudioContext and the PCM pipeline are already open at
    // this point. Returning without releasing them left the microphone
    // recording forever (and a live Graph "recording" bubble) with no UI to
    // stop it.
    const reason = err instanceof Error ? err.message : 'MediaRecorder failed';
    console.warn('[Kivara Lingo] offscreen MediaRecorder failed', reason);
    // Same teardown as a normal stop, without waiting on recorder.stop().
    await teardownPipeline();
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

/**
 * Release every capture resource: the recording stream's tracks, the AudioContext
 * graph (source → processor → silent gain) and the PCM ring buffer.
 *
 * Split out of `stopCapture` so a FAILED start can use it too: when
 * MediaRecorder cannot be constructed the stream and graph are already open,
 * and leaving them running keeps the microphone live with nothing in the UI
 * that can stop it.
 */
async function teardownPipeline(): Promise<void> {
  // Stop the synthetic stream's burst loop (E2E only): a setInterval
  // outliving the graph keeps scheduling gain envelopes into a dead context.
  while (e2eRepeaters.length) e2eRepeaters.pop()?.();
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
    workletNode?.port.close();
  } catch {
    // ignore
  }
  try {
    workletNode?.disconnect();
  } catch {
    // ignore
  }
  workletNode = null;
  pcmPath = null;
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

/** Full stop: release the pipeline AND reset the buffers it was filling. */
async function stopCapture(): Promise<void> {
  await teardownPipeline();
  chunks = [];
  pcmChunks = [];
  recorderHeader = null;
  recordedMime = '';
  recordingStartedAt = 0;
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

/**
 * Thin binding over the pure `buildPcmClip` in `pcm-timeline.ts`: feeds the
 * module-scoped rolling buffer and target rate. All the load-bearing timeline
 * math (gap-fill, per-chunk resample, window anchoring) lives in — and is
 * unit-tested through — that pure module.
 */
function buildPcmClip(
  sliceStart: number,
  sliceEnd: number,
): { samples: Float32Array; sampleRate: number } | null {
  return buildPcmClipPure(pcmChunks, sliceStart, sliceEnd, TARGET_SAMPLE_RATE);
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

  // Fold over both buffers (see `bufferBounds`): a full 30 s ring buffer holds
  // hundreds of chunks, and `Math.min(...arr)` on a large array can blow the
  // call stack.
  const bounds = bufferBounds(chunks, pcmChunks);
  if (!bounds) {
    return { ok: false, error: 'No audio buffered yet' };
  }
  const sliceStart = Math.max(opts.startMs, bounds.minStart);
  const sliceEnd = Math.min(opts.endMs, bounds.maxEnd);
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
    // Anki path: MP3 by default (~10× smaller than WAV PCM), WAV only when
    // the caller explicitly asks for PCM-friendly output (Whisper) or when
    // lamejs fails to load — the card still gets audio, just larger.
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
    // E2E-only override, forwarded by the SW (see the field's declaration
    // above). Validated here so a typo cannot force a path that does not exist.
    const forced = msg.pcmPath;
    forcedPathOverride =
      forced === 'audio-worklet' || forced === 'script-processor' ? forced : null;
    void startCapture(msg.streamId, msg.bufferSizeSec ?? 30).then((result) => {
      sendResponse(result);
    }, (err) => {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    });
    return true;
  }

  if (msg.type === 'OFFSCREEN_STOP_AUDIO_CAPTURE') {
    void stopCapture().then(() => sendResponse({ ok: true }), (err) => {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    });
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
    }, (err) => {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
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
    }, (err) => {
      sendResponse({
        clip: { ok: false, error: err instanceof Error ? err.message : String(err) },
        transcription: { ok: false, error: err instanceof Error ? err.message : String(err) },
      });
    });
    return true;
  }

  if (msg.type === 'OFFSCREEN_TTS_SPEAK' && typeof msg.text === 'string') {
    void speakViaSpeechSynthesis({
      text: msg.text,
      lang: msg.lang ?? 'en',
      rate: msg.rate,
      pitch: msg.pitch,
    }).then((result) => sendResponse(result), (err) => {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    });
    return true;
  }

  if (msg.type === 'OFFSCREEN_STATUS') {
    sendResponse({
      ok: true,
      active: !!mediaRecorder,
      mimeType: recordedMime,
      bufferedChunks: chunks.length,
      recordingStartedAt,
      // Which PCM path is filling the ring buffer. Reported so the E2E smoke
      // can prove it compared the two paths it meant to compare.
      pcmPath: pcmPath ?? null,
      // Diagnostics for the AudioWorklet path: how many blocks actually
      // reached the document, and the first error if emitting one threw.
      workletBlocksSeen: workletBlocksSeen || null,
      workletFirstError,
      workletSetupError,
      // Diagnostics for the PCM path: how many blocks reached the document,
      // the rate the chunks are labelled with, and what the capture context
      // runs at. Zero blocks with `pcmPath` reporting a live path is what a
      // dead worklet looks like — the PCM extraction then silently gives way
      // to the WebM transcription, whose samples land on a 16 kHz timeline
      // without resampling, so a 48 kHz stream reads as a third of its pitch.
      bufferedPcmChunks: pcmChunks.length,
      chunkSampleRate: pcmChunks.at(-1)?.sampleRate ?? null,
      captureSampleRate: audioCtx?.sampleRate ?? null,
    });
    return false;
  }

  return false;
});

console.log('[Kivara Lingo] offscreen audio worker ready');
