/**
 * Behavioral characterization of the Onboarding ROOT, rendered for real
 * in jsdom. It pins only what a step-split move (steps/*.tsx) must keep:
 * the stepper renders one dot per STEPS entry, welcome is active first,
 * Back is disabled on it, and Next/Back move the active dot back and
 * forth through the pure steps.ts graph.
 *
 * Language-independent on purpose: the copy is i18n'd and the suite may
 * run under either locale, so it queries structural markers (dot count,
 * the active dot ring class) and the disabled state of the footer buttons
 * positionally — never translated strings.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';

function chromeStub(): Record<string, unknown> {
  return {
    runtime: {
      sendMessage: async () => ({ ok: false }),
      onMessage: { addListener() {}, removeListener() {} },
      onConnect: { addListener() {}, removeListener() {} },
      getURL: (p: string) => p,
      id: 'test',
    },
    storage: {
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      onChanged: { addListener() {}, removeListener() {} },
    },
    permissions: { contains: async () => true, getAll: async () => ({ origins: [], permissions: [] }) },
    tabs: { query: async () => [], sendMessage: async () => ({}), create: vi.fn(), onRemoved: { addListener() {} } },
    action: {},
  };
}

async function mount() {
  const mod = await import('../../src/onboarding/Onboarding');
  return render(React.createElement(mod.Onboarding));
}

/**
 * Stepper dots. The transition wraps BOTH the outgoing and incoming step
 * panes, so a plain selector double-counts; scope to the LAST pane (the
 * one mounted for the current step) and count numbered placeholders,
 * which only the stepper uses (exactly STEPS.length of them, numbered
 * 1..N) plus the active one marked with the ring.
 */
function stepDots(): Element[] {
  const mains = [...document.querySelectorAll('div')].filter(
    (d) => d.className.includes('max-w-2xl') && d.className.includes('flex') && d.className.includes('items-center'),
  );
  const pane = mains[mains.length - 1] ?? document.body;
  return [...pane.querySelectorAll('.rounded-full')].filter(
    (d) => d.className.includes('w-6') && d.className.includes('h-6'),
  );
}

const activeIndex = (): number => stepDots().findIndex((d) => d.className.includes('ring-indigo-500'));
const doneIndex = (): number => stepDots().filter((d) => d.className.includes('bg-indigo-600')).length;

function footer(back: boolean): HTMLButtonElement {
  const b = [...document.querySelectorAll('button')];
  return (back ? b[b.length - 2] : b[b.length - 1]) as HTMLButtonElement;
}

describe('Onboarding wizard - behavioral characterization (pre-move)', () => {
  beforeEach(() => { vi.stubGlobal('chrome', chromeStub()); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('opens on welcome: 7 dots, step 1 active, none done, Next on, Back off', async () => {
    await mount();
    expect(stepDots().length).toBe(7);
    expect(activeIndex()).toBe(0);
    expect(doneIndex()).toBe(0);
    expect(footer(false).disabled).toBe(false);
    expect(footer(true).disabled).toBe(true);
  });

  it('Next advances the active dot; Back returns it', async () => {
    await mount();
    expect(activeIndex()).toBe(0);
    fireEvent.click(footer(false));
    await waitFor(() => expect(activeIndex()).toBe(1));
    fireEvent.click(footer(true));
    await waitFor(() => expect(activeIndex()).toBe(0));
  });
});
