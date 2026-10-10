/// <reference types="chrome" />

/**
 * Optional host permissions, on demand.
 *
 * Chrome Web Store review reads a manifest with ~96 host permissions as
 * "collects your browsing habits", so they are declared OPTIONAL and granted
 * when the user turns on the provider that needs them. Inside the service
 * worker a prompt is impossible, so every request path here either has the
 * origins already granted or reports what is missing for the UI to explain.
 *
 * Semantics:
 *  - ask: `chrome.permissions.request` — MUST run inside a user gesture;
 *  - query: `chrome.permissions.contains` / `getAll` — safe anywhere, cached
 *    through host-permissions-store so the resolve-word hot path never hits
 *    the API per lookup;
 *  - revoke: `chrome.permissions.remove`, used by the Permissions row.
 */

import { providerHosts } from './provider-hosts';
import { refreshHostPermissions } from './host-permissions-store';

/**
 * host[:port] → [host, port], keeping an IPv6 literal intact: the naive split
 * on ':' turns `[::1]:8765` into `[`, and reading the port AFTER rewriting the
 * host reads back the rewritten value, which is how `[::1]:9999` ends up
 * matching a `[::1]:8765` grant. Both sides go through this.
 */
function splitHostPort(hostAndPort: string): [string, string] {
  if (hostAndPort.startsWith('[')) {
    const bracketEnd = hostAndPort.indexOf(']');
    if (bracketEnd < 0) return [hostAndPort, ''];
    const tail = hostAndPort.slice(bracketEnd + 1);
    return [hostAndPort.slice(0, bracketEnd + 1), tail.startsWith(':') ? tail.slice(1) : ''];
  }
  const colon = hostAndPort.indexOf(':');
  if (colon < 0) return [hostAndPort, ''];
  return [hostAndPort.slice(0, colon), hostAndPort.slice(colon + 1)];
}

function matchesPattern(pattern: string, origin: string): boolean {
  const scheme = pattern.split('://')[0];
  const rest = pattern.split('://')[1] ?? '';
  const slashAt = rest.indexOf('/');
  const patternHost = slashAt < 0 ? rest : rest.slice(0, slashAt);
  const patternPath = slashAt < 0 ? '*' : rest.slice(slashAt + 1);
  const target = origin.split('://')[1] ?? '';

  // Chrome match patterns DO carry a port (`http://localhost:8080/*` is a
  // valid, distinct pattern from `http://localhost/*`), so the port is only
  // dropped from the SIDE that has none — otherwise a permission typed for
  // port 8765 would silently cover every port on that host. The Anki entries
  // in the manifest are the ones that use this.
  const [host, rawOriginPort] = splitHostPort(target.split('/')[0]);
  const [patternHostName, patternPort] = splitHostPort(patternHost);
  // Only the ORIGIN gets a default port: an origin written `https://host` IS
  // `https://host:443` for Chrome, so the two forms compare equal. The PATTERN
  // side is left exactly as written — a portless pattern stays a wildcard on
  // purpose, which is why `*://localhost/*` still covers `:8765`.
  const originScheme = origin.split('://')[0];
  const defaultPort = originScheme === 'https' || originScheme === 'wss' ? '443' : originScheme === 'http' || originScheme === 'ws' ? '80' : '';
  const originPort = rawOriginPort || defaultPort;
  const path = target.split('/').slice(1).join('/');
  if (scheme !== '*' && scheme !== originScheme) return false;
  // Chrome's rule: only a PORTLESS pattern is the wildcard. A pattern with a
  // port means that port, where "that port" includes the scheme default, which
  // is why `[::1]` still does not match `[::1]:8765`.
  if (patternPort) {
    if (!originPort || originPort !== patternPort) return false;
  }
  if (patternHostName.toLowerCase() === '*') return true;
  if (patternHostName.toLowerCase().startsWith('*.')) {
    // `*.example.com` matches any subdomain AND the apex.
    const suffix = patternHostName.slice(1);
    const bare = patternHostName.slice(2);
    if (host.toLowerCase() !== bare.toLowerCase() && !host.toLowerCase().endsWith(suffix.toLowerCase())) return false;
  } else if (patternHostName.toLowerCase() !== host.toLowerCase()) {
    return false;
  }
  // Path: `*` inside a chrome pattern matches any run of characters, so treat
  // it as a wildcard through the whole path, not a literal segment.
  if (!patternPath || patternPath === '*') return true;
  const asRegex = new RegExp(
    `^${patternPath.split('*').map((seg) => seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`,
  );
  return asRegex.test(path);
}

