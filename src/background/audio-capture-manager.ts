/// <reference types="chrome" />

/**
 * Service-worker side of audio capture + offscreen-document multiplexing.
 *
 * Responsibilities:
 *  - Create / close the offscreen document and keep it alive while at least
 *    one consumer holds a refcount (capture, TTS, ASR…).
 *  - Resolve a `streamId` from `chrome.tabCapture.getMediaStreamId` and ship
 *    it to the offscreen worker.
 *  - Proxy `EXTRACT_AUDIO_CLIP` and `TRANSCRIBE_AUDIO_CLIP` requests from
 *    content / orchestrator into the offscreen worker.
 *  - Proxy `OFFSCREEN_TTS_SPEAK` so the background's `tts.ts` can fall back
 *    to `speechSynthesis` when `chrome.tts` is unavailable.
 */

import type {
  AudioCaptureStatus,
  AudioClipResponse,
  TtsResponse,
} from '../shared/types';

const OFFSCREEN_URL = 'src/offscreen/index.html';
const AUDIO_CAPTURE_SESSION_KEY = 'kivara-lingo-audio-capture-session';

interface AudioCaptureSession {
  active: boolean;
  tabId: number;
  mimeType?: string;
  startedAt: number;
}

let activeTabId: number | null = null;
let activeMimeType: string | undefined;
let lastError: string | undefined;

/** Refcount for one-shot consumers (TTS / ASR) that need a brief lifetime. */
let oneShotRefs = 0;

async function hasOffscreenDocument(): Promise<boolean> {
  // chrome.offscreen.hasDocument was renamed; both exist in different versions
  const api = chrome.offscreen as unknown as {
    hasDocument?: () => Promise<boolean>;
  };
  if (typeof api.hasDocument === 'function') {
    try {
      return await api.hasDocument();
    } catch {
      // fall back to runtime.getContexts
    }
  }
  const runtimeApi = chrome.runtime as unknown as {
    getContexts?: (opts: { contextTypes: string[] }) => Promise<Array<unknown>>;
  };
  if (typeof runtimeApi.getContexts === 'function') {
    try {
      const contexts = await runtimeApi.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      return contexts.length > 0;
    } catch {
      return false;
    }
  }
  return false;
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  // We list every reason we use across the whole app so a single offscreen
  // document can serve capture (USER_MEDIA), TTS fallback (AUDIO_PLAYBACK)
  // and Whisper.cpp WASM transcription (WORKERS-friendly compute).
  const reasons = [
    'USER_MEDIA',
    'AUDIO_PLAYBACK',
    'WORKERS',
  ] as chrome.offscreen.Reason[];
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons,
    justification:
      'Tab audio capture, on-device speech synthesis (TTS fallback) and Whisper.cpp transcription for language learning cards.',
  });
}

async function loadStoredSession(): Promise<AudioCaptureSession | null> {
  try {
    const stored = await chrome.storage.session.get(AUDIO_CAPTURE_SESSION_KEY);
    const session = stored[AUDIO_CAPTURE_SESSION_KEY] as AudioCaptureSession | undefined;
    return session?.active && typeof session.tabId === 'number' ? session : null;
  } catch {
    return null;
  }
}

async function saveStoredSession(session: AudioCaptureSession): Promise<void> {
  try {
    await chrome.storage.session.set({ [AUDIO_CAPTURE_SESSION_KEY]: session });
  } catch (err) {
    console.warn('[Kivara Lingo] failed to persist audio capture session', err);
  }
}

async function clearStoredSession(): Promise<void> {
  try {
    await chrome.storage.session.remove(AUDIO_CAPTURE_SESSION_KEY);
  } catch {
    // ignore
  }
}

async function getOffscreenRecorderStatus(): Promise<{
  ok?: boolean;
  active?: boolean;
  mimeType?: string;
  error?: string;
} | null> {
  if (!(await hasOffscreenDocument())) return null;
  try {
    return await sendToOffscreen<{
      ok?: boolean;
      active?: boolean;
      mimeType?: string;
      error?: string;
    }>({ type: 'OFFSCREEN_STATUS' });
  } catch {
    return null;
  }
}

async function hydrateCaptureSession(): Promise<boolean> {
  if (activeTabId != null) return true;
  const session = await loadStoredSession();
  if (!session) return false;
  const offscreen = await getOffscreenRecorderStatus();
  if (!offscreen?.active) {
    await clearStoredSession();
    return false;
  }
  activeTabId = session.tabId;
  activeMimeType = offscreen.mimeType || session.mimeType;
  lastError = undefined;
  return true;
}

async function closeOffscreenIfIdle(): Promise<void> {
  if (activeTabId != null) return; // capture still active
  if (await loadStoredSession()) return; // capture survived a SW restart
  if (oneShotRefs > 0) return; // another one-shot in flight
  if (!(await hasOffscreenDocument())) return;
  try {
    await chrome.offscreen.closeDocument();
  } catch (err) {
    console.warn('[Kivara Lingo] closeOffscreenIfIdle failed', err);
  }
}

function getStreamId(tabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      if (!streamId) {
        reject(new Error('tabCapture returned an empty stream id'));
        return;
      }
      resolve(streamId);
    });
  });
}

interface OffscreenResponse<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
}

function sendToOffscreen<T = unknown>(message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response as T);
    });
  });
}

/** Wrap a one-shot offscreen operation in refcounting + cleanup. */
async function withOffscreen<T>(op: () => Promise<T>): Promise<T> {
  oneShotRefs += 1;
  try {
    await ensureOffscreen();
    return await op();
  } finally {
    oneShotRefs = Math.max(0, oneShotRefs - 1);
    void closeOffscreenIfIdle();
  }
}

