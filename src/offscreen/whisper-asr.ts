/**
 * Whisper.cpp WASM transcription, scaffolded for the offscreen document.
 *
 * Why a runtime loader instead of an npm dep?
 *  - The user explicitly forbade adding new npm packages.
 *  - Whisper.cpp ships a self-contained WASM module that is loaded by a
 *    tiny JS glue. We host both behind an HTTPS URL (jsdelivr CDN of the
 *    upstream `whisper.cpp` repo by default) so no build-time bundling is
 *    needed. The user can swap the URL in Settings later.
 *  - The ggml model (`ggml-tiny.en.bin`, ~75 MB) is fetched once and
 *    persisted in the browser's `Cache` storage so subsequent loads are
 *    instant.
 *
 * Threading & cost
 *  - We run inside the offscreen document, off the main thread, so a
 *    transcription pass doesn't block the user's playback.
 *  - Transcription cost on a recent laptop CPU: tiny.en ≈ 2 s for a 3 s
 *    clip. Good enough for "the platform didn't expose subtitles, fall
 *    back to ASR on the captured audio" — i.e. one cue at a time.
 *
 * What this file owns
 *  - Loading and caching the WASM glue + ggml model.
 *  - A `transcribePcm(samples, sampleRate, lang)` entry point that takes
 *    16 kHz mono PCM (exactly what `audio-encoder.ts` produces) and
 *    returns the recognised text plus rough word-level timings.
 *  - All errors are surfaced as `{ ok: false, error }` so the caller can
 *    keep the rest of the card creation path working (subtitles missing
 *    is only a soft failure).
 */

import { encodeWavMono } from './audio-encoder';
import {
  WHISPER_MODEL_PRESETS,
  modelKeyForUrl,
  type WhisperModelKey,
} from '../shared/whisper-presets';

export { WHISPER_MODEL_PRESETS, type WhisperModelKey };

/**
 * Per-model download progress (0–1) reported by `fetchModel`. Subscribers
 * are notified as the response stream is read so the SettingsTab can
 * render a progress bar during the first download. Subsequent loads from
 * `Cache Storage` are instant (they emit a single 1.0 tick).
 */
export type ModelProgressListener = (info: {
  modelKey: WhisperModelKey | null;
  loadedBytes: number;
  totalBytes: number;
  fraction: number;
  cached: boolean;
  done: boolean;
}) => void;

const progressListeners = new Set<ModelProgressListener>();

export function onModelProgress(listener: ModelProgressListener): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

function emitProgress(info: Parameters<ModelProgressListener>[0]): void {
  for (const listener of progressListeners) {
    try {
      listener(info);
    } catch {
      /* never let a listener break the load */
    }
  }
}

export interface WhisperConfig {
  /** URL of the `whisper.cpp` JS glue (e.g. main.js or whisper.js) */
  glueUrl: string;
  /** URL of the ggml model file. Default: tiny.en quantised */
  modelUrl: string;
  /** Optional cache name override */
  cacheName?: string;
  /** Optional language hint (BCP-47). Default: 'auto' (whisper detects) */
  language?: string;
}

export interface WhisperSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface WhisperTranscription {
  ok: true;
  text: string;
  segments: WhisperSegment[];
  language?: string;
}

export interface WhisperError {
  ok: false;
  error: string;
  /** Whether the error is recoverable on retry (e.g. transient fetch failure) */
  transient?: boolean;
}

export type WhisperResult = WhisperTranscription | WhisperError;

/**
 * Conservative defaults. We DO NOT ship a Whisper glue ourselves — the
 * upstream whisper.cpp repository does not publish a stable
 * browser-loadable `whisper.js` file that exposes `globalThis.WhisperModule`
 * at the URL we pin (the previous default of `libmain.worker.js` is a
 * Web Worker entry, not a `Module` factory, and would fail to `init()`).
 *
 * Instead, ASR is opt-in: the user must point `AsrSettings.glueUrl` at a
 * compatible build and `AsrSettings.modelUrl` at a `.bin` mirror. See
 * `README.md → ASR`.
 *
 * STATUS (audit 2026-10-09), so nobody has to rediscover it: as long as the
 * glue lives on a REMOTE URL, this cannot work in a Manifest V3 build — the
 * extension-page CSP is `script-src 'self'`, so `<script src="https://…">` is
 * refused before the request leaves. The path that WOULD work is shipping
 * glue + WASM inside `dist/` (self-hosted), which is a packaging decision
 * (zip size, wasm build) and deliberately not taken here. Until then the
 * feature fails with that exact reason instead of a generic load error, and
 * the orchestrator skips the ASR fallback.
 */
const DEFAULT_CONFIG: WhisperConfig = {
  glueUrl: '',
  modelUrl: '',
  cacheName: 'kivara-lingo-whisper-v1',
};

