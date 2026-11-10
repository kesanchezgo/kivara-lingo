/** Ported from the v2 prototype (docs/REDESIGN-V2.md §5.3); behaviour unchanged. */

import type { CefrLevel } from './types';

/**
 * Knowledge model of lexicon per person (no UI dependencies).
 *
 * Idea: each word has a difficulty `d` and each person a capacity `θ`, on the
 * same scale (logarithm of the rank in the subtitle frequency list; e^θ ≈ «your
 * estimated vocabulary»). The probability of knowing it is logistic,
 * P = σ((θ − d) / s): the shape of the Rasch models with which vocabulary tests
 * are validated (Masrai, 2022; Nicklin and Vitta, 2022). What justifies each
 * piece:
 *
 *  · Difficulty = frequency + CEFR level + similarity with your L1. Frequency
 *    alone explains little (Hashimoto and Egbert, 2019: six variables and
 *    R2 = .37; Hashimoto, 2021); the best predictor is being a cognate,
 *    followed by frequency and concreteness (Puimège and Peters, 2019). For
 *    Spanish speakers cognates are half of the oral academic vocabulary (Dang,
 *    Macis and Aguilera-Munizaga, 2025). Similarity is measured with the
 *    normalized Levenshtein distance against the translation (Carrasco-Ortiz,
 *    Amengual and Gries, 2019), so false friends are excluded by construction
 *    and partial ones are marked by hand (`falseFriend`).
 *  · Capacity = starting point per level, corrected with your evidence. The
 *    vocabulary size per level varies a lot between studies and people
 *    (Milton, 2010, with a 5,000 ceiling; Gesa, 2026: 5,300–11,200 families in
 *    Spanish speakers, with adjacent levels that are not always distinguished),
 *    and short tests are imprecise (Stoeckel, McLean and Nation, 2020). That is
 *    why the level is only a prior with wide uncertainty and the estimate is
 *    refined with the yes/no test corrected by pseudowords (Zhang, Liu and Ai,
 *    2019) and with your marks.
 *
 * The constants are prudent initial values; in production they are calibrated
 * with data (adjusting `d` by regression, as in Hashimoto and Egbert).
 */
export type StudyLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
export const STUDY_LEVELS: readonly StudyLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
export const LEVEL_RANK: Record<CefrLevel, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };

/**
 * Reference vocabulary (lemmas, subtitle scale) of whoever HAS that level. It
 * is used in both directions: your self-assessment → starting point, and your
 * estimated vocabulary → your level (`levelForVocab`). They are heuristics of
 * the demo, not universal CEFR sizes (the CEFR does not define vocabularies):
 * A1–B1 follow Milton (2010); above his 5,000 ceiling it is interpolated
 * towards Gesa (2026) downwards, because his multiple-choice test overestimates
 * (Stoeckel et al., 2020).
 */
export const LEVEL_VOCAB: Record<StudyLevel, number> = { A1: 1000, A2: 2000, B1: 3000, B2: 4500, C1: 6500, C2: 9000 };

/**
 * Typical difficulty of a word labelled at a level (same axis): that of your
 * own level sits below your vocabulary (whoever is B1 knows the B1 words) and
 * that of the next one, above.
 */
export const LABEL_RANK: Record<CefrLevel, number> = { A1: 500, A2: 1250, B1: 2500, B2: 3750, C1: 5500, C2: 8000 };

export const MODEL = {
  /** Logistic slope (ln): a word twice as hard as your vocabulary ≈ 20 %. */
  slope: 0.5,
  /** Uncertainty of the per-level starting point (ln 0.6 ≈ ×1.8 up or down). */
  priorSd: 0.6,
  /** Minimum spelling similarity to count as a cognate and maximum effect (≈ 4× easier). */
  cognateMin: 0.5,
  cognateBoost: 1.4,
  /** The test loses half its weight every six months: your vocabulary grows. */
  testHalfLifeDays: 180,
  /** From three months on it is suggested to retake it. */
  staleTestDays: 90,
  /**
   * Your marks are self-reports made in passing and, above all, corrections
   * (you mark what the estimate missed): they count a quarter of a test
   * response and allow a 10 % «slip» in each direction (a known word marked
   * new to review a sense, or vice versa). With that weight a mark moves your
   * base vocabulary 7–10 % (A2: 2,000 → 1,850 or 2,150) and never changes
   * level on its own; ten coherent marks on B1-level words do take you from A2
   * to B1 (2,000 → 3,250). With 0.5 a single mark moved 15–17 %. Without the
   * slip, 8 marks on very easy words sank the estimate from 3,000 to 250 (4PL:
   * guessing and slip bound each response's weight).
   */
  markWeight: 0.25,
  markLapse: 0.1,
  /** In the test, guessing is measured with the pseudowords; the slip is small. */
  testSlip: 0.05,
} as const;

