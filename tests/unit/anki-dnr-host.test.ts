/**
 * The Anki URL's host before it becomes a DNR `urlFilter`.
 *
 * The service worker registers `Origin: http://localhost` on requests to the
 * user's AnkiConnect endpoint, because MV3 service-worker fetches otherwise
 * send `Origin: chrome-extension://<id>` and AnkiConnect's default
 * `webCorsOriginList` refuses them. The host for that rule is parsed by
 * `parseAnkiAuthority`/`ankiHostVariants` in `shared/anki-host.ts` — pure, so
 * this runs against the real code without importing the service worker (whose
 * webext-bridge import needs a chrome global at module scope).
 */
import { describe, expect, it } from 'vitest';
import { ankiHostVariants, parseAnkiAuthority } from '../../src/shared/anki-host';

describe('the Anki host that reaches the DNR urlFilter', () => {
  it('parses the loopback default and both of its spellings', () => {
    expect(parseAnkiAuthority('http://127.0.0.1:8765')).toBe('127.0.0.1:8765');
    expect(parseAnkiAuthority('http://localhost:8765')).toBe('localhost:8765');
    expect(ankiHostVariants('127.0.0.1:8765')).toEqual(['127.0.0.1:8765', 'localhost:8765']);
    expect(ankiHostVariants('localhost:8765')).toEqual(['localhost:8765', '127.0.0.1:8765']);
  });

  it('parses a custom port and a remote host, with or without a path', () => {
    expect(parseAnkiAuthority('https://anki.example.com:9898/')).toBe('anki.example.com:9898');
    expect(parseAnkiAuthority('http://anki.internal')).toBe('anki.internal');
  });

  it('keeps a bracketed IPv6 literal intact with its port', () => {
    expect(parseAnkiAuthority('http://[::1]:8765/')).toBe('[::1]:8765');
    expect(ankiHostVariants('[::1]:8765')).toEqual(['[::1]:8765']);
  });

  it('rejects every urlFilter metacharacter the user could type', () => {
    for (const url of [
      'http://evil.com^',
      'http://evil.com|',
      'http://*.example.com',
      'http://example.com|http://127.0.0.1',
      'http://example.com^/x',
      'http://example.com:8765^',
      'http://user:pass@example.com',
      'ftp://evil.example',
      'javascript:alert(1)',
      'not a url at all',
      '',
    ]) {
      expect(parseAnkiAuthority(url), url).toBeNull();
    }
  });
});

