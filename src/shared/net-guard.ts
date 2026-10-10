/**
 * Outbound-fetch guards for the service worker.
 *
 * Two families of danger live in the SW and need identical handling:
 *
 *  1. A URL that reaches inside the user's own network. The service worker
 *     has host permissions far beyond any page, so a loopback / RFC1918 /
 *     link-local target turns "download this dictionary" or "fetch this
 *     image" into a port scanner aimed at `127.0.0.1` or the LAN — including
 *     via a REDIRECT, which is why nothing here uses `redirect: 'follow'`
 *     (the network stack would honour a `302 → http://127.0.0.1/…` before a
 *     validation of the requested URL could matter).
 *  2. An answer that never ends. Nothing in `fetch` bounds latency or size
 *     by itself: a hung CDN holds the enrichment chain open past the UI's
 *     patience, and a `Content-Length`-less stream can stream until the SW
 *     is killed.
 *
 * `assertPublicHttpUrl` answers (1), `fetchXWithLimits` answer (2). The
 * residual neither can cover is DNS rebinding (a name that resolves to a
 * private address) — documented, not fixable from here, see PRIVACY.md.
 */

/** Largest response we ever read into memory, per call. */
export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

export class UrlNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UrlNotAllowedError';
  }
}

/**
 * Loopback on every notation Chrome resolves (127/8, ::1, localhost), the
 * RFC1918 ranges, CGNAT, benchmarking (198.18/15), multicast, reserved
 * (240/4) and link-local (169.254 includes cloud metadata).
 *
 * The trailing dot is stripped because a FQDN form is accepted by the URL
 * parser and resolves to the same host (`localhost.` is loopback); every
 * non-dotted-decimal notation resolves numerically through `url.hostname`
 * only for IPv4 literals, and any IPv6 literal is refused outright.
 *
 * Names that resolve through DNS are NOT checked here — that is the
 * documented DNS-rebinding residual (see PRIVACY.md).
 */
function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host === '::' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }
  // IPv6 literal — anything not a normal global unicast address is refused.
  if (host.includes(':')) return true;
  // Dotted-decimal in a non-standard base is normalised by WHATWG URL for
  // IPv4 literals, but accept a decimal one as written too.
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18.0.0/15
  if (a >= 224) return true; // multicast 224/4 + reserved 240/4 (+ bogus last)
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  return false;
}

/**
 * Validate a URL the extension is about to fetch on the user's behalf.
 * Throws `UrlNotAllowedError` when the target is not a public HTTPS
 * endpoint. Pass `allowHttp` for callers that legitimately speak cleartext —
 * note loopback and private ranges are refused either way, so a localhost
 * pack is NOT reachable through this gate (import from a hosted URL).
 */
export function assertPublicHttpUrl(raw: string, opts: { allowHttp?: boolean } = {}): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlNotAllowedError('URL inválida');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && opts.allowHttp)) {
    throw new UrlNotAllowedError('Solo se permiten URLs https://');
  }
  if (isBlockedHost(url.hostname)) {
    throw new UrlNotAllowedError('URL no permitida');
  }
  // A URL embedding credentials is a phishing classic and we never send any.
  if (url.username || url.password) {
    throw new UrlNotAllowedError('URL no permitida');
  }
  return url;
}

/** True when the URL passes `assertPublicHttpUrl` — for callers that want a
 * verdict instead of an exception. */
export function isPublicHttpUrl(raw: string): boolean {
  try {
    assertPublicHttpUrl(raw);
    return true;
  } catch {
    return false;
  }
}

export interface PackInstallRequest {
  /** `sender.id` of the runtime message that carried the URL. */
  senderId: string | undefined;
  /** This extension's own id, i.e. `chrome.runtime.id`. */
  runtimeId: string;
  url: string;
}

/**
 * Gate for the service worker's INSTALL_DICT_PACK_FROM_URL. Kept pure and
 * out of the SW module so the rule is testable (and so the reason for it is
 * readable next to the other guards):
 *
 *  • only OUR OWN extension process may ask: a web page cannot claim
 *    `chrome.runtime.id`, so a site (and anything it could have reached) is
 *    filtered out. This does NOT distinguish our content scripts injected
 *    into a page — they carry the same id by definition, and the pack URLs
 *    they can name are still limited by the rule below. Without it,
 *    "install this pack for me" becomes a way to make the extension download
 *    arbitrary hosts on demand.
 *  • the URL must be a public HTTPS endpoint — never http, never loopback,
 *    never a LAN address. The service worker's host_permissions reach far
 *    more than any page, so an ungated download is a scanner aimed at the
 *    user's own machine and network.
 *  Residual, documented: a name that RESOLVES to a private address (DNS
 *  rebinding) cannot be detected from here — see PRIVACY.md.
 *
 * Returns the error message, or null when the request may proceed.
 */
