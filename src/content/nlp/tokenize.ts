import type { DictionaryEntry } from '../../shared/types';
import { getDictionary, lookupDictionary } from './dictionary';
import { isLikelyProperNoun, lemmaCandidates } from './lemma';
import { mweLemmaCandidates } from './mwe-lemma';
import { hasYomitanHeadword } from './yomitan-headwords';

/**
 * The full token taxonomy after the Tier 2 audit.
 *
 *  - mwe              : multi-word expression in the dictionary (idiom or phrasal).
 *  - known            : single word in the dictionary (incl. via lemma fallback).
 *  - proper-noun-known: capitalized word that IS in the dictionary (e.g.
 *                       "America", "Microsoft"). Rendered with a distinct
 *                       affordance so it doesn't compete with regular vocab.
 *  - unknown          : single word NOT in the dictionary and NOT a proper noun.
 *                       Still rendered interactively — hover triggers a remote
 *                       translation lookup. Save is allowed.
 *  - ignored          : auto-classified as a proper noun NOT in the dictionary
 *                       (or user opted to hide). Rendered as plain text with no
 *                       affordance.
 *  - mastered         : the user has marked this token as fully learnt.
 *                       Rendered with opacity so it stops competing for visual
 *                       attention. Hover still works (compact popover).
 *  - punct            : whitespace / punctuation. Non-interactive.
 *
 * The three flag-style states from the spec (`isSaved`, `isHovered`,
 * `expanded`) are transverse and live on the Token object, not on `kind`.
 */
export type TokenKind =
  | 'mwe'
  | 'known'
  | 'proper-noun-known'
  | 'unknown'
  | 'ignored'
  | 'mastered'
  | 'punct';

/**
 * Optional sub-classification for MWE tokens. Surfaced in the popover so the
 * UI can tint phrasal verbs differently from idioms.
 */
export type TokenMweKind = 'idiom' | 'phrasal';

export interface Token {
  text: string;
  /** Lowercased canonical key. For MWE = the phrase. */
  key: string;
  kind: TokenKind;
  /** When kind === 'mwe', whether it's an idiom or a phrasal verb. */
  mweKind?: TokenMweKind;
  /**
   * When the dictionary hit came from the lemmatizer (e.g. user hovered
   * "running" but we matched "run"), this records the resolved lemma so the
   * popover header can show "running → run".
   */
  lemma?: string;
}

/**
 * Greedy tokenizer.
 *
 * Behaviour:
 *   1. Scan word groups longest-first up to MAX_MWE_LEN looking for an MWE
 *      hit in the dictionary. If found and not in `expanded`, emit as 'mwe'.
 *   2. For single-word fallbacks, look up the literal lowercased token first.
 *   3. If that misses, try lemma candidates from `lemmaCandidates()`. The
 *      first dictionary hit wins; record the resolved lemma on the token.
 *   4. If still no hit, decide between 'unknown' and 'ignored' using
 *      `isLikelyProperNoun()` (capitalized mid-sentence + not in dict).
 *
 * `expanded` lets the user manually break apart an MWE; tokens inside an
 * expanded MWE are emitted as their individual single-word tokens instead.
 */
const MAX_MWE_LEN = 5;

