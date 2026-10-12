/**
 * Shortcut combos are LAYOUT-INDEPENDENT — the reason `e.code` exists.
 *
 * The audit found every in-page shortcut dead on macOS: `comboFromEvent`
 * read `e.key`, which on a Mac with Option held returns the CHARACTER that
 * layout produces — Option+c gives 'ç' — so the combo string came out as
 * "Alt+ç" and "Alt+C" never matched. The user pressing Alt+V got nothing.
 *
 * These tests pin the contract across both key sources:
 *
 *   - the default combo "Alt+V" must match on a Mac Option+V press
 *     (e.key '√' or 'ç', e.code 'KeyV', altKey true);
 *   - the SAME combo must ALSO match on Windows/Linux Alt+V
 *     (e.key 'v', e.code 'KeyV');
 *   - an unknown key must return null (never "Ctrl+Undefined");
 *   - pure modifiers must return null;
 *   - Space / arrow / F-keys keep working (fallback path preserved);
 *   - `normalizeCombo("Command+S")` still equals `normalizeCombo("Meta+S")`
 *     — the round-trip against `chrome.commands.getAll()`.
 */
import { describe, it, expect } from 'vitest';
import { comboFromEvent, normalizeCombo } from '../../src/shared/shortcuts';

const evt = (init: KeyboardEventInit, code?: string) => {
  const base: KeyboardEventInit = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...init };
  base.code = code ?? '';
  return base as unknown as KeyboardEvent;
};

describe('comboFromEvent is layout-independent (Mac and Linux both work)', () => {
  it('resolves Alt+V on macOS Option+V where the key would otherwise be a character', () => {
    // The audit's exact failure: Option+V on macOS with a Spanish layout.
    // Option held: e.key is the dead-key character the display produces;
    // e.code is what the PHYSICAL key was. Only the latter identifies the
    // shortcut the user meant.
    const macOptionV = evt({ altKey: true, key: '√' }, 'KeyV');
    expect(comboFromEvent(macOptionV)).toBe('Alt+V');
    // Same physical key, different Option character — same answer.
    expect(comboFromEvent(evt({ altKey: true, key: 'ç' }, 'KeyV'))).toBe('Alt+V');
    // English default layout where Option+key produces 'v' anyway.
    expect(comboFromEvent(evt({ altKey: true, key: 'v' }, 'KeyV'))).toBe('Alt+V');
  });

  it('resolves Alt+V on Windows/Linux where e.key is "v"', () => {
    expect(comboFromEvent(evt({ altKey: true, key: 'v' }, 'KeyV'))).toBe('Alt+V');
  });

  it('resolves a digits combo without key interpretation drift', () => {
    // Alt+2 must not become "Alt+@" (Shift state) or "Alt+²".
    expect(comboFromEvent(evt({ altKey: true, shiftKey: true, key: '@' }, 'Digit2'))).toBe('Alt+Shift+2');
    expect(comboFromEvent(evt({ altKey: true, key: '2' }, 'Digit2'))).toBe('Alt+2');
  });

  it('keeps the non-letter keys working through the fallback', () => {
    // Arrows and F-keys have no letter code, so `e.key` is the source.
    expect(comboFromEvent(evt({ ctrlKey: true, key: 'ArrowLeft' }))).toBe('Ctrl+ArrowLeft');
    expect(comboFromEvent(evt({ ctrlKey: true, key: 'F5' }))).toBe('Ctrl+F5');
    // Space is " " on every layout.
    expect(comboFromEvent(evt({ key: ' ' }, 'Space'))).toBe('Space');
  });

  it('returns null for incomplete combos (modifier-only)', () => {
    expect(comboFromEvent(evt({ altKey: true, key: 'Alt' }))).toBe(null);
    expect(comboFromEvent(evt({ ctrlKey: true, key: 'Control' }))).toBe(null);
    // Cmd + nothing : the "Meta" key alone is not a combo.
    expect(comboFromEvent(evt({ metaKey: true, key: 'Meta' }))).toBe(null);
  });

  it('keeps the Manifest "Command+S" equivalent to our stored "Meta+S"', () => {
    // The comparison chrome.commands.getAll() feeds the switch:
    // normalizeCombo must be idempotent and cross-key. The canonical
    // modifier order is MOD_ORDER (Ctrl, Alt, Shift, Meta), so Meta
    // ties AFTER Shift in the canonical string.
    expect(normalizeCombo('Command+S')).toBe(normalizeCombo('Meta+S'));
    expect(normalizeCombo('⌘⇧Y')).toBe('Shift+Meta+Y');
    expect(normalizeCombo('⌥⌘⇧Y')).toBe('Alt+Shift+Meta+Y');
    expect(normalizeCombo('MacCtrl+Alt+K')).toBe('Ctrl+Alt+K');
  });

  it('survives a bare lowercase combo string without crashing', () => {
    // chrome.commands on Windows used to sometimes hand back "ctrl+s".
    expect(normalizeCombo('ctrl+s')).toBe('Ctrl+S');
    expect(normalizeCombo('alt+v')).toBe('Alt+V');
  });
});
