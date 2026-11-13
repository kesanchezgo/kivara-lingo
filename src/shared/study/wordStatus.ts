/**
 * Word status and level, per language (docs/REDESIGN-V2.md §3 H4/H8, §5.3,
 * §7 F5).
 *
 * Status of a word: new → learning → known. Precedence when resolving one (the
 * one Migaku/LingQ use with Anki):
 *
 *   1. what the USER marked by hand — always wins; «back to automatic» clears
 *      it and the next sources take over;
 *   2. Anki — with a card, «learning»; mature (interval ≥ 21 days, Anki's own
 *      definition) → «known». Saving a card does NOT write a user mark, so
 *      maturing can promote the word on its own;
 *   3. the lexical model (`lexicalModel`, F0) over the subtitle frequency list
 *      plus cognates and false friends: probability of knowing the word given
 *      its frequency, its CEFR level and its similarity to the learner's
 *      language, against their base vocabulary;
 *   4. new (no data to estimate).
 *
 * One profile per language: marks, Anki intervals, self-assessment and check
 * (`levelProfile`). Storage is `chrome.storage.local`, one key per language
 * (`kvl:wordStatus:<lang>`, `kvl:ankiWords:<lang>`,
 * `kvl:levelProfile:<lang>`): it grows with the user and would blow the 8 KB
 * / 120-writes-per-minute limits of `chrome.storage.sync` (§3 H4). Cross-device
 * sync is out of scope for v2.0 (D8).
 *
 * This module is chrome-free except through `chrome-local-store`; the lexicon
 * it estimates over is injected as `StudyWords`, so every function here is
 * pure or storage-only and unit-testable without React or a dictionary.
 */
import { createChromeLocalStore, type ChromeLocalStore } from '../chrome-local-store';
import {
  LEVEL_RANK, LEVEL_VOCAB, MODEL, STUDY_LEVELS, difficulty, estimateTheta,
  levelProgress, pKnown, vocabOf, wordFeatures,
  type Cognate, type Obs, type StudyLevel, type WordFeaturesInput,
} from './lexicalModel';
import {
  DEFAULT_LEVEL_PROFILE, LEVEL_PROFILE_KEY, PROVISIONAL_LEVEL, reviveLevelProfile,
  withVocabTest,
  type LevelProfile,
} from './levelProfile';
import { testObservations, type VcChecks } from './vocabCheck';
import type { CefrLevel } from './types';

export type WordStatus = 'new' | 'learning' | 'known';

/** Card of a word in Anki (by lemma). `interval` in days. */
export interface AnkiCard {
  interval: number;
}

/** Interval from which Anki considers a card mature. */
export const MATURE_INTERVAL_DAYS = 21;

const WORD_STATUS_KEY = 'kvl:wordStatus';
const ANKI_WORDS_KEY = 'kvl:ankiWords';
/** Flag of the one-time move from the global keys to per-language profiles. */
const PROFILES_FLAG = 'kvl:profilesV';

/** `kvl:wordStatus:en`, `kvl:ankiWords:fr`... */
const langKey = (base: string, lang: string) => `${base}:${lang}`;

/** Status keys are lemmas, lowercased, with typographic apostrophes folded. */
export const normalizeStatusKey = (s: string): string =>
  s.replace(/[\u2018\u2019\u02BC]/g, "'").trim().toLowerCase();

/**
 * What the estimator needs to know about lexicon data. Implemented on top of
 * the dictionary and the frequency list in `content/ui/study`; injected here
 * so this module never imports them (and stays testable).
 */
export interface StudyWords {
  /** Model features of a word: level, subtitle rank, gloss and false friend. */
  features(tokenKey: string): WordFeaturesInput;
}

/* ── Revivers ──────────────────────────────────────────────────────────── */

const isStatus = (v: unknown): v is WordStatus => v === 'new' || v === 'learning' || v === 'known';

