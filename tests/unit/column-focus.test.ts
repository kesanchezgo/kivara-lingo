/**
 * Focus hand-off between the two right-hand columns (#38).
 *
 * The rail and the panel are independent DOM subtrees; these helpers are what
 * moves the keyboard from one to the other instead of leaving it on the page.
 */
import { describe, it, expect } from 'vitest';
import { focusFirstIn } from '../../src/content/ui/column-focus';

describe('focusFirstIn', () => {
  it('focuses the first real control and ignores a -1 tabindex', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <button id="skip" tabindex="-1">skip</button>
      <button id="first">first</button>
      <button id="second">second</button>
    `;
    document.body.appendChild(container);
    expect(focusFirstIn(container)).toBe(true);
    expect(document.activeElement?.id).toBe('first');
    container.remove();
  });

  it('returns false for an empty or null column', () => {
    expect(focusFirstIn(null)).toBe(false);
    const empty = document.createElement('div');
    document.body.appendChild(empty);
    expect(focusFirstIn(empty)).toBe(false);
    empty.remove();
  });
});
