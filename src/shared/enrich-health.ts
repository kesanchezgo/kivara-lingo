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