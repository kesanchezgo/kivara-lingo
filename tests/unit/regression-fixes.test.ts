/**
 * Tests where reverting the fix turns the test red.
 *
 * The review's criterion: revert the fix → the test must fail. This
 * file is the replacement for the previous iteration that tested
 * unchanged behavior.
 *
 * Covers:
 *  #1 `handleSaveCard`'s SUCCESS path — see `overlay-save-flow.test.tsx`,
 *     which drives the real SubtitleOverlay save flow and asserts the
 *     token only paints the "saved" style when the promise resolved ok.
 *  #2 TTS in a ServiceWorker scope (no `window`). The implementation
 *     uses bare `setTimeout`/`clearTimeout`; reviewing the source with
 *     a guard catches a re-introduction of `window.` in the SW.
 *  #9 `ankiConnect.ping('127.0.0.1:8765')` — a scheme-less URL —
 *     normalizes-before-validating. Reverting to validate-then-normalize
 *     throws LOOPBACK_REFUSED.
 *  #3(y) Killing one YouTube adapter on a shared <video> does not remove
 *     a sibling-injected style node — the audit's #3-again finding. The
 *     same holds for the generic `createInterceptedAdapter` factory.
 *  #20 A response whose final `res.url` lands on loopback is refused
 *     before res.ok is examined (the destination-check-first rule).
 *  #21 A write (`allowFallbackRetry: false`) does NOT retry on the
 *     sibling URL — restoring this as the review specifically said.
 *  #6 (adapter sibling). Two generic adapters on one <video>; the dying
 *     one only removes ITS OWN cue listener, not the sibling's. The
 *     fake TextTrack records every addEventListener callback so
 *     destroying one adapter provably leaves the other bound.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { ankiConnect } from '../../src/background/anki-connect';
import { attachGenericHtml5 } from '../../src/content/platform-adapters/generic-html5';
import { attachYouTube } from '../../src/content/platform-adapters/youtube';
import { createInterceptedAdapter } from '../../src/content/platform-adapters/intercepted-adapter';
import { clearBus } from '../../src/content/platform-adapters/intercepted-bus';

// No global stash of `fetch` in afterEach: vitest.config now has
// `restoreMocks: true` + `unstubGlobals: true`, which unwrap
// vi.fn/vi.spyOn between tests automatically. Anything that mutates
// globalThis.fetch, though, needs explicit care — see the #20 test
// below which wraps the swap in try/finally.

// The adapter tests append real <video> elements to document.body; a
// leftover node leaks into the next test (and into any DOM-querying
// suite that runs after this file in the same worker).
afterEach(() => {
  document.querySelectorAll('video').forEach((v) => v.remove());
  document.querySelectorAll('style').forEach((s) => s.remove());
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
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      return new Response('{"result":6,"error":null}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }) as unknown as Response;
    }));
    const result = await ankiConnect.ping('127.0.0.1:8765');
    expect(result.ok).toBe(true);
    expect(calls[0]).toContain('http://127.0.0.1:8765');
  });

  it('refuses a remote host BEFORE fetching it', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      throw new Error('should not be reached');
    }));
    const result = await ankiConnect.ping('https://evil.example.com');
    expect(result.ok).toBe(false);
    expect(calls.length).toBe(0);
  });
});

describe('write actions do NOT fall back to sibling URL (#21)', () => {
  it('addNote fires exactly one fetch on write failure', async () => {
    // ping('127.0.0.1') tries localhost as a sibling fallback (2 calls).
    // addNote has `allowFallbackRetry: false` → exactly 1 call. Restoring
    // the old filter (which let everything past for non-TIMEOUT errors)
    // makes this go red with 2 calls.
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      throw new Error('transport failure');
    }));
    await expect(
      ankiConnect.addNote({ deckName: 'd', modelName: 'm', fields: { a: 'b' } }, 'http://127.0.0.1:8765'),
    ).rejects.toThrow();
    expect(calls.length).toBe(1);
  });

  it('read actions DO fall back to sibling URL for resilience', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      throw new Error('transport failure');
    }));
    const result = await ankiConnect.ping('http://127.0.0.1:8765');
    expect(result.ok).toBe(false);
    expect(calls.length).toBe(2); // primary + localhost sibling
  });
});

describe('destination-check-before-status-reads (#20)', () => {
  it('a redirect that landed on a private host is refused as a URL error, not as HTTP 404', async () => {
    // Constructed Response whose `url` is a private address (this is
    // shape-of a redirect chain's landing response). `fetchMediaWithLimits`
    // calls assertResponseDestination FIRST (with body-cancelled on
    // refusal); reverting to status-first means the 404 surfaces and the
    // fact that the body came back from a private host is never reported.
    vi.stubGlobal('fetch', vi.fn(async () => {
      const r = new Response(null, { status: 404 });
      Object.defineProperty(r, 'url', { value: 'http://127.0.0.1/landed', configurable: true });
      return r;
    }));
    const { fetchMediaWithLimits, UrlNotAllowedError } = await import('../../src/shared/net-guard');
    // Order-sensitive in the strict direction: the thrown error is the
    // destination refusal (`UrlNotAllowedError`), never the plain
    // `HTTP 404` a status-first implementation would raise.
    let caught: unknown = null;
    try {
      await fetchMediaWithLimits('https://example.com/ok.png', { timeoutMs: 500, maxBytes: 1024 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UrlNotAllowedError);
    expect((caught as Error).message).not.toMatch(/HTTP\s*404/i);
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

  it('intercepted adapter destroys only its own hide-native style, sibling stays connected', () => {
    // Same finding as the YouTube one, on the generic factory used by
    // Netflix / Disney+ / Max / Prime. `buildHideStyle` creates a fresh
    // <style> per adapter (no id); reverting to a shared-id find-and-
    // remove means the dying adapter strips the surviving one's node and
    // the native captions come back mid-navigation.
    clearBus();
    const before = document.querySelectorAll('style').length;

    const a1 = createInterceptedAdapter({
      platform: 'netflix',
      language: 'en',
      hideNativeCss: '.player-timedtext { display: none }',
    });
    const stylesAfterA1 = Array.from(document.querySelectorAll('style'));
    const a2 = createInterceptedAdapter({
      platform: 'netflix',
      language: 'en',
      hideNativeCss: '.player-timedtext { display: none }',
    });
    expect(document.querySelectorAll('style').length).toBe(before + 2);
    // The node a2 owns: the one that appeared, not one of the pre-existing
    // heads. Snapshot the live list so the assertion below is about a2's
    // concrete element — `document.querySelector('style')` would happily
    // answer about the FIRST style in the document, which is a false pass.
    const a2Style = Array.from(document.querySelectorAll('style')).find(
      (s) => !stylesAfterA1.includes(s),
    );
    expect(a2Style).toBeDefined();

    a1.destroy!();
    expect(document.querySelectorAll('style').length).toBe(before + 1);
    expect(a2Style!.isConnected).toBe(true);

    a2.destroy!();
    expect(document.querySelectorAll('style').length).toBe(before);
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

describe('RUN_COMMAND_GATE covers every mutating case (#6-2)', () => {
  // Consistency between the gate SET and the switch's cases: the audit
  // caught `repeat_phrase` reachable in the switch but absent from the
  // gate, so a RUN_COMMAND message could seek the video with the
  // extension off. Dropping any case (or the whole gate) turns this red
  // without needing to render the panel in happy-dom.
  const appSrc = readFileSync('src/content/ui/App.tsx', 'utf8');

  function setLiteral(): string {
    const m = appSrc.match(
      /const RUN_COMMAND_GATE[\s\S]*?new Set\(\[([\s\S]*?)\]\)/,
    );
    expect(m, 'RUN_COMMAND_GATE declaration not found').not.toBeNull();
    return m![1];
  }

  function quoted(src: string): string[] {
    return [...src.matchAll(/'([^']+)'/g)].map((x) => x[1]);
  }

  it('every gated case is in the gate, and nothing gated is dead', () => {
    const gate = new Set(quoted(setLiteral()));
    const switchStart = appSrc.indexOf("msg?.type === 'RUN_COMMAND'");
    expect(switchStart).toBeGreaterThan(-1);
    const switchSrc = appSrc.slice(switchStart, switchStart + 6000);
    const cases = quoted(switchSrc.match(/case '[^']+':/g)!.join(','));
    expect(cases.length).toBeGreaterThan(3);
    for (const c of cases) {
      if (c === 'toggle_panel') continue; // intentionally exempt
      expect(gate, `case '${c}' is not in RUN_COMMAND_GATE`).toContain(c);
    }
    for (const g of gate) {
      expect(cases, `gate entry '${g}' has no case`).toContain(g);
    }
  });

  it('every handler that acts on a shortcut consults the enabled toggle first', () => {
    // Three paths must all read the toggle before touching the video:
    // the in-page keydown, the chrome.commands RUN_COMMAND listener and
    // the kivara-repeat-cue event the overlay button dispatches.
    const checks = appSrc.match(/!useKivaraStore\.getState\(\)\.enabled/g) ?? [];
    expect(checks.length).toBeGreaterThanOrEqual(3);
  });
});