export function validateDictPackInstallRequest(req: PackInstallRequest): string | null {
  if (req.senderId !== req.runtimeId) return 'sender no permitido';
  try {
    assertPublicHttpUrl(req.url);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'URL no permitida';
  }
}

export interface LimitsOptions {
  timeoutMs: number;
  maxBytes?: number;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  signal?: AbortSignal;
}

class SizeLimitError extends Error {
  constructor(limit: number) {
    super(`respuesta mayor de ${limit} bytes`);
    this.name = 'SizeLimitError';
  }
}

/** Read a stream while counting bytes, so a lying `content-length` cannot
 * get past the cap. */
async function readWithLimit(
  res: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new SizeLimitError(maxBytes);
  const body = res.body;
  if (!body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new SizeLimitError(maxBytes);
    return buf;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        received += value.length;
        if (received > maxBytes) throw new SizeLimitError(maxBytes);
        chunks.push(value);
      }
    }
  } finally {
    // Release the lock even when the size cap fired, otherwise the
    // connection stays half-open until GC.
    reader.releaseLock();
  }
  const merged = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }
  return merged;
}

export interface MediaFetchOptions {
  timeoutMs: number;
  maxBytes: number;
  /** Allow a cleartext start (used for http:// media candidates). */
  allowHttp?: boolean;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface MediaFetch {
  bytes: Uint8Array;
  /** Lower-cased `content-type`, or '' when the server gave none. */
  contentType: string;
  /** The URL that actually answered (after redirects). */
  finalUrl: string;
}

/**
 * GET one media URL: guarded redirects, size cap, and the response type.
 * Throws on a blocked/invalid URL, a timeout, a size overrun or a non-2xx.
 */
export async function fetchMediaWithLimits(
  raw: string,
  opts: MediaFetchOptions,
): Promise<MediaFetch> {
  const allowHttp = isHttpUrl(raw);
  assertPublicHttpUrl(raw, { allowHttp });
  const maxBytes = opts.maxBytes;
  const { signal, cleanup } = composeSignals(opts.timeoutMs, opts.signal);
  try {
    const res = await fetch(raw, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      headers: opts.headers,
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Follow-destination check: never read a body the redirects dragged into
    // a private host (see assertResponseDestination).
    assertResponseDestination(res, allowHttp);
    const bytes = await readWithLimit(res, maxBytes);
    return {
      bytes,
      contentType: (res.headers.get('content-type') ?? '').toLowerCase(),
      finalUrl: res.url || raw,
    };
  } finally {
    cleanup();
  }
}

/** Extension for a media file, from the response type or the URL. Several
 * sources answer `octet-stream` for audio we know is `.ogg`/`.mp3`, so the
 * path is the second opinion — an `.ogg` stored as `.mp3` was a real bug. */
export function mediaExtFor(contentType: string, url: string, fallback = 'jpg'): string {
  if (/png/.test(contentType)) return 'png';
  if (/webp/.test(contentType)) return 'webp';
  if (/gif/.test(contentType)) return 'gif';
  if (/jpeg|jpg/.test(contentType)) return 'jpg';
  if (/mpeg|mp3/.test(contentType)) return 'mp3';
  if (/ogg|opus/.test(contentType)) return 'ogg';
  if (/wav|wave/.test(contentType)) return 'wav';
  if (/mp4|m4a|aac/.test(contentType)) return 'm4a';
  const path = url.split('?')[0]?.toLowerCase() ?? '';
  if (path.endsWith('.png')) return 'png';
  if (path.endsWith('.webp')) return 'webp';
  if (path.endsWith('.gif')) return 'gif';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'jpg';
  if (path.endsWith('.mp3')) return 'mp3';
  if (path.endsWith('.ogg') || path.endsWith('.opus')) return 'ogg';
  if (path.endsWith('.wav')) return 'wav';
  if (path.endsWith('.m4a')) return 'm4a';
  return fallback;
}

/** Compose our timeout with the caller's abort signal. `AbortSignal.any`
 * (Chrome 116+, Node 20+) needs no listener bookkeeping at all; the manual
 * path below removes its listener when the request ends — the old code
 * attached one per call and never cleaned it up. */
function composeSignals(
  timeoutMs: number,
  outer?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  if (outer && typeof AbortSignal.any === 'function') {
    return { signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), outer]), cleanup: () => {} };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  outer?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: ctrl.signal,
    cleanup: () => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
    },
  };
}

