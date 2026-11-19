/**
 * Word identity is the single source of truth for "same word" across layers.
 * These tests pin the normalization required by the product decision:
 * lowercase + NFC (accents preserved), apostrophe folding, MWE base form,
 * and a lowercase-surface fallback when no lemmatizer hint exists.
 */
import { describe, expect, it } from 'vitest';
import {
  lemmaTag, lemmaTagFragment, normalizeIdentityKey, wordIdentity,
} from '../../src/shared/word-identity';

describe('normalizeIdentityKey', () => {
  it('composes and lowercases while PRESERVING accents (naïve stays naïve)', () => {
    const decomposed = 'nai\u0308ve'; // n a i + combining diaeresis + v e
    expect(normalizeIdentityKey(decomposed)).toBe('naïve');
    expect(normalizeIdentityKey('NAÏVE')).toBe('naïve');
  });

  it("folds curly apostrophes so rock'n'roll has one key", () => {
    expect(normalizeIdentityKey("ROCK’N’ROLL")).toBe("rock'n'roll");
    expect(normalizeIdentityKey("rock'n'roll")).toBe(normalizeIdentityKey('rock\u02BCn\u02BCroll'));
  });

  it('escapes neither _ nor * — those are escaped later by escapeAnkiSearchTerm', () => {
    expect(normalizeIdentityKey('a_b*')).toBe('a_b*');
  });

  it('normalizes a Japanese term without damaging its script', () => {
    expect(normalizeIdentityKey('　走る　')).toBe('走る');
  });
});

describe('wordIdentity', () => {
  it('uses the dictionary lemma when present', () => {
    const identity = wordIdentity({ token: 'ran', dictionaryLemma: 'run', lang: 'en' });
    expect(identity).toEqual({ key: 'run', surface: 'ran', source: 'dictionary' });
  });

  it('reduces a MWE to its base form via the caller candidate list', () => {
    const identity = wordIdentity({
      token: 'gave up', kind: 'expression',
      lemmaCandidates: ['gave up', 'give up'], lang: 'en',
    });
    expect(identity).toEqual({ key: 'give up', surface: 'gave up', source: 'mwe' });
  });

  it('respects the Yomitan source flag', () => {
    const identity = wordIdentity({
      token: '走った', fromYomitan: true,
      lemmaCandidates: ['走った', '走る'], lang: 'ja',
    });
    expect(identity).toEqual({ key: '走る', surface: '走った', source: 'yomitan' });
  });

  it('falls back to the lemmatizer candidate for a single inflected word', () => {
    const identity = wordIdentity({ token: 'running', lemmaCandidates: ['running', 'run'], lang: 'en' });
    expect(identity).toEqual({ key: 'run', surface: 'running', source: 'lemmatizer' });
  });

  it('falls back to the normalized surface when no lemma is available (no lemmatizer for lang)', () => {
    expect(wordIdentity({ token: 'STEVE', lang: 'es' })).toEqual({
      key: 'steve', surface: 'steve', source: 'surface',
    });
  });
});

describe('lemmaTag', () => {
  it('replaces spaces with dashes and keeps special characters for the query escaper', () => {
    expect(lemmaTagFragment("give up")).toBe('give-up');
    expect(lemmaTag("rock'n'roll")).toBe("kivara::lemma::rock'n'roll");
    expect(lemmaTag('a_b*')).toBe('kivara::lemma::a_b*');
  });
});
