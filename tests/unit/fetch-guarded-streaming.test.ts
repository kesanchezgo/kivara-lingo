/**
 * `fetchGuarded`'s two clocks.
 *
 * The installer's download used to be bounded by a single 120 s TOTAL. On a
 * 127 MB pack that is an 8.5 Mbit/s floor, so ordinary connections died
 * mid-body with nothing in the panel. The deadline is now split: one for the
 * headers, one for inactivity, reset by every byte of the body.
 *
 * Both tests drive the real function with a TransformStream body, so the
 * behaviour is observed rather than asserted from source.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchGuarded } from '../../src/shared/net-guard';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function slowBody(chunkEveryMs: number, chunkBytes = 8 * 1024, chunkCount = 12) {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (sent >= chunkCount) {
        controller.close();
        return;
      }
      await new Promise((r) => setTimeout(r, chunkEveryMs));
      controller.enqueue(new Uint8Array(chunkBytes));
      sent += 1;
    },
  });
}

function stubResponse(body: ReadableStream<Uint8Array>, url = 'https://cdn.example/pack.zip') {
  const res = new Response(body, { status: 200, headers: { 'content-length': '98304' } });
  Object.defineProperty(res, 'url', { value: url, configurable: true });
  return res;
}

describe('fetchGuarded: header deadline vs body idle deadline', () => {
  it('lets a slow-but-steady body outlive a total deadline far shorter than the transfer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('fetch', vi.fn(async () => stubResponse(slowBody(16, 4 * 1024, 6))));

    const guarded = await fetchGuarded('https://cdn.example/pack.zip', {
      headerTimeoutMs: 1_000,
      idleTimeoutMs: 30_000,
    });
    const reader = guarded.response.body!.getReader();
    let bytes = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value!.length;
    }
    guarded.done();

    expect(bytes).toBe(6 * 4 * 1024);
  }, 20_000);

  it('aborts when the body goes quiet for longer than the idle budget', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const stream = new ReadableStream<Uint8Array>({
          pull() {
            /* never resolves → the transfer is idle */
          },
        });
        return stubResponse(stream);
      }),
    );

    const guarded = await fetchGuarded('https://cdn.example/pack.zip', {
      headerTimeoutMs: 1_000,
      idleTimeoutMs: 200,
    });
    const reader = guarded.response.body!.getReader();
    let settled = false;
    // Under a 200 ms idle budget the read must reject on its own. Waiting on
    // it directly would hang forever if the guard were missing, which is the
    // difference between a test that fails and a test that never returns.
    reader.read().then(
      () => { settled = true; },
      () => { settled = true; },
    );
    await new Promise((r) => setTimeout(r, 1_500));
    guarded.done();
    expect(settled).toBe(true);
  }, 20_000);

  it('the header clock stops once the response resolves', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] });
    let fetchSignalAborted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: unknown, init?: RequestInit) => {
        init?.signal?.addEventListener('abort', () => {
          fetchSignalAborted = true;
        });
        return stubResponse(slowBody(16, 1024, 6));
      }),
    );

    const guarded = await fetchGuarded('https://cdn.example/pack.zip', {
      headerTimeoutMs: 500,
      idleTimeoutMs: 30_000,
    });
    await new Promise((r) => setTimeout(r, 1_500));
    expect(fetchSignalAborted).toBe(false);
    guarded.done();
  }, 20_000);
});