export async function startAudioCapture(
  tabId: number,
  bufferSizeSec: number,
): Promise<{ ok: boolean; mimeType?: string; error?: string }> {
  try {
    await ensureOffscreen();
    const streamId = await getStreamId(tabId);
    const result = await sendToOffscreen<OffscreenResponse & { mimeType?: string }>({
      type: 'OFFSCREEN_START_AUDIO_CAPTURE',
      streamId,
      bufferSizeSec,
    });
    if (!result?.ok) {
      lastError = result?.error || 'offscreen reported failure';
      activeTabId = null;
      activeMimeType = undefined;
      await clearStoredSession();
      void closeOffscreenIfIdle();
      return { ok: false, error: lastError };
    }
    activeTabId = tabId;
    activeMimeType = result.mimeType;
    lastError = undefined;
    await saveStoredSession({
      active: true,
      tabId,
      mimeType: activeMimeType,
      startedAt: Date.now(),
    });
    return { ok: true, mimeType: activeMimeType };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown';
    lastError = reason;
    activeTabId = null;
    activeMimeType = undefined;
    await clearStoredSession();
    // Best effort: shut the offscreen doc back down if we failed to start.
    void closeOffscreenIfIdle();
    return { ok: false, error: reason };
  }
}

export async function stopAudioCapture(): Promise<void> {
  try {
    if (await hasOffscreenDocument()) {
      await sendToOffscreen({ type: 'OFFSCREEN_STOP_AUDIO_CAPTURE' });
    }
  } catch (err) {
    console.warn('[Kivara Lingo] failed to stop offscreen', err);
  } finally {
    activeTabId = null;
    activeMimeType = undefined;
    await clearStoredSession();
    await closeOffscreenIfIdle();
  }
}

export interface ExtractAudioClipOptions {
  /** Trim to detected speech (RMS-based VAD). Default `true`. */
  useVad?: boolean;
  /** ms kept before detected speech */
  preRollMs?: number;
  /** ms kept after detected speech */
  postRollMs?: number;
  /**
   * Output container.
   *  - `'mp3'` (default for Anki): smallest file, compatible with all Anki
   *    clients. Encoded via lamejs in the offscreen.
   *  - `'wav'`: 16 kHz mono PCM. Used internally by Whisper transcription.
   *  - `'webm'`: raw recorder output, no transcoding.
   */
  format?: 'mp3' | 'wav' | 'webm';
  /** MP3 bitrate in kbps. Only used when format is 'mp3'. Default 64. */
  mp3BitrateKbps?: number;
}

export async function extractAudioClip(
  startMs: number,
  endMs: number,
  options: ExtractAudioClipOptions = {},
): Promise<AudioClipResponse> {
  if (!(await hydrateCaptureSession())) {
    return { ok: false, error: 'Audio capture is not active for this tab.' };
  }
  try {
    const result = await sendToOffscreen<AudioClipResponse>({
      type: 'OFFSCREEN_EXTRACT_AUDIO_CLIP',
      startMs,
      endMs,
      format: options.format ?? 'mp3',
      useVad: options.useVad ?? true,
      preRollMs: options.preRollMs,
      postRollMs: options.postRollMs,
      mp3BitrateKbps: options.mp3BitrateKbps,
    });
    return result;
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown';
    return { ok: false, error: reason };
  }
}

export interface TranscribeClipOptions extends ExtractAudioClipOptions {
  /** BCP-47 language code (or 'auto' to let Whisper detect) */
  language?: string;
  /** Override the Whisper glue / model URLs at runtime */
  whisperConfig?: {
    glueUrl?: string;
    modelUrl?: string;
    cacheName?: string;
  };
}

export interface TranscribeClipResult {
  clip: AudioClipResponse;
  transcription:
    | {
        ok: true;
        text: string;
        segments: Array<{ startMs: number; endMs: number; text: string }>;
        language?: string;
      }
    | { ok: false; error: string; transient?: boolean };
}

export async function transcribeAudioClip(
  startMs: number,
  endMs: number,
  options: TranscribeClipOptions = {},
): Promise<TranscribeClipResult> {
  if (!(await hydrateCaptureSession())) {
    return {
      clip: { ok: false, error: 'Audio capture is not active for this tab.' },
      transcription: { ok: false, error: 'Audio capture is not active for this tab.' },
    };
  }
  try {
    const result = await sendToOffscreen<TranscribeClipResult>({
      type: 'OFFSCREEN_TRANSCRIBE_CLIP',
      startMs,
      endMs,
      useVad: options.useVad ?? true,
      preRollMs: options.preRollMs,
      postRollMs: options.postRollMs,
      language: options.language,
      whisperConfig: options.whisperConfig,
    });
    return result;
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown';
    return {
      clip: { ok: false, error: reason },
      transcription: { ok: false, error: reason },
    };
  }
}

/**
 * Speak `text` via the offscreen document's `speechSynthesis` (Web Speech
 * API). Used as a fallback when `chrome.tts` is unavailable / errors out.
 */
export async function speakViaOffscreen(text: string, lang: string): Promise<TtsResponse> {
  return withOffscreen(async () => {
    try {
      const result = await sendToOffscreen<TtsResponse>({
        type: 'OFFSCREEN_TTS_SPEAK',
        text,
        lang,
      });
      return result ?? { ok: false, error: 'no response from offscreen' };
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'offscreen TTS failed';
      return { ok: false, error: reason };
    }
  });
}

export async function getAudioCaptureStatus(): Promise<AudioCaptureStatus> {
  await hydrateCaptureSession();
  return {
    active: activeTabId != null,
    tabId: activeTabId,
    mimeType: activeMimeType,
    error: lastError,
  };
}