let activeConfig: WhisperConfig = { ...DEFAULT_CONFIG };
let modulePromise: Promise<WhisperModule> | null = null;
let modelBufferPromise: Promise<ArrayBuffer> | null = null;

/** Drop the loaded module, asking the glue to release its native memory. */
function releaseModule(): void {
  if (modulePromise) {
    // `free()` exists only on the C++ glue builds; ignore the rest.
    void modulePromise
      .then((mod) => mod.free?.())
      .catch(() => {});
  }
  modulePromise = null;
}

export function setWhisperConfig(partial: Partial<WhisperConfig>): void {
  const next: WhisperConfig = { ...activeConfig, ...partial };
  // Only a change of URL (or cache namespace) can require re-reading the
  // ~75 MB model. This setter used to invalidate on EVERY transcription,
  // which is what a caller passing its config each time produced: a fresh
  // fetch + parse per clip, and the native module reallocated with it.
  const urlsChanged =
    next.glueUrl !== activeConfig.glueUrl ||
    next.modelUrl !== activeConfig.modelUrl ||
    next.cacheName !== activeConfig.cacheName;
  activeConfig = next;
  if (!urlsChanged) return;
  releaseModule();
  modelBufferPromise = null;
}

export function getWhisperConfig(): WhisperConfig {
  return { ...activeConfig };
}

/**
 * Tear down the cached module and model. Useful when the user toggles
 * ASR off so we release the ~75 MB ArrayBuffer — and the native buffers the
 * glue allocated inside it, which dropping the reference alone does not free.
 */
export function unloadWhisper(): void {
  releaseModule();
  modelBufferPromise = null;
}

interface WhisperModule {
  init(modelData: Uint8Array): boolean;
  /** Returns the transcribed text (joined segments). */
  fullDefault(samples: Float32Array, lang: string, translate: boolean, threads: number): string;
  /** Optional: returns segments if the glue exposes them */
  getSegments?: () => Array<{ start: number; end: number; text: string }>;
  free?: () => void;
}

/**
 * Fetch the ggml model, caching it in the browser's Cache Storage so the
 * ~75 MB download only happens once per origin. We avoid IndexedDB here
 * because Cache Storage exposes a `Request`/`Response` API that is much
 * cheaper for large binary payloads (no JSON serialisation).
 */
async function fetchModel(): Promise<ArrayBuffer> {
  if (modelBufferPromise) return modelBufferPromise;
  if (!activeConfig.modelUrl) {
    return Promise.reject(
      new Error(
        'Whisper model URL is not configured. Set AsrSettings.modelUrl in Settings → ASR.',
      ),
    );
  }
  const url = activeConfig.modelUrl;
  const modelKey = modelKeyForUrl(url);
  const expectedSize =
    modelKey != null ? WHISPER_MODEL_PRESETS[modelKey].sizeBytes : 0;

  const promise = (async () => {
    const cacheName = activeConfig.cacheName ?? DEFAULT_CONFIG.cacheName!;
    const cache = await caches.open(cacheName);
    const req = new Request(url, { cache: 'force-cache' });
    let res = await cache.match(req);

    if (res) {
      // Cache hit — emit a single 100 % tick so the UI knows we're done.
      emitProgress({
        modelKey,
        loadedBytes: expectedSize,
        totalBytes: expectedSize,
        fraction: 1,
        cached: true,
        done: true,
      });
      return res.arrayBuffer();
    }

    res = await fetch(url, { mode: 'cors' });
    if (!res.ok) {
      throw new Error(`Whisper model HTTP ${res.status} (${url})`);
    }

    // Stream the body so we can report progress for the (potentially large)
    // download. If the server doesn't send Content-Length we fall back to
    // the preset's expected size.
    const headerLength = Number(res.headers.get('content-length') ?? 0);
    const totalBytes = headerLength > 0 ? headerLength : expectedSize;
    const reader = res.body?.getReader();
    if (!reader) {
      // No streaming support — fall back to a single-shot read.
      emitProgress({ modelKey, loadedBytes: 0, totalBytes, fraction: 0, cached: false, done: false });
      const buffer = await res.arrayBuffer();
      try {
        await cache.put(req, new Response(buffer));
      } catch (err) {
        console.warn('[Kivara Lingo] could not cache Whisper model', err);
      }
      emitProgress({
        modelKey,
        loadedBytes: buffer.byteLength,
        totalBytes: buffer.byteLength,
        fraction: 1,
        cached: false,
        done: true,
      });
      return buffer;
    }

    const chunks: Uint8Array[] = [];
    let received = 0;
    emitProgress({ modelKey, loadedBytes: 0, totalBytes, fraction: 0, cached: false, done: false });
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        const fraction = totalBytes > 0 ? Math.min(1, received / totalBytes) : 0;
        emitProgress({
          modelKey,
          loadedBytes: received,
          totalBytes,
          fraction,
          cached: false,
          done: false,
        });
      }
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      await cache.put(req, new Response(merged.buffer));
    } catch (err) {
      console.warn('[Kivara Lingo] could not cache Whisper model', err);
    }
    emitProgress({
      modelKey,
      loadedBytes: received,
      totalBytes: received,
      fraction: 1,
      cached: false,
      done: true,
    });
    return merged.buffer;
  })();
  modelBufferPromise = promise;
  promise.catch(() => {
    modelBufferPromise = null;
  });
  return promise;
}

