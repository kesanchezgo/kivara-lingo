/**
 * F5 gate: the Vocabulary tab is REAL and visible (docs/REDESIGN-V2.md §7 F5).
 *
 * A smoke render of the tab over the real engine: the level card, its ladder
 * and the self-assessment selector exist, and the tab is enabled in the panel.
 * It also proves the tab mounts without needing the dictionary to have loaded
 * the frequency list yet (the estimate falls back to the CEFR levels).
 */
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { VocabTab, VOCAB_TAB_ENABLED } from '../../src/app/components/tabs/VocabTab';

describe('VocabTab', () => {
  it('is enabled and renders the calculated level with its controls', async () => {
    expect(VOCAB_TAB_ENABLED).toBe(true);
    const { container } = render(<VocabTab />);

    const card = container.querySelector('[data-level-card]');
    expect(card).toBeTruthy();

    // The provisional reference (A2) until more evidence arrives.
    await waitFor(() => expect(container.querySelector('[data-level-value]')).toBeTruthy());
    expect(container.querySelector('[data-level-value]')?.textContent).toContain('A2');
    expect(container.querySelector('[data-level-ladder]')).toBeTruthy();
    expect(container.querySelector('[data-level-next]')).toBeTruthy();

    // Self-assessment selector and the check entry point.
    expect(screen.getByRole('combobox', { name: /autoevaluación/i })).toBeTruthy();
    expect(container.querySelector('[data-vocab-open]')).toBeTruthy();
    expect(container.querySelector('[data-open-cards]')).toBeTruthy();
  });
});