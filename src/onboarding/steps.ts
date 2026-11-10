/**
 * The stepper's contract, split out of the Onboarding monolith.
 *
 * Order, the lock rules, and where `done` begins. The root component keeps its
 * own state machine; this is the pure data it drives it with, so the rules are
 * testable without rendering the wizard (its per-step chrome.bridge + i18n
 * environment cannot be mounted faithfully in vitest — that is what the e2e
 * covers).
 *
 * `done` is not a travel step: it is the terminal state the last regular step
 * emits, and nextStepId(idle) is never a thing — this file just answers the
 * two questions the root asked inline: what is next, what is prev, and does
 * this step let you move on.
 *
 * F8 (docs/REDESIGN-V2.md §7) adds the Level step between Language and Anki.
 * Its gate is deliberately narrow: a self-assessment OR a saved vocabulary
 * check is enough, and the check itself never blocks saving (F5's rule — the
 * result arrives already corrected). Skipping the whole wizard still works;
 * the profile is simply left provisional.
 */
import type { StudyLevel } from '../shared/study/lexicalModel';

export type StepId =
  | 'welcome'
  | 'lang'
  | 'level'
  | 'anki'
  | 'mapping'
  | 'dict'
  | 'ai'
  | 'demo'
  | 'done';

export interface StepMeta {
  id: Exclude<StepId, 'done'>;
  /** i18n key, resolved at render so the label follows the locale. */
  label: string;
  optional?: boolean;
  recommended?: boolean;
}

/** The travel steps, in the order the wizard walks them. */
export const STEPS: StepMeta[] = [
  { id: 'welcome', label: 'onb.step.welcome' },
  { id: 'lang', label: 'onb.step.lang' },
  { id: 'level', label: 'onb.step.level' },
  { id: 'anki', label: 'onb.step.anki' },
  { id: 'mapping', label: 'onb.step.mapping' },
  { id: 'dict', label: 'onb.step.dict', recommended: true },
  { id: 'ai', label: 'onb.step.ai', optional: true },
  { id: 'demo', label: 'onb.step.demo' },
];

export const DEMO_URL = 'https://www.youtube.com/watch?v=arj7oStGLkU';

/** The last regular step: after it, `next` lands on done. */
export const LAST_STEP_ID = STEPS[STEPS.length - 1]!.id;

/** What the lock check reads from root state. */
export interface AdvanceContext {
  /** The ping step's live-state: only `ok` releases the gate. */
  ping?: { status: 'idle' | 'pinging' | 'ok' | 'error' };
  /** The mapping step's required names, deck per language. */
  ankiMapping?: {
    deckName?: string;
    modelName?: string;
    /** `mapping.decks[lang]`: the deck this language saves to (F2/F4). */
    decks?: Record<string, string>;
  };
  /** The Level step's evidence: what the person said, or a saved check. */
  level?: {
    selfLevel?: StudyLevel | null;
    /** A vocabulary check has been saved (the answers are the evidence). */
    tested?: boolean;
  };
  /**
   * Language being learned. The mapping gate reads ITS deck; without it the
   * legacy single `deckName` is read, which is what pre-v3 snapshots hold.
   */
  lang?: string;
}

const indexOf = (id: StepId): number => STEPS.findIndex((s) => s.id === id);

/**
 * The following step. From the last regular step it emits `done` (the
 * root then writes `completed`); from `done` it stays at `done`.
 */
export function nextStepId(id: StepId): StepId {
  if (id === 'done') return 'done';
  const i = indexOf(id);
  if (i < 0 || i === STEPS.length - 1) return 'done';
  return STEPS[i + 1]!.id;
}

/**
 * The previous step. Stuck at `welcome`, and `done` has no way back: the
 * terminal screen's back button is disabled, and the root's guard
 * (`n === step`) is a no-op there, so returning `done` keeps button and
 * handler in agreement instead of smuggling a silent jump to demo.
 */
export function prevStepId(id: StepId): StepId {
  if (id === 'done') return 'done';
  const i = indexOf(id);
  if (i <= 0) return STEPS[0]!.id;
  return STEPS[i - 1]!.id;
}

/**
 * Whether "Siguiente" is unlocked on this step. The three NON-trivial gates
 * live here because they are the irreversible-looking ones: a level commitment
 * that seeds every estimate, connecting to Anki, and committing a deck+model
 * to the store on the user's behalf. Everything else is open — the point of
 * the wizard is to move.
 *
 * The Level gate accepts EITHER form of evidence: the CEFR sentence the person
 * recognises themselves in, or the result of the 2-minute check. It is a gate
 * on the wizard, never on saving: skipping the whole flow leaves the profile
 * provisional instead of failing anything (`onb.pickLevel` explains it).
 */
export function canAdvance(step: StepId, ctx: AdvanceContext = {}): boolean {
  if (step === 'level') return Boolean(ctx.level?.selfLevel) || ctx.level?.tested === true;
  if (step === 'anki') return ctx.ping?.status === 'ok';
  if (step === 'mapping') {
    const deck = ctx.lang ? ctx.ankiMapping?.decks?.[ctx.lang] : ctx.ankiMapping?.deckName;
    return Boolean(deck) && Boolean(ctx.ankiMapping?.modelName);
  }
  return true;
}