/**
 * The stepper contract extracted from the Onboarding monolith, and now
 * the ONLY implementation the wizard reads — the grep for `idx + 1`,
 * `idx - 1` and an inline `canAdvance` in Onboarding.tsx comes back
 * empty, so a lock changed here changes the wizard; a regression in the
 * wizard shows up here.
 *
 * F8 adds the Level step between Language and Anki and moves the mapping
 * gate to the deck OF THE LANGUAGE being learned (`mapping.decks[lang]`).
 */
import { describe, expect, it } from 'vitest';
import {
  StepId, STEPS, DEMO_URL, LAST_STEP_ID, nextStepId, prevStepId, canAdvance,
} from '../../src/onboarding/steps';

describe('onboarding stepper', () => {
  it('walks a fixed eight-step order', () => {
    expect(STEPS.map((s) => s.id)).toEqual([
      'welcome', 'lang', 'level', 'anki', 'mapping', 'dict', 'ai', 'demo',
    ]);
    expect(STEPS).toHaveLength(8);
    // Labels are i18n keys, resolved at render.
    expect(STEPS[2]!.label).toBe('onb.step.level');
  });

  it('advances through the list and emits done from the last step', () => {
    let id: StepId = 'welcome';
    const seen: StepId[] = [];
    for (let i = 0; i < 9; i++) { seen.push(id); id = nextStepId(id); }
    // exact ids, step by step: a reordered wizard fails here.
    expect(seen).toEqual([
      'welcome', 'lang', 'level', 'anki', 'mapping', 'dict', 'ai', 'demo', 'done',
    ]);
    expect(LAST_STEP_ID).toBe('demo');
    expect(nextStepId('done')).toBe('done');
  });

  it('goes back step by step and stops at welcome', () => {
    const ids: StepId[] = [];
    let id: StepId = 'demo';
    for (let i = 0; i < 9; i++) { ids.push(id); id = prevStepId(id); }
    expect(ids).toEqual([
      'demo', 'ai', 'dict', 'mapping', 'anki', 'level', 'lang', 'welcome', 'welcome',
    ]);
  });

  it('done has no way back — the back button is disabled there', () => {
    // The monolith never moved back from done (the button was disabled);
    // returning demo would smuggle a silent jump out of the terminal.
    expect(prevStepId('done')).toBe('done');
  });

  it('gates level on a self-assessment OR a saved check, never on both', () => {
    expect(canAdvance('level')).toBe(false);
    expect(canAdvance('level', { level: {} })).toBe(false);
    expect(canAdvance('level', { level: { selfLevel: null, tested: false } })).toBe(false);
    // Either form of evidence is enough.
    expect(canAdvance('level', { level: { selfLevel: 'B1' } })).toBe(true);
    expect(canAdvance('level', { level: { selfLevel: null, tested: true } })).toBe(true);
    expect(canAdvance('level', { level: { selfLevel: 'C2', tested: true } })).toBe(true);
  });

  it('gates anki on a live ping', () => {
    expect(canAdvance('anki', { ping: { status: 'idle' } })).toBe(false);
    expect(canAdvance('anki', { ping: { status: 'pinging' } })).toBe(false);
    expect(canAdvance('anki', { ping: { status: 'error' } })).toBe(false);
    expect(canAdvance('anki', { ping: { status: 'ok' } })).toBe(true);
  });

  it('gates mapping on the deck OF THE LANGUAGE and the model', () => {
    // English ready, French not: the active language decides.
    const decks = { en: 'English deck' };
    expect(canAdvance('mapping', { lang: 'en', ankiMapping: { modelName: 'Basic', decks } })).toBe(true);
    expect(canAdvance('mapping', { lang: 'fr', ankiMapping: { modelName: 'Basic', decks } })).toBe(false);
    // A model is still required.
    expect(canAdvance('mapping', { lang: 'en', ankiMapping: { decks } })).toBe(false);
    // An empty deck name is not a choice.
    expect(canAdvance('mapping', { lang: 'en', ankiMapping: { modelName: 'Basic', decks: { en: '' } } })).toBe(false);
  });

  it('reads the legacy single deckName when no language is given', () => {
    expect(canAdvance('mapping', { ankiMapping: { deckName: 'D' } })).toBe(false);
    expect(canAdvance('mapping', { ankiMapping: { deckName: 'D', modelName: 'B' } })).toBe(true);
  });

  it('leaves every other step open', () => {
    for (const step of ['welcome', 'lang', 'dict', 'ai', 'demo'] as const) {
      expect(canAdvance(step)).toBe(true);
    }
  });

  it('keeps the demo deep link in one place', () => {
    expect(DEMO_URL).toBe('https://www.youtube.com/watch?v=arj7oStGLkU');
  });
});
