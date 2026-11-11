/**
 * Shortcut hints in tooltips (F6 · docs/REDESIGN-V2.md §7).
 *
 * One helper so every view formats a hint the same way: the copy plus the
 * user's live combo, or the copy alone when the action has no binding. The
 * combo comes from the persisted map first and the catalogue default second —
 * a view never owns a copy of the shortcut.
 */
import type { ShortcutMap } from '../../shared/shortcuts';
import { SHORTCUT_DEFS } from '../../shared/shortcuts';

/** The user's combo for `id`, or the catalogue default, or undefined. */
export function comboOf(map: ShortcutMap | undefined, id: string): string | undefined {
  return map?.[id] ?? SHORTCUT_DEFS.find((def) => def.id === id)?.defaultCombo;
}

/** `title (Combo)`, or just `title` when there is no combo to show. */
export function withCombo(title: string, combo: string | undefined | null): string {
  return combo ? `${title} (${combo})` : title;
}
