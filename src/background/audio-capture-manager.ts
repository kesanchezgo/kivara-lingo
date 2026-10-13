/// <reference types="chrome" />

/**
 * Service-worker side of audio capture + offscreen-document multiplexing.
 *
 * Responsibilities:
 *  - Create / close the offscreen document and keep it alive while at least
 *    one consumer holds a refcount (capture, TTS).
 *  - Resolve a `streamId` from `chrome.tabCapture.getMediaStreamId` and ship
 *    it to the offscreen worker.
 *  - Proxy `EXTRACT_AUDIO_CLIP` requests from content / orchestrator into the
 *    offscreen worker.
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

/**
 * Monotonic stamp of the last start. A stop compares against it: a stop that
 * returns after a newer start began must not zero `activeTabId` out from
 * under the live capture, nor schedule the document's close.
 */
let captureToken = 0;

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

let ensureOffscreenPromise: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  // Single-flight lock: concurrent callers (capture start + TTS fallback +
  // transcription) used to race hasDocument → createDocument, and the loser
  // threw when the document already existed. Wrapped in the shared mutex so
  // an open can never interleave with a close.
  if (ensureOffscreenPromise) return ensureOffscreenPromise;
  ensureOffscreenPromise = (async () => {
    await withOffscreenLock(async () => {
      if (await hasOffscreenDocument()) return;
      // We list every reason we use across the whole app so a single offscreen
      // document can serve capture (USER_MEDIA), TTS fallback (AUDIO_PLAYBACK)
      // and speech synthesis (WORKERS-friendly compute).
      const reasons = [
        'USER_MEDIA',
        'AUDIO_PLAYBACK',
        'WORKERS',
      ] as chrome.offscreen.Reason[];
      try {
        await chrome.offscreen.createDocument({
          url: OFFSCREEN_URL,
          reasons,
          justification:
            'Tab audio capture, on-device speech synthesis (TTS fallback) for language learning cards.',
        });
      } catch (err) {
        // Lost the race with another context that created it first — not fatal.
        if (await hasOffscreenDocument()) return;
        throw err;
      }
    });
  })();
  try {
    await ensureOffscreenPromise;
  } finally {
    ensureOffscreenPromise = null;
  }
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
  pcmPath?: 'audio-worklet' | 'script-processor' | null;
  captureSampleRate?: number | null;
  bufferedPcmChunks?: number;
  chunkSampleRate?: number | null;
  workletBlocksSeen?: number | null;
  workletFirstError?: string | null;
  workletSetupError?: string | null;
} | null> {
  if (!(await hasOffscreenDocument())) return null;
  try {
    return await sendToOffscreen<{
      ok?: boolean;
      active?: boolean;
      mimeType?: string;
      error?: string;
      pcmPath?: 'audio-worklet' | 'script-processor' | null;
      captureSampleRate?: number | null;
      bufferedPcmChunks?: number;
      chunkSampleRate?: number | null;
      workletBlocksSeen?: number | null;
      workletFirstError?: string | null;
      workletSetupError?: string | null;
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

/**
 * The close path has to win the race it used to lose: `oneShotRefs` and the
 * stored session were read, then TWO awaits happened before
 * `closeDocument()`, and a TTS or capture that started in that window got
 * "Receiving end does not exist".
 *
 * A process-wide mutex serialises open and close, so the check and the close
 * are atomic with respect to any `ensureOffscreen` that starts inside the
 * window. `withOffscreenLock` wraps the reader side too, which makes the
 * ordering total rather than best-effort.
 */
let offscreenLock: Promise<void> = Promise.resolve();
function withOffscreenLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = offscreenLock.then(fn, fn);
  // The chain must survive a rejected task: a failure releases the lock and
  // keeps the next waiter in line instead of poisoning the queue.
  offscreenLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function closeOffscreenIfIdle(): Promise<void> {
  if (activeTabId != null) return; // capture still active
  if (await loadStoredSession()) return; // capture survived a SW restart
  if (oneShotRefs > 0) return; // another one-shot in flight
  if (!(await hasOffscreenDocument())) return;
  try {
    // Re-checked INSIDE the lock: whatever started during the awaits above
    // either finished (its ref is gone, so closing is right) or is queued
    // behind us and will recreate the document.
    await withOffscreenLock(async () => {
      if (activeTabId != null) return;
      if (await loadStoredSession()) return;
      if (oneShotRefs > 0) return;
      if (!(await hasOffscreenDocument())) return;
      await chrome.offscreen.closeDocument();
    });
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

const OFFSCREEN_RPC_TIMEOUT_MS = 15_000;

/**
 * One round trip to the offscreen document, with a deadline.
 *
 * `chrome.runtime.sendMessage` never calls the callback when the document is
 * gone or wedged — the promise it is wrapped in stayed PENDING forever, and
 * with it the `oneShotRefs` refcount, so `closeOffscreenIfIdle` forever saw a
 * phantom consumer and the live document was never released. 15 s is far above
 * any real response (the heaviest payload takes under a second) and far below
 * a service worker's own lifetime budget.
 */
function sendToOffscreen<T = unknown>(message: Record<string, unknown>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('el documento offscreen no respondió'));
    }, OFFSCREEN_RPC_TIMEOUT_MS);

    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        resolve(response as T);
      });
    } catch (err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
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
  streamIdOverride?: string,
  /** E2E-only capture-path override; forwarded verbatim to the offscreen. */
  pcmPath?: 'audio-worklet' | 'script-processor',
): Promise<{ ok: boolean; mimeType?: string; error?: string }> {
  // A ref is held for the WHOLE start, including the async gaps: the offscreen
  // open, `getStreamId`, the round trip and the `storage.session` write — a
  // TTS one-shot finishing mid-start would otherwise look idle and close the
  // document this start had just opened.
  oneShotRefs += 1;
  // Every bump supersedes every earlier token — including an earlier START,
  // which is the case the whole loop below exists for. A stop that lands
  // while this start is still awaiting cannot pre-empt post-mortem, so the
  // token is re-read after EACH await, not only in the finally.
  captureToken += 1;
  const token = captureToken;
  const stale = () => token !== captureToken;

  try {
    // NOT wrapped in the offscreen lock: the lock is not reentrant and
    // `ensureOffscreen()` takes it itself, so a start inside the lock
    // deadlocked with the open until the e2e suite caught it. The token
    // alone preserves the ordering.
    await ensureOffscreen();
    if (stale()) return superseded();

    const streamId = streamIdOverride ?? (await getStreamId(tabId));
    if (stale()) return superseded();

    const result = await sendToOffscreen<OffscreenResponse & { mimeType?: string }>({
      type: 'OFFSCREEN_START_AUDIO_CAPTURE',
      streamId,
      bufferSizeSec,
      ...(pcmPath ? { pcmPath } : {}),
    });
    if (stale()) {
      // The offscreen IS now recording (the RPC landed) but a stop already
      // ran, so the user's intent is stop: tell the document instead of
      // leaving it capturing into a session nobody owns.
      await sendToOffscreen({ type: 'OFFSCREEN_STOP_AUDIO_CAPTURE' }).catch(() => {});
      return superseded();
    }
    if (!result?.ok) {
      if (stale()) return superseded();
      lastError = result?.error || 'offscreen reported failure';
      activeTabId = null;
      activeMimeType = undefined;
      await clearStoredSession();
      return { ok: false, error: lastError };
    }
    if (stale()) return superseded();

    activeTabId = tabId;
    activeMimeType = result.mimeType;
    // ONLY after the state above is recorded: one write, so
    // `closeOffscreenIfIdle` and every consumer see a coherent session.
    await saveStoredSession({
      active: true,
      tabId,
      mimeType: activeMimeType,
      startedAt: Date.now(),
    });
    if (stale()) return superseded();
    lastError = undefined;
    return { ok: true, mimeType: result.mimeType };
  } catch (err) {
    // A newer start or stop owns the state; clearing it here would zero
    // `activeTabId` out from under a capture that is already running, and
    // `closeOffscreenIfIdle` would then close ITS document.
    if (stale()) return superseded();
    const reason = err instanceof Error ? err.message : 'unknown';
    lastError = reason;
    activeTabId = null;
    activeMimeType = undefined;
    await clearStoredSession();
    return { ok: false, error: reason };
  } finally {
    oneShotRefs = Math.max(0, oneShotRefs - 1);
    // Released AFTER the session is recorded: the normal success path ends
    // with a stored session, so the close attempt returns early.
    void closeOffscreenIfIdle();
  }
}

