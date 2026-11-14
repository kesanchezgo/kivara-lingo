/**
 * ISOLATED-world side of the Netflix playback bridge (docs/REDESIGN-V2.md
 * §4.5, §3 H2).
 *
 * The Netflix player lives in the page's MAIN world. Its API —
 * `netflix.appContext.state.playerApp.getAPI().videoPlayer` — is the only way
 * to move the playhead without interrupting playback (M7375). This module
 * posts a command over `window.postMessage` (the same channel the subtitle
 * interceptor already uses), and waits for the MAIN script's answer.
 *
 * The nonce on `<html data-kivara-nonce>` is required on both directions.
 * The page can read it, so this is a bar-raiser against stray messages, not a
 * cryptographic boundary — the same trade-off documented in
 * `intercepted-bus.ts`.
 */

const CMD_EVENT = 'kivara-lingo:playback';
const RESULT_EVENT = 'kivara-lingo:playback-result';
const DEFAULT_TIMEOUT_MS = 1500;

interface PendingSeek {
  resolve: (data?: unknown) => void;
  reject: (error: Error) => void;
  timer: number;
}

const pending = new Map<string, PendingSeek>();
let counter = 0;
let listening = false;

function currentNonce(): string {
  return document.documentElement.getAttribute('data-kivara-nonce') ?? '';
}

function ensureListener(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data as
      | { source?: unknown; id?: unknown; nonce?: unknown; ok?: unknown; error?: unknown; data?: unknown }
      | null;
    if (!data || typeof data !== 'object' || data.source !== RESULT_EVENT) return;
    if (data.nonce !== currentNonce()) return;
    if (typeof data.id !== 'string') return;
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    window.clearTimeout(entry.timer);
    if (data.ok === true) entry.resolve(data.data);
    else entry.reject(new Error(typeof data.error === 'string' ? data.error : 'seek refused'));
  });
}

/**
 * Ask the MAIN world to seek. Rejects when the MAIN world does not answer in
 * time (no player API yet, e.g. before the watch page booted) — the caller
 * shows "not seekable" and playback keeps going.
 */
function playbackCommand<T = unknown>(command: Record<string, unknown>, timeoutMs: number): Promise<T> {
  ensureListener();
  const nonce = currentNonce();
  if (!nonce) return Promise.reject(new Error('playback bridge not ready'));
  const id = `p${(++counter).toString(36)}${Date.now().toString(36)}`;
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id);
      reject(new Error('player API did not answer'));
    }, timeoutMs);
    pending.set(id, { resolve: (data) => resolve(data as T), reject, timer });
    try {
      window.postMessage({ source: CMD_EVENT, id, nonce, ...command }, '*');
    } catch (err) {
      pending.delete(id);
      window.clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export function seekThroughMainWorld(timeMs: number, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
  return playbackCommand({ cmd: 'seek', timeMs }, timeoutMs);
}

/**
 * Point 3: set the playback rate through the platform's own API. Rejects when
 * there is no nonce (generic hosts), no MAIN answer in time, or the MAIN side
 * has no rate API — the caller falls back to the element in every case.
 */
export function rateThroughMainWorld(rate: number, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
  return playbackCommand({ cmd: 'rate', rate }, timeoutMs);
}

/** Test seam: drop every pending request (module reloads in unit tests). */
export function resetPlaybackBridgeForTests(): void {
  for (const entry of pending.values()) window.clearTimeout(entry.timer);
  pending.clear();
  counter = 0;
}

/**
 * Point 5: the player's own metadata for the current video. `title` is what
 * the MAIN world sees for the session; `videoId` identifies the stream.
 */
export function mediaThroughMainWorld(
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ videoId?: string; title?: string }> {
  return playbackCommand<{ videoId?: string; title?: string }>({ cmd: 'media' }, timeoutMs)
    .then((data) => ({ videoId: data?.videoId, title: data?.title }));
}
