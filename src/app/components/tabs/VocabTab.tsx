/**
 * Vocabulary tab — placeholder until F5 (docs/REDESIGN-V2.md §7).
 *
 * The tab is wired into the panel so F5 only flips `VOCAB_TAB_ENABLED`; the
 * shell renders nothing until the word-status store, the level estimator and
 * the vocabulary test exist. The prototype's full view (level ladder, self
 * assessment, word test, coverage) is a copy of `VocabTab.tsx` from `.mock`
 * once the engine behind it is real.
 */
export const VOCAB_TAB_ENABLED = false;

export function VocabTab() {
  return null;
}