export function tokenizeSentence(
  sentence: string,
  expanded: Set<string> = new Set(),
  lang = 'en',
  /**
   * Optional set of tokens (lower-cased keys or MWE phrases) the user has
   * marked as `ignored` — the tokenizer applies this as a final override so
   * proper nouns / blacklisted words stop highlighting without modifying the
   * dictionary.
   */
  ignored: Set<string> = new Set(),
  /**
   * Optional set of tokens (lower-cased keys or MWE phrases) the user has
   * marked as `mastered` — same idea as ignored but kept interactive with a
   * dimmed appearance.
   */
  mastered: Set<string> = new Set(),
): Token[] {
  // Token regex. Compound words with internal hyphens (well-known, mother-in-law,
  // self-aware) are kept as a single token so the dictionary lookup has a
  // chance to hit. Apostrophe-internal words (don't, John's, won't) are also
  // single tokens. Pure punctuation runs and whitespace runs are emitted as
  // their own tokens.
  const raw = sentence.match(/[\w']+(?:-[\w']+)*|[^\w\s-]+|-+|\s+/g) ?? [];
  const words: { text: string; idx: number }[] = [];
  raw.forEach((t, idx) => {
    if (/[\w']/.test(t)) words.push({ text: t, idx });
  });

  const dict = getDictionary(lang);

  const wordKey = new Map<number, Token>();
  let i = 0;
  while (i < words.length) {
    let matched = false;
    // 1. Try MWE matches (longest first).
    for (let len = Math.min(MAX_MWE_LEN, words.length - i); len >= 2; len--) {
      const phrase = words.slice(i, i + len).map((w) => w.text).join(' ').toLowerCase();
      // Probe the literal phrase first, then lemmatized candidates so an
      // inflected MWE in speech ("big girls", "kicked the bucket",
      // "looking up") still resolves to its dictionary citation form.
      let entry = dict[phrase];
      let matchedKey = phrase;
      if (!(entry?.type === 'phrase')) {
        const candidates = mweLemmaCandidates(phrase);
        for (let c = 1; c < candidates.length; c += 1) {
          const hit = dict[candidates[c]];
          if (hit?.type === 'phrase') {
            entry = hit;
            matchedKey = candidates[c];
            break;
          }
        }
      }
      if (entry?.type === 'phrase' && !expanded.has(phrase) && !expanded.has(matchedKey)) {
        const text = words.slice(i, i + len).map((w) => w.text).join(' ');
        let kind: TokenKind = 'mwe';
        if (ignored.has(matchedKey) || ignored.has(phrase)) kind = 'ignored';
        else if (mastered.has(matchedKey) || mastered.has(phrase)) kind = 'mastered';
        wordKey.set(words[i].idx, {
          text,
          key: matchedKey,
          kind,
          mweKind: entry.phraseKind ?? 'idiom',
          // Record the inflected→citation mapping so the popover can show
          // "big girls → big girl" the same way it does for single words.
          lemma: matchedKey !== phrase ? matchedKey : undefined,
        });
        for (let k = 1; k < len; k++) {
          wordKey.set(words[i + k].idx, { text: '', key: '', kind: 'mwe' });
        }
        i += len;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // 2. Single-word fallback: literal → lemma candidates → installed Yomitan
    //    packs (so words outside the bundled `en.json` but covered by an
    //    EN→ES / EN→EN pack still classify as `known`).
    const w = words[i];
    const literal = w.text.toLowerCase();
    let resolvedKey = literal;
    let resolvedLemma: string | undefined;
    let isKnown = !!dict[literal];

    if (!isKnown) {
      // Try lemma candidates against the bundled dict. lemmaCandidates()
      // always includes the literal first; skip index 0 since we already
      // tested it.
      const candidates = lemmaCandidates(w.text);
      for (let c = 1; c < candidates.length; c++) {
        if (dict[candidates[c]]) {
          isKnown = true;
          resolvedKey = candidates[c];
          resolvedLemma = candidates[c];
          break;
        }
      }
      // Yomitan headword fallback. Only `en` is supported by the
      // lemmatizer right now, so for other source languages we just
      // probe the literal. We try the literal first (cheap) then the
      // lemma candidates (also cheap — Set.has is O(1)).
      if (!isKnown && hasYomitanHeadword(literal)) {
        isKnown = true;
        resolvedKey = literal;
      } else if (!isKnown) {
        const candidates = lemmaCandidates(w.text);
        for (let c = 1; c < candidates.length; c++) {
          if (hasYomitanHeadword(candidates[c])) {
            isKnown = true;
            resolvedKey = candidates[c];
            resolvedLemma = candidates[c];
            break;
          }
        }
      }
    }

    // 3. Decide final kind.
    let kind: TokenKind;
    if (ignored.has(resolvedKey) || ignored.has(literal)) {
      kind = 'ignored';
    } else if (mastered.has(resolvedKey) || mastered.has(literal)) {
      kind = 'mastered';
    } else if (isKnown) {
      // Distinguish a capitalized known token (proper noun the dict recognises,
      // e.g. "America", "Microsoft") from a regular vocabulary hit. This lets
      // the renderer pick a subtler affordance so culturally-loaded words
      // don't compete with verbs/nouns the learner is trying to study.
      const cuePos: 'start' | 'middle' | 'end' =
        i === 0 ? 'start' : i === words.length - 1 ? 'end' : 'middle';
      kind = isLikelyProperNoun(w.text, cuePos) ? 'proper-noun-known' : 'known';
    } else {
      const cuePos: 'start' | 'middle' | 'end' =
        i === 0 ? 'start' : i === words.length - 1 ? 'end' : 'middle';
      // Proper-noun heuristic — only applies when the dictionary doesn't have
      // the word (otherwise dictionary wins). Mid-sentence capitalized words
      // (Nicola, Pedro) get silently demoted to 'ignored' to cut visual noise.
      kind = isLikelyProperNoun(w.text, cuePos) ? 'ignored' : 'unknown';
    }

    wordKey.set(w.idx, {
      text: w.text,
      key: resolvedKey,
      kind,
      lemma: resolvedLemma,
    });
    i++;
  }

  const tokens: Token[] = [];
  raw.forEach((t, idx) => {
    if (/^\s+$/.test(t)) tokens.push({ text: t, key: `_sp${idx}`, kind: 'punct' });
    else if (/^[^\w\s]+$/.test(t)) tokens.push({ text: t, key: `_p${idx}`, kind: 'punct' });
    else {
      const tok = wordKey.get(idx);
      if (tok && tok.text) tokens.push(tok);
    }
  });
  return tokens;
}

/**
 * Returns dictionary metadata for a token. Falls back to lemma candidates so
 * "running" returns the entry for "run". Returns a placeholder entry when
 * nothing is found.
 */
export function lookup(token: string, lang = 'en'): DictionaryEntry {
  const literal = lookupDictionary(token, lang);
  if (literal) return literal;

  // Multi-word phrase: try MWE lemma candidates ("big girls" → "big girl",
  // "kicked the bucket" → "kick the bucket") before falling back to the
  // single-word lemmatizer.
  if (token.includes(' ')) {
    const mweCandidates = mweLemmaCandidates(token);
    for (let i = 1; i < mweCandidates.length; i += 1) {
      const hit = lookupDictionary(mweCandidates[i], lang);
      if (hit) return { ...hit, token, lemmaOf: mweCandidates[i] };
    }
  }

  const candidates = lemmaCandidates(token);
  for (let i = 1; i < candidates.length; i++) {
    const hit = lookupDictionary(candidates[i], lang);
    if (hit) return { ...hit, token };
  }

  return {
    token,
    type: token.includes(' ') ? 'phrase' : 'word',
    translation: '—',
  };
}
