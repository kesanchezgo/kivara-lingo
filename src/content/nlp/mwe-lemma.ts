/**
 * Multi-word-expression (MWE) lemmatization.
 *
 * The single-word lemmatizer (`lemmaCandidates`) resolves "running" → "run"
 * so the dictionary hit on the citation form succeeds. MWEs need the same
 * treatment: a learner watching a video sees the INFLECTED phrase
 *   - "big girls"          (plural)  → dictionary key "big girl"
 *   - "kicked the bucket"  (past)    → dictionary key "kick the bucket"
 *   - "looking up"         (gerund)  → dictionary key "look up"
 *   - "pieces of cake"     (plural)  → dictionary key "piece of cake"
 *
 * Without this, the tokenizer only finds the MWE when the speaker happens
 * to use the exact citation form — rare in natural speech.
 *
 * Strategy: generate candidate phrases by lemmatizing the word most likely
 * to be inflected:
 *   - the LAST word  (noun-headed phrases: "big girl(s)", "piece(s) of cake")
 *   - the FIRST word (verb-headed phrases: "kick(ed) the bucket", "look(ing) up")
 *
 * We don't try every combination (would explode for 5-word phrases); the
 * head verb and the head noun cover virtually all inflected MWEs in English.
 *
 * Returns an ordered, de-duplicated list of candidate phrase keys. The
 * literal phrase is always first so an exact dictionary hit short-circuits.
 *
 * Performance: O(words) string work, no allocations beyond a small array.
 */

import { lemmaCandidates } from './lemma';

const MAX_MWE_WORDS = 5;

/**
 * Given a raw multi-word phrase (already lowercased by the caller is fine,
 * we lowercase defensively), return candidate dictionary keys to probe.
 */
export function mweLemmaCandidates(phrase: string): string[] {
  const lower = phrase.trim().toLowerCase();
  if (!lower || !lower.includes(' ')) return lower ? [lower] : [];

  const words = lower.split(/\s+/);
  if (words.length < 2 || words.length > MAX_MWE_WORDS) return [lower];

  const out: string[] = [lower];
  const push = (candidate: string) => {
    if (candidate && candidate !== lower && !out.includes(candidate)) {
      out.push(candidate);
    }
  };

  // 1. Lemmatize the LAST word (noun-headed: "big girls" → "big girl",
  //    "pieces of cake" → "piece of cake"). We take the lemma candidates
  //    of the last word and rebuild the phrase with each.
  const lastIdx = words.length - 1;
  const lastLemmas = lemmaCandidates(words[lastIdx]);
  // lemmaCandidates[0] is the literal — skip it (already in `lower`).
  for (let i = 1; i < lastLemmas.length; i += 1) {
    const rebuilt = [...words.slice(0, lastIdx), lastLemmas[i]].join(' ');
    push(rebuilt);
  }

  // 2. Lemmatize the FIRST word (verb-headed: "kicked the bucket" →
  //    "kick the bucket", "looking up" → "look up", "gave up" → "give up").
  const firstLemmas = lemmaCandidates(words[0]);
  for (let i = 1; i < firstLemmas.length; i += 1) {
    const rebuilt = [firstLemmas[i], ...words.slice(1)].join(' ');
    push(rebuilt);
  }

  // 3. Lemmatize BOTH head verb and last word together for phrases where
  //    both inflect (rare but cheap: "putting on airs" → "put on airs"
  //    already covered by first-word; "made faces" handled by first-word).
  //    We additionally cover the verb-first + noun-last combo for safety.
  if (firstLemmas.length > 1 && lastLemmas.length > 1 && words.length >= 3) {
    const rebuilt = [
      firstLemmas[1],
      ...words.slice(1, lastIdx),
      lastLemmas[1],
    ].join(' ');
    push(rebuilt);
  }

  return out;
}
