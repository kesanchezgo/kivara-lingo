import { describe, expect, it } from 'vitest';
import { lookupDictionary } from '../../src/content/nlp/dictionary';

describe('ACL collocation overlay filters corpus adverb bigrams', () => {
  it('drops "clearly give"-style adverb bigrams from the bundled overlay', () => {
    // The ACL (Ackermann & Chen 2013) carries corpus adverb bigrams for
    // frequent verbs; they are frequency artifacts, not learner
    // collocations. The overlay must filter them before they reach the
    // bundle (verified live 2026-08-30: `give` shipped "clearly give",
    // "currently give", "directly give", "freely give" to the card).
    const entry = lookupDictionary('give', 'en');
    const collocations = entry?.collocations ?? [];
    expect(collocations).not.toContain('clearly give');
    expect(collocations).not.toContain('freely give');
    for (const phrase of collocations) {
      const words = phrase.toLowerCase().split(/\s+/);
      if (words.length === 2) {
        expect(/^[a-z]+ly$/.test(words[0])).toBe(false);
        expect(/^[a-z]+ly$/.test(words[1])).toBe(false);
      }
    }
  });

  it('covers high-frequency verbs the ACL misses', () => {
    // The ACL has 471 headwords but no run/forget/know/break entries —
    // the hand-curated verb overlay fills exactly that gap (offline,
    // zero-network). Verified against the 2026-09-10 corpus pools:
    // these pairings appear in Longman/PONS/ozdic sense groups.
    for (const [verb, chunk] of [
      ['run', 'run a marathon'],
      ['forget', 'forget your keys'],
      ['know', 'know the answer'],
      ['break', 'break a record'],
    ] as Array<[string, string]>) {
      expect(lookupDictionary(verb, 'en')?.collocations ?? []).toContain(chunk);
    }
    // Sense-scoped pairs live in the bundled SOURCE (relationGroups),
    // not in the flat map — `run a company` must NOT leak flat onto a
    // motion card. Verified live 2026-09-10.
    expect(lookupDictionary('run', 'en')?.collocations ?? []).not.toContain('run a company');
  });
});