function reviveStatusMap(raw: unknown): Record<string, WordStatus> {
  const out: Record<string, WordStatus> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) if (isStatus(v)) out[normalizeStatusKey(k)] = v;
  }
  return out;
}

function reviveAnki(raw: unknown): Record<string, AnkiCard> {
  const out: Record<string, AnkiCard> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const interval = (v as { interval?: unknown } | null)?.interval;
      if (typeof interval === 'number' && Number.isFinite(interval) && interval >= 0) {
        out[normalizeStatusKey(k)] = { interval };
      }
    }
  }
  return out;
}

/* ── Stores, one set per language ──────────────────────────────────────── */

export interface StudyStores {
  status: ChromeLocalStore<Record<string, WordStatus>>;
  anki: ChromeLocalStore<Record<string, AnkiCard>>;
  profile: ChromeLocalStore<LevelProfile>;
}

const stores = new Map<string, StudyStores>();
const hydrating = new Map<string, Promise<void>>();

/** The three stores of a profile, created on first use. */
export function studyStores(lang: string): StudyStores {
  let found = stores.get(lang);
  if (!found) {
    found = {
      // The two map stores merge `onChanged` key by key: two tabs marking
      // different words must not clobber each other. The level profile is a
      // single object, so it keeps replacing wholesale.
      status: createChromeLocalStore(langKey(WORD_STATUS_KEY, lang), {}, reviveStatusMap, { merge: 'keys' }),
      anki: createChromeLocalStore(langKey(ANKI_WORDS_KEY, lang), {}, reviveAnki, { merge: 'keys' }),
      profile: createChromeLocalStore(langKey(LEVEL_PROFILE_KEY, lang), DEFAULT_LEVEL_PROFILE, reviveLevelProfile),
    };
    stores.set(lang, found);
  }
  return found;
}

/** Drop cached stores (tests). Without `lang`, every language. */
export function resetStudyStores(lang?: string): void {
  if (lang) {
    stores.delete(lang);
    hydrating.delete(lang);
    return;
  }
  stores.clear();
  hydrating.clear();
}

/* ── Storage: per-language migration and hydration ─────────────────────── */

/** The slice of `chrome.storage.local` this module needs (injected in tests). */
export interface LocalStorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

function chromeArea(): LocalStorageArea | null {
  const local = (globalThis as { chrome?: { storage?: { local?: LocalStorageArea } } }).chrome?.storage?.local;
  return local ?? null;
}

/**
 * One-time move of the pre-profile global keys into the language that was
 * being learned at that moment. Idempotent, flag-guarded, and it never
 * overwrites a profile the per-language key already holds. Legacy shapes
 * inside the profile are handled by `reviveLevelProfile`.
 */
export async function migrateToLanguageProfiles(
  lang: string,
  area: LocalStorageArea | null = chromeArea(),
): Promise<void> {
  if (!area) return;
  const flag = (await area.get(PROFILES_FLAG).catch(() => ({}))) as Record<string, unknown>;
  if (flag?.[PROFILES_FLAG]) return;

  const legacy = await area
    .get([WORD_STATUS_KEY, ANKI_WORDS_KEY, LEVEL_PROFILE_KEY])
    .catch(() => ({} as Record<string, unknown>));
  const writes: Record<string, unknown> = {};
  const removals: string[] = [];
  for (const base of [WORD_STATUS_KEY, ANKI_WORDS_KEY, LEVEL_PROFILE_KEY]) {
    if (!(base in legacy)) continue;
    const target = langKey(base, lang);
    writes[target] = legacy[base];
    removals.push(base);
  }
  // Only write a target that is not already there: the per-language value is
  // newer by construction.
  const existing = Object.keys(writes).length
    ? await area.get(Object.keys(writes)).catch(() => ({} as Record<string, unknown>))
    : {};
  for (const key of Object.keys(writes)) if (key in existing) delete writes[key];
  if (Object.keys(writes).length) await area.set(writes).catch(() => undefined);
  if (removals.length) await area.remove(removals).catch(() => undefined);
  await area.set({ [PROFILES_FLAG]: '1' }).catch(() => undefined);
}

