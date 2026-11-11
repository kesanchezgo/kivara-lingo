/**
 * Episode lexical coverage (docs/REDESIGN-V2.md §5.3).
 *
 * Coverage counts every RUNNING WORD in the episode — each appearance, not
 * each distinct lemma — because that is what the listening studies measure
 * (Durbahn, Rodgers, Macis & Peters, 2024): 80% is the minimum to follow a
 * video, 95% the comfortable band. The verdict describes, it does not promise:
 * the link between coverage and comprehension is weak and varies per episode
 * (Webb, Pellicer-Sánchez & Wang, 2025).
 *
 * Status comes from the study binding, so a word marked known, in Anki or
 * estimated known contributes its occurrences to the «known» share. Pure and
 * separate from the view: a test drives it with a fixed `statusOf`.
 */
import type { WordStatus } from '../../../shared/study/wordStatus';

/** Minimum share to follow a video (Durbahn et al., 2024). */
export const COVERAGE_MIN = 80;
/** Comfortable share. */
export const COVERAGE_OPTIMAL = 95;

export type CoverageOcc = Record<WordStatus, number>;

export interface EpisodeCoverage {
  /** Running-word count per status. */
  occ: CoverageOcc;
  /** Running words with a status. */
  total: number;
  /** Share of `status`, rounded to the nearest integer. */
  pct(status: WordStatus): number;
  /** Share of known running words. */
  knownPct: number;
}

export interface CoverageWord {
  /** Status key of the lemma. */
  key: string;
  /** Appearances of the lemma in the episode. */
  count: number;
}

export function episodeCoverage(
  words: readonly CoverageWord[],
  statusOf: (key: string) => WordStatus,
): EpisodeCoverage {
  const occ: CoverageOcc = { new: 0, learning: 0, known: 0 };
  for (const word of words) occ[statusOf(word.key)] += word.count;
  const total = occ.new + occ.learning + occ.known;
  const pct = (status: WordStatus) => (total ? Math.round((occ[status] / total) * 100) : 0);
  return { occ, total, pct, knownPct: pct('known') };
}

/** Comprehension bucket of a share: easy at 95%, followable at 80%, hard below. */
export function coverageVerdictKey(knownPct: number): string {
  if (knownPct >= COVERAGE_OPTIMAL) return 'ws.coverageEasy';
  if (knownPct >= COVERAGE_MIN) return 'ws.coverageOk';
  return 'ws.coverageHard';
}