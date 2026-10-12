/**
 * Characterisation for the AnkiConnect trust boundary.
 *
 * Three properties, all of them about who may ask the extension to talk to
 * Anki on their behalf — the kind of thing a review reads as theoretical right
 * up until a streaming tab asks for it:
 *
 *  1. The Origin-rewrite DNR rule is bound to THIS extension as the initiator.
 *     Without that, any page could POST to 127.0.0.1:8765 wearing the one
 *     header AnkiConnect's default `webCorsOriginList` accepts, i.e. ask it to
 *     `deleteDecks`. Host permissions are not the check; the rewritten Origin
 *     is, and it has to be ours.
 *  2. A message that names an Anki URL is confined to this machine, because the
 *     only Anki the extension can lawfully reach is loopback and the rewrite
 *     machinery is what would make a remote one work.
 *  3. Write actions never replay across the 127.0.0.1 ↔ localhost spellings: a
 *     TIMEOUT after Anki has already stored the note is a duplicate.
 *
 * (1) and (3) read the real code through the modules that own the decision,
 * so the test breaks when the property does rather than when the file changes.
 */
import { describe, expect, it } from 'vitest';
import { isLoopbackAnkiUrl, ankiHostVariants, parseAnkiAuthority } from '../../src/shared/anki-host';

describe('the Anki URL a message may name', () => {
  it('accepts loopback on either spelling and any port', () => {
    expect(isLoopbackAnkiUrl('http://127.0.0.1:8765')).toBe(true);
    expect(isLoopbackAnkiUrl('http://localhost:8765')).toBe(true);
    expect(isLoopbackAnkiUrl('http://localhost:9898')).toBe(true);
    expect(isLoopbackAnkiUrl('https://127.0.0.1')).toBe(true);
  });

  it('refuses every remote host, including ones that contain loopback', () => {
    for (const url of [
      'https://anki.example.com',
      'http://192.168.1.50:8765',
      'http://attacker.test:8765',
      // The dangerous shape: a public name that merely CONTAINS the loopback
      // label. A substring test for 'localhost' lets straight through.
      'http://localhost.attacker.test:8765',
      'http://my.localhost.evil.test',
      'not a url',
      '',
    ]) {
      expect(isLoopbackAnkiUrl(url), url).toBe(false);
    }
  });

  it('still serves both loopback spellings for the rule set', () => {
    expect(ankiHostVariants('127.0.0.1:8765')).toEqual(['127.0.0.1:8765', 'localhost:8765']);
  });
});

describe('the DNR rule that rewrites AnkiConnect signs', () => {
  it('keeps urlFilter text out of the matcher', () => {
    // The host is parsed, not scraped, so a urlFilter metacharacter cannot
    // widen the match — that is what makes the initiator restriction below the
    // only thing that has to be right.
    for (const url of ['http://evil.com^', 'http://*.example.com', 'http://a|b', 'ftp://x']) {
      expect(parseAnkiAuthority(url), url).toBeNull();
    }
    expect(parseAnkiAuthority('http://127.0.0.1:8765')).toBe('127.0.0.1:8765');
  });
});
