/**
 * The stepper's contract, split out of the Onboarding monolith (86 KB,
 * seven steps, one root component pulling chrome, the bridge, the store
 * and eleven small components in the same file).
 *
 * Order, the lock rules, and where `done` begins. The root component
 * keeps its own state machine; this is the pure data it drives it with,
 * so the rules are testable without rendering the wizard (its per-step
 * chrome.bridge + i18n environment cannot be mounted faithfully in
 * vitest — that is what the e2e covers).
 *
 * `done` is not a travel step: it is the terminal state the last regular
 * step emits, and nextStepId(idle) is never a thing — this file just
 * answers the two questions the root asked inline: what is next, what is
 * prev, and does this step let you move on.
 */

export type StepId =
  | 'welcome'
  | 'lang'
  | 'anki'
  | 'mapping'
  | 'dict'
  | 'ai'
  | 'demo'
  | 'done';

export interface StepMeta {
  id: Exclude<StepId, 'done'>;
  label: string;
  optional?: boolean;
  recommended?: boolean;
}

/** The travel steps, in the order the wizard walks them. */
export const STEPS: StepMeta[] = [
  { id: 'welcome', label: 'Bienvenida' },
  { id: 'lang', label: 'Idioma' },
  { id: 'anki', label: 'Anki' },
  { id: 'mapping', label: 'Mapeo' },
  { id: 'dict', label: 'Diccionarios', recommended: true },
  { id: 'ai', label: 'IA', optional: true },
  { id: 'demo', label: 'Demo' },
];

export const DEMO_URL = 'https://www.youtube.com/watch?v=arj7oStGLkU';

/** The last regular step: after it, `next` lands on done. */
export const LAST_STEP_ID = STEPS[STEPS.length - 1]!.id;

/** What the lock check reads from root state. */
export interface AdvanceContext {
  /** The ping step's live-state: only `ok` releases the gate. */
  ping?: { status: 'idle' | 'pinging' | 'ok' | 'error' };
  /** The mapping step's two required names. */
  ankiMapping?: { deckName?: string; modelName?: string };
  /** The demo step's flag: the user has seen/started the demo. */
  demoStarted?: boolean;
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
 * Whether "Siguiente" is unlocked on this step. The two NON-trivial
 * gates live here because they are the two irreversible-looking ones:
 * connecting to Anki, and committing a deck+model to store on the
 * user's behalf. Everything else is open — the point of the wizard is
 * to move.
 */
export function canAdvance(step: StepId, ctx: AdvanceContext = {}): boolean {
  if (step === 'anki') return ctx.ping?.status === 'ok';
  if (step === 'mapping') {
    return Boolean(ctx.ankiMapping?.deckName) && Boolean(ctx.ankiMapping?.modelName);
  }
  return true;
}
