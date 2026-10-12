/**
 * Both halves of the shadow boundary, asserted — and the resolver the two
 * App.tsx guards now use.
 *
 * The panel's root moved from `open` to `closed` (content/shadow-host.ts) so a
 * host page cannot read the API-key inputs. That fixed the leak and introduced
 * a question it had to answer: can the extension's own PAGE-SIDE listeners
 * still see inside? Two of them carry the UX around that answer — App.tsx's
 * shortcut guard (typing in a key field must not fire "save word") and its
 * hover guard (cursor over a popover must not resume the video).
 *
 * Both guards call the production helpers with the event shape each
 * environment produces. One environment boundary is honest about itself:
 * jsdom delivers the inner input to a `window` listener, Chromium does NOT
 * (measured in real Chromium, tests/e2e/shadow-composed-path.spec.ts), and
 * jsdom implements no layout, so `elementFromPoint` reads null here. Cases
 * where jsdom cannot emulate a box stub the resolver the same way the
 * production call makes it — as a function of the event coordinates — and the
 * Chromium behaviour itself ships pinned by the e2e spec.
 *
 * The "over the chrome but not the zone → false" cases exist because a
 * membership check ("the root contains a hover zone") got this wrong: it read
 * a pointer anywhere on the overlay as inside Kivara.
 */
import { describe, expect, it } from 'vitest';
import {
  __registerShadowRootForTests,
  getShadowRoot,
  overKivaraZone,
} from '../../src/content/shadow-host';
import { eventPathIsEditable } from '../../src/content/utils/keyboard';

/** A host carrying a closed root, mounted and registered as production does. */
function mountClosedPanel(): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement('div');
  host.id = 'kivara-lingo-host';
  const root = host.attachShadow({ mode: 'closed' });
  __registerShadowRootForTests(host, root);
  document.body.appendChild(host);
  return { host, root };
}

/** The panel's real shape: root → section → key field, a few levels in. */
function mountApiKeyField(root: ShadowRoot): HTMLInputElement {
  const section = document.createElement('section');
  root.appendChild(section);
  const input = document.createElement('input');
  input.type = 'password'; // the API-key field
  section.appendChild(input);
  return input;
}

/** What Chromium hands a page-side listener for an event from inside: the
 * path stops at the host; jsdom would deliver the inner nodes instead. */
function chromeShape(host: HTMLElement): Event {
  return { composedPath: () => [host], target: host } as unknown as Event;
}

describe('the closed root is opaque to the page but not to us', () => {
  it('exposes nothing through shadowRoot, and is reachable through ours', () => {
    const { host, root } = mountClosedPanel();
    try {
      // The shape of the leak that was fixed: a page reached the panel's
      // API-key inputs through `element.shadowRoot`.
      expect(host.shadowRoot).toBeNull();
      expect(host.querySelector('input')).toBeNull();
      // Our own handle is not null, and reaches the same tree.
      expect(getShadowRoot(host)).toBe(root);
    } finally {
      host.remove();
    }
  });
});

describe('the shortcut guard resolves the focused node, not any field', () => {
  it('typing in the API-key field — Chromium shape — suppresses shortcuts', () => {
    const { host, root } = mountClosedPanel();
    const input = mountApiKeyField(root);

    try {
      input.focus();
      // jsdom would pass this on the raw path; the Chromium shape is what
      // decides the fix, since Chrome truncates the path at the host.
      expect(
        eventPathIsEditable(chromeShape(host)),
        'a keydown with focus on the key field must read as typing, path truncated or not',
      ).toBe(true);
    } finally {
      host.remove();
    }
  });

  it('a shortcut with focus elsewhere is not "typing", even though the root has fields', () => {
    const { host, root } = mountClosedPanel();
    mountApiKeyField(root);

    try {
      // A Ctrl+s aimed at a button inside the panel, or nothing focused at
      // all: the root CONTAINS a text field, but the event does not come
      // from one. A membership check would report "typing" here and swallow
      // every shortcut pressed while the side panel stands open.
      expect(eventPathIsEditable(chromeShape(host))).toBe(false);
    } finally {
      host.remove();
    }
  });

  it('focus on a BUTTON inside the panel is not a text field', () => {
    const { host, root } = mountClosedPanel();
    const button = document.createElement('button');
    root.appendChild(button);

    try {
      button.focus();
      expect(eventPathIsEditable(chromeShape(host))).toBe(false);
    } finally {
      host.remove();
    }
  });
});

describe('the hover guard resolves the element under the pointer, not the root contents', () => {
  /** The overlay: host → chrome (non-zone) + zone plate side by side. */
  function mountOverlay(): { host: HTMLElement; root: ShadowRoot; zone: HTMLElement; chrome: HTMLElement } {
    const { host, root } = mountClosedPanel();
    const chrome = document.createElement('div'); // the non-zone overlay chrome
    const zone = document.createElement('div');
    zone.dataset.kivaraHoverZone = 'true';
    root.appendChild(chrome);
    root.appendChild(zone);
    return { host, root, zone, chrome };
  }

  it('pointer ON the zone reads as over-Kivara', () => {
    const { host, root, zone } = mountOverlay();
    try {
      // jsdom has no layout — elementFromPoint is null here — so the
      // resolver is stubbed to what the coordinates resolve to. Production
      // gets this from the DOM; the stub only emulates the absence of one.
      (root as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint =
        () => zone;
      const e = { composedPath: () => [host], target: host, clientX: 10, clientY: 10 } as unknown as MouseEvent;
      expect(overKivaraZone(e)).toBe(true);
    } finally {
      host.remove();
    }
  });

  it('pointer OVER the chrome — no zone under it — reads as NOT over-Kivara', () => {
    const { host, root, chrome } = mountOverlay();
    try {
      (root as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint =
        () => chrome;
      const e = { composedPath: () => [host], target: host, clientX: 10, clientY: 10 } as unknown as MouseEvent;
      // The regression this pins: the old membership check returned true
      // here — the root contains a zone — keeping the video paused while
      // the cursor sat on the (much larger) empty overlay.
      expect(overKivaraZone(e), 'chrome-with-a-zone-somewhere must not read as a hit').toBe(false);
    } finally {
      host.remove();
    }
  });

  it('pointer over nothing (resolver null) reads as NOT over-Kivara', () => {
    const { host, root } = mountOverlay();
    try {
      (root as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint =
        () => null;
      const e = { composedPath: () => [host], target: host, clientX: 10, clientY: 10 } as unknown as MouseEvent;
      expect(overKivaraZone(e)).toBe(false);
    } finally {
      host.remove();
    }
  });
});
