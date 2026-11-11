/**
 * Enrichment source health classification.
 *
 * `ENRICH_SOURCE_HEALTH` reports what each source did. The raw provider text
 * ("HTTP 429 Too Many Requests", "The server did not answer in 4 s") is right
 * for DevTools and wrong for the VIP panel, which has one tailored line per
 * failure family — the same wording the prototype used for its deterministic
 * mock (`vipx.err401` … `vipx.errTimeout`).
 *
 * The worker records the code with the observation; the panel re-classifies
 * older snapshots (a worker from before the field existed) through the same
 * pure function, so both paths agree.
 */
import type { EnrichErrorCode } from './types';

const STATUS_CODES: Array<[RegExp, EnrichErrorCode]> = [
  [/\b401\b|unauthor/i, 'unauthorized'],
  [/\b403\b|forbidden/i, 'forbidden'],
  [/\b404\b|not found/i, 'notFound'],
  [/\b429\b|rate.?limit|too many requests/i, 'rateLimited'],
  // A gateway timeout is a 5xx on paper but the user action is "retry", the
  // same as a client-side timeout — keep it in that family.
  [/\b504\b|gateway timeout/i, 'timeout'],
  [/\b5\d{2}\b|internal server|bad gateway|service unavailable/i, 'server'],
];

const TIMEOUT = /\btimeout\b|timed out|timed-out|abort(ed)?|deadline|no respond[ió]|dejó de enviar|stale/i;
const PERMISSION = /permission|permiso|not allowed|denied|blocked by client|ERR_BLOCKED|host access|missing host/i;
const NETWORK = /failed to fetch|networkerror|load failed|connection (refused|reset)|econnrefused|enotfound|getaddrinfo|dns/i;

/** One raw error string → the failure family the panel can explain. */
export function classifyEnrichError(error: string | null | undefined): EnrichErrorCode {
  const text = (error ?? '').trim();
  if (!text) return 'unknown';
  for (const [pattern, code] of STATUS_CODES) {
    if (pattern.test(text)) return code;
  }
  if (TIMEOUT.test(text)) return 'timeout';
  if (PERMISSION.test(text)) return 'permission';
  if (NETWORK.test(text)) return 'network';
  return 'unknown';
}

/**
 * i18n key per family. `permission` reuses the site-access message: it is the
 * same user action (grant the host) and the same wording in the prototype.
 */
export const ENRICH_ERROR_KEYS: Record<EnrichErrorCode, string> = {
  unauthorized: 'vipx.err401',
  forbidden: 'vipx.err403',
  notFound: 'vipx.err404',
  rateLimited: 'vipx.err429',
  server: 'vipx.err5xx',
  timeout: 'vipx.errTimeout',
  permission: 'vipx.errCors',
  network: 'vipx.errNetwork',
  unknown: 'vipx.status_error',
};

/**
 * What to DO about each failure family, per the prototype's `vipx.err*Fix`
 * lines. The permission family carries `{group}` — the host-permission group
 * the row's "Grant access" action requests.
 *
 * Explicit map on purpose: the old code composed `` `${msgKey}Fix` `` at
 * render time, so a family without a `*Fix` key rendered the raw key to the
 * user (`vipx.errNetworkFix`), and the dead-key scanner could not see any of
 * them. `unknown` has no fix — the panel has no idea what happened.
 */
export const ENRICH_ERROR_FIX_KEYS: Partial<Record<EnrichErrorCode, string>> = {
  unauthorized: 'vipx.err401Fix',
  forbidden: 'vipx.err403Fix',
  notFound: 'vipx.err404Fix',
  rateLimited: 'vipx.err429Fix',
  server: 'vipx.err5xxFix',
  timeout: 'vipx.errTimeoutFix',
  permission: 'vipx.errCorsFix',
  network: 'vipx.errNetworkFix',
};

/**
 * Answers a source deserves before the generic family line. The prototype
 * worded three of them by name — Unsplash's 401 IS a missing Access Key,
 * Pixabay's 429 IS the shared quota, Reverso's 403 IS the anti-bot challenge —
 * so the generic family text would say less than the failure did.
 */
export const ENRICH_SOURCE_FIX_KEYS: Record<string, Partial<Record<EnrichErrorCode, string>>> = {
  unsplash: { unauthorized: 'vipx.fixUnsplash401' },
  pixabay: { rateLimited: 'vipx.fixPixabay429' },
  reverso: { forbidden: 'vipx.fixReverso403' },
};

/** A slow source still works: the fix is the prototype's `vipx.slowFix`. */
export const ENRICH_SLOW_FIX_KEY = 'vipx.slowFix';

/**
 * The action a failing row offers, in the prototype's terms: add the key,
 * grant the host group, or just retry. Pure so the panel stays a renderer.
 *
 *  - `permission` → grant the group: that IS the fix.
 *  - `unauthorized` / `rateLimited` on a keyed source (Unsplash, Pixabay) →
 *    the key is the fix, both failures read as "your key would change this".
 *  - anything else with a classified family → retry; the failure may be gone.
 *  - no family (unknown) → no action; the row has nothing honest to offer.
 */
export type VipRowAction = 'addKey' | 'grantAccess' | 'retry';

const KEYED_SOURCES = new Set(['unsplash', 'pixabay']);

export function vipRowAction(
  sourceId: string | undefined,
  code: EnrichErrorCode | null | undefined,
): VipRowAction | null {
  if (code === 'permission') return 'grantAccess';
  if (sourceId && KEYED_SOURCES.has(sourceId) && (code === 'unauthorized' || code === 'rateLimited')) {
    return 'addKey';
  }
  if (code) return 'retry';
  return null;
}

/**
 * Fix copy for one observation: the source-specific variant when the pair
 * `(source, family)` has one, otherwise the family's generic line.
 */
export function enrichFixKey(
  sourceId: string | undefined,
  code: EnrichErrorCode | null | undefined,
): string | undefined {
  if (code == null) return undefined;
  const sourceFix = sourceId ? ENRICH_SOURCE_FIX_KEYS[sourceId]?.[code] : undefined;
  return sourceFix ?? ENRICH_ERROR_FIX_KEYS[code];
}
