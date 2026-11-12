/**
 * Card failure codes → the copy the panel shows (debt D1).
 *
 * Two jobs, both deterministic:
 *
 *  1. `classifyCardError` turns a raw provider/transport sentence into one of
 *     the `CreateCardErrorCode` families. The service worker classifies at the
 *     moment of failure (it has the original error object); the panel uses the
 *     same function ONLY for rows written before codes existed.
 *  2. `CARD_ERROR_LABEL_KEYS` names the dictionary key per family. An explicit
 *     map, not a template: the dead-key scan can see every one of these, and a
 *     family without copy is a type error rather than a raw key on screen.
 */
import type { AnkiPingErrorCode, CreateCardErrorCode } from './types';

/** Dictionary key per failure family. */
export const CARD_ERROR_LABEL_KEYS: Record<CreateCardErrorCode, string> = {
  'no-deck': 'recent.code.noDeck',
  'no-model': 'recent.code.noModel',
  disabled: 'recent.code.disabled',
  'no-token': 'recent.code.noToken',
  'api-key': 'recent.code.apiKey',
  timeout: 'recent.code.timeout',
  'anki-down': 'recent.code.ankiDown',
  'anki-error': 'recent.code.ankiError',
  unknown: 'recent.code.unknown',
};

/**
 * Raw sentence → family. Order matters: an "Unauthorized (401)" must read as
 * an API key problem, not as a generic server error.
 *
 * `pingCode` is optional: the ping path already classifies (`AnkiPingErrorCode`)
 * and its answer is more precise than any regex on the message.
 */
export function classifyCardError(
  raw?: string | null,
  pingCode?: AnkiPingErrorCode,
): CreateCardErrorCode {
  if (pingCode) {
    if (pingCode === 'API_KEY') return 'api-key';
    if (pingCode === 'TIMEOUT') return 'timeout';
    if (pingCode === 'NETWORK' || pingCode === 'LOOPBACK_REFUSED' || pingCode === 'CORS') return 'anki-down';
    if (pingCode === 'ANKI' || pingCode === 'HTTP') return 'anki-error';
  }
  const text = (raw ?? '').trim().toLowerCase();
  if (!text) return 'unknown';
  if (/(api.?key|unauthori[sz]ed|\b401\b|\b403\b|forbidden)/.test(text)) return 'api-key';
  // `tardó` is the Spanish half of the timeout sentence the client throws;
  // without it the same failure read as "Anki is down" in one locale only.
  if (/(timeout|timed out|took too long|deadline|tard[oó] (?:más|demasiado))/.test(text)) return 'timeout';
  // A transport failure names the network, not the provider. Checked BEFORE
  // Anki's own refusals so a wrapped "No se pudo contactar AnkiConnect" reads
  // as "Anki is down", not as a rejected note. The loopback refusal belongs to
  // the same family: the endpoint is unreachable by policy.
  // `contactando|contacting`: the wrapper's "unknown error contacting
  // AnkiConnect" means the transport died before anything classified it —
  // the same family the worker reports for that failure.
  if (/(network|failed to fetch|econnrefused|fetch failed|\bconnect\b|refused|unreachable|econnreset|no se pudo contactar|could not reach|could not contact|contactando|contacting|loopback|no es local)/.test(text)) {
    return 'anki-down';
  }
  // Anki's own refusals. The bare `anki` token is gone: it matched every
  // sentence that merely mentioned the add-on, including the transport ones
  // above. `ankiconnect` stays because those sentences were already routed, so
  // what reaches here is the provider speaking about itself — an HTTP status,
  // an unreadable body, a model/deck refusal.
  if (/(ankiconnect|addnote|duplicate|notetype|field|not found|model|deck)/.test(text)) {
    return 'anki-error';
  }
  return 'unknown';
}
