/**
 * Vocabulary self-check: yes/no recognitions plus pseudowords, corrected by a
 * short meaning check (docs/REDESIGN-V2.md §3 H8, §5.3; ported from the
 * prototype).
 *
 * Format: mark the words you know the meaning of; the invented words measure
 * how much you tick by intuition. It is a valid format for receptive
 * vocabulary (Masrai, 2022) as long as the pseudowords resemble the real ones:
 * their false alarms track the guessing rate on the real ones (r > .80,
 * Zhang, Liu and Ai, 2019). It measures form recognition above all (Lee et
 * al., 2025) and a short sample is imprecise (Stoeckel, McLean and Nation,
 * 2020): that is why the result is not applied as truth but as evidence for
 * `lexicalModel`, with the guessing rate as parameter g and a weight that
 * decays over time. The check NEVER blocks saving: a result with many misses
 * is corrected (its marks weigh less) and the screen says so.
 *
 * v2 differences from the prototype:
 *  · The bank is the committed one (160 lemmas + 60 pseudowords, four
 *    frequency bands up to rank 12,000), not hand-picked words. Each attempt
 *    samples 10 per band (40) plus 5 pseudowords = 45 items, a different
 *    sample every time, so retaking it is not remembering it.
 *  · Glosses are not in the bank: they come from the bundled dictionary, so a
 *    word without a gloss is excluded from the meaning step. Pass the enriched
 *    bank (`withGlosses`) and the same object everywhere, or the sample and the
 *    scoring will disagree.
 *  · Difficulty uses the exact subtitle rank of each item (the prototype only
 *    had a band centre), minus the cognate effect when the gloss resembles the
 *    word in the learner's language.
 */
import bank from '../../assets/study/vocab-bank.json';
import {
  MODEL, cognateShift, estimateTheta, levelForVocab, orthoSim, vocabOf,
  type Obs, type StudyLevel,
} from './lexicalModel';

export interface VcItem {
  word: string;
  /** 0-based frequency band; null for an invented word. */
  band: number | null;
  /** Subtitle rank of the lemma (0 for invented words). */
  rank: number;
  /** Translation in the learner's language; absent without a dictionary hit. */
  gloss?: string;
}

export interface VocabBank {
  /** Real lemmas, one entry per word. */
  items: VcItem[];
  /** Invented words that do not exist. */
  fakes: string[];
}

/** Band edges of the committed bank (`_meta.bands`): 1–1250, 1251–2500, 2501–5000, 5001–12000. */
const BAND_EDGES = [1250, 2500, 5000, 12000] as const;
export const VC_BANDS = BAND_EDGES.length;
/** Real words per band and per attempt. */
export const VC_PER_BAND = 10;
export const VC_FAKES_SHOWN = 5;
/** The highest rank the check can measure. */
export const VC_MAX = BAND_EDGES[VC_BANDS - 1];

export function bandOfRank(rank: number): number {
  for (let i = 0; i < BAND_EDGES.length; i += 1) if (rank <= BAND_EDGES[i]) return i;
  return BAND_EDGES.length - 1;
}

function committedBank(): VocabBank {
  return {
    items: bank.words.map((w) => ({
      word: w.word.toLowerCase(),
      band: bandOfRank(w.rank),
      rank: w.rank,
    })),
    fakes: bank.pseudowords.map((w) => w.toLowerCase()),
  };
}

/** The bank as committed (no glosses). `withGlosses` adds them. */
export const COMMITTED_BANK: VocabBank = committedBank();

/** Attach dictionary glosses; words without one stay glossless and are skipped by the meaning step. */
export function withGlosses(source: VocabBank, glossOf: (word: string) => string | undefined): VocabBank {
  return {
    items: source.items.map((it) => {
      const gloss = glossOf(it.word);
      return gloss ? { ...it, gloss } : it;
    }),
    fakes: source.fakes,
  };
}

const REAL_SET = new Set(COMMITTED_BANK.items.map((i) => i.word));
const FAKE_SET = new Set(COMMITTED_BANK.fakes);

/** Is the word part of the committed bank at all (real or invented)? */
export const isVcWord = (w: string) => REAL_SET.has(w) || FAKE_SET.has(w);
/** Is the word a real lemma of the bank? */
export const isVcRealWord = (w: string) => REAL_SET.has(w);

/** The meaning step needs glosses in the learner's language; the prototype only had Spanish ones. */
export const hasCheckGlosses = (l1: string) => l1 === 'es';

/** A word's translation, or '' when the bank carries none. */
export function glossOf(source: VocabBank, word: string): string {
  return source.items.find((it) => it.word === word)?.gloss ?? '';
}

