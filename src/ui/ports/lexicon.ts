/**
 * LexiconPort — the dictionary and tokenizer boundary (docs/REDESIGN-V2.md §4.2).
 *
 * Replaces the prototype's `data/segments.ts`. Phase F1 replaces the stub
 * factory below with the real engine wired to `content/nlp/tokenize`, the
 * bundled dictionary and the Yomitan packs (queried through the service
 * worker).
 */
import type { CefrLevel, DictionaryEntry, LexiconToken } from './types';

export interface LexiconPort {
  /** Tokenize a subtitle line, expanding or collapsing MWEs per `expanded`. */
  tokenize(text: string, lang: string, expanded?: boolean): Promise<LexiconToken[]>;
  /** Full dictionary entry for a token key, or null on a full miss. */
  lookup(key: string, lang: string): Promise<DictionaryEntry | null>;
  /** Corpus frequency rank of a lemma (1 = most frequent), or null when unknown. */
  rankOf(lemma: string, lang: string): Promise<number | null>;
  /** CEFR level of a key (or of its lemma), or null when unknown. */
  levelOf(key: string, lang: string): Promise<CefrLevel | null>;
  /** Lemma a surface form resolves to, or null when it is already the citation form. */
  lemmaOf(key: string, lang: string): Promise<string | null>;
}

/**
 * Build a LexiconPort from the injected engine. This is a thin F1 stub: it only
 * forwards calls, so the view tree can mount before the real engine lands.
 *
 * @deprecated Phase F1 replaces this factory with the real lexicon engine.
 */
export function createLexiconPort(engine: LexiconPort): LexiconPort {
  return {
    tokenize: (text, lang, expanded) => engine.tokenize(text, lang, expanded),
    lookup: (key, lang) => engine.lookup(key, lang),
    rankOf: (lemma, lang) => engine.rankOf(lemma, lang),
    levelOf: (key, lang) => engine.levelOf(key, lang),
    lemmaOf: (key, lang) => engine.lemmaOf(key, lang),
  };
}
