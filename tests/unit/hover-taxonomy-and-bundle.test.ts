import { describe, expect, it } from 'vitest';
import { getDictionary, lookupDictionary } from '../../src/content/nlp/dictionary';
import { tokenizeSentence } from '../../src/content/nlp/tokenize';

const nonPunctuation = (sentence: string) =>
  tokenizeSentence(sentence, new Set()).filter((token) => token.kind !== 'punct');

describe('offline bundle and first-hover taxonomy', () => {
  it('keeps common grammatical forms interactive and sends their normalized key to lookup', () => {
    const samples = [
      'apple', // concrete noun
      'freedom', // abstract noun
      'run', // verb
      'wonderful', // adjective
      'quickly', // adverb
      'anything', // pronoun
      'each', // determiner
      'despite', // preposition
      'nevertheless', // discourse connector
      "don't", // contraction
      'well-known', // hyphenated word
      'tensor', // technical vocabulary (may fall back to remote)
      'lit', // slang / polysemous vocabulary (may fall back to remote)
    ];

    for (const sample of samples) {
      const token = nonPunctuation('We saw ' + sample + ' today.').find(
        (item) => item.text.toLowerCase() === sample,
      );
      expect(token, sample).toBeDefined();
      // Known terms paint instantly; unknown terms are deliberately still
      // interactive so the remote chain can enrich new, technical and slang
      // vocabulary instead of silently dropping it.
      expect(['known', 'unknown']).toContain(token!.kind);
      expect(token!.key).toBeTruthy();
    }

    const inflectedVerb = nonPunctuation('She ran home.').find((token) => token.text === 'ran');
    // Some common irregular forms have their own curated bundle entry; both
    // direct and lemma-resolved keys are valid as long as that exact key
    // resolves before the network stage.
    expect(inflectedVerb?.kind).toBe('known');
    expect(lookupDictionary(inflectedVerb!.key)).toBeDefined();
  });

  it('uses curated local senses for audited polysemous and technical terms', () => {
    expect(lookupDictionary('run')).toMatchObject({ translation: 'correr' });
    expect(lookupDictionary('forget')).toMatchObject({ translation: 'olvidar' });
    expect(lookupDictionary('each')).toMatchObject({ translation: 'cada' });
    expect(lookupDictionary('tensor')).toMatchObject({ translation: 'tensor' });
    expect(lookupDictionary('lit')).toMatchObject({
      translation: 'genial',
      monolingual: 'Slang: excellent, exciting, or highly enjoyable.',
    });
  });

  it('normalizes both phrasal verbs and idioms before the hover source chain', () => {
    const phrasal = nonPunctuation('She was looking up the word.').find(
      (token) => token.text.toLowerCase() === 'looking up',
    );
    expect(phrasal).toMatchObject({
      kind: 'mwe',
      mweKind: 'phrasal',
      key: 'look up',
      lemma: 'look up',
    });
    expect(lookupDictionary(phrasal!.key)).toBeDefined();

    const idiom = nonPunctuation('The old horse kicked the bucket.').find(
      (token) => token.text.toLowerCase() === 'kicked the bucket',
    );
    expect(idiom).toMatchObject({
      kind: 'mwe',
      mweKind: 'idiom',
      key: 'kick the bucket',
      lemma: 'kick the bucket',
    });
    expect(lookupDictionary(idiom!.key)).toBeDefined();
  });

  it('preserves every token state: known proper noun, unknown, ignored, mastered and punctuation', () => {
    const knownProperNoun = nonPunctuation('We saw Apple today.').find(
      (token) => token.text === 'Apple',
    );
    expect(knownProperNoun?.kind).toBe('proper-noun-known');

    const unknown = nonPunctuation('A quizzaciously word appears.').find(
      (token) => token.text === 'quizzaciously',
    );
    expect(unknown?.kind).toBe('unknown');

    const properNoun = nonPunctuation('We met Quizzaciously yesterday.').find(
      (token) => token.text === 'Quizzaciously',
    );
    expect(properNoun?.kind).toBe('ignored');

    const manuallyIgnored = tokenizeSentence(
      'We saw apple.',
      new Set(),
      'en',
      new Set(['apple']),
    ).find((token) => token.text === 'apple');
    expect(manuallyIgnored?.kind).toBe('ignored');

    const mastered = tokenizeSentence(
      'We saw apple.',
      new Set(),
      'en',
      new Set(),
      new Set(['apple']),
    ).find((token) => token.text === 'apple');
    expect(mastered?.kind).toBe('mastered');
    expect(tokenizeSentence('Hello, world!', new Set()).some((token) => token.kind === 'punct')).toBe(true);
  });

  it('has a large local baseline and resolves a mixed hover corpus fast after bundle load', () => {
    const entries = Object.values(getDictionary('en'));
    const phrases = entries.filter((entry) => entry.type === 'phrase');
    const realTranslations = entries.filter(
      (entry) => (entry.translation ?? '').trim() !== '' && entry.translation !== '—',
    );
    expect(entries.length).toBeGreaterThan(30_000);
    expect(phrases.length).toBeGreaterThan(20_000);
    expect(realTranslations.length).toBeGreaterThan(3_000);
    expect(entries.some((entry) => !!entry.monolingual)).toBe(true);
    expect(entries.some((entry) => !!entry.examples?.length)).toBe(true);
    expect(entries.some((entry) => !!entry.synonyms?.length)).toBe(true);
    expect(entries.some((entry) => !!entry.collocations?.length)).toBe(true);

    const corpus = [
      'apple', 'freedom', 'ran', 'wonderful', 'quickly', 'anything', 'each',
      'despite', 'nevertheless', "don't", 'well-known', 'tensor', 'lit',
      'look up', 'kick the bucket', 'make a decision', 'big deal', 'quizzaciously',
    ];
    const started = performance.now();
    for (let iteration = 0; iteration < 25; iteration += 1) {
      for (const token of corpus) lookupDictionary(token);
    }
    expect(performance.now() - started).toBeLessThan(100);
  });
});
