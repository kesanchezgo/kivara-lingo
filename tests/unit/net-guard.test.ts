/**
 * Outbound-fetch guards (the four security findings of the 2026-10-09 audit).
 *
 * The service worker holds host permissions no page has, so an ungated
 * download doubles as a probe of the user's own machine and LAN; and nothing
 * in `fetch` bounds how long a response may take or how big it may be.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  assertPublicHttpUrl,
  isPublicHttpUrl,
  fetchBytesWithLimits,
  fetchTextWithLimits,
  validateDictPackInstallRequest,
  DEFAULT_MAX_BYTES,
  UrlNotAllowedError,
} from '../../src/shared/net-guard';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('assertPublicHttpUrl', () => {
  it('gates the dict-pack installer on sender AND destination', () => {
    // A web page cannot claim our extension id, so a site — or any content
    // script a compromised page reached — is refused before any fetch. Even
    // our own pages cannot point the download at the user's machine or LAN.
    expect(
      validateDictPackInstallRequest({
        senderId: undefined,
        runtimeId: chrome.runtime.id,
        url: 'https://example.com/a.zip',
      }),
    ).toBe('sender no permitido');
    expect(
      validateDictPackInstallRequest({
        senderId: 'other-extension-id',
        runtimeId: chrome.runtime.id,
        url: 'https://example.com/a.zip',
      }),
    ).toBe('sender no permitido');
    expect(
      validateDictPackInstallRequest({
        senderId: chrome.runtime.id,
        runtimeId: chrome.runtime.id,
        url: 'http://127.0.0.1:8765/kivara.zip',
      }),
    ).toMatch(/URL/);
    expect(
      validateDictPackInstallRequest({
        senderId: chrome.runtime.id,
        runtimeId: chrome.runtime.id,
        url: 'http://192.168.1.10/kivara.zip',
      }),
    ).toMatch(/URL/);
    // A public HTTPS zip — including a self-hosted one — is allowed.
    expect(
      validateDictPackInstallRequest({
        senderId: chrome.runtime.id,
        runtimeId: chrome.runtime.id,
        url: 'https://example.com/a.zip',
      }),
    ).toBeNull();
  });

  it('accepts a normal public https URL', () => {
    expect(isPublicHttpUrl('https://pub-c3d38cca4dc2403b88934c56748f5144.r2.dev/releases/latest/kty-en-es.zip')).toBe(true);
  });

  it('rejects anything that is not https unless cleartext is asked for', () => {
    expect(isPublicHttpUrl('http://example.com/a.zip')).toBe(false);
    expect(isPublicHttpUrl('ftp://example.com/a.zip')).toBe(false);
    expect(isPublicHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isPublicHttpUrl('data:text/html,<b>x</b>')).toBe(false);
    expect(isPublicHttpUrl('/relative/path.zip')).toBe(false);
    // Opt-in still refuses private ranges below.
    expect(() => assertPublicHttpUrl('http://10.0.0.5/a.zip', { allowHttp: true })).toThrow(UrlNotAllowedError);
  });

  it('rejects loopback on every notation', () => {
    for (const url of [
      'http://localhost:8765/',
      'https://127.0.0.1/',
      'https://127.1.2.3/',
      'http://[::1]:8080/',
      'https://foo.localhost/',
      'https://printer.local/',
      'https://host.internal/',
    ]) {
      expect(isPublicHttpUrl(url), url).toBe(false);
    }
  });

  it('rejects the private and cloud-metadata ranges', () => {
    for (const url of [
      'http://192.168.1.1/admin',
      'http://10.0.0.1/',
      'http://172.16.0.9/',
      'http://172.31.255.255/',
      'http://169.254.169.254/latest/meta-data/', // cloud metadata
      'http://100.64.0.1/',
      'http://0.0.0.0/',
    ]) {
      expect(isPublicHttpUrl(url), url).toBe(false);
    }
  });

  it('rejects URLs with embedded credentials', () => {
    expect(isPublicHttpUrl('https://user:pass@example.com/a.zip')).toBe(false);
  });

  it('rejects the FQDN form of a blocked name', () => {
    // A trailing dot is accepted by the URL parser and resolves to the same
    // host, so `localhost.` (and `foo.localhost.`) are loopback too.
    for (const url of ['https://localhost./', 'http://127.0.0.0./', 'https://printer.local./']) {
      expect(isPublicHttpUrl(url), url).toBe(false);
    }
  });

  it('rejects the benchmarking, multicast and reserved ranges', () => {
    for (const url of [
      'http://198.18.0.1/',
      'http://198.19.255.255/',
      'http://224.0.0.1/',
      'http://240.0.0.1/',
    ]) {
      expect(isPublicHttpUrl(url), url).toBe(false);
    }
  });

  it('accepts anything between the private edges of 172/16', () => {
    expect(isPublicHttpUrl('https://172.15.0.1/')).toBe(true);
  });
});

describe('fetchBytesWithLimits', () => {
  it('rejects a blocked URL without touching the network', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    await expect(fetchBytesWithLimits('http://127.0.0.1:6379/', { timeoutMs: 100 })).rejects.toThrow(
      UrlNotAllowedError,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses a redirect that lands on loopback (follow would reach it)', async () => {
    // `redirect: 'follow'` is not used precisely because the network stack
    // would honour this 302 and the SW's host permissions would carry it.
    const wrapped = new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1:8765/' },
    });
    vi.stubGlobal('fetch', vi.fn(async () => wrapped));

    await expect(
      fetchBytesWithLimits('https://cdn.example.com/a.bin', { timeoutMs: 1000 }),
    ).rejects.toThrow(UrlNotAllowedError);
  });

  it('refuses a redirect to a private LAN address', async () => {
    const wrapped = new Response(null, {
      status: 302,
      headers: { location: 'http://192.168.1.50/admin' },
    });
    vi.stubGlobal('fetch', vi.fn(async () => wrapped));
    await expect(
      fetchBytesWithLimits('https://cdn.example.com/a.bin', { timeoutMs: 1000 }),
    ).rejects.toThrow(UrlNotAllowedError);
  });

  it('refuses a redirect to the cloud metadata endpoint', async () => {
    const wrapped = new Response(null, {
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data/' },
    });
    vi.stubGlobal('fetch', vi.fn(async () => wrapped));
    await expect(
      fetchBytesWithLimits('https://cdn.example.com/a.bin', { timeoutMs: 1000 }),
    ).rejects.toThrow(UrlNotAllowedError);
  });

  it('walks a redirect to another PUBLIC host', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        if (calls.length === 1) {
          return new Response(null, {
            status: 302,
            headers: { location: '/mirrors/a.bin' },
          });
        }
        return new Response(new TextEncoder().encode('mirrored'), { status: 200 });
      }),
    );
    const out = await fetchBytesWithLimits('https://cdn.example.com/a.bin', { timeoutMs: 1000 });
    expect(new TextDecoder().decode(out)).toBe('mirrored');
    expect(calls).toEqual(['https://cdn.example.com/a.bin', 'https://cdn.example.com/mirrors/a.bin']);
  });

  it('gives up after too many hops', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 302, headers: { location: '/next.bin' } })),
    );
    await expect(
      fetchBytesWithLimits('https://cdn.example.com/a.bin', { timeoutMs: 1000 }),
    ).rejects.toThrow(/redirecciones/);
  });

  it('refuses a body bigger than the declared length', async () => {    const body = new Uint8Array(64);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
    await expect(
      fetchBytesWithLimits('https://cdn.example.com/a.bin', { timeoutMs: 1000, maxBytes: 16 }),
    ).rejects.toThrow(/mayor/);
  });

  it('refuses an oversized STREAM even when the header lies', async () => {
    // No content-length at all, and the bytes only reveal their size mid-read.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(32));
        controller.enqueue(new Uint8Array(32));
        controller.close();
      },
    });
    const res = new Response(stream, { status: 200 });
    Object.defineProperty(res, 'headers', {
      value: new Headers(), // genuinely no content-length
    });
    vi.stubGlobal('fetch', vi.fn(async () => res));
    await expect(
      fetchBytesWithLimits('https://cdn.example.com/a.bin', { timeoutMs: 1000, maxBytes: 48 }),
    ).rejects.toThrow(/mayor/);
  });

  it('reads a normal body and honours the default cap constant', async () => {
    const payload = new TextEncoder().encode('pack-bytes');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(payload, { status: 200 })));
    const out = await fetchBytesWithLimits('https://cdn.example.com/a.bin', { timeoutMs: 1000 });
    expect(new TextDecoder().decode(out)).toBe('pack-bytes');
    expect(DEFAULT_MAX_BYTES).toBe(8 * 1024 * 1024);
  });

  it('refuses non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    await expect(
      fetchBytesWithLimits('https://cdn.example.com/missing.bin', { timeoutMs: 1000 }),
    ).rejects.toThrow('HTTP 404');
  });

  it('aborts a request that outlives the timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }),
    );
    const started = Date.now();
    await expect(
      fetchBytesWithLimits('https://slow.example.com/hang.bin', { timeoutMs: 50 }),
    ).rejects.toBeDefined();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('fetchTextWithLimits', () => {
  it('decodes UTF-8', async () => {
    const payload = new TextEncoder().encode('definición ✓');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(payload, { status: 200 })));
    const out = await fetchTextWithLimits('https://es.wikipedia.org/x', { timeoutMs: 1000 });
    expect(out).toBe('definición ✓');
  });

  it('shares the same gates', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    await expect(fetchTextWithLimits('http://192.168.0.10/', { timeoutMs: 100 })).rejects.toThrow(
      UrlNotAllowedError,
    );
    expect(spy).not.toHaveBeenCalled();
  });
});
