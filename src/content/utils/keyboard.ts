/**
 * Keyboard helpers for the shadow-DOM panel.
 *
 * The panel (side panel, popover, onboarding) lives INSIDE a shadow root, and a
 * `keydown` fired from an `<input>` in there reaches the page's `window`
 * listener with `event.target` set to the SHADOW HOST — an outer element whose
 * `tagName` is DIV. Checking `target.tagName === 'INPUT'` therefore reports
 * "not typing" and the global shortcuts (save word, toggle subtitles…) fire
 * while the user edits a field.
 *
 * `event.composedPath()` was the answer... for an OPEN root. It is NOT the
 * answer for a CLOSED one: a page-side listener's path stops at the host (see
 * `eventClosedRoot` in content/shadow-host.ts, and the Chromium measurement in
 * tests/e2e/shadow-composed-path.spec.ts). For a closed root the panel's
 * focused element is resolved directly — `root.activeElement` is the node the
 * browser itself considers focused inside the panel — instead of by presence:
 * "the root contains A text field" would over-match a Ctrl+s aimed at some
 * other surface. The path scan stays for every other shape: open roots,
 * plain page events, and environments that deliver the inner node natively.
 */
import { eventClosedRoot } from '../shadow-host';

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
  const root = eventClosedRoot(event);
  if (root) return isEditableElement(root.activeElement);
  const path =
    typeof event.composedPath === 'function' ? Array.from(event.composedPath()) : [];
  const nodes = path.length > 0 ? path : [event.target];
  return nodes.some((node) => isEditableElement(node));
}
