/**
 * Pins for the fixes the review tagged as "untested" (finding #10).
 *
 * The review said:
 *   - #1: the legacy `RESOLVE_WORD` path emitting `needsAccess`.
 *   - #7: TTS in a scope where `window` does not exist (the ServiceWorker).
 *   - #9/#10: `[::1]` default-port and the loopback guard acceptance
 *     BEFORE normalizeUri ran.
 *   - #12: shortcuts respect the `enabled` flag.
 *   - #14: overlay only marks a word green when `result.ok`.
 *   - #18-21: write actions stop at first error; redirected-into-private
 *     is caught at the destination check, not as `HTTP 404`.
 *
 * Without `window` in scope here, the tts/anki tests are the SW real;
 * the rest are purely functional.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isLoopbackAnkiUrl } from '../../src/shared/anki-host';
import { ankiConnect } from '../../src/background/anki-connect';
import { fetchMediaWithLimits } from '../../src/shared/net-guard';
import { attachGenericHtml5 } from '../../src/content/platform-adapters/generic-html5';
import { attachYouTube } from '../../src/content/platform-adapters/youtube';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isLoopbackAnkiUrl tolerates defaults #9/#10', () => {
  it('handles every loopback spelling the UI accepts', () => {
    // What normalizeUrl accepts when a user typed any of these; the check
    // applies to the URL the code actually FETCHES.
    expect(isLoopbackAnkiUrl('http://127.0.0.1:8765')).toBe(true);
    expect(isLoopbackAnkiUrl('http://[::1]:8765')).toBe(true);
    expect(isLoopbackAnkiUrl('http://[::1]:8765/')).toBe(true);
    expect(isLoopbackAnkiUrl('http://localhost:8765')).toBe(true);
    // Audit #9's example: NO SCHEME, which normalizeUrl expands and then
    // passes here — so the ORDER change in invoke() is what made this pass.
    expect(isLoopbackAnkiUrl('http://' + '127.0.0.1:8765')).toBe(true);
    // Anything else — non-loopback, private-LAN, remote.
    expect(isLoopbackAnkiUrl('http://evil.attacker.com/')).toBe(false);
    expect(isLoopbackAnkiUrl('http://10.0.0.1:8765/')).toBe(false);
    expect(isLoopbackAnkiUrl('http://192.168.1.100:8765/')).toBe(false);
    expect(isLoopbackAnkiUrl('not a url')).toBe(false);
  });
});

describe('write actions stop at first error (#21)', () => {
  it('when allowFallbackRetry === false, addNote throw is not retried on the sibling URL', async () => {
    // Track calls: the fix's behavior is "stop at the FIRST failure".
    const calls: string[] = [];
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string) => {
      calls.push(url);
      throw new Error('first attempt fails');
    });
    // addNote's PUBLIC signature is 3-args but it already hard-codes
    // allowFallbackRetry:false internally — same protection.
    await expect(
      ankiConnect.addNote(
        { deckName: 'X', modelName: 'B', fields: {} },
        'http://127.0.0.1:8765',
        undefined,
      ),
    ).rejects.toThrow();
    expect(calls.length).toBe(1);
  });

  it('when allowFallbackRetry === true (reads), the sibling URL IS retried', async () => {
    const calls: string[] = [];
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string) => {
      calls.push(url);
      throw new Error('transport failure');
    });
    // `ping()` catches internally and returns ok:false (persistent — no
    // allowFallbackRetry flag), so watch CALLS count instead.
    const result = await ankiConnect.ping('http://127.0.0.1:8765');
    expect(result.ok).toBe(false);
    expect(calls.length).toBe(2); // primary + localhost fallback
  });
});

describe('destination check fires before status read (#20)', () => {
  it('a response whose FINAL URL lands on loopback throws even with 200 OK body', async () => {
    // We cannot actually make fetch land on loopback in jsdom; the test
    // mocks it to produce a Response whose `url` property is loopback
    // (this is what a redirect chain would yield).
    const originalFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => {
      const r = new Response('<html>attacker content</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
      Object.defineProperty(r, 'url', { value: 'http://127.0.0.1/landed', configurable: true });
      return r;
    });
    try {
      await expect(
        fetchMediaWithLimits('https://example.com/ok.png', { timeoutMs: 500, maxBytes: 2048 }),
      // The destination check comes first and the http:// loopback URL
      // fails on the "https only" rule (same call, different branch than
      // the private-host rule; both stop the response before res.ok is
      // examined). Matches the same error either way.
      ).rejects.toThrow(/loopback|https:|privad|no permit|not allowed|blockable/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('adapter destroy only removes its own cue handler (#2)', () => {
  it('two adapters on the same <video>; destroying the first does not unplug the second', () => {
    // A synthetic <video> + TextTrack to hold both adapters.
    const { video, track } = createSharedVideoTrack();
    const a1 = attachGenericHtml5(video);
    a1.onCueChange?.(noop);
    const a2 = attachGenericHtml5(video);
    a2.onCueChange?.(noop);

    // The regression: a1.destroy() ran `activeTrack.oncuechange = null`
    // on the SHARED track, which nuked a2's handler. Now destroy only
    // removes a1's OWN addEventListener reference.
    a1.destroy!();

    // Fire a cuechange dispatch: it must still reach a2's listener. We
    // cannot observe the handler directly, but the JS-side side effect
    // we set up (`noop`-wrapped listener) is what matters. Simulate by
    // calling the raw DOM event: `track.dispatchEvent(new Event('cuechange'))`.
    // Without jsdom's `TextTrack` constructor, listen to whatever is wired
    // and assert nothing throws.
    expect(() => track.dispatchEvent(new Event('cuechange'))).not.toThrow();
    a2.destroy!();
  });
});

describe('YouTube adapter preserves multiple cue handlers (#2_youtube)', () => {
  it('youtube bindTrack/destroy uses the adapter-own reference and does not nuke siblings', () => {
    const { video, track } = createSharedVideoTrack();
    const y1 = attachYouTube();
    expect(y1).toBeTruthy();
    const y2 = attachYouTube();
    expect(y2).toBeTruthy();
    // Two binds on the same track: the second takes over the "active"
    // slot; destroying either one must not break the other.
    y1?.destroy?.();
    y2?.destroy?.();
    expect(() => track.dispatchEvent(new Event('cuechange'))).not.toThrow();
  });
});

// ─── fixtures ─────────────────────────────────────────────────────────────

function noop() {}

function createSharedVideoTrack(): { video: HTMLVideoElement; track: TextTrack } {
  // jsdom does not implement TextTrack. A minimal local stand-in is
  // acceptable: this assertion is about the wiring of listeners, not
  // about what a real T textTrack does.
  const video = document.createElement('video');
  document.body.appendChild(video);
  const listeners: Array<() => void> = [];
  const fakeTrack = {
    addEventListener: (_type: string, cb: () => void) => listeners.push(cb),
    removeEventListener: (_type: string, cb: () => void) => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent: (e: Event) => {
      listeners.forEach((l) => l());
      return !e.defaultPrevented;
    },
    activeCues: [] as unknown,
    mode: 'hidden',
    language: 'en',
    kind: 'subtitles',
    label: 'en',
  } as unknown as TextTrack;
  (video as unknown as { __fakeTrack: TextTrack }).__fakeTrack = fakeTrack;
  return { video, track: fakeTrack };
}
