import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  definitionContextReasons,
  glossPosShape,
  pickDefinitions,
  pickLexicalTranslations,
  sentencePosHint,
} from '../../src/background/enrichment/orchestrator';

/**
 * POS gate for the primary translation — regression tests for the
 * 2026-08-30 fix. The VIP card for `quibble` in "They quibble over
 * trivial details" published the NOUN gloss ("objeción") because no
 * ranking signal distinguished verb-shaped from noun-shaped Spanish
 * glosses. The gate infers the sentence's usage of the headword and
 * reorders glosses to match it.
 */
describe('translation POS gate', () => {
  describe('sentencePosHint', () => {
    it('detects verb usage with inflected forms', () => {
      // The hover token is the citation form; the sentence carries the
      // inflection ("runs", "quibbling", "quibbled").
      expect(sentencePosHint('run', 'She runs the company from home.')).toBe('verb');
      expect(sentencePosHint('quibble', 'They quibble over trivial details.')).toBe('verb');
      expect(sentencePosHint('quibble', 'He was quibbling about the terms.')).toBe('verb');
      expect(sentencePosHint('know', "I don't know what to say.")).toBe('verb');
    });

    it('detects noun usage', () => {
      expect(sentencePosHint('tensor', 'The model uses a tensor.')).toBe('noun');
      expect(sentencePosHint('run', 'She goes for a run every morning.')).toBe('noun');
      expect(sentencePosHint('support', 'Public support is growing.')).toBe('noun');
      // Quality-adjective premodifier the base determiner list misses.
      expect(sentencePosHint('interest', 'The bank charges high interest on loans.')).toBe('noun');
    });

    it('detects adverb usage from -ly shape and position', () => {
      expect(sentencePosHint('quickly', 'He quickly finished his homework.')).toBe('adverb');
      expect(sentencePosHint('carefully', 'She read the letter carefully.')).toBe('adverb');
    });

    it('detects predicative adjective usage after a copula', () => {
      expect(sentencePosHint('beautiful', 'The sunset was beautiful.')).toBe('adjective');
      expect(sentencePosHint('happy', 'She felt happy about the news.')).toBe('adjective');
      // A copula + inflected token is still a verb ("was walking"), not an
      // adjective — the predicative rule matches the BARE token only, so an
      // inflected form after the copula falls through to the verb rule.
      expect(sentencePosHint('walk', 'She was walking home.')).toBe('verb');
    });

    it('returns undefined without a usable signal', () => {
      expect(sentencePosHint('ephemeral', '')).toBeUndefined();
      expect(sentencePosHint('serendipity', undefined)).toBeUndefined();
    });
  });

  describe('definition POS gate', () => {
    const posMap = () => new Map<string, 'noun' | 'verb' | 'adjective' | 'adverb'>([
      ['be on the mind of', 'verb'],
      ['a fixed charge for borrowing money', 'noun'],
      ['moving quickly and lightly', 'adjective'],
      ['with speed', 'adverb'],
    ]);

    it('demotes a verb gloss when the sentence uses the word as a noun', () => {
      const ranked = pickDefinitions([
        { source: 'wordnet', text: 'be on the mind of' },
        { source: 'wordnet', text: 'a fixed charge for borrowing money' },
      ], 'interest', 'The bank charges high interest on loans.', posMap());
      expect(ranked[0].text).toBe('a fixed charge for borrowing money');
    });

    it('demotes an adjective gloss when the sentence uses the word as an adverb', () => {
      const ranked = pickDefinitions([
        { source: 'wordnet', text: 'moving quickly and lightly' },
        { source: 'wordnet', text: 'with speed' },
      ], 'quickly', 'He quickly finished his homework.', posMap());
      expect(ranked[0].text).toBe('with speed');
    });

    it('emits the POS reason codes', () => {
      const mismatch = definitionContextReasons('be on the mind of', 'interest', 'The bank charges high interest on loans.', posMap());
      expect(mismatch).toContain('penalty-pos-mismatch');
      const match = definitionContextReasons('a fixed charge for borrowing money', 'interest', 'The bank charges high interest on loans.', posMap());
      expect(match).toContain('ok-pos-match');
    });

    it('stays neutral when no POS metadata is available (no token rule needed)', () => {
      const reasons = definitionContextReasons('some gloss', 'interest', 'The bank charges high interest on loans.');
      expect(reasons).not.toContain('penalty-pos-mismatch');
      expect(reasons).not.toContain('ok-pos-match');
    });
  });

  describe('glossPosShape', () => {
    it('classifies Spanish verb glosses', () => {
      expect(glossPosShape('discutir por pequeñeces')).toBe('verb');
      expect(glossPosShape('dirigir')).toBe('verb');
      expect(glossPosShape('correr')).toBe('verb');
      expect(glossPosShape('poner peros a')).toBe('verb');
      expect(glossPosShape('buscar evasivas')).toBe('verb');
    });

    it('classifies noun/adjective glosses', () => {
      expect(glossPosShape('objeción')).toBe('noun-adj');
      expect(glossPosShape('sutileza')).toBe('noun-adj');
      expect(glossPosShape('efímero')).toBe('noun-adj');
      expect(glossPosShape('serendipia')).toBe('noun-adj');
    });
  });

  describe('pickLexicalTranslations with the gate', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('publishes the verb gloss for a verb sentence (quibble case)', () => {
      // The documented failure: VIP published "objeción" (noun) for
      // "They quibble over trivial details". Cambridge carries both the
      // noun and the verb gloss.
      const ranked = pickLexicalTranslations('quibble', [
        { source: 'cambridge', text: 'objeción' },
        { source: 'cambridge', text: 'discutir por pequeñeces' },
        { source: 'wiktApi', text: 'sutileza' },
      ], { sentence: 'They quibble over trivial details instead of deciding.' });

      expect(ranked[0]).toBe('discutir por pequeñeces');
      expect(ranked).toContain('objeción');
    });

    it('keeps the manage gloss first for run+company', () => {
      const ranked = pickLexicalTranslations('run', [
        { source: 'bundled', text: 'correr' },
        { source: 'cambridge', text: 'correr' },
        { source: 'dictCc', text: 'dirigir' },
        { source: 'wordReference', text: 'manejar' },
        { source: 'pons', text: 'ir (en coche)' },
      ], { sentence: 'She runs the company from home.' });

      expect(ranked[0]).toBe('dirigir');
    });

    it('does not let the POS bonus legitimize a single-source gloss', () => {
      // "músculo tensor" (one source) must NOT pass the single-source
      // filter just because its shape matches the noun hint — the
      // admission score stays untouched by the POS adjustment.
      const ranked = pickLexicalTranslations('tensor', [
        { source: 'pons', text: 'screw shackle' },
        { source: 'wordReference', text: 'músculo tensor' },
        { source: 'bundled', text: 'tensor' },
      ], { sentence: 'The model uses a tensor.' });

      expect(ranked).toEqual(['tensor']);
    });

    it('keeps the motion gloss for a motion sentence', () => {
      const ranked = pickLexicalTranslations('run', [
        { source: 'bundled', text: 'correr' },
        { source: 'dictCc', text: 'dirigir' },
      ], { sentence: 'She ran home.' });

      expect(ranked[0]).toBe('correr');
    });
  });
});
