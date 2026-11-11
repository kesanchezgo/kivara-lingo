/**
 * ES↔EN false friends (docs/REDESIGN-V2.md §3 H8, §5.3).
 *
 * The list is committed data (src/assets/study/es-en-false-friends.json, 311
 * pairs) and small enough to inline. A false friend cancels the cognate effect
 * of the lexical model — the resemblance is a trap, not help — and the word
 * card cites the Spanish twin it is confused with.
 *
 * Only the English lemma is indexed: the model asks "does this English word
 * look like a Spanish word with another meaning", so the lookup key is the
 * English side and the returned word is the Spanish one.
 */
import data from '../../assets/study/es-en-false-friends.json';

export interface FalseFriend {
  /** The Spanish word it is confused with. */
  es: string;
  /** One line contrasting both meanings. */
  note: string;
}

const BY_EN = new Map<string, FalseFriend>();

for (const item of data.items) {
  const key = item.en.trim().toLowerCase();
  if (!key) continue;
  // First entry wins: the file is curated and a repeated English headword
  // would be a data defect, not a second meaning to merge.
  if (!BY_EN.has(key)) BY_EN.set(key, { es: item.es, note: item.note });
}

export const FALSE_FRIEND_COUNT = BY_EN.size;

/** The Spanish twin of an English lemma, or undefined when it is not a trap. */
export function falseFriendOf(lemma: string): FalseFriend | undefined {
  return BY_EN.get(lemma.trim().toLowerCase());
}