/**
 * Read the profile's three keys from storage. Migration runs first, once per
 * language, so a legacy global value is already at its per-language key when
 * the store hydrates.
 */
export function hydrateStudy(lang: string): Promise<void> {
  const running = hydrating.get(lang);
  if (running) return running;
  const promise = (async () => {
    await migrateToLanguageProfiles(lang);
    const s = studyStores(lang);
    await Promise.all([s.status.hydrate(), s.anki.hydrate(), s.profile.hydrate()]);
  })();
  hydrating.set(lang, promise);
  return promise;
}

/* ── Marks ─────────────────────────────────────────────────────────────── */

/** `null` clears the user mark: Anki or the estimate takes over again. */
export function setWordStatus(lang: string, tokenKey: string, status: WordStatus | null): void {
  const k = normalizeStatusKey(tokenKey);
  studyStores(lang).status.set((prev) => {
    if (status === null) {
      if (!(k in prev)) return prev;
      const next = { ...prev };
      delete next[k];
      return next;
    }
    return prev[k] === status ? prev : { ...prev, [k]: status };
  });
}

/* ── Anki intervals ────────────────────────────────────────────────────── */

/** Register or update the interval of one word (0 for a card just created). */
function setAnkiWord(lang: string, tokenKey: string, interval = 0): void {
  const k = normalizeStatusKey(tokenKey);
  const safe = Number.isFinite(interval) && interval >= 0 ? interval : 0;
  studyStores(lang).anki.set((prev) => (prev[k]?.interval === safe ? prev : { ...prev, [k]: { interval: safe } }));
}

export function removeAnkiWord(lang: string, tokenKey: string): void {
  const k = normalizeStatusKey(tokenKey);
  studyStores(lang).anki.set((prev) => {
    if (!(k in prev)) return prev;
    const next = { ...prev };
    delete next[k];
    return next;
  });
}

/**
 * Profile id of a cue language: the two-letter code, so `en-US` and `en`
 * share one profile. There is one profile per language being learned, not per
 * track tag. Lives in the pure layer so the service worker (undo path) folds
 * a registry language the same way the content script does.
 */
export function profileLangOf(lang: string): string {
  const base = (lang || 'en').trim().toLowerCase().slice(0, 2);
  return base || 'en';
}

/** Interval cache equality: same words, same values. */
function sameAnkiCache(a: Record<string, AnkiCard>, b: Record<string, AnkiCard>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => a[k].interval === b[k]?.interval);
}

/**
 * Apply an `ANKI_WORD_INTERVALS` SNAPSHOT: the response is the complete
 * picture of the deck, so the cached map is REPLACED, not merged — a word
 * that left Anki (note deleted by hand) disappears instead of haunting the
 * panel forever. User marks are NOT touched: they live in their own store
 * and only a user action clears them.
 *
 * Only reached with `{ ok: true }` — a failed query (`{ ok: false }`) never
 * calls this, so the previous cache survives an unreachable Anki intact.
 */
export function replaceAnkiIntervals(lang: string, words: Record<string, number>): void {
  const next: Record<string, AnkiCard> = {};
  for (const [word, interval] of Object.entries(words)) {
    if (typeof interval !== 'number' || !Number.isFinite(interval) || interval < 0) continue;
    next[normalizeStatusKey(word)] = { interval };
  }
  studyStores(lang).anki.set((prev) => (sameAnkiCache(prev, next) ? prev : next));
}

/**
 * The user just saved a card. A card created from a word marked «known» drops
 * that mark: the card is the new evidence and the word becomes «learning»
 * until it matures («a known word can still be saved»). A «new» mark survives —
 * the user explicitly said they do not know it. The freshly created card is
 * registered with interval 0; a later refresh reads the real interval.
 */
export function noteCardSaved(lang: string, tokenKey: string): void {
  const k = normalizeStatusKey(tokenKey);
  const s = studyStores(lang);
  s.status.set((prev) => {
    if (prev[k] !== 'known') return prev;
    const next = { ...prev };
    delete next[k];
    return next;
  });
  setAnkiWord(lang, k, 0);
}

/** Does the word have a card in Anki (cached intervals)? An Anki word is never saved twice. */
export function isInAnki(lang: string, tokenKey: string): boolean {
  return normalizeStatusKey(tokenKey) in studyStores(lang).anki.get();
}

/** How many cards the profile has, and how many of them are mature. */
export interface AnkiSummary {
  total: number;
  mature: number;
  learning: number;
}

export function ankiSummaryOf(anki: Record<string, AnkiCard>): AnkiSummary {
  const keys = Object.keys(anki);
  const mature = keys.filter((k) => anki[k].interval >= MATURE_INTERVAL_DAYS).length;
  return { total: keys.length, mature, learning: keys.length - mature };
}

/* ── Level profile ─────────────────────────────────────────────────────── */

export function setSelfLevel(lang: string, level: StudyLevel | null): void {
  studyStores(lang).profile.set((prev) => (prev.selfLevel === level ? prev : { ...prev, selfLevel: level }));
}

/** Save a check as evidence for the profile's level (never touches the self-assessment). */
export function applyVocabTest(
  lang: string,
  answers: Iterable<string>,
  checks?: VcChecks,
  shown?: readonly string[],
): void {
  studyStores(lang).profile.set((prev) => withVocabTest(prev, answers, checks, shown));
}

/* ── Estimator ─────────────────────────────────────────────────────────── */

/**
 * Where the status came from: `user` (a hand mark) · `history` (Anki: card →
 * learning, mature → known) · `estimate` (the model, with probability and main
 * reason) · `default` (new, no data to estimate).
 */
export type StatusSource = 'user' | 'history' | 'estimate' | 'default';

/** Main reason of an estimate. */
export type StatusReason =
  | 'cognate'   // known thanks to the similarity with the learner's language (without it: new)
  | 'below'     // known: CEFR level below theirs
  | 'atLevel'   // known: of their level (expression without frequency)
  | 'frequent'  // known: frequent for their vocabulary
  | 'above'     // new: CEFR level above theirs
  | 'rare'      // new: rare for their vocabulary
  | 'beyond'    // new: their evidence places their vocabulary below it
  | 'noData';   // new: no level and no frequency

/** Data the decision used (the card cites it). */
export interface StatusBasis {
  p: number;
  level?: CefrLevel;
  rank?: number;
  cognate?: Cognate;
  falseFriend?: string;
  userLevel: StudyLevel;
  vocab: number;
  provisional: boolean;
}

export interface StatusDetail {
  status: WordStatus;
  source: StatusSource;
  reason?: StatusReason;
  basis?: StatusBasis;
}

/** Summary of one person's estimate in one language. */
export interface Estimator {
  /** Base capacity (ln-rank) and base vocabulary: predicts the words not marked or saved. */
  theta: number;
  base: number;
  /**
   * Total estimated vocabulary = base + what is certain and the base did not
   * already count (mature cards, «known» marks) − what the base counted and
   * the user does not know (learning cards, «new» marks). It is the expected
   * number of known words given all the evidence.
   */
  total: number;
  /** Their level: the one `total` corresponds to. Advances on its own as cards mature, marks land and checks are taken. */
  level: StudyLevel;
  /** Next level, from which word count it starts and progress inside the current one (0–1). */
  next: StudyLevel | null;
  nextAt: number | null;
  progress: number;
  /** Starting point: self-assessment or, without it, the provisional reference. */
  startLevel: StudyLevel;
  provisional: boolean;
  /** Evidence: the check (date, current weight) and the marks used in the base. */
  testAt?: number;
  testWeight: number;
  marks: number;
  mature: number;
  learning: number;
  knownMarks: number;
  /** Estimate for a word with no mark and no card. */
  detail: (tokenKey: string) => StatusDetail;
}