/* ── Sampling ───────────────────────────────────────────────────────────── */

function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Reproducible shuffle (mulberry32): the same seed gives the same paper. */
function shuffled<T>(xs: readonly T[], seed: number): T[] {
  let a = seed || 1;
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * One attempt: `VC_PER_BAND` per band and `VC_FAKES_SHOWN` invented words, in
 * an interleaved order — bands alternate and an invented word lands every
 * seven or eight real ones — so there are no runs of easy or hard items.
 */
export function sampleTest(source: VocabBank = COMMITTED_BANK, seed = Date.now()): VcItem[] {
  const byBand = Array.from({ length: VC_BANDS }, (_, b) =>
    shuffled(source.items.filter((it) => it.band === b), seed + b * 7919).slice(0, VC_PER_BAND));
  const fakes = shuffled(source.fakes, seed ^ 0x5bd1e995).slice(0, VC_FAKES_SHOWN);
  const reals: VcItem[] = [];
  for (let i = 0; i < VC_PER_BAND * VC_BANDS; i += 1) {
    reals.push(byBand[i % VC_BANDS][Math.floor(i / VC_BANDS)]);
  }
  const out: VcItem[] = [];
  const gap = reals.length / (fakes.length + 1);
  let f = 0;
  reals.forEach((it, i) => {
    out.push(it);
    if (f < fakes.length && i + 1 >= Math.round(gap * (f + 1))) {
      out.push({ word: fakes[f], band: null, rank: 0 });
      f += 1;
    }
  });
  while (f < fakes.length) {
    out.push({ word: fakes[f], band: null, rank: 0 });
    f += 1;
  }
  return out;
}

/** What was shown in a saved attempt (a test without `shown` has no evidence). */
export function shownItems(shown: readonly string[] | undefined, source: VocabBank = COMMITTED_BANK): VcItem[] {
  if (!shown?.length) return [];
  const wanted = new Set(shown);
  const out = source.items.filter((it) => wanted.has(it.word));
  for (const word of source.fakes) if (wanted.has(word)) out.push({ word, band: null, rank: 0 });
  return out;
}

/**
 * Words to check the meaning of: of the real words marked, one per band (from
 * the hardest band to the easiest) up to five.
 */
export function pickCheckWords(answers: ReadonlySet<string>, source: VocabBank = COMMITTED_BANK, seed = Date.now()): string[] {
  const byBand = Array.from({ length: VC_BANDS }, (_, i) =>
    shuffled(source.items.filter((it) => it.band === VC_BANDS - 1 - i && answers.has(it.word)).map((it) => it.word), seed + i));
  const out: string[] = [];
  while (out.length < 5 && byBand.some((l) => l.length)) {
    for (const list of byBand) {
      if (!list.length || out.length >= 5) continue;
      const word = list.shift();
      if (word) out.push(word);
    }
  }
  return out;
}

/** The correct gloss plus three from the same or adjacent bands, shuffled. */
export function checkOptions(source: VocabBank, word: string, avoid: readonly string[] = []): string[] {
  const it = source.items.find((x) => x.word === word);
  if (!it || !it.gloss) return [];
  const pool = source.items
    .filter((x) => x.word !== word && !avoid.includes(x.word) && !!x.gloss && x.gloss !== it.gloss)
    .sort((a, b) => Math.abs((a.band ?? 0) - (it.band ?? 0)) - Math.abs((b.band ?? 0) - (it.band ?? 0)))
    .slice(0, 12);
  const seen = new Set<string>([it.gloss]);
  const distractors: string[] = [];
  for (const candidate of shuffled(pool, hashOf(word))) {
    if (distractors.length === 3) break;
    if (!candidate.gloss || seen.has(candidate.gloss)) continue;
    seen.add(candidate.gloss);
    distractors.push(candidate.gloss);
  }
  return shuffled([it.gloss, ...distractors], hashOf(`${word}#`));
}

export type VcCheckAnswer = 'ok' | 'wrong' | 'idk';
export type VcChecks = Record<string, VcCheckAnswer>;
export const VC_CHECK_MAX = 5;
export const VC_CHECK_GUESS = 0.2;

/** `null` = «No lo sé». */
export const checkAnswerOf = (source: VocabBank, word: string, gloss: string | null): VcCheckAnswer =>
  gloss === null ? 'idk' : gloss === glossOf(source, word) ? 'ok' : 'wrong';

/** Difficulty of an item: its subtitle rank, minus the cognate effect with its gloss. */
export function itemDifficulty(it: VcItem, l1: string): number {
  const base = Math.log(Math.max(1, it.rank));
  const sim = l1 === 'es' && it.gloss ? orthoSim(it.word, it.gloss) : 0;
  return base - (sim > MODEL.cognateMin ? cognateShift({ word: it.gloss!, sim }) : 0);
}

/* ── Scoring ───────────────────────────────────────────────────────────── */

export interface TestObservations {
  obs: Obs[];
  falseAlarms: number;
  fakeTotal: number;
  hits: number;
  quality: 'good' | 'low';
  lowReason?: 'fakes' | 'checks';
  checked: number;
  passed: number;
  corrected: boolean;
}

/**
 * Answers → evidence for the model. A mark on an invented word is a false
 * alarm; the meaning check reclassifies the words it covered (a right answer
 * is verified knowledge, a miss or «No lo sé» is not) and its miss rate,
 * smoothed towards the pseudo-word rate, becomes the guessing rate `g` for the
 * rest of the marks. With half or more of the invented words marked the result
 * no longer informs the model's base.
 */
export function testObservations(
  answers: ReadonlySet<string>,
  l1: string,
  weight = 1,
  checks?: VcChecks,
  shown?: readonly string[],
  source: VocabBank = COMMITTED_BANK,
): TestObservations {
  // Only what was shown counts: a bank word that did not appear is not a «no».
  const items = shownItems(shown, source);
  const reals = items.filter((it) => it.band !== null);
  const fakes = items.filter((it) => it.band === null);
  const falseAlarms = fakes.filter((it) => answers.has(it.word)).length;
  const fa = fakes.length ? falseAlarms / fakes.length : 0;
  const T = reals.filter((it) => answers.has(it.word)).length;
  const R = reals.length;
  const checked = Object.entries(checks ?? {}).filter(([w]) => answers.has(w) && reals.some((it) => it.word === w));
  const n = checked.length;
  const count = (a: VcCheckAnswer) => checked.filter(([, v]) => v === a).length;
  const uRaw = n ? Math.min(1, (count('idk') + count('wrong') * (4 / 3)) / n) : 0;
  const u = n ? (n * uRaw + 2 * fa) / (n + 2) : 0;
  const knownTicks = T * (1 - u);
  const gCheck = n && R - knownTicks > 0 ? (u * T) / (R - knownTicks) : 0;
  const gFa = Math.min(0.9, fa);
  const g = Math.max(gFa, Math.min(0.9, gCheck));
  const obs: Obs[] = reals.map((it) => {
    const d = itemDifficulty(it, l1);
    const c = answers.has(it.word) ? checks?.[it.word] : undefined;
    if (c === 'ok') return { d, y: 1, w: weight, g: Math.min(gFa, VC_CHECK_GUESS), s: MODEL.testSlip };
    if (c) return { d, y: 0, w: weight, g: VC_CHECK_GUESS, s: MODEL.testSlip };
    return { d, y: answers.has(it.word) ? 1 : 0, w: weight, g, s: MODEL.testSlip };
  });
  // Quality is only ever a warning, never a gate.
  const lowReason = fa >= 0.3 ? 'fakes' as const : n >= 3 && uRaw >= 0.4 ? 'checks' as const : undefined;
  return {
    obs, falseAlarms, fakeTotal: fakes.length, hits: T,
    quality: lowReason ? 'low' : 'good', lowReason,
    checked: n, passed: count('ok'), corrected: gCheck > gFa + 0.02,
  };
}

export interface VcResult {
  /** Vocabulary estimated from the check alone (multiple of 50; capped at `VC_MAX`). */
  size: number;
  /** The result reached the ceiling of the check: «more than 12,000». */
  ceiling: boolean;
  level: StudyLevel;
  hits: number;
  falseAlarms: number;
  fakeTotal: number;
  quality: 'good' | 'low';
  lowReason?: 'fakes' | 'checks';
  checked: number;
  passed: number;
  corrected: boolean;
}

/** Result of the check alone (a neutral, wide prior: the test decides). */
export function scoreVocabCheck(
  answers: ReadonlySet<string>,
  l1: string,
  checks?: VcChecks,
  shown?: readonly string[],
  source: VocabBank = COMMITTED_BANK,
): VcResult {
  const t = testObservations(answers, l1, 1, checks, shown, source);
  const raw = vocabOf(estimateTheta(Math.log(2000), 1.5, t.obs));
  const ceiling = raw >= VC_MAX;
  const size = Math.min(raw, VC_MAX);
  return {
    size, ceiling, level: levelForVocab(size),
    hits: t.hits, falseAlarms: t.falseAlarms, fakeTotal: t.fakeTotal,
    quality: t.quality, lowReason: t.lowReason, checked: t.checked, passed: t.passed, corrected: t.corrected,
  };
}