/** Typographic apostrophes (’ ‘ ʼ) → straight: «won’t» and «won't» are the same key. */
const APOSTROPHES = /[\u2018\u2019\u02BC]/g;
export const normalizeKey = (s: string): string => s.replace(APOSTROPHES, "'").toLowerCase();

const strip = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Spelling similarity 0–1 (1 − normalized Levenshtein distance), without accents or uppercase. */
export function orthoSim(a: string, b: string): number {
  const x = strip(a);
  const y = strip(b);
  const m = Math.max(x.length, y.length);
  return m ? 1 - levenshtein(x, y) / m : 0;
}

const ES_STOP = new Set(['para', 'como', 'esta', 'este', 'esto', 'pero', 'algo', 'cosa', 'muy', 'sobre', 'entre', 'hasta', 'desde', 'cuando']);

export interface Cognate { word: string; sim: number }

/**
 * Cognate with the person's language: the gloss word that looks most alike in
 * form. Prototype: the glosses are in Spanish, so only with `l1 = es`.
 * Expressions are out (a phrase's similarity is not that of its words).
 * Pure: the word and its gloss are given, no dictionary is consulted.
 */
export function cognateOf(word: string, translation: string): Cognate | undefined {
  if (word.includes(' ') || word.length < 4) return undefined;
  let best: Cognate | undefined;
  for (const w of (translation || '').split(/[^\p{L}]+/u)) {
    if (w.length < 4 || ES_STOP.has(strip(w))) continue;
    const sim = orthoSim(word, w);
    if (sim > MODEL.cognateMin && (!best || sim > best.sim)) best = { word: w, sim };
  }
  return best;
}

export interface WordFeatures { level?: CefrLevel; rank?: number; cognate?: Cognate; falseFriend?: string }

/** Data the model needs about a word, injected by the caller (the lexicon lives behind a port). */
export interface WordFeaturesInput { key: string; level?: CefrLevel; rank?: number; gloss?: string; falseFriend?: string }

/**
 * Word features for the model. Pure: level, rank, gloss and false friend come
 * in as arguments, so the dictionary stays behind its port (`LexiconPort`).
 * A false friend cancels the cognate (the resemblance is a trap, not help).
 */
export function wordFeatures(input: WordFeaturesInput, l1: string): WordFeatures {
  return {
    level: input.level,
    rank: input.rank,
    cognate: l1 === 'es' && !input.falseFriend ? cognateOf(input.key, input.gloss ?? '') : undefined,
    falseFriend: l1 === 'es' ? input.falseFriend : undefined,
  };
}

export function cognateShift(c?: Cognate): number {
  return c ? MODEL.cognateBoost * Math.min(1, (c.sim - MODEL.cognateMin) / (1 - MODEL.cognateMin)) : 0;
}

/**
 * Difficulty (ln-rank): mean of the frequency and the CEFR level when both are
 * present (each corrects the other: «bedroom» is A1 even if it is not among the
 * most frequent; «gonna» has no level but has frequency), minus the cognate
 * effect. `undefined` = no data to estimate.
 */
export function difficulty(f: WordFeatures, withCognate = true): number | undefined {
  const parts: number[] = [];
  if (f.rank !== undefined) parts.push(Math.log(Math.max(1, f.rank)));
  if (f.level) parts.push(Math.log(LABEL_RANK[f.level]));
  if (!parts.length) return undefined;
  const d = parts.reduce((a, b) => a + b, 0) / parts.length;
  return withCognate ? d - cognateShift(f.cognate) : d;
}