export interface EstimatorInput {
  marks: Record<string, WordStatus>;
  profile: LevelProfile;
  anki?: Record<string, AnkiCard>;
  /** The learner's language (cognates, false friends). */
  l1: string;
  words: StudyWords;
  now?: number;
}

const DAY = 86_400_000;

/**
 * Estimate of one profile. The base capacity is adjusted with the
 * self-assessment (starting point), the check (weight halved every six months)
 * and the «known»/«new» marks on words without a card. Anki cards do NOT move
 * the base — the words were studied because they were not known, so knowing
 * them now says nothing about the rest — but they count one by one in the
 * total vocabulary, and therefore in the level. Linear in the evidence; the
 * hooks memoise it.
 */
export function buildEstimator(input: EstimatorInput): Estimator {
  const { marks, profile, anki = {}, l1, words, now = Date.now() } = input;
  const startLevel = profile.selfLevel ?? PROVISIONAL_LEVEL;
  const featuresOf = (tokenKey: string) => wordFeatures(words.features(tokenKey), l1);
  const obs: Obs[] = [];
  let testWeight = 0;
  if (profile.vocabTest) {
    const w = 0.5 ** (Math.max(0, now - profile.vocabTest.at) / DAY / MODEL.testHalfLifeDays);
    const t = testObservations(new Set(profile.vocabTest.answers), l1, w, profile.vocabTest.checks, profile.vocabTest.shown);
    // It always counts: a test with many misses arrives already corrected (its marks weigh less).
    obs.push(...t.obs);
    testWeight = w;
  }
  let usedMarks = 0;
  for (const [k, st] of Object.entries(marks)) {
    // «Learning» by hand is ambiguous (it may mean review): only «known» and
    // «new» adjust the base, and a word with a card belongs to Anki.
    if (st === 'learning' || anki[k]) continue;
    const d = difficulty(featuresOf(k));
    if (d === undefined) continue;
    obs.push({ d, y: st === 'known' ? 1 : 0, w: MODEL.markWeight, g: MODEL.markLapse, s: MODEL.markLapse });
    usedMarks += 1;
  }
  const theta = estimateTheta(Math.log(LEVEL_VOCAB[startLevel]), MODEL.priorSd, obs);
  const base = vocabOf(theta);

  // Total vocabulary: what is certain replaces what was estimated, word by word.
  const pOf = (k: string) => {
    const d = difficulty(featuresOf(k));
    return d === undefined ? 0 : pKnown(theta, d);
  };
  // Certain state of each word with its own evidence (same precedence as
  // `resolveDetailed`: mark > Anki). Each one counts only once.
  const cardY = (k: string): 0 | 1 | undefined =>
    anki[k] ? (anki[k].interval >= MATURE_INTERVAL_DAYS ? 1 : 0) : undefined;
  const certain = new Map<string, 0 | 1>();
  for (const k of Object.keys(anki)) certain.set(k, cardY(k)!);
  for (const [k, st] of Object.entries(marks)) certain.set(k, st === 'known' ? 1 : 0);
  let total = Math.exp(theta);
  let mature = 0;
  let learning = 0;
  let knownMarks = 0;
  for (const [k, y] of certain) {
    total += y - pOf(k);
    const card = cardY(k);
    const manual = marks[k];
    if (y) {
      if (card === 1 && (!manual || manual === 'known')) mature += 1;
      else knownMarks += 1;
    } else if (card !== undefined && (!manual || manual === 'learning')) {
      learning += 1;
    }
  }
  total = Math.max(0, total);
  const lp = levelProgress(total);
  const level = lp.level;
  // Without a self-assessment or a check, the starting point is only a reference.
  const provisional = !profile.selfLevel && testWeight === 0;
  const shownTotal = Math.round(total / 50) * 50;

  const detail = (tokenKey: string): StatusDetail => {
    const f = featuresOf(tokenKey);
    const d = difficulty(f);
    if (d === undefined) return { status: 'new', source: 'default', reason: 'noData' };
    const p = pKnown(theta, d);
    const known = p >= 0.5;
    const below = !!f.level && LEVEL_RANK[f.level] < LEVEL_RANK[level];
    const above = !!f.level && LEVEL_RANK[f.level] > LEVEL_RANK[level];
    let reason: StatusReason;
    if (known) {
      const dNoCog = difficulty(f, false);
      reason = f.cognate && dNoCog !== undefined && pKnown(theta, dNoCog) < 0.5 ? 'cognate'
        : below ? 'below' : f.rank !== undefined ? 'frequent' : 'atLevel';
    } else {
      reason = above ? 'above' : f.rank !== undefined ? 'rare' : 'beyond';
    }
    return {
      status: known ? 'known' : 'new',
      source: 'estimate',
      reason,
      basis: {
        p, level: f.level, rank: f.rank, cognate: f.cognate, falseFriend: f.falseFriend,
        userLevel: level, vocab: base, provisional,
      },
    };
  };

  return {
    theta, base, total: shownTotal, level, next: lp.next, nextAt: lp.nextAt, progress: lp.progress,
    startLevel, provisional,
    testAt: testWeight > 0 ? profile.vocabTest?.at : undefined,
    testWeight, marks: usedMarks, mature, learning, knownMarks, detail,
  };
}

