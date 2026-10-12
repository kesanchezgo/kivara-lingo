/**
 * Both halves of the shadow boundary, asserted.
 *
 * The panel's root moved from `open` to `closed` (content/shadow-host.ts) so a
 * host page cannot read the API-key inputs. That fixed the leak and introduced a
 * question it had to answer: can the extension's own PAGE-SIDE listeners still
 * see inside? Two of them carry the UX around that answer — App.tsx's shortcut
 * guard (typing in a key field must not fire "save word") and its hover guard
 * (cursor over a popover must not resume the video).
 *
 * Both are real `window`/`document` listeners reading `event.composedPath()`,
 * so that is exactly what runs here: a real closed root, a real listener, a
 * real event. Anything less would be a test agreeing with itself.
 */
import { describe, expect, it } from 'vitest';
import { __registerShadowRootForTests, getShadowRoot } from '../../src/content/shadow-host';
import { eventPathIsEditable } from '../../src/content/utils/keyboard';

/** The exact composition a real mount produces. */
function mountClosedPanel(): { host: HTMLElement; dispose: () => void } {
  const host = document.createElement('div');
  host.id = 'kivara-lingo-host';
  const root = host.attachShadow({ mode: 'closed' });
  __registerShadowRootForTests(host, root);
  document.body.appendChild(host);
  return { host, dispose: () => host.remove() };
}

describe('the closed root is opaque to the page but not to us', () => {
  it('exposes nothing through shadowRoot, and is reachable through ours', () => {
    const { host, dispose } = mountClosedPanel();
    try {
      // The shape of the leak that was fixed: a page reaching the panel's
      // API-key inputs did it through `element.shadowRoot`.
      expect(host.shadowRoot).toBeNull();
      expect(host.querySelector('input')).toBeNull();
      // Our own handle is not null, and reaches the same tree.
      const ours = getShadowRoot(host);
      expect(ours).toBeInstanceOf(ShadowRoot);
    } finally {
      dispose();
    }
  });
});

describe('App.tsx guards still see inside', () => {
  it('the shortcut guard recognises typing in a field the page cannot see', () => {
    const { host, dispose } = mountClosedPanel();
    try {
      const root = getShadowRoot(host)!;
      const input = document.createElement('input');
      input.type = 'password'; // the API-key field
      root.appendChild(input);

      // A listener on the page window, exactly like App.tsx's: the event is
      // dispatched from the input, retargeted, and reported to whoever is
      // listening on the way up. If that path does not carry the input, this
      // assertion is what says the change broke the guard.
      const observed: boolean[] = [];
      const onKey = (e: KeyboardEvent) => {
        observed.push(eventPathIsEditable(e));
      };
      window.addEventListener('keydown', onKey, { capture: true });
      try {
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'a', bubbles: true, composed: true }),
        );
      } finally {
        window.removeEventListener('keydown', onKey, { capture: true });
      }
      expect(observed, 'the window listener never fired').toHaveLength(1);
      // If this is false, typing in the key field fires the global shortcuts.
      expect(observed[0], 'typing is not visible to composedPath').toBe(true);
    } finally {
      dispose();
    }
  });

  it('the hover guard still matches a zone inside the root', () => {
    const { host, dispose } = mountClosedPanel();
    try {
      const zone = document.createElement('div');
      zone.dataset.kivaraHoverZone = 'true';
      getShadowRoot(host)?.appendChild(zone);

      const seen: boolean[] = [];
      const onMove = (e: MouseEvent) => {
        seen.push(
          (e.composedPath() as unknown[]).some(
            (node) => node instanceof HTMLElement && node.dataset.kivaraHoverZone === 'true',
          ),
        );
      };
      document.addEventListener('mousemove', onMove, { capture: true });
      try {
        zone.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, composed: true }));
      } finally {
        document.removeEventListener('mousemove', onMove, { capture: true });
      }
      expect(seen, 'the document listener never fired').toHaveLength(1);
      // If this is false, the video resumes while the cursor is on the
      // subtitle or the popover.
      expect(seen[0], 'the hover zone is not visible to composedPath').toBe(true);
    } finally {
      dispose();
    }
  });
});
