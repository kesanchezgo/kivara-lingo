/**
 * Per-call AI deadlines.
 *
 * One 5 s global made DALL-E (10–20 s typical) and Anthropic at 800
 * max_tokens fail every time — the toast said the call errored, and from
 * outside that reads as a dead API key. The chat calls get 30 s, the image
 * call 60 s, and these tests advance a request past the old 5 s wall to
 * prove nothing aborts there any more.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const REQ = {
  token: 'run',
  sentence: 'I had to run for the bus.',
  sourceLang: 'en',
  nativeLang: 'es',
} as const;

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ai-providers deadlines', () => {
  it('does not abort an Anthropic response that takes longer than the old 5 s wall', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        // Resolve after 8 s of virtual time: > 5000 < 30000. With the old
        // single 5 s timeout this aborted before the body existed.
        await new Promise((r) => setTimeout(r, 8_000));
        return jsonResponse({
          content: [
            { type: 'text', text: JSON.stringify({ contextualDefinition: 'correr' }) },
          ],
        });
      }),
    );
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const pending = (await import('../../src/background/ai-providers')).callAiProvider(REQ as never, {
      provider: 'anthropic',
      apiKey: 'sk-ant-x',
      model: 'claude-haiku-4-5',
    } as never);
    await vi.advanceTimersByTimeAsync(13_000);
    const result = await pending;

    expect(result.ok).toBe(true);
  });

  it('keeps a hard ceiling — a chat call still gives up at its own 30 s', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: unknown, init?: RequestInit) => {
        // Never resolve: only the abort can settle this.
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        });
      }),
    );
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const pending = (await import('../../src/background/ai-providers')).callAiProvider(REQ as never, {
      provider: 'anthropic',
      apiKey: 'sk-ant-x',
      model: 'claude-haiku-4-5',
    } as never);
    await vi.advanceTimersByTimeAsync(28_000);
    let settled: unknown;
    await Promise.race([pending.then((r) => { settled = r; }), Promise.resolve()]);
    expect(settled).toBeUndefined(); // still waiting at 28 s — the wall is not the old one
    await vi.advanceTimersByTimeAsync(3_000);
    const result = await pending;
    expect(result.ok).toBe(false);
  });

  it('gives the image call a longer budget than the chat calls', async () => {
    const mod = await import('../../src/background/ai-providers');
    expect(mod.AI_TIMEOUT_CHAT_MS).toBe(30_000);
    expect(mod.AI_TIMEOUT_IMAGE_MS).toBe(60_000);
    expect(mod.AI_TIMEOUT_IMAGE_MS).toBeGreaterThan(mod.AI_TIMEOUT_CHAT_MS);
  });
});
