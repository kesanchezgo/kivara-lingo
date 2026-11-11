/**
 * Focus hand-off between the transcript rail and the docked panel (#38).
 *
 * Both columns are plain DOM subtrees; opening one does not move the keyboard
 * with it. These helpers put focus on the first real control of a column, so
 * Tab continues inside the column the user just asked for instead of walking
 * the rest of the player.
 */
const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Focus the first focusable control inside `container`. False when there is none. */
export function focusFirstIn(container: HTMLElement | null): boolean {
  if (!container) return false;
  const candidates = container.querySelectorAll<HTMLElement>(FOCUSABLE);
  for (const candidate of candidates) {
    if (candidate.getAttribute('aria-hidden') === 'true') continue;
    if (candidate.tabIndex < 0) continue;
    candidate.focus();
    if (container.ownerDocument.activeElement === candidate) return true;
  }
  return false;
}