/**
 * Dynamically load the whisper.cpp glue and initialise a Module instance.
 *
 * We use `import()` with a string URL — Vite leaves that alone and the
 * browser handles the fetch. The expected upstream glue exposes a
 * `Module` factory at `globalThis.WhisperModule` once loaded. If a
 * different glue is configured, the caller is expected to provide a
 * compatible API shape.
 */
async function loadModule(): Promise<WhisperModule> {
  if (modulePromise) return modulePromise;
  if (!activeConfig.glueUrl) {
    return Promise.reject(
      new Error(
        'Whisper glue URL is not configured. Set AsrSettings.glueUrl in Settings → ASR.',
      ),
    );
  }
  const promise = (async () => {
    const [modelBuffer] = await Promise.all([fetchModel()]);
    await injectGlueScript(activeConfig.glueUrl);

    const factory = (
      globalThis as unknown as {
        WhisperModule?: () => Promise<WhisperModule>;
        Module?: WhisperModule;
      }
    );

    // Some glue builds expose a synchronous `Module`; others expose a
    // promise-returning factory at `WhisperModule()`. Cover both shapes
    // without forcing the user to ship a custom glue.
    const mod = factory.WhisperModule
      ? await factory.WhisperModule()
      : factory.Module;

    if (!mod || typeof mod.init !== 'function') {
      throw new Error('Whisper glue did not expose a compatible Module instance');
    }
    const ok = mod.init(new Uint8Array(modelBuffer));
    if (!ok) throw new Error('Whisper Module.init returned false');
    return mod;
  })();

  modulePromise = promise;
  promise.catch(() => {
    modulePromise = null;
  });
  return promise;
}

/**
 * Inject the glue `<script>` once. Re-uses an in-flight load instead of
 * stacking script tags. Inside an offscreen document `document` is the
 * regular page DOM, so `appendChild(script)` works just like on a normal
 * web page.
 */
const injectedGlue = new Map<string, Promise<void>>();
function injectGlueScript(url: string): Promise<void> {
  const cached = injectedGlue.get(url);
  if (cached) return cached;
  const promise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[data-kl-whisper="${url}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.dataset.klWhisper = url;
    script.onload = () => resolve();
    /**
     * MV3 extension pages (including this offscreen document) run under
     * `script-src 'self'`, so a REMOTE glue is refused by CSP before the
     * request even leaves. That is not fixable from here: making local ASR
     * work requires shipping the glue + WASM inside `dist/` and loading them
     * from the extension's own origin. Saying so beats the generic
     * "Failed to load" that used to appear.
     */
    script.onerror = () =>
      reject(
        new Error(
          `No se pudo cargar el glue de Whisper: ${url}. ` +
            'Las páginas de extensión MV3 solo permiten scripts propios ' +
            `(script-src 'self'): el glue y el WASM deben empaquetarse ` +
            'dentro de la extensión para que el ASR funcione sin conexión.',
        ),
      );
    document.head.appendChild(script);
  });
  injectedGlue.set(url, promise);
  promise.catch(() => injectedGlue.delete(url));
  return promise;
}

/**
 * Run transcription on a 16 kHz mono PCM buffer.
 *
 * The current upstream glue accepts Float32 PCM directly, so we don't
 * need to re-encode. If a future glue requires a WAV file, the second
 * argument exposes `audio-encoder.encodeWavMono(samples, 16_000)` for
 * convenience.
 */
export async function transcribePcm(
  samples: Float32Array,
  sampleRate: number,
  language: string = 'auto',
): Promise<WhisperResult> {
  if (sampleRate !== 16_000) {
    return {
      ok: false,
      error: `Whisper expects 16 kHz PCM, got ${sampleRate}`,
    };
  }
  if (!samples.length) {
    return { ok: false, error: 'Empty audio buffer' };
  }

  try {
    const mod = await loadModule();
    const text = mod.fullDefault(samples, language, false, navigator.hardwareConcurrency || 2);
    const segments = mod.getSegments
      ? mod.getSegments().map((s) => ({
          startMs: Math.round(s.start * 1000),
          endMs: Math.round(s.end * 1000),
          text: s.text,
        }))
      : [];
    return {
      ok: true,
      text: text.trim(),
      segments,
      language,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: message,
      transient: /HTTP|network|Failed to fetch/i.test(message),
    };
  }
}

/**
 * Re-export so the audio-processor can encode the trimmed clip as WAV for
 * Anki even when only PCM is needed for Whisper.
 */
export { encodeWavMono };
