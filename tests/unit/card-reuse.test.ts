/**
 * A REUSED note was not created by this save: the notice must never offer
 * "Deshacer" (which would delete an old note with all its review history).
 * `same-context` only informs; `other-context` offers the EXISTING
 * "Add this scene" flow. Both are localized (es/en).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { toast } from 'sonner';
import { ALL_MESSAGES } from '../../src/shared/i18n';
import { showCardReused } from '../../src/content/ui/save-actions';

vi.mock('sonner', () => {
  const toast = vi.fn();
  Object.assign(toast, {
    custom: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    dismiss: vi.fn(),
    loading: vi.fn(),
  });
  return { toast, Toaster: () => null };
});

/** Walk a React element tree, collecting text and button onClick handlers. */
function flatten(node: React.ReactNode): { texts: string[]; buttons: Array<{ text: string; onClick?: () => void }> } {
  const texts: string[] = [];
  const buttons: Array<{ text: string; onClick?: () => void }> = [];
  const walk = (n: React.ReactNode) => {
    if (n == null || typeof n === 'boolean') return;
    if (typeof n === 'string' || typeof n === 'number') { texts.push(String(n)); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const el = n as React.ReactElement;
    if (!el || typeof el !== 'object' || !('props' in el)) return;
    const props = el.props as { children?: React.ReactNode; onClick?: () => void };
    if (el.type === 'button') {
      const label = (flatten(props.children).texts.join(' ') || String(props.children ?? '')).trim();
      buttons.push({ text: label, onClick: props.onClick });
    }
    walk(props.children);
  };
  walk(node);
  return { texts, buttons };
}

/** Render the notice toast's custom content and inspect it. */
function renderNotice(): { texts: string[]; buttons: Array<{ text: string; onClick?: () => void }> } {
  const custom = toast.custom as unknown as ReturnType<typeof vi.fn>;
  const renderFn = custom.mock.calls[0]?.[0] as (id: string) => React.ReactElement;
  expect(typeof renderFn).toBe('function');
  return flatten(renderFn('toast-id'));
}

afterEach(() => { vi.clearAllMocks(); });

describe('showCardReused', () => {
  it('same-context informs with the word and NEVER renders Undo, even when an add-scene handler is passed', () => {
    showCardReused('same-context', 'steve', () => {});
    const { texts, buttons } = renderNotice();
    expect(texts.join(' ')).toContain('steve');
    expect(texts.join(' ')).toContain(ALL_MESSAGES.es['app.reusedSameContext'].replace('{word}', 'steve'));
    expect(buttons.some((b) => b.text.includes('Deshacer'))).toBe(false);
    // No add-scene action either on the same-context path.
    expect(buttons.some((b) => b.text.includes('Añadir esta escena'))).toBe(false);
  });

  it('other-context renders "Añadir esta escena" and its click calls ONLY the add-context handler, never Undo', () => {
    const onAddScene = vi.fn();
    showCardReused('other-context', 'STEVE', onAddScene);
    const { texts, buttons } = renderNotice();
    expect(texts.join(' ')).toContain(ALL_MESSAGES.es['app.reusedOtherContext'].replace('{word}', 'STEVE'));
    expect(buttons.some((b) => b.text.includes('Deshacer'))).toBe(false);
    const add = buttons.find((b) => b.text.includes('Añadir esta escena'));
    expect(add).toBeDefined();
    add?.onClick?.();
    expect(onAddScene).toHaveBeenCalledTimes(1);
  });

  it('the add-scene action label and texts are localized in en too', () => {
    expect(ALL_MESSAGES.en['app.reusedSameContext']).toContain('already in your deck');
    expect(ALL_MESSAGES.en['app.reusedOtherContext']).toContain('already in your deck');
    expect(ALL_MESSAGES.en['popover.addScene']).toBe('Add this scene');
  });
});
