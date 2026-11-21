/**
 * RED TESTS — round 10: the bus's Netflix manifest branch.
 *
 * The fetched NATIVE track is an AUXILIARY translation surface: it rides the
 * bus with `background: true`, never becomes `lastTrack`, and the guard that
 * reuses the MAIN world's download only fires when the URL matches. The
 * manifest seen-set is bounded (LRU) and cleared by clearBus(), and the last
 * manifest is kept so a target-language change can reprocess it without
 * waiting for the player's next parse.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearBus,
  getTrackByLanguage,
  getLastTrack,
  onTrack,
  __resetInterceptedBusForTests,
  __netflixManifestsSeenCountForTests,
  reprocessLastNetflixManifest,
} from '../../src/content/platform-adapters/intercepted-bus';
import { NETFLIX_MANIFEST_EVENT } from '../../src/content/platform-adapters/netflix-manifest-hook';

const NETFLIX_EVENT = NETFLIX_MANIFEST_EVENT;
const ES_BODY = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="es"><body><div>
<p begin="0s" end="4s">Hola, esta es la pista nativa.</p>
</div></body></tt>`;
const PT_BODY = ES_BODY.replace('xml:lang="es"', 'xml:lang="pt"').replace('Hola', 'Olá');
const ES_URL = 'https://ipv4-c001.nflxvideo.net/sub/es/seg.xml?o=1';
const PT_URL = 'https://ipv4-c001.nflxvideo.net/sub/pt/seg.xml?o=2';

function manifestWith(...urls: string[]): Array<Record<string, unknown>> {
  // The HOOK extracts ttDownloadUrl before posting — the bus contract is the
  // normalized NetflixManifestTrack shape, not the raw manifest row.
  return urls.map((url) => ({
    bcp47: /\/pt\//.test(url) ? 'pt' : 'es',
    isNoneTrack: false,
    isForcedNarrative: false,
    isImageBased: false,
    ttDownloadUrl: url,
  }));
}

function nonce(): string {
  return document.documentElement.getAttribute('data-kivara-nonce') ?? '';
}

function post(payload: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', {
    source: window,
    data: { nonce: nonce(), ...payload },
  }));
}

const flush = () => new Promise((r) => setTimeout(r, 25));

beforeEach(() => {
  __resetInterceptedBusForTests();
  document.documentElement.setAttribute('data-kivara-target-lang', 'es');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(ES_BODY, { status: 200 })));
});

afterEach(() => {
  __resetInterceptedBusForTests();
  vi.unstubAllGlobals();
  document.documentElement.setAttribute('data-kivara-target-lang', 'es');
});

describe('the fetched native track is AUXILIARY', () => {
  it('publishes with background:true, never as lastTrack', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const off = onTrack((t) => seen.push(t as unknown as Record<string, unknown>));
    post({ source: NETFLIX_EVENT, tracks: manifestWith(ES_URL), nativeBody: ES_BODY, nativeUrl: ES_URL });
    await flush();
    off();

    const es = getTrackByLanguage('es');
    expect(es?.cues.some((c) => c.text.includes('pista nativa'))).toBe(true);
    expect(es?.background).toBe(true);
    expect(seen[0]?.background).toBe(true);
    // The player's own caption source must never be replaced by our fetch.
    expect(getLastTrack()).toBeNull();
  });

  it('the MAIN world body is reused ONLY when nativeUrl matches the picked URL', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    // Mismatch: the body belongs to another URL — the bus downloads itself.
    post({ source: NETFLIX_EVENT, tracks: manifestWith(ES_URL), nativeBody: ES_BODY, nativeUrl: 'https://other.example/track.ttml' });
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(ES_URL, expect.objectContaining({ credentials: 'include' }));
    expect(getTrackByLanguage('es')?.background).toBe(true);

    __resetInterceptedBusForTests();
    fetchMock.mockClear();
    // Match: the MAIN world already downloaded THIS url — no second fetch.
    post({ source: NETFLIX_EVENT, tracks: manifestWith(ES_URL), nativeBody: ES_BODY, nativeUrl: ES_URL });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getTrackByLanguage('es')).not.toBeNull();
  });
});

describe('netflixManifestsSeen: bounded and reset-able', () => {
  it('does not fetch the same manifest URL twice until clearBus()', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    post({ source: NETFLIX_EVENT, tracks: manifestWith(ES_URL), nativeBody: ES_BODY, nativeUrl: ES_URL });
    await flush();
    expect(getTrackByLanguage('es')).not.toBeNull();
    // Same manifest again (the player re-parses): still one published track.
    post({ source: NETFLIX_EVENT, tracks: manifestWith(ES_URL), nativeBody: ES_BODY, nativeUrl: ES_URL });
    await flush();
    expect(getTrackByLanguage('es')?.cues).toHaveLength(1);

    clearBus();
    post({ source: NETFLIX_EVENT, tracks: manifestWith(ES_URL), nativeBody: ES_BODY, nativeUrl: ES_URL });
    await flush();
    expect(getTrackByLanguage('es')).not.toBeNull();
  });

  it('the seen-set stays bounded (LRU)', async () => {
    for (let i = 0; i < 205; i++) {
      const url = `${ES_URL}?i=${i}`;
      post({ source: NETFLIX_EVENT, tracks: manifestWith(url), nativeBody: ES_BODY, nativeUrl: url });
    }
    await flush();
    expect(__netflixManifestsSeenCountForTests()).toBeLessThanOrEqual(200);
  });
});

describe('target-language change reprocesses the last manifest', () => {
  it('publishes the NEW target track from the stored tracks, self-fetching its URL', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => new Response(
      String(input).includes('/pt/') ? PT_BODY : ES_BODY,
      { status: 200 },
    ));
    post({
      source: NETFLIX_EVENT,
      tracks: manifestWith(ES_URL, PT_URL),
      nativeBody: ES_BODY,
      nativeUrl: ES_URL,
    });
    await flush();
    expect(getTrackByLanguage('es')).not.toBeNull();
    expect(getTrackByLanguage('pt')).toBeNull();

    // The user switches their native language to Portuguese.
    document.documentElement.setAttribute('data-kivara-target-lang', 'pt');
    clearBus({ keepManifests: true });
    reprocessLastNetflixManifest();
    await flush();
    const pt = getTrackByLanguage('pt');
    expect(pt?.cues.some((c) => c.text.includes('Olá'))).toBe(true);
    expect(pt?.background).toBe(true);
    // The stored MAIN-world body was for ES: the bus fetched the PT url.
    expect(fetchMock).toHaveBeenCalledWith(PT_URL, expect.objectContaining({ credentials: 'include' }));
    expect(getLastTrack()).toBeNull();
  });
});