/** Resolve a word's status with the documented precedence (mark > Anki > estimate). */
export function resolveDetailed(
  marks: Record<string, WordStatus>,
  tokenKey: string,
  anki: Record<string, AnkiCard>,
  est: Estimator,
): StatusDetail {
  const k = normalizeStatusKey(tokenKey);
  if (marks[k]) return { status: marks[k], source: 'user' };
  if (anki[k]) {
    return {
      status: anki[k].interval >= MATURE_INTERVAL_DAYS ? 'known' : 'learning',
      source: 'history',
    };
  }
  return est.detail(tokenKey);
}

/** Preview of a check before saving it: the profile's estimate with these answers instead of the previous check. */
export function estimateWithTest(
  lang: string,
  test: { answers: Iterable<string>; checks?: VcChecks; shown?: readonly string[] },
  l1: string,
  words: StudyWords,
  now = Date.now(),
): Estimator {
  const s = studyStores(lang);
  return buildEstimator({
    marks: s.status.get(),
    profile: {
      ...s.profile.get(),
      vocabTest: {
        answers: [...new Set(test.answers)],
        at: now,
        checks: test.checks,
        shown: test.shown ? [...test.shown] : undefined,
      },
    },
    anki: s.anki.get(),
    l1,
    words,
    now,
  });
}

/**
 * How much the self-assessment still weighs: the level with the current
 * evidence if the person chose A1 (`low`) or C2 (`high`). With evidence the
 * range is narrow; without it, it runs the whole scale.
 */
export function startRange(
  marks: Record<string, WordStatus>,
  profile: LevelProfile,
  anki: Record<string, AnkiCard>,
  l1: string,
  words: StudyWords,
  now = Date.now(),
): { low: Estimator; high: Estimator } {
  return {
    low: buildEstimator({ marks, profile: { ...profile, selfLevel: STUDY_LEVELS[0] }, anki, l1, words, now }),
    high: buildEstimator({ marks, profile: { ...profile, selfLevel: STUDY_LEVELS[STUDY_LEVELS.length - 1] }, anki, l1, words, now }),
  };
}

/** The vocabulary column of a level; re-exported so the views do not import the model twice. */
