/**
 * F6 shortcut migration (docs/REDESIGN-V2.md §3 H15, decision D9).
 *
 * The nine page shortcuts are new IDs in the persisted map. The store merges
 * `{ ...DEFAULT_SHORTCUT_MAP, ...persisted.shortcuts }`, so the migration rule
 * is: every new id gets its default, and a value the user customised is never
 * overwritten. Alt+D must not be a default anywhere — Chrome owns it on
 * Windows and Linux — and the canonical parser must understand its
 * replacement, plus the comma/period physical keys on macOS layouts.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SHORTCUT_MAP,
  SHORTCUT_DEFS,
  comboFromEvent,
  normalizeCombo,
} from '../../src/shared/shortcuts';

const F6_IDS = [
  'prev',
  'replaySlow',
  'next',
  'autoPause',
  'loop',
  'slower',
  'faster',
  'listenFirst',
  'rail',
];

/** The exact merge the store performs in `mergePersisted`. */
function migrated(persisted: Record<string, string>): Record<string, string> {
  return { ...DEFAULT_SHORTCUT_MAP, ...persisted };
}

describe('F6 shortcut catalogue', () => {
  it('ships the nine new page shortcuts', () => {
    for (const id of F6_IDS) {
      expect(SHORTCUT_DEFS.find((def) => def.id === id), id).toBeTruthy();
      expect(DEFAULT_SHORTCUT_MAP[id], id).toBeTruthy();
    }
  });

  it('never defaults to Alt+D (claimed by Chrome)', () => {
    for (const [id, combo] of Object.entries(DEFAULT_SHORTCUT_MAP)) {
      expect(normalizeCombo(combo), id).not.toBe('Alt+D');
    }
    expect(DEFAULT_SHORTCUT_MAP.next).toBe('Alt+Z');
  });

  it('fills the new ids without touching a customised one', () => {
    // A snapshot written before F6: only the original five ids, two customised.
    const before = { save: 'Ctrl+Alt+S', panel: 'Alt+P' };
    const after = migrated(before);
    for (const id of F6_IDS) expect(after[id], id).toBe(DEFAULT_SHORTCUT_MAP[id]);
    expect(after.save).toBe('Ctrl+Alt+S');
    expect(after.panel).toBe('Alt+P');
  });

  it('is idempotent', () => {
    const once = migrated({ save: 'Ctrl+Alt+S' });
    expect(migrated(once)).toEqual(once);
  });
});

describe('combo parsing for the new defaults', () => {
  const event = (init: Partial<KeyboardEvent>) =>
    ({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, key: '', code: '', ...init }) as KeyboardEvent;

  it('reads the physical comma and period keys', () => {
    expect(comboFromEvent(event({ altKey: true, code: 'Comma', key: '≤' }))).toBe('Alt+,');
    expect(comboFromEvent(event({ altKey: true, code: 'Period', key: '≥' }))).toBe('Alt+.');
  });

  it('matches the documented defaults', () => {
    expect(comboFromEvent(event({ altKey: true, code: 'KeyZ', key: 'z' }))).toBe('Alt+Z');
    expect(comboFromEvent(event({ altKey: true, code: 'KeyA', key: 'a' }))).toBe('Alt+A');
    expect(
      comboFromEvent(event({ altKey: true, shiftKey: true, code: 'KeyR', key: 'R' })),
    ).toBe('Alt+Shift+R');
  });
});
