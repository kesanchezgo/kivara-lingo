/**
 * Shortcut catalogue + serialization helpers.
 *
 * Centralised here so popup / options / onboarding / content-script can all
 * agree on the same combo for "Save card", "Toggle subtitles", etc. The IDs
 * map to (in order):
 *
 *  - `save`    — `save_word` chrome command (manifest.json), default Ctrl+Shift+S.
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
import { t } from './i18n';

export interface ShortcutDef {
  id: string;
  label: string;
  defaultCombo: string;
}

export const SHORTCUT_DEFS: ShortcutDef[] = [
  { id: 'save',    label: t('shortcut.save'),          defaultCombo: 'Ctrl+Shift+S' },
  { id: 'toggle',  label: t('shortcut.toggleSubs'),    defaultCombo: 'Alt+C' },
  { id: 'replay',  label: t('shortcut.replay'),        defaultCombo: 'Alt+R' },
  { id: 'recap',   label: t('shortcut.recap'),         defaultCombo: 'Alt+V' },
  { id: 'panel',   label: t('shortcut.panel'),         defaultCombo: 'Alt+K' },
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

  // Layout-independent key extraction, with `e.key` as the fallback.
  //
  // `e.key` reports the CHARACTER a key produces, not the key: on macOS
  // Option is the carrier for Alt, and Option+C produces the character 'ç'
  // (ç = the dead-key output of Alt+c on the Spanish layout, or '√' with
  // Option on the default layout), so the combo string came out as "Alt+ç"
  // and "Alt+C" NEVER matched. Every in-page shortcut silently died for
  // anyone on a Mac — the exact behaviour the review measured as "Alt+V
  // never works".
  //
  // `e.code` is the PHYSICAL key ("KeyV", "Digit3") and is the same on
  // every keyboard and OS. We read it for letter/digit keys — the shapes
  // the whole shortcut catalog uses — and keep `e.key` for everything
  // else (Space, arrows, F-keys, punctuation): those are the same on every
  // layout and `e.code` would be 'Quote'/'Slash' instead of the character.
  let key: string | null = null;
  const code = 'code' in e ? e.code : undefined;
  if (code?.startsWith('Key')) key = code.slice(3);
  else if (code?.startsWith('Digit')) key = code.slice(5);

  if (key === null) {
    const raw = e.key;
    if (!raw || raw === 'Control' || raw === 'Alt' || raw === 'Shift' || raw === 'Meta') return null;
    key = raw;
  }
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
  // chrome.commands on macOS returns glued symbol runs ("⌘⇧Y", "⌃⌥A")
  // with no '+' — map each Mac modifier symbol to its canonical name and
  // split so the rest of the pipeline sees a normal token list.
  const withNamedMods = combo
    .replace(/⌘|cmd/gi, ' Meta+')
    .replace(/⌥|option/gi, ' Alt+')
    .replace(/⇧|shift/gi, ' Shift+')
    .replace(/⌃|control/gi, ' Ctrl+');
  const parts = parseCombo(withNamedMods);
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
