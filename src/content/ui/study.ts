/**
 * The F5 study engine for the content script and the extension pages
 * (docs/REDESIGN-V2.md §4.2–4.3, §5.3, §7 F5).
 *
 * It is the one place that knows how the pure study layer
 * (`shared/study/wordStatus`) gets its lexicon: the bundled dictionary for
 * level and gloss, the lazily loaded subtitle frequency list for rank, and the
 * committed false-friend list. The pure layer takes those as `StudyWords`, so
 * this file is the adapter — and the React binding the views consume.
 *
 * Nothing here talks to `chrome.*` for data: word status and level live in
 * `chrome.storage.local` through `shared/chrome-local-store`, and the only
 * message is `ANKI_WORD_INTERVALS`, which the service worker already owns.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { sendMessage } from 'webext-bridge/content-script';
import { useKivaraStore } from '../../shared/store';
import type { AnkiWordIntervalsResponse } from '../../shared/types';
import type { ChromeLocalStore } from '../../shared/chrome-local-store';
import { lookupDictionary } from '../nlp/dictionary';
import { falseFriendOf } from '../../shared/study/falseFriends';
import { frequency, hasFrequencyList, type FrequencyRanks } from '../../shared/study/frequency';
import {
  ankiSummaryOf, applyVocabTest, buildEstimator, estimateWithTest, hydrateStudy, mergeAnkiIntervals,
  noteCardSaved, normalizeStatusKey, resolveDetailed, setSelfLevel, setWordStatus, startRange,
  studyStores,
  type AnkiCard, type AnkiSummary, type Estimator, type StatusDetail, type StudyWords,
  type WordStatus,
} from '../../shared/study/wordStatus';
import type { StudyLevel } from '../../shared/study/lexicalModel';
import { normalizeKey } from '../../shared/study/lexicalModel';
import type { LevelProfile } from '../../shared/study/levelProfile';
import type { VcChecks } from '../../shared/study/vocabCheck';

/** What the subtitle overlay needs from the study layer (kept narrow on purpose). */
export interface StudyBinding {
  statusOf(tokenKey: string): WordStatus;
  detailOf(tokenKey: string): StatusDetail;
  /** `null` = «back to automatic» (clear the hand mark). */
  setStatus(tokenKey: string, status: WordStatus | null): void;
  inAnki(tokenKey: string): boolean;
  /** The user's own mark, without Anki or the estimate (undo in the word list). */
  userStatusOf(tokenKey: string): WordStatus | undefined;
}

/**
 * Profile id of a cue language: the two-letter code, so `en-US` and `en`
 * share one profile. There is one profile per language being learned, not per
 * track tag.
 */
export function profileLangOf(lang: string): string {
  const base = (lang || 'en').trim().toLowerCase().slice(0, 2);
  return base || 'en';
}

/**
 * Lexicon features over the bundled dictionary and the frequency list.
 * `ranks` is null while the list is loading: the estimate then falls back to
 * the CEFR level alone, which is a valid (if coarser) basis.
 */
export function createStudyWords(lang: string, ranks: FrequencyRanks | null): StudyWords {
  return {
    features(tokenKey) {
      const key = normalizeKey(tokenKey);
      const entry = lookupDictionary(key, lang);
      const rank = ranks?.rankOf(key) ?? undefined;
      return {
        key,
        level: entry?.level,
        rank: rank ?? undefined,
        gloss: entry?.translation,
        // The curated list is ES↔EN; the model only applies it when l1 is Spanish.
        falseFriend: lang === 'en' ? falseFriendOf(key)?.es : undefined,
      };
    },
  };
}

/* ── Frequency, lazily ─────────────────────────────────────────────────── */

function useFrequencyRanks(lang: string): FrequencyRanks | null {
  const [ranks, setRanks] = useState<FrequencyRanks | null>(() => frequency.peek(lang));
  useEffect(() => {
    let alive = true;
    setRanks(frequency.peek(lang));
    if (!hasFrequencyList(lang)) return () => { alive = false; };
    void frequency.get(lang).then((loaded) => {
      if (alive) setRanks(loaded);
    });
    return () => { alive = false; };
  }, [lang]);
  return ranks;
}

/* ── Anki intervals ────────────────────────────────────────────────────── */

function hasExtensionRuntime(): boolean {
  const runtime = (globalThis as { chrome?: { runtime?: { id?: string } } }).chrome?.runtime;
  return !!runtime?.id;
}

/** Card-field name the interval query reads: the field mapped to `selection`, else the front. */
function fieldNameFromMapping(mapping: { fieldSources?: Record<string, unknown> }): string {
  const found = Object.entries(mapping.fieldSources ?? {}).find(([, source]) => source === 'selection');
  return found?.[0] ?? 'Front';
}

const refreshing = new Map<string, Promise<void>>();

/**
 * Refresh the cached Anki intervals for a language (`ANKI_WORD_INTERVALS`).
 * Incremental on purpose: the service worker answers with the current
 * interval per headword and `mergeAnkiIntervals` rewrites only the entries
 * whose value changed. Called when the panel mounts and after every save; a
 * failed call keeps the cached values.
 */
export function refreshAnkiIntervals(lang: string): Promise<void> {
  if (!hasExtensionRuntime()) return Promise.resolve();
  const running = refreshing.get(lang);
  if (running) return running;
  const promise = (async () => {
    try {
      const { ankiMapping } = useKivaraStore.getState();
      const deck = ankiMapping.decks?.[lang] ?? ankiMapping.deckName;
      if (!deck) return;
      const response = (await sendMessage(
        'ANKI_WORD_INTERVALS',
        { lang, deck, fieldName: fieldNameFromMapping(ankiMapping) },
        'background',
      )) as AnkiWordIntervalsResponse;
      if (response?.words) mergeAnkiIntervals(lang, response.words);
    } catch {
      // Anki unreachable (closed, wrong URL): the cached intervals stay.
    } finally {
      refreshing.delete(lang);
    }
  })();
  refreshing.set(lang, promise);
  return promise;
}

