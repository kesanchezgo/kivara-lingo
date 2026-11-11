/**
 * Level profile per language (docs/REDESIGN-V2.md §4.3, §5.3, §7 F5).
 *
 * What the person SAYS about themselves in one language: their CEFR
 * self-assessment (the sentence that describes what they can do) and their
 * last vocabulary check. It is the starting point of the level, not the level:
 * the level is computed from all the evidence and advances on its own
 * (`wordStatus.buildEstimator`), so a stale self-assessment never freezes it.
 *
 * One profile per language. Being B2 in English says nothing about French, and
 * «fine» in English is not «fine» in French. Storage lives in
 * `chrome.storage.local` under `kvl:levelProfile:<lang>` (H4), not in the
 * synced store: it is small, but it is tied to the word status next to it.
 *
 * Legacy shapes are read with the same migration the prototype used:
 * `selfLevel` → `level` → `studyLevel` → `knownUpTo` (`'none'` meant A1).
 * A test saved by the old one-number version is not evidence — without the
 * answers it cannot be re-scored — and is discarded.
 */
import type { StudyLevel } from './lexicalModel';
import { isVcWord, isVcRealWord, VC_CHECK_MAX, type VcChecks } from './vocabCheck';

/** Point of departure while there is no self-assessment (onboarding skipped). Never presented as «your» level. */
export const PROVISIONAL_LEVEL: StudyLevel = 'A2';

/**
 * A saved vocabulary check: the answers are the evidence, never the number the
 * old version stored. `checks` is the optional meaning check of some of the
 * marked words; it weighs less with time, like the test itself.
 */
export interface VocabTest {
  answers: string[];
  at: number;
  checks?: VcChecks;
  /** The words this attempt showed (each attempt samples the bank). Without it there is no evidence. */
  shown?: string[];
}

export interface LevelProfile {
  selfLevel: StudyLevel | null;
  vocabTest: VocabTest | null;
}

export const DEFAULT_LEVEL_PROFILE: LevelProfile = { selfLevel: null, vocabTest: null };

/** One key per language: `kvl:levelProfile:en`. */
export const LEVEL_PROFILE_KEY = 'kvl:levelProfile';

const isStatusLevel = (v: unknown): v is StudyLevel =>
  v === 'A1' || v === 'A2' || v === 'B1' || v === 'B2' || v === 'C1' || v === 'C2';

/** `knownUpTo` was «the last level you knew»; `'none'` meant the first one. */
const LEGACY_KNOWN_UP_TO = new Map<unknown, StudyLevel>([['none', 'A1'], ['A1', 'A1'], ['A2', 'A2'], ['B1', 'B1'], ['B2', 'B2']]);

const isVocabTest = (v: unknown): v is VocabTest => {
  const o = v as Partial<VocabTest> | null;
  return !!o && typeof o === 'object' && Array.isArray(o.answers) && o.answers.length <= 200
    && o.answers.every((w) => typeof w === 'string' && isVcWord(w))
    && typeof o.at === 'number' && Number.isFinite(o.at);
};

/** A valid meaning check: real words of the bank, known answers, at most `VC_CHECK_MAX`. */
function reviveChecks(raw: unknown): VcChecks | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter(([w, a]) => isVcRealWord(w) && (a === 'ok' || a === 'wrong' || a === 'idk'));
  return entries.length && entries.length <= VC_CHECK_MAX ? Object.fromEntries(entries) as VcChecks : undefined;
}

/** Validate and migrate one profile. A newer property wins over an older one. */
export function reviveLevelProfile(raw: unknown): LevelProfile {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const selfLevel: StudyLevel | null = 'selfLevel' in r ? (isStatusLevel(r.selfLevel) ? r.selfLevel : null)
    : 'level' in r ? (isStatusLevel(r.level) ? r.level : null)
    : 'studyLevel' in r ? (isStatusLevel(r.studyLevel) ? r.studyLevel : null)
    : LEGACY_KNOWN_UP_TO.get(r.knownUpTo) ?? null;
  const vocabTest: VocabTest | null = isVocabTest(r.vocabTest)
    ? { answers: [...new Set(r.vocabTest.answers)], at: r.vocabTest.at }
    : null;
  if (vocabTest) {
    const checks = reviveChecks((r.vocabTest as VocabTest).checks);
    if (checks) vocabTest.checks = checks;
    const shown = (r.vocabTest as VocabTest).shown;
    // v2 always stores what the attempt showed; without it the answers cannot
    // be scored (the denominator is unknown), so the test is not evidence.
    if (!Array.isArray(shown) || !shown.length || shown.length > 200
      || !shown.every((w) => typeof w === 'string' && isVcWord(w))) {
      return { selfLevel, vocabTest: null };
    }
    vocabTest.shown = [...new Set(shown)];
    // Answers outside what was shown are not evidence (corrupt data).
    vocabTest.answers = vocabTest.answers.filter((w) => vocabTest.shown!.includes(w));
  }
  return { selfLevel, vocabTest };
}

/**
 * Record a check as the profile's evidence. It does not touch the
 * self-assessment: that would count the same evidence twice and overwrite what
 * the person said about themselves.
 */
export function withVocabTest(
  profile: LevelProfile,
  answers: Iterable<string>,
  checks?: VcChecks,
  shown?: readonly string[],
  now = Date.now(),
): LevelProfile {
  const list = [...new Set(answers)];
  return {
    ...profile,
    vocabTest: {
      answers: list,
      at: now,
      ...(checks && Object.keys(checks).length ? { checks } : {}),
      ...(shown?.length ? { shown: [...shown] } : {}),
    },
  };
}
