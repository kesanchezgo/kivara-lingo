/**
 * Keyboard guard for the shadow-DOM panel.
 *
 * The bug this pins: a `keydown` coming from an `<input>` inside the panel's
 * shadow root reaches the page's `window` listener with `event.target` = the
 * SHADOW HOST (a DIV), so a `tagName === 'INPUT'` check says "not typing" and
 * the global shortcuts fire while the user types. Only `composedPath()` sees
 * across the boundary.
 */
import { describe, it, expect } from 'vitest';
import { eventPathIsEditable } from '../../src/content/utils/keyboard';

function fakeEvent(path: Array<Partial<{ tagName: string; isContentEditable: boolean; type: string }>>): Event {
  const nodes = path.map((p) =>
    Object.assign(Object.create(null), p),
  ) as unknown as EventTarget[];
  return {
    composedPath: () => nodes,
    target: nodes[0] ?? null,
  } as unknown as Event;
}

describe('eventPathIsEditable', () => {
  it('sees text inputs the shadow host hides', () => {
    // The panel's search box: the reported target is the host, the input is
    // one hop deeper in the composed path.
    expect(
      eventPathIsEditable(
        fakeEvent([{ tagName: 'DIV' }, { tagName: 'DIV' }, { tagName: 'INPUT', type: 'text' }]),
      ),
    ).toBe(true);
  });

  it('ignores clicks/keys on ordinary elements', () => {
    expect(eventPathIsEditable(fakeEvent([{ tagName: 'DIV' }, { tagName: 'SPAN' }]))).toBe(false);
  });

  it('treats textarea and select as typing', () => {
    expect(eventPathIsEditable(fakeEvent([{ tagName: 'TEXTAREA' }]))).toBe(true);
    expect(eventPathIsEditable(fakeEvent([{ tagName: 'SELECT' }]))).toBe(true);
  });

  it('treats contentEditable as typing', () => {
    expect(eventPathIsEditable(fakeEvent([{ tagName: 'DIV', isContentEditable: true }]))).toBe(true);
  });

  it('lets shortcuts through for checkbox/radio/range inputs', () => {
    for (const type of ['checkbox', 'radio', 'range', 'button', 'submit']) {
      expect(
        eventPathIsEditable(fakeEvent([{ tagName: 'INPUT', type }])),
        type,
      ).toBe(false);
    }
  });

  it('reads a password field as typing (never swallows into a shortcut)', () => {
    expect(eventPathIsEditable(fakeEvent([{ tagName: 'INPUT', type: 'password' }]))).toBe(true);
  });

  it('falls back to event.target when composedPath is unavailable', () => {
    const event = { target: { tagName: 'INPUT', type: 'text' } } as unknown as Event;
    expect(eventPathIsEditable(event)).toBe(true);
  });
});
