/**
 * Resilient fetch with automatic retries, timeout, and progress reporting.
 *
 * Designed for dictionary pack downloads where:
 *  - The CDN can be temporarily unreachable (R2 cold starts, user on mobile)
 *  - The user's connection can drop mid-download (WiFi handoff, subway)
 *  - Packs range from 1.5 MB to 127 MB — progress feedback matters
 *
 * Behaviour:
 *  - Up to `maxRetries` attempts (default 3) with exponential backoff
 *    (1s → 3s → 9s between retries).
 *  - `headerTimeoutMs` bounds the RESPONSE HEADERS only (default 60s). The
 *    body has no total deadline: if the server stops sending bytes for
 *    longer than `staleTimeoutMs` (default 15s) the attempt is aborted —
 *    which is what a stall actually is. The old per-attempt TOTAL timeout
 *    made a 127 MB pack unrescuable on anything but a fast link, and every
 *    retry restarted from byte 0.
 *  - Optional `onProgress(received, total)` callback fired on each chunk.
 *  - Network errors and HTTP 5xx trigger a retry. HTTP 4xx (client errors)
 *    fail immediately — retrying won't help.
 *
 * Returns the full response as an ArrayBuffer. For very large files (>50 MB)
 * callers should be aware that this allocates the full buffer in memory.
 */

export interface ResilientFetchOptions {
  maxRetries?: number;
  /**
   * Deadline for the RESPONSE HEADERS. The body is not covered by it: a pack
   * that streams for an hour on a slow link is a healthy transfer, and
   * bounding it made the EN→EN download fail on any ordinary connection.
   */
  headerTimeoutMs?: number;
  /** @deprecated use `headerTimeoutMs` — the old name implied body coverage. */
  timeoutMs?: number;
  staleTimeoutMs?: number;
  onProgress?: (receivedBytes: number, totalBytes: number) => void;
}

export class FetchAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchAbortedError';
  }
}

export class FetchHttpError extends Error {
  status: number;
  constructor(status: number, statusText: string) {
    super(`HTTP ${status} ${statusText}`);
    this.name = 'FetchHttpError';
    this.status = status;
  }
}

const DEFAULT_MAX_RETRIES = 3;
/** Headers must arrive within this; the body is bounded by inactivity. */
const DEFAULT_HEADER_TIMEOUT_MS = 60_000;
const DEFAULT_STALE_TIMEOUT_MS = 15_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MULTIPLIER = 3;

export async function fetchWithRetry(
  url: string,
  options: ResilientFetchOptions = {},
): Promise<ArrayBuffer> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const headerTimeoutMs = options.headerTimeoutMs ?? options.timeoutMs ?? DEFAULT_HEADER_TIMEOUT_MS;
  const staleTimeoutMs = options.staleTimeoutMs ?? DEFAULT_STALE_TIMEOUT_MS;
  const onProgress = options.onProgress;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (attempt > 0) {
      const delay = BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, attempt - 1);
      await sleep(delay);
    }
    try {
      const result = await fetchOnce(url, headerTimeoutMs, staleTimeoutMs, onProgress);
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (err instanceof FetchHttpError && err.status >= 400 && err.status < 500) {
        throw err;
      }
      if (attempt < maxRetries) {
        console.warn(
          `[Kivara Lingo] fetch attempt ${attempt + 1}/${maxRetries + 1} failed for ${url}: ${lastError.message}. Retrying...`,
        );
      }
    }
  }
  throw lastError ?? new Error('Fetch failed after all retries');
}

async function fetchOnce(
  url: string,
  headerTimeoutMs: number,
  staleTimeoutMs: number,
  onProgress?: (received: number, total: number) => void,
): Promise<ArrayBuffer> {
  const controller = new AbortController();
  // HEADER deadline only. `fetch` clears its own clock the moment the
  // response resolves, so everything that follows — reader.read(), the body
  // — is unbounded. This used to cover the whole transfer, which put a 120 s
  // ceiling on the EN→EN pack (127 MB) and aborted it mid-stream at anything
  // under 8.5 Mbit/s, restarting every retry from byte 0. The floor is
  // inactivity, re-armed below on EVERY chunk received.
  const headerTimer = setTimeout(() => controller.abort(), headerTimeoutMs);
  // Recorded so the catch can say WHICH clock fired (see the abort message).
  let staleFired = false;

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
    });
    // Headers are in — from here only inactivity can kill this attempt.
    clearTimeout(headerTimer);

    if (!response.ok) {
      // Release the connection BEFORE the caller retries: a 5xx body nobody
      // reads stays attached until GC, and the retry then waits on a socket
      // the client still considers busy on its side.
      void response.body?.cancel().catch(() => {});
      throw new FetchHttpError(response.status, response.statusText);
    }

    const contentLength = parseInt(response.headers.get('content-length') ?? '0', 10);
    const total = contentLength > 0 ? contentLength : 0;

    if (!response.body) {
      const buf = await response.arrayBuffer();
      onProgress?.(buf.byteLength, buf.byteLength);
      return buf;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    let staleTimer: ReturnType<typeof setTimeout> | null = null;
    let idleReject: (() => void) | null = null;

    /** Re-arm: the timer now refuses the CURRENT read rather than only
     *  aborting the controller. Relying on `controller.abort()` alone cannot
     *  break a body that has already been handed over (and, in tests, a
     *  synthetic stream is bound to no controller at all), so the read is
     *  raced against the idle promise explicitly. */
    const armStaleTimer = () => {
      if (staleTimer) clearTimeout(staleTimer);
      staleTimer = setTimeout(() => {
        staleFired = true;
        controller.abort();
        idleReject?.();
      }, staleTimeoutMs);
    };

    // NOT cleaned up by hand on every exit path: the `finally` covers a throw
    // out of the read too, which is how the previous version leaked an armed
    // timer (and a controller that could abort a retry already waiting on its
    // backoff).
    armStaleTimer();

    try {
      while (true) {
        idleReject = null;
        const idle = new Promise<never>((_resolve, reject) => {
          idleReject = () => reject(new Error(`no bytes for ${staleTimeoutMs} ms`));
        });
        const { done, value } = await Promise.race([reader.read(), idle]);
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.byteLength;
          armStaleTimer();
          onProgress?.(received, total);
        }
      }
    } finally {
      if (staleTimer) clearTimeout(staleTimer);
      staleTimer = null;
      idleReject = null;
    }

    const merged = new Uint8Array(received);
    {
      let offset = 0;
      for (let i = 0; i < chunks.length; i += 1) {
        merged.set(chunks[i], offset);
        offset += chunks[i].byteLength;
        chunks[i] = new Uint8Array(0); // release each copy as it is copied
      }
    }
    return merged.buffer;
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      // The original message from a bare `abort()` is "signal is aborted
      // without reason", which told the user nothing about which clock fired.
      // Both cases are named, and the idle one points at the connection
      // rather than at the request.
      const stalled = staleFired;
      throw new FetchAbortedError(
        stalled
          ? `La descarga se detuvo: el servidor dejó de enviar datos durante más de ${Math.round(staleTimeoutMs / 1000)} s. Comprueba la conexión y vuelve a intentarlo.`
          : `El servidor no respondió en ${Math.round(headerTimeoutMs / 1000)} s. Vuelve a intentarlo.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(headerTimer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
