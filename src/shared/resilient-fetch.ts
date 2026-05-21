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
 *  - Per-attempt timeout (default 60s). If the server stops sending bytes
 *    for longer than `staleTimeoutMs` (default 15s), the attempt is aborted.
 *  - Optional `onProgress(received, total)` callback fired on each chunk.
 *  - Network errors and HTTP 5xx trigger a retry. HTTP 4xx (client errors)
 *    fail immediately — retrying won't help.
 *
 * Returns the full response as an ArrayBuffer. For very large files (>50 MB)
 * callers should be aware that this allocates the full buffer in memory.
 */

export interface ResilientFetchOptions {
  maxRetries?: number;
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
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_STALE_TIMEOUT_MS = 15_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MULTIPLIER = 3;

export async function fetchWithRetry(
  url: string,
  options: ResilientFetchOptions = {},
): Promise<ArrayBuffer> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleTimeoutMs = options.staleTimeoutMs ?? DEFAULT_STALE_TIMEOUT_MS;
  const onProgress = options.onProgress;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (attempt > 0) {
      const delay = BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, attempt - 1);
      await sleep(delay);
    }
    try {
      const result = await fetchOnce(url, timeoutMs, staleTimeoutMs, onProgress);
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
  timeoutMs: number,
  staleTimeoutMs: number,
  onProgress?: (received: number, total: number) => void,
): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const overallTimer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!response.ok) {
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

    const resetStaleTimer = () => {
      if (staleTimer) clearTimeout(staleTimer);
      staleTimer = setTimeout(() => {
        controller.abort();
      }, staleTimeoutMs);
    };

    resetStaleTimer();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        resetStaleTimer();
        onProgress?.(received, total);
      }
    }

    if (staleTimer) clearTimeout(staleTimer);

    const merged = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged.buffer;
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new FetchAbortedError(
        `La descarga se agotó después de ${Math.round(timeoutMs / 1000)}s o el servidor dejó de responder.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(overallTimer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