/**
 * The save path calls this once a card exists: a «known» hand mark gives way
 * to the new card (the word becomes «learning» until it matures), the card is
 * cached with interval 0, and a background refresh reads the real interval.
 */
export function recordCardSaved(lang: string, tokenKey: string): void {
  const profile = profileLangOf(lang);
  // An inflected surface («looking up») is stored under the dictionary's
  // citation key; the tokenizer does the same when it resolves the mark.
  const entry = lookupDictionary(tokenKey.trim().toLowerCase(), profile);
  noteCardSaved(profile, entry?.lemmaOf ?? tokenKey);
  void refreshAnkiIntervals(profile);
}

/* ── React binding ─────────────────────────────────────────────────────── */

function useChromeStore<T>(store: ChromeLocalStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}

export interface WordStudy extends StudyBinding {
  /** Language of the profile (the one being learned). */
  lang: string;
  /** The learner's own language: cognates and false friends. */
  l1: string;
  /** The frequency list has loaded (or the language ships without one). */
  ready: boolean;
  marks: Record<string, WordStatus>;
  anki: Record<string, AnkiCard>;
  profile: LevelProfile;
  estimator: Estimator;
  /** Level if the self-assessment were A1 / C2, to say how much it still weighs. */
  range: { low: Estimator; high: Estimator };
  summary: AnkiSummary;
  /** The user's own mark, without Anki or the estimate. */
  userStatusOf(tokenKey: string): WordStatus | undefined;
  setSelfLevel(level: StudyLevel | null): void;
  applyTest(answers: Iterable<string>, checks?: VcChecks, shown?: readonly string[]): void;
  /** Preview of the level with a check applied, without saving it. */
  previewTest(test: { answers: Iterable<string>; checks?: VcChecks; shown?: readonly string[] }): Estimator;
  refreshAnki(): Promise<void>;
}

/**
 * Study state of one language. Without an argument it follows the learned
 * language (`translate.sourceLang`), which is the active profile everywhere
 * except an episode in another language, which passes its own. Mandatory
 * subscriptions: marks, Anki intervals and the profile. Hydration and the
 * first interval refresh happen on mount, so opening the panel is enough.
 */
export function useWordStudy(langArg?: string): WordStudy {
  const activeLang = useKivaraStore((s) => s.translate.sourceLang) || 'en';
  const l1 = useKivaraStore((s) => s.translate.targetLanguage) || 'es';
  const lang = profileLangOf(langArg ?? activeLang);
  const deck = useKivaraStore((s) => s.ankiMapping.decks?.[lang] ?? s.ankiMapping.deckName);

  const stores = useMemo(() => studyStores(lang), [lang]);
  const marks = useChromeStore<Record<string, WordStatus>>(stores.status);
  const anki = useChromeStore<Record<string, AnkiCard>>(stores.anki);
  const profile = useChromeStore<LevelProfile>(stores.profile);

  const ranks = useFrequencyRanks(lang);
  const ready = ranks !== null || !hasFrequencyList(lang);
  const words = useMemo(() => createStudyWords(lang, ranks), [lang, ranks]);

  useEffect(() => {
    void hydrateStudy(lang);
  }, [lang]);

  useEffect(() => {
    void refreshAnkiIntervals(lang);
  }, [lang, deck]);

  const estimator = useMemo(
    () => buildEstimator({ marks, profile, anki, l1, words }),
    [marks, profile, anki, l1, words],
  );
  const range = useMemo(
    () => startRange(marks, profile, anki, l1, words),
    [marks, profile, anki, l1, words],
  );
  const summary = useMemo(() => ankiSummaryOf(anki), [anki]);

  const detailOf = useCallback(
    (tokenKey: string) => resolveDetailed(marks, tokenKey, anki, estimator),
    [marks, anki, estimator],
  );
  const statusOf = useCallback((tokenKey: string) => detailOf(tokenKey).status, [detailOf]);

  const setStatus = useCallback(
    (tokenKey: string, status: WordStatus | null) => setWordStatus(lang, tokenKey, status),
    [lang],
  );
  const inAnki = useCallback(
    (tokenKey: string) => normalizeStatusKey(tokenKey) in anki,
    [anki],
  );
  const userStatusOf = useCallback(
    (tokenKey: string) => marks[normalizeStatusKey(tokenKey)],
    [marks],
  );
  const changeSelfLevel = useCallback((level: StudyLevel | null) => setSelfLevel(lang, level), [lang]);
  const saveTest = useCallback(
    (answers: Iterable<string>, checks?: VcChecks, shown?: readonly string[]) =>
      applyVocabTest(lang, answers, checks, shown),
    [lang],
  );
  const previewTest = useCallback(
    (test: { answers: Iterable<string>; checks?: VcChecks; shown?: readonly string[] }) =>
      estimateWithTest(lang, test, l1, words),
    [lang, l1, words],
  );
  const refreshAnki = useCallback(() => refreshAnkiIntervals(lang), [lang]);

  return {
    lang, l1, ready, marks, anki, profile, estimator, range, summary,
    statusOf, detailOf, setStatus, inAnki, userStatusOf,
    setSelfLevel: changeSelfLevel, applyTest: saveTest, previewTest, refreshAnki,
  };
}