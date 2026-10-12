/**
 * The host part of the user's AnkiConnect URL, parsed once and safely.
 *
 * Why this is not done inline in the service worker: the value ends up as a DNR
 * `urlFilter`, which is a pattern language rather than a literal — `|` anchors,
 * `^` is a separator, `*` is a wildcard. A string scraped out of the settings
 * field (strip the scheme, split on `/`) lets any of those through, and a rule
 * that matches more than the user configured is the failure direction that
 * matters: it silently rewrites the `Origin` header on requests nobody
 * authorised.
 *
 * Kept free of chrome and of the service worker so the parsing is reachable
 * from a unit test without importing the whole worker.
 */

/**
 * What a DNR matcher may be handed: `name`, `name:port`, or `[v6]` /
 * `[v6]:port`.
 *
 * A single label starts and ends alphanumeric so a stray dot or hyphen cannot
 * make an empty label, and the port stays digits (1..5 of them) so `8765^` or
 * `8765|` cannot pass as a port.
 */
const SAFE_HOST = /^(\[[0-9a-f:]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::\d{1,5})?$/i;

/** Loopback under both spellings, since AnkiConnect answers on either. */
export function ankiHostVariants(host: string): string[] {
  if (host.includes('127.0.0.1')) return [host, host.replace('127.0.0.1', 'localhost')];
  // Only the bare name, not `foo.localhost`, which is a different host.
  if (host === 'localhost' || host.startsWith('localhost:')) {
    return [host, host.replace('localhost', '127.0.0.1')];
  }
  return [host];
}

/**
 * True when the URL names AnkiConnect on this machine, which is the only Anki
 * the extension is willing to talk to.
 *
 * Two reasons this is worth its own function rather than a string check:
 *
 *  1. The manifest grants loopback host permissions and nothing else, so a
 *     remote host is a request the extension cannot legally make anyway.
 *  2. The AnkiConnect `Origin` rewrite (declarative-net-request, service
 *     worker) exists to satisfy AnkiConnect's default `webCorsOriginList`
 *     `["http://localhost"]`. Pointing that machinery at an arbitrary
 *     message-supplied host turns the extension into an authorised-origin
 *     fetcher for whoever can reach the message door.
 *
 * `:port` is accepted on either name because Anki's port is user-editable and
 * the extension documents, in PRIVACY.md, that a remote Anki stays out on
 * purpose. A hostname that merely CONTAINS `localhost` (e.g. `x.localhost.attacker`)
 * is not loopback, and a `127.`-family address outside 127/8 is refused by the
 * exact-match rule below.
 */
export function isLoopbackAnkiUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(String(raw).trim());
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase().replace(/\.+$/, '');
  // IPv6 is BRACKETED in `URL`: `url.hostname` is the string "[::1]", so
  // comparing it to the bare form is a comparison no URL will ever satisfy —
  // the address is loopback and the function says it is not.
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  return bare === 'localhost' || bare === '127.0.0.1' || bare === '::1';
}

/**
 * The authority (`host[:port]`) a rule may be built from, or `null` when the
 * URL is unparseable or carries anything the matcher would interpret.
 */
export function parseAnkiAuthority(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  // Only what AnkiConnect speaks; anything else found in the field is a typo or
  // an attempt, and the previous rule set stays in place rather than being
  // replaced by a match on something unintended.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // `url.host` keeps IPv6 brackets and includes the port when present. A URL
  // that carries credentials is refused: we need no credentials to reach
  // AnkiConnect, and one there is a mismatch worth surfacing.
  const authority = url.host || url.hostname;
  if (url.username || url.password) return null;
  if (!SAFE_HOST.test(authority)) return null;
  return authority;
}
