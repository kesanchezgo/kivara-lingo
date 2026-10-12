/**
 * Both halves of the shadow boundary, asserted.
 *
 * The panel's root moved from `open` to `closed` (content/shadow-host.ts) so a
 * host page cannot read the API-key inputs. That fixed the leak and introduced
 * a question it had to answer: can the extension's own PAGE-SIDE listeners
 * still see inside? Two of them carry the UX around that answer — App.tsx's
 * shortcut guard (typing in a key field must not fire "save word") and its
 * hover guard (cursor over a popover must not resume the video).
 *
 * Both are real `window`/`document` listeners calling the production helpers,
 * against a real closed root. Anything less would be a test agreeing with
 * itself.
 *
 * One environment boundary is honest about itself: jsdom delivers the inner
 * input to a `window` listener, Chromium does NOT (measured in real Chromium,
 * tests/e2e/shadow-composed-path.spec.ts). Each guard is therefore asserted
 * twice — on the event jsdom delivers, and on the event Chromium delivers
 * (path truncated at the host). The second is the one that decides the fix.
 */
import { describe, expect, it } from 'vitest';
import {
  __registerShadowRootForTests,
  getShadowRoot,
  overKivaraZone,
} from '../../src/content/shadow-host';
import { eventPathIsEditable } from '../../src/content/utils/keyboard';

/** A host carrying a closed root, mounted and registered as production does. */
function mountClosedPanel(): { host: HTMLElement } {
  const host = document.createElement('div');
  host.id = 'kivara-lingo-host';
  const root = host.attachShadow({ mode: 'closed' });
  __registerShadowRootForTests(host, root);
  document.body.appendChild(host);
  return { host };
}

/** The panel's real shape: root → section → key field, a few levels in. */
function mountApiKeyField(host: HTMLElement): HTMLInputElement {
  const section = document.createElement('section');
  getShadowRoot(host)!.appendChild(section);
  const input = document.createElement('input');
  input.type = 'password'; // the API-key field
  section.appendChild(input);
  return input;
}

/** What Chromium hands a page-side listener for an event from inside. */
function chromeShape(host: HTMLElement): Event {
  return { composedPath: () => [host], target: host } as unknown as Event;
}

describe('the closed root is opaque to the page but not to us', () => {
  it('exposes nothing through shadowRoot, and is reachable through ours', () => {
    const { host } = mountClosedPanel();
    try {
      // The shape of the leak that was fixed: a page reached the panel's
      // API-key inputs through `element.shadowRoot`.
      expect(host.shadowRoot).toBeNull();
      expect(host.querySelector('input')).toBeNull();
      // Our own handle is not null, and reaches the same tree.
      expect(getShadowRoot(host)).toBeInstanceOf(ShadowRoot);
    } finally {
      host.remove();
    }
  });
});

describe('App.tsx guards still see inside', () => {
  it('the shortcut guard recognises typing in the field the page cannot see', () => {
    const { host } = mountClosedPanel();
    const input = mountApiKeyField(host);

    const observed: boolean[] = [];
    const onKey = (e: KeyboardEvent) => {
      observed.push(eventPathIsEditable(e));
    };
    window.addEventListener('keydown', onKey, { capture: true });
    try {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'a', bubbles: true, composed: true }),
      );
      // The Chromium shape, stubbed: the path stops at the host. jsdom would
      // pass this case on the raw path alone, so this is the one that bites.
      observed.push(eventPathIsEditable(chromeShape(host)));
    } finally {
      window.removeEventListener('keydown', onKey, { capture: true });
    }
    expect(observed[0]).toBe(true);
    // If this is false, typing in the key field fires the global shortcuts.
    expect(observed[1], 'the guard never needed extendedComposedPath on jsdom — Chrome does').toBe(true);
    host.remove();
  });

  it('the hover guard still matches a zone inside the root', () => {
    const { host } = mountClosedPanel();
    const subtitles = document.createElement('div'); // the overlay
    getShadowRoot(host)!.appendChild(subtitles);
    const zone = document.createElement('div');
    zone.dataset.kivaraHoverZone = 'true';
    subtitles.appendChild(zone);

    const seen: boolean[] = [];
    const onMove = (e: MouseEvent) => {
      seen.push(overKivaraZone(e));
    };
    document.addEventListener('mousemove', onMove, { capture: true });
    try {
      zone.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, composed: true }));
      seen.push(overKivaraZone(chromeShape(host) as MouseEvent));
    } finally {
      document.removeEventListener('mousemove', onMove, { capture: true });
    }
    expect(seen[0], 'the document listener never fired').toBe(true);
    // The Chromium shape too — and if this is false, the video resumes while
    // the cursor is still on the subtitle or the popover.
    expect(seen[1], 'the hover zone is not visible to the extended path').toBe(true);
    host.remove();
  });
});