export const pKnown = (theta: number, d: number) => 1 / (1 + Math.exp(-(theta - d) / MODEL.slope));

/**
 * One response: a word of difficulty `d`, known (`y`) or not, with weight `w`,
 * guessing `g` (saying «I know it» without knowing it) and slip `s` (saying
 * «no» while knowing it).
 */
export interface Obs { d: number; y: 0 | 1; w: number; g?: number; s?: number }

/**
 * Most likely capacity (MAP) given the evidence and a normal starting point.
 * Probability of answering «I know it»: g + (1 − g − s)·P (the 4PL model:
 * guessing and slip). Grid over [ln 50, ln 30,000] and refined by golden-section
 * around the best point: with contradictory evidence the function can have two
 * maxima and a local search would stop at the worst one.
 */
export function estimateTheta(mu: number, sd: number, obs: readonly Obs[]): number {
  const f = (th: number) => {
    let v = -((th - mu) ** 2) / (2 * sd * sd);
    for (const o of obs) {
      const g = o.g ?? 0;
      const q = g + (1 - g - (o.s ?? 0)) * pKnown(th, o.d);
      v += o.w * Math.log(Math.max(o.y ? q : 1 - q, 1e-9));
    }
    return v;
  };
  const lo = Math.log(50);
  const hi = Math.log(30000);
  const steps = 120;
  const step = (hi - lo) / steps;
  let bestI = 0;
  let bestV = -Infinity;
  for (let i = 0; i <= steps; i++) {
    const v = f(lo + i * step);
    if (v > bestV) { bestV = v; bestI = i; }
  }
  let a = lo + Math.max(0, bestI - 1) * step;
  let b = lo + Math.min(steps, bestI + 1) * step;
  const r = (Math.sqrt(5) - 1) / 2;
  let c = b - r * (b - a);
  let d = a + r * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let i = 0; i < 30; i++) {
    if (fc > fd) { b = d; d = c; fd = fc; c = b - r * (b - a); fc = f(c); } else { a = c; c = d; fc = fd; d = a + r * (b - a); fd = f(d); }
  }
  return (a + b) / 2;
}

/** Readable vocabulary (multiple of 50). */
export const vocabOf = (theta: number) => Math.round(Math.exp(theta) / 50) * 50;

/** Closest level to a vocabulary (on the logarithmic scale). */
export function levelForVocab(size: number): StudyLevel {
  const x = Math.log(Math.max(1, size));
  let best: StudyLevel = 'A1';
  for (const l of STUDY_LEVELS) if (Math.abs(Math.log(LEVEL_VOCAB[l]) - x) < Math.abs(Math.log(LEVEL_VOCAB[best]) - x)) best = l;
  return best;
}

/**
 * Boundaries between levels: the geometric mean of two adjacent levels (where
 * `levelForVocab` switches from one to the other). A1 starts and C2 ends at the
 * same logarithmic distance from their reference.
 */
function levelBounds(l: StudyLevel): [number, number] {
  const i = STUDY_LEVELS.indexOf(l);
  const v = (j: number) => LEVEL_VOCAB[STUDY_LEVELS[j]];
  const lo = i > 0 ? Math.sqrt(v(i - 1) * v(i)) : v(0) / Math.sqrt(v(1) / v(0));
  const last = STUDY_LEVELS.length - 1;
  const hi = i < last ? Math.sqrt(v(i) * v(i + 1)) : v(last) * Math.sqrt(v(last) / v(last - 1));
  return [lo, hi];
}

/** Level of a vocabulary, the next one, from how many words it starts and the progress (0–1, logarithmic scale). */
export function levelProgress(size: number): { level: StudyLevel; next: StudyLevel | null; nextAt: number | null; progress: number } {
  const level = levelForVocab(size);
  const [lo, hi] = levelBounds(level);
  const i = STUDY_LEVELS.indexOf(level);
  const next = i < STUDY_LEVELS.length - 1 ? STUDY_LEVELS[i + 1] : null;
  const progress = Math.min(1, Math.max(0, Math.log(Math.max(1, size) / lo) / Math.log(hi / lo)));
  return { level, next, nextAt: next ? Math.round(hi / 50) * 50 : null, progress };
}
