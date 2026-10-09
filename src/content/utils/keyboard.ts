/**
 * Keyboard helpers for the shadow-DOM panel.
 *
 * The panel (side panel, popover, onboarding) lives inside a shadow root, and
 * a `keydown` fired from an `<input>` in there reaches the page's `window`
 * listener with `event.target` set to the SHADOW HOST — an outer element whose
 * `tagName` is DIV. Checking `target.tagName === 'INPUT'` therefore reports
 * "not typing" and the global shortcuts (save word, toggle subtitles…) fire
 * while the user edits a field. `event.composedPath()` is the only view that
 * crosses the shadow boundary, so every hop is inspected instead.
 */

/** `input[type=…]` where typing letters means text, not a shortcut. */
const TEXTUAL_INPUT_TYPES = new Set([
  'text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date',
  'datetime-local', 'month', 'time', 'week',
]);

function isEditableElement(node: EventTarget | null): boolean {
  const el = node as (HTMLElement & { isContentEditable?: boolean }) | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  if (tag === 'INPUT') {
    const type = ((el as HTMLInputElement).type ?? 'text').toLowerCase();
    // A checkbox/radio/button-style input is operated with Space/Enter and
    // must not swallow a shortcut; a text field must.
    return !TEXTUAL_INPUT_TYPES.has(type) ? false : true;
  }
  return false;
}

/** True when the event came from (or passed through) a text-entry control,
 * including one inside a shadow root. */
export function eventPathIsEditable(event: Event): boolean {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  if (path.length === 0) return isEditableElement(event.target);
  return path.some((node) => isEditableElement(node));
}