/**
 * Validate a response BEFORE its body is touched.
 *
 * `redirect: 'manual'` does NOT work in an extension's network stack: it
 * yields an opaque redirect (`status: 0`, no headers), so a per-hop loop reads
 * no `Location` at all and every real-world hop — http→https, the www prefix, a
 * CDN, GitHub releases → codeload, Wikimedia `Special:FilePath` — dies with
 * `HTTP 0`. So the fetch FOLLOWS redirects and the guard checks where the
 * request ENDED UP: `res.url` is the final URL after every hop, and a
 * private/loopback/metadata destination is refused before a single byte is read
 * or handed to Anki.
 *
 * An empty `res.url` (test doubles, or a response whose final URL the engine
 * does not disclose) is treated as "the URL we asked for", which the caller
 * already validated — refusing it would break every mocked response for no gain.
 *
 * Residual, stated plainly: the request itself did reach that address, so a
 * scripter can still probe with timing. Closing that requires a DNR rule
 * scoped to this extension's own fetches — see the notes in PRIVACY.md.
 */
function assertResponseDestination(res: Response, allowHttp = false): void {
  const finalUrl = typeof res.url === 'string' ? res.url : '';
  if (!finalUrl || finalUrl === 'about:blank') return;
  assertPublicHttpUrl(finalUrl, { allowHttp });
}

/** True when the URL is http:// — callers use it to allow a cleartext start,
 * while loopback and private ranges are refused either way. */
function isHttpUrl(raw: string): boolean {
  try {
    return new URL(raw).protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * GET a URL as bytes, bounded by time and size. The DESTINATION is validated
 * twice: before the request (the URL we were asked for) and after the
 * redirects resolved (where we actually landed).
 */
export async function fetchBytesWithLimits(
  raw: string,
  opts: LimitsOptions,
): Promise<Uint8Array> {
  const allowHttp = isHttpUrl(raw);
  assertPublicHttpUrl(raw, { allowHttp });
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const { signal, cleanup } = composeSignals(opts.timeoutMs, opts.signal);
  try {
    const res = await fetch(raw, {
      method: 'GET',
      credentials: opts.credentials ?? 'omit',
      cache: 'no-store',
      redirect: 'follow',
      headers: opts.headers,
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    assertResponseDestination(res, allowHttp);
    return await readWithLimit(res, maxBytes);
  } finally {
    cleanup();
  }
}

/** Same, decoded as UTF-8 text. */
export async function fetchTextWithLimits(
  raw: string,
  opts: LimitsOptions,
): Promise<string> {
  const bytes = await fetchBytesWithLimits(raw, opts);
  return new TextDecoder().decode(bytes);
}

/**
 * GET `raw` for the pack installer, following redirects.
 *
 * Returns `{ response, done }` instead of the bare response so the CALLER
 * decides when the timeout is disarmed: the installer reports progress while
 * draining a body that can be 127 MB, so clearing the deadline in a `finally`
 * here left that download without one.
 */
export async function fetchGuarded(
  raw: string,
  opts: {
    timeoutMs: number;
    headers?: Record<string, string>;
    credentials?: RequestCredentials;
    signal?: AbortSignal;
  },
): Promise<{ response: Response; done: () => void }> {
  const allowHttp = isHttpUrl(raw);
  assertPublicHttpUrl(raw, { allowHttp });
  const composed = composeSignals(opts.timeoutMs, opts.signal);
  const res = await fetch(raw, {
    method: 'GET',
    credentials: opts.credentials ?? 'omit',
    cache: 'no-store',
    redirect: 'follow',
    headers: opts.headers,
    signal: composed.signal,
  });
  if (!res.ok) {
    composed.cleanup();
    throw new Error(`HTTP ${res.status}`);
  }
  assertResponseDestination(res, allowHttp);
  return { response: res, done: () => composed.cleanup() };
}
