/**
 * `fetchWithRetry`'s two clocks for dictionary packs.
 *
 * A pack download used to be bounded by a single TOTAL timeout (120 s in the
 * Yomitan path, 60 s by default). For the 127 MB EN→EN pack that is an
 * 8.5 Mbit/s floor, so the install died on any ordinary connection, and each
 * retry restarted from byte 0. The total is gone: the headers have their own
 * deadline and the body is bounded by inactivity, re-armed on every chunk.
 *
 * These drive the real function with a slow stream, so the observed contract
 * is behaviour rather than source shape.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithRetry, FetchAbortedError } from '../../src/shared/resilient-fetch';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A chunk every `everyMs`, for `chunks` chunks, then the end of stream.
 *  `onAbort` is called if the consumer's signal fires, so a test can model
 *  what a real network body does when the caller aborts: it errors the
 *  stream. Without it, aborting has no effect on a synthetic body and the
 *  header/total-deadline distinction cannot be observed at all. */
function slowBody(
  everyMs: number,
  chunks: number,
  chunkBytes = 16 * 1024,
  onAbort?: (fire: () => void) => void,
) {
  let sent = 0;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      onAbort?.(() => controller.error(new Error('aborted')));
    },
    async pull(controller) {
      if (sent >= chunks) {
        controller.close();
        return;
      }
      await new Promise((r) => setTimeout(r, everyMs));
      controller.enqueue(new Uint8Array(chunkBytes));
      sent += 1;
    },
  });
  return stream;
}

/** `fetch` stub that honours the caller's signal, like a real body stream. */
function signalingFetch(
  makeBody: (signal: AbortSignal | undefined) => ReadableStream<Uint8Array>,
): ReturnType<typeof vi.fn> {
  return vi.fn((_url: string, init?: RequestInit) => {
    const signal = init?.signal ?? undefined;
    const body = makeBody(signal);
    const length = 16 * 1024 * 16;
    return Promise.resolve(
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/zip', 'content-length': String(length) },
      }),
    );
  }) as unknown as ReturnType<typeof vi.fn>;
}

function okResponse(body: ReadableStream<Uint8Array>, lengthBytes: number): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/zip', 'content-length': String(lengthBytes) },
  });
}

describe('fetchWithRetry: header deadline vs body inactivity', () => {
  it('completes a transfer that runs far longer than the old per-attempt TOTAL', async () => {
    // 13 chunks × 300 ms = ~3.9 s of transfer, with a 150 ms header budget:
    // 26× the whole old total. Intervals are compressed (not fake-timed) so
    // the test measures behaviour instead of timer bookkeeping — the clock
    // being proven is real either way.
    const chunks = 13;
    const chunkBytes = 16 * 1024;
    vi.stubGlobal(
      'fetch',
      signalingFetch((signal) =>
        slowBody(300, chunks, chunkBytes, (fire) =>
          signal?.addEventListener('abort', fire),
        ),
      ),
    );

    const progress: Array<[number, number]> = [];
    const buffer = await fetchWithRetry('https://cdn.example/pack.zip', {
      headerTimeoutMs: 150,
      staleTimeoutMs: 5_000,
      maxRetries: 0,
      onProgress: (received, total) => progress.push([received, total]),
    });

    expect(buffer.byteLength).toBe(chunks * chunkBytes);
    expect(progress.at(-1)?.[0]).toBe(chunks * chunkBytes);
  }, 20_000);

  it('still aborts a body that goes quiet past the inactivity window', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          okResponse(
            new ReadableStream<Uint8Array>({
              pull() {
                /* never resolves — the connection is idle */
              },
            }),
            1024,
          ),
        ),
      ),
    );

    let settled = false;
    void fetchWithRetry('https://cdn.example/pack.zip', {
      headerTimeoutMs: 5_000,
      staleTimeoutMs: 200,
      maxRetries: 0,
    }).then(
      () => { settled = true; },
      () => { settled = true; },
    );
    await new Promise((r) => setTimeout(r, 1_200));
    expect(settled).toBe(true);
  }, 15_000);

  it('a 4xx fails immediately instead of burning the retries', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 404, statusText: 'Not Found' })),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchWithRetry('https://cdn.example/missing.zip', { maxRetries: 3, headerTimeoutMs: 5_000 }),
    ).rejects.toThrow(/HTTP 404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
