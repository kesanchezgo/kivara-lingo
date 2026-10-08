/**
 * Shortcut catalogue + serialization helpers.
 *
 * Centralised here so popup / options / onboarding / content-script can all
 * agree on the same combo for "Save card", "Toggle subtitles", etc. The IDs
 * map to (in order):
 *
 *  - `save`    — `save_word` chrome command (manifest.json), default Ctrl+S.
 *  - `toggle`  — `toggle_subtitles`, default Alt+C.
 *  - `replay`  — `repeat_cue`, default Alt+R.
 *  - `recap`   — `recapture_frame` command (manifest.json, NO suggested_key:
 *    Chrome caps suggested shortcuts at 4, so Alt+V lives ONLY in the
 *    in-page keydown listener below and is fully user-rebindable).
 *  - `panel`   — `toggle_panel`, default Alt+K.
 *
 * The chrome.commands API can only be re-bound by the user via
 * `chrome://extensions/shortcuts`, so the user-customisable combos stored
 * here are honoured by the content script (Alt+V re-capture in particular)
 * and surfaced as a UI-only hint for the chrome-managed shortcuts. This
 * keeps the UI consistent with the mock while never breaking the manifest
 * contract.
 */
import type React from 'react';

export interface ShortcutDef {
  id: string;
  label: string;
  defaultCombo: string;
}

export const SHORTCUT_DEFS: ShortcutDef[] = [
  { id: 'save',    label: 'Guardar tarjeta',      defaultCombo: 'Ctrl+S' },
  { id: 'toggle',  label: 'Toggle subtítulos',    defaultCombo: 'Alt+C' },
  { id: 'replay',  label: 'Repetir frase',        defaultCombo: 'Alt+R' },
  { id: 'recap',   label: 'Re-capturar frame',    defaultCombo: 'Alt+V' },
  { id: 'panel',   label: 'Abrir / cerrar panel', defaultCombo: 'Alt+K' },
];

export type ShortcutMap = Record<string, string>;

export const DEFAULT_SHORTCUT_MAP: ShortcutMap = Object.fromEntries(
  SHORTCUT_DEFS.map((s) => [s.id, s.defaultCombo]),
);

/** Stable order of modifiers in the serialised combo. */
const MOD_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;

/**
 * Convert a KeyboardEvent into the canonical `"Ctrl+Shift+K"` form.
 * Returns `null` while only modifiers are pressed (incomplete combo).
 */
export function comboFromEvent(
  e: KeyboardEvent | React.KeyboardEvent,
): string | null {
  const mods: string[] = [];
  if (e.ctrlKey)  mods.push('Ctrl');
  if (e.altKey)   mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey)  mods.push('Meta');

  const raw = e.key;
  if (!raw || raw === 'Control' || raw === 'Alt' || raw === 'Shift' || raw === 'Meta') return null;

  let key = raw;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();

  const ordered = MOD_ORDER.filter((m) => mods.includes(m));
  return [...ordered, key].join('+');
}

export function parseCombo(combo: string): string[] {
  return combo.split('+').map((k) => k.trim()).filter(Boolean);
}

/** Normalize a combo string to the canonical form `comboFromEvent`
 * produces, so live `chrome.commands.getAll()` shortcuts ("MacCtrl", raw
 * "ctrl+s", …) compare equal to our stored map. `Command`/`Cmd` →
 * `Meta`, `MacCtrl` → `Ctrl`, single letters uppercased, modifiers in
 * MOD_ORDER. Unknown tokens pass through so we never crash the guard. */
export function normalizeCombo(combo: string): string {
  const parts = parseCombo(combo);
  if (!parts.length) return combo;
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1).map((m) => {
    const low = m.toLowerCase();
    if (low === 'command' || low === 'cmd' || low === 'meta') return 'Meta';
    if (low === 'macctrl' || low === 'ctrl' || low === 'control') return 'Ctrl';
    if (low === 'alt' || low === 'option') return 'Alt';
    if (low === 'shift') return 'Shift';
    return m;
  });
  const normKey = key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key;
  const ordered = MOD_ORDER.filter((m) => mods.includes(m));
  const extra = mods.filter((m) => !(MOD_ORDER as readonly string[]).includes(m));
  return [...ordered, ...extra, normKey].join('+');
}
