/**
 * Enrichment health classifier (`shared/enrich-health`).
 *
 * The VIP panel shows one tailored line per failure family instead of the
 * provider's raw text. The orchestrator runs this when it records an
 * observation; the panel re-runs it on snapshots taken before the field
 * existed — both must agree, which is why the classifier is pure.
 */
import { describe, expect, it } from 'vitest';
import { ENRICH_ERROR_KEYS, classifyEnrichError } from '../../src/shared/enrich-health';
import type { EnrichErrorCode } from '../../src/shared/types';

const CASES: Array<[string, EnrichErrorCode]> = [
  ['HTTP 401 Unauthorized', 'unauthorized'],
  ['HTTP 403 Forbidden', 'forbidden'],
  ['HTTP 404 Not Found', 'notFound'],
  ['HTTP 429 Too Many Requests', 'rateLimited'],
  ['HTTP 500 Internal Server Error', 'server'],
  ['HTTP 502 Bad Gateway', 'server'],
  ['HTTP 503 Service Unavailable', 'server'],
  ['HTTP 504 Gateway Timeout', 'timeout'],
];

describe('classifyEnrichError — status codes', () => {
  it.each(CASES)('%s → %s', (message, expected) => {
    expect(classifyEnrichError(message)).toBe(expected);
  });
});

describe('classifyEnrichError — timeout path', () => {
  it('maps the per-source abort to timeout', () => {
    expect(classifyEnrichError('El servidor no respondió en 4 s. Vuelve a intentarlo.')).toBe('timeout');
    expect(classifyEnrichError('AbortError: The operation was aborted')).toBe('timeout');
    expect(classifyEnrichError('FetchAbortedError: deadline exceeded')).toBe('timeout');
  });
});

describe('classifyEnrichError — permission and transport', () => {
  it('maps a blocked host to the permission family', () => {
    expect(classifyEnrichError('Permission denied: host access missing')).toBe('permission');
    expect(classifyEnrichError('net::ERR_BLOCKED_BY_CLIENT')).toBe('permission');
  });

  it('maps a dead network to the network family', () => {
    expect(classifyEnrichError('TypeError: Failed to fetch')).toBe('network');
    expect(classifyEnrichError('getaddrinfo ENOTFOUND dictionary.example')).toBe('network');
  });

  it('keeps an unknown message unknown instead of guessing', () => {
    expect(classifyEnrichError('tatoeba is down')).toBe('unknown');
    expect(classifyEnrichError('')).toBe('unknown');
    expect(classifyEnrichError(undefined)).toBe('unknown');
  });
});

describe('ENRICH_ERROR_KEYS', () => {
  it('has one i18n key per family', () => {
    const families: EnrichErrorCode[] = [
      'unauthorized', 'forbidden', 'notFound', 'rateLimited', 'server',
      'timeout', 'permission', 'network', 'unknown',
    ];
    for (const family of families) {
      expect(ENRICH_ERROR_KEYS[family]).toMatch(/^vipx\./);
    }
    expect(ENRICH_ERROR_KEYS.unauthorized).toBe('vipx.err401');
    expect(ENRICH_ERROR_KEYS.timeout).toBe('vipx.errTimeout');
  });
});