/** Is `origin` covered by any of the granted patterns? */
function coveredBy(origin: string, granted: string[]): boolean {
  return granted.some((pattern) => pattern === origin || matchesPattern(pattern, origin));
}

/**
 * The granted origin list, read once. Exported so a SW hot path can do ONE
 * permission listing per request instead of one per source (a fresh install
 * with ~20 sources was making ~20 `getAll()` calls in series before the first
 * network request left).
 */
export async function grantedOriginList(): Promise<string[]> {
  if (typeof chrome === 'undefined' || !chrome.permissions?.getAll) return [];
  try {
    const all = await chrome.permissions.getAll();
    return all.origins ?? [];
  } catch {
    return [];
  }
}

/** False when the permissions API does not exist at all (a plain page, or the
 * unit-test environment). Callers use it to skip gating rather than treat
 * "cannot list permissions" as "nothing is granted", which would turn every
 * source into a permission-blocked answer outside a real extension context. */
export function permissionsApiAvailable(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.permissions?.getAll;
}

/** Same verdict as `missingHosts`, against a list already fetched. */
export function originCovered(origin: string, granted: string[]): boolean {
  return granted.length === 0 ? false : coveredBy(origin, granted);
}

/** Are these origins granted right now? Never prompts. */
export async function hasHosts(origins: string[]): Promise<boolean> {
  return (await missingHosts(origins)).length === 0;
}

/** Which of these origins is missing? Never prompts. */
export async function missingHosts(origins: string[]): Promise<string[]> {
  if (origins.length === 0) return [];
  // No permissions API at all (a plain page, or the unit-test chrome mock):
  // there is nothing that could be granted, so nothing is reported missing.
  if (!permissionsApiAvailable()) return [];
  const granted = await grantedOriginList();
  return origins.filter((o) => !originCovered(o, granted));
}

/**
 * Prompt the user for these origins. MUST be called from a user gesture.
 *
 * `chrome.permissions.request` runs FIRST and synchronously: awaiting
 * `getAll()` before it lets Chrome drop the gesture between the await and the
 * prompt, which turns a "Conceder" click into a silently refused grant. The
 * API is a no-op for origins that are already granted, so there is nothing to
 * pre-check — and the grant answer is re-read afterwards to report what is
 * still missing.
 */
export async function requestHosts(origins: string[]): Promise<string[]> {
  if (origins.length === 0 || typeof chrome === 'undefined' || !chrome.permissions?.request) {
    return await missingHosts(origins);
  }
  try {
    // Runs FIRST, synchronously in the gesture: awaiting anything before
    // `request` lets Chrome drop the gesture in the gap and answer `false`.
    const granted = await chrome.permissions.request({ origins });
    return granted ? [] : await missingHosts(origins);
  } catch {
    return await missingHosts(origins);
  } finally {
    // Whatever happened, the UI should not be looking at a stale picture.
    void refreshHostPermissions();
  }
}

/** Drop these origins again (Permissions row → "revoke"). */
export async function revokeHosts(origins: string[]): Promise<string[]> {
  if (origins.length === 0 || typeof chrome === 'undefined' || !chrome.permissions?.remove) {
    return origins;
  }
  await chrome.permissions.remove({ origins });
  await refreshHostPermissions();
  return missingHosts(origins);
}

/**
 * Grant flow for a provider switch: asks for that provider's origins inside
 * the caller's gesture. Returns null when access is granted, or the missing
 * list when the user declined (callers then show the "needs access" hint).
 */
export async function ensureProviderHosts(providerId: string): Promise<string[] | null> {
  const missing = await requestHosts(providerHosts(providerId));
  return missing.length === 0 ? null : missing;
}

