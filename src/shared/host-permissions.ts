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

function matchesPattern(pattern: string, origin: string): boolean {
  const [scheme, rest] = pattern.split('://');
  const slashAt = (rest ?? '').indexOf('/');
  const patternHost = slashAt < 0 ? rest : rest.slice(0, slashAt);
  const patternPath = slashAt < 0 ? '*' : rest.slice(slashAt + 1);
  const target = origin.split('://')[1] ?? '';
  const host = target.split('/')[0];
  const path = target.split('/').slice(1).join('/');
  if (scheme !== '*' && scheme !== origin.split('://')[0]) return false;
  if (patternHost === '*') return true;
  if (patternHost.startsWith('*.')) {
    // `*.example.com` matches any subdomain AND the apex, which is how chrome's
    // own matcher treats the syntactically generous form.
    const suffix = patternHost.slice(1); // ".example.com"
    const bare = patternHost.slice(2); // "example.com"
    if (host !== bare && !host.endsWith(suffix)) return false;
  } else if (patternHost !== host) {
    return false;
  }
  // Path: an explicit path matches only itself or by prefix on '/'.
  if (!patternPath || patternPath === '*') return true;
  return path === patternPath || path.startsWith(`${patternPath}/`);
}

/** Is `origin` covered by any of the granted patterns? */
function coveredBy(origin: string, granted: string[]): boolean {
  return granted.some((pattern) => pattern === origin || matchesPattern(pattern, origin));
}

/** Are these origins granted right now? Never prompts. */
export async function hasHosts(origins: string[]): Promise<boolean> {
  return (await missingHosts(origins)).length === 0;
}

/** Which of these origins is missing? Never prompts. */
export async function missingHosts(origins: string[]): Promise<string[]> {
  if (origins.length === 0) return [];
  if (typeof chrome === 'undefined' || !chrome.permissions?.getAll) return [];
  try {
    const all = await chrome.permissions.getAll();
    const granted = all.origins ?? [];
    return origins.filter((o) => !coveredBy(o, granted));
  } catch {
    // Outside an extension context (tests) — never block a request on it.
    return [];
  }
}

/**
 * Prompt the user for these origins. MUST be called from a user gesture.
 * Returns the origins still missing afterwards (empty on success).
 */
export async function requestHosts(origins: string[]): Promise<string[]> {
  const missing = await missingHosts(origins);
  if (missing.length === 0) return [];
  if (typeof chrome === 'undefined' || !chrome.permissions?.request) return missing;
  try {
    const granted = await chrome.permissions.request({ origins: missing });
    return granted ? [] : await missingHosts(origins);
  } finally {
    // Whatever the user chose, keep the UI's picture of it current.
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

