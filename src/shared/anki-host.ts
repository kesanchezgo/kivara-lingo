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
