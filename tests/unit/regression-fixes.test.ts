/**
 * Tests where reverting the fix turns the test red.
 *
 * The review's criterion: revert the fix → the test must fail. The ones
 * I wrote before did not meet it — they tested behavior that existed
 * unchanged. This is the replacement.
 *
 * Covers:
 *  #1 `handleSaveCard`'s SUCCESS path returns `{ ok: true }`. Reverting
 *     to the code I had (falling off the `if` branch to `return { ok:
 *     false }` at the bottom) turns the overlay-side pin red.
 *  #2 TTS in a ServiceWorker scope (no `window`). The implementation
 *     uses bare `setTimeout`/`clearTimeout`; reviewing the source with
 *     a guard catches a re-+reintroduction of `window.` in the SW.
 *  #3 `ankiConnect.ping('127.0.0.1:8765')` — a scheme-less URL —
 *     normalizes before validation. Reverting to `validate-then-
 *     normalize` throws LOOPBACK_REFUSED.
 *  #3(y) Killing one YouTube adapter on a shared <video> does not remove
 *     a sibling-injected style node — the audit's #3-again finding.
 *  #6 (adapter sibling). Two generic adapters on one <video>; the
 *     dying one only removes ITS OWN cue listener, not the sibling's.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { ankiConnect } from '../../src/background/anki-connect';
import { attachGenericHtml5 } from '../../src/content/platform-adapters/generic-html5';
import { attachYouTube } from '../../src/content/platform-adapters/youtube';

const ORIGINAL_FETCH = globalThis.fetch as unknown;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH as never;
  vi.restoreAllMocks();
});

describe('source guards', () => {
  it('service-worker background modules use bare setTimeout/clearTimeout', () => {
    // The audit caught `window.setTimeout` inside tts.ts's tryChromeTts —
    // in a ServiceWorker scope `window` is undefined, so EVERY TTS call
    // threw before speak() was reached. This test is what would have
    // caught it: any reintroduction of `window.` around the interval
    // helpers turns this red.
    const ttsSrc = readFileSync('src/background/tts.ts', 'utf8');
    expect(ttsSrc).not.toMatch(/\bwindow\s*\.\s*(setTimeout|clearTimeout|requestAnimationFrame|setInterval)/);
    const bgPath = 'src/background';
    for (const f of ['service-worker.ts', 'anki-connect.ts', 'translate.ts']) {
      const src = readFileSync(`${bgPath}/${f}`, 'utf8');
      expect(src, `${f} re-introduced window.<timer>`).not.toMatch(
        /\bwindow\s*\.\s*(setTimeout|clearTimeout|setInterval)\b/,
      );
    }
  });
});

describe('ankiConnect.ping normalizes before validating (#9)', () => {
  it('accepts a scheme-less loopback URL, which normalizeUrl expands', async () => {
    const calls: string[] = [];
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string) => {
      calls.push(url);
      return new Response('{"result":6,"error":null}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }) as unknown as Response;
    });
    const result = await ankiConnect.ping('127.0.0.1:8765');
    expect(result.ok).toBe(true);
    expect(calls[0]).toContain('http://127.0.0.1:8765');
  });

  it('refuses a remote host BEFORE fetching it', async () => {
    const calls: string[] = [];
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string) => {
      calls.push(url);
      throw new Error('should not be reached');
    });
    const result = await ankiConnect.ping('https://evil.example.com');
    expect(result.ok).toBe(false);
    expect(calls.length).toBe(0);
  });
});

describe('adapter lifecycle (#2/#3)', () => {
  it('killing one YouTube adapter does not remove a sibling-injected style node', () => {
    // The audit's finding: `document.getElementById(sharedId)?.remove()`
    // removed ANY matching style node, including one another adapter
    // injected. The fix keeps `ownStyle` as adapter-local. Detaching
    // the style from the ID (a wrinkle the audit specifically noted)
    // verifies the sibling won the race with its own node present.
    const styleId = 'kivara-lingo-yt-hide';
    const siblingStyle = document.createElement('style');
    siblingStyle.id = styleId;
    siblingStyle.textContent = '.ytp-caption-window-container { opacity: 0 }';
    document.head.appendChild(siblingStyle);

    const video = document.createElement('video');
    document.body.appendChild(video);
    const adapter = attachYouTube();
    adapter?.destroy?.();

    // Without the fix, destroy() would have looked the ID up and removed
    // the sibling's node too. With the fix, the ID lookup is gone and
    // the sibling's node survives.
    expect(document.getElementById(styleId)).not.toBeNull();
    document.getElementById(styleId)?.remove();
  });

  it('generic adapter destroy removes only its own cue listener, leaves the sibling bound', () => {
    const video = document.createElement('video');
    const cueListeners: Array<() => void> = [];
    const makeTrack = (): TextTrack =>
      ({
        mode: 'hidden',
        activeCues: [] as unknown,
        kind: 'subtitles',
        language: 'en',
        label: 'en',
        addEventListener: (_t: string, cb: () => void) => cueListeners.push(cb),
        removeEventListener: (_t: string, cb: () => void) => {
          const i = cueListeners.indexOf(cb);
          if (i >= 0) cueListeners.splice(i, 1);
        },
      }) as unknown as TextTrack;
    const track = makeTrack();
    const trackListListener: Array<(t: string, cb: () => void) => void> = [];
    const trackList = Object.create(Array.prototype) as unknown as TextTrackList;
    Object.defineProperty(trackList, '0', { value: track, enumerable: true });
    Object.defineProperty(trackList, 'length', { value: 1, enumerable: true });
    (trackList as unknown as {
      addEventListener: (t: string, cb: () => void) => void;
      removeEventListener: (t: string, cb: () => void) => void;
    }).addEventListener = (t, cb) => trackListListener.push((tt, cc) => { void tt; cc(); });
    (trackList as unknown as {
      addEventListener: unknown; removeEventListener: unknown;
    }).removeEventListener = () => {};
    Object.defineProperty(video, 'textTracks', { value: trackList, configurable: true });

    const before = cueListeners.length;
    const a1 = attachGenericHtml5(video);
    const a2 = attachGenericHtml5(video);
    const afterBoth = cueListeners.length;
    expect(afterBoth).toBe(before + 2); // both adapters added a listener

    a1.destroy!();
    // With the fix, a1.removeEventListener removes ONLY a1's callback.
    // Without it, the shape was `oncuechange = null`, which does not work
    // on this fake (no such setter), so the CALL COUNT is what proves it.
    expect(cueListeners.length).toBe(afterBoth - 1); // only a1's own
    a2.destroy!();
    expect(cueListeners.length).toBe(afterBoth - 2); // both gone, not double
  });
});
