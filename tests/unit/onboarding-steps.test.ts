/**
 * The stepper contract extracted from the Onboarding monolith — the gate
 * for its split. These rules live inline in the 86 KB root today; the
 * extracted module must reproduce them exactly.
 */
import { describe, expect, it } from 'vitest';
import {
  StepId, STEPS, DEMO_URL, LAST_STEP_ID, nextStepId, prevStepId, canAdvance,
} from '../../src/onboarding/steps';

describe('onboarding stepper', () => {
  it('walks a fixed seven-step order', () => {
    expect(STEPS.map((s) => s.id)).toEqual([
      'welcome', 'lang', 'anki', 'mapping', 'dict', 'ai', 'demo',
    ]);
    expect(STEPS).toHaveLength(7);
  });

  it('advances through the list and emits done from the last step', () => {
    let id: StepId = 'welcome';
    const seen: StepId[] = [];
    for (let i = 0; i < 8; i++) { seen.push(id); id = nextStepId(id); }
    expect(seen).toEqual([
      'welcome', 'lang', 'anki', 'mapping', 'dict', 'ai', 'demo', 'done',
    ]);
    // done is terminal.
    expect(LAST_STEP_ID).toBe('demo');
    expect(nextStepId('done')).toBe('done');
  });

  it('goes back but never before welcome', () => {
    let id: StepId = 'demo';
    const seen: StepId[] = [];
    for (let i = 0; i < 9; i++) { seen.push(id); id = prevStepId(id); }
    expect(seen).toContain('welcome');
    expect(prevStepId('welcome')).toBe('welcome');
  });

  it('gates anki on a live ping', () => {
    expect(canAdvance('anki', { ping: { status: 'idle' } })).toBe(false);
    expect(canAdvance('anki', { ping: { status: 'pinging' } })).toBe(false);
    expect(canAdvance('anki', { ping: { status: 'error' } })).toBe(false);
    expect(canAdvance('anki', { ping: { status: 'ok' } })).toBe(true);
  });

  it('gates mapping on deck AND model', () => {
    expect(canAdvance('mapping', { ankiMapping: {} })).toBe(false);
    expect(canAdvance('mapping', { ankiMapping: { deckName: 'D' } })).toBe(false);
    expect(canAdvance('mapping', { ankiMapping: { modelName: 'B' } })).toBe(false);
    expect(canAdvance('mapping', { ankiMapping: { deckName: 'D', modelName: 'B' } })).toBe(true);
  });

  it('leaves every other step open', () => {
    for (const step of ['welcome', 'lang', 'dict', 'ai', 'demo'] as const) {
      expect(canAdvance(step)).toBe(true);
    }
  });

  it('keeps the demo deep link in one place', () => {
    expect(DEMO_URL).toMatch(/^https:\/\//);
  });
});