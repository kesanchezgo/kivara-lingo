/**
 * F5 gate: the vocabulary dialog's own focus trap (docs/REDESIGN-V2.md §3 H1).
 *
 * Radix is not usable: its FocusScope reads `document.activeElement`, which is
 * the shadow HOST inside a closed root. The dialog therefore traps Tab itself
 * and resolves the focused node through the shadow-root registry
 * (`getShadowRoot(host).activeElement`). This mounts the real dialog in a
 * CLOSED root and drives it: open → focus inside, Tab keeps focus inside,
 * Escape closes and focus returns to the button that opened it.
 */
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { __registerShadowRootForTests } from '../../src/content/shadow-host';
import { VocabTestDialog } from '../../src/content/ui/VocabTestDialog';
import { COMMITTED_BANK } from '../../src/shared/study/vocabCheck';
import { buildEstimator, type StudyWords } from '../../src/shared/study/wordStatus';

const words: StudyWords = { features: (key) => ({ key }) };
const estimate = buildEstimator({
  marks: {},
  profile: { selfLevel: null, vocabTest: null },
  anki: {},
  l1: 'en',
  words,
  now: 1_700_000_000_000,
});

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" data-open-vocab-dialog onClick={() => setOpen(true)}>open</button>
      <VocabTestDialog
        open={open}
        onOpenChange={setOpen}
        bank={COMMITTED_BANK}
        l1="en"
        langName="inglés"
        before={estimate}
        preview={() => estimate}
        onSave={() => {}}
      />
    </div>
  );
}

function mountInClosedRoot() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'closed' });
  __registerShadowRootForTests(host, root);
  const mount = document.createElement('div');
  root.appendChild(mount);
  render(<Harness />, { container: mount });
  return { root, host };
}

describe('VocabTestDialog inside a closed shadow root', () => {
  it('opens with focus inside, keeps Tab inside and restores focus on Escape', () => {
    const { root } = mountInClosedRoot();
    const opener = root.querySelector<HTMLButtonElement>('[data-open-vocab-dialog]')!;
    opener.focus();
    fireEvent.click(opener);

    const dialog = root.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(root.activeElement).toBe(dialog);

    // Tab from the window itself goes to the first control (the close button).
    fireEvent.keyDown(dialog!, { key: 'Tab' });
    const first = root.querySelector<HTMLElement>('[role="dialog"] button');
    expect(first).toBeTruthy();
    expect(root.activeElement).toBe(first);

    // Escape closes the window and returns focus to the opener.
    fireEvent.keyDown(dialog!, { key: 'Escape' });
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(root.activeElement).toBe(opener);
  });

  it('closes on an outside click only while nothing is marked', () => {
    const { root } = mountInClosedRoot();
    const opener = root.querySelector<HTMLButtonElement>('[data-open-vocab-dialog]')!;
    opener.focus();
    fireEvent.click(opener);

    const backdrop = root.querySelector<HTMLElement>('[data-vocab-backdrop]')!;
    // The scrim is the first child of the backdrop container.
    fireEvent.mouseDown(backdrop.firstElementChild!);
    expect(root.querySelector('[role="dialog"]')).toBeNull();
  });
});