/**
 * A start whose token was superseded (a stop, or another start, ran while it
 * was awaiting) reports failure WITHOUT touching shared state: whoever
 * superseded it owns the session, the flags and the document now.
 */
function superseded(): { ok: false; error: string } {
  return { ok: false, error: 'capture start superseded' };
}

export async function stopAudioCapture(): Promise<void> {
  // BUMP first, not read: a start still awaiting its round trip holds the
  // OLD token, so it reads itself stale, sends the OFFSCREEN_STOP for the
  // capture it had just started, and leaves the flags alone (they belong to
  // this call). Reading instead of bumping let a stop during a start be
  // pre-empted by the state the start wrote afterwards: the tab kept
  // recording while the UI said it had stopped.
  captureToken += 1;
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
    void closeOffscreenIfIdle();
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
   *  - `'wav'`: 16 kHz mono PCM. returned on the pcm field when the caller asks for it.
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

/**
 * Status plus which PCM path is filling the ring buffer — and the rates that
 * path declared, for the AudioWorklet pitch diagnostic.
 *
 * Only the E2E bridge asks for this. It exists because the AudioWorklet /
 * ScriptProcessor equivalence test has to know it compared the two paths it
 * claims to compare: without the path reported back, a forced path that
 * silently fell back would be measured as its twin and the parity number
 * would be meaningless.
 */
export async function getAudioCaptureStatusWithPath(): Promise<AudioCaptureStatus & {
  pcmPath?: 'audio-worklet' | 'script-processor' | null;
  captureSampleRate?: number | null;
  bufferedPcmChunks?: number;
  chunkSampleRate?: number | null;
  chunkLength?: number | null;
  workletBlocksSeen?: number | null;
  workletFirstError?: string | null;
}> {
  const status = await getAudioCaptureStatus();
  const offscreen = await getOffscreenRecorderStatus();
  return { ...status, ...offscreen };
}
