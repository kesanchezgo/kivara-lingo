/**
 * Outbound-fetch guards for the service worker.
 *
 * Two families of danger live in the SW and need identical handling:
 *
 *  1. A URL that reaches inside the user's own network. The service worker
 *     has host permissions far beyond any page, so a loopback / RFC1918 /
 *     link-local target turns "download this dictionary" or "fetch this
 *     image" into a port scanner aimed at `127.0.0.1` or the LAN.
 *  2. An answer that never ends. Nothing in `fetch` bounds latency or size
 *     by itself: a hung CDN holds the enrichment chain open past the UI's
 *     patience, and a `Content-Length`-less stream can stream until the SW
 *     is killed.
 *
 * `assertPublicHttpUrl` answers (1) and `fetchBytesWithLimits` /
 * `fetchTextWithLimits` answer (2). Both are pure enough to unit test.
 */

/** Largest response we ever read into memory, per call. */
export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

export class UrlNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UrlNotAllowedError';
  }
}

/** Loopback on every notation Chrome resolves (127/8, ::1, localhost) plus
 * the RFC1918 ranges, CGNAT, link-local (169.254, cloud metadata) and
 * unspecified. Dotted-decimal only — a DNS name is resolved by the fetch
 * engine, not by us, so hostnames are checked for the literal names below. */
function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
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
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 0) return true; // 0.0.0.0/8
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
 *  • only OUR extension may ask. A web page cannot claim `chrome.runtime.id`,
 *    so `senderId` filters every site, every tab and every content script a
 *    page could have reached. Without it, "install this pack for me" becomes
 *    a way to make the extension download arbitrary hosts on demand.
 *  • the URL must be a public HTTPS endpoint — never http, never loopback,
 *    never a LAN address. The service worker's host_permissions reach far
 *    more than any page, so an ungated download is a scanner aimed at the
 *    user's own machine and network.
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
 * GET a URL as bytes, bounded by time and size. Throws on a bad URL, a
 * timeout, a size overrun, or a non-2xx status.
 */
export async function fetchBytesWithLimits(
  raw: string,
  opts: LimitsOptions,
): Promise<Uint8Array> {
  assertPublicHttpUrl(raw);
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
