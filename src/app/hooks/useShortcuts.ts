import { useCallback } from 'react';
import { useKivaraStore } from '../../shared/store';
import {
  DEFAULT_SHORTCUT_MAP,
  SHORTCUT_DEFS,
  type ShortcutMap,
} from '../../shared/shortcuts';

/**
 * Read-and-edit hook for the user-customisable shortcut map.
 *
 * Backed by the Zustand store (chrome.storage.sync) instead of localStorage
 * so the same combos surface in popup, options, onboarding, AND content
 * scripts — `localStorage` would be silently per-origin in MV3 and break
 * cross-context consistency.
 */
export function useShortcuts() {
  const map = useKivaraStore((s) => s.shortcuts);
  const setShortcuts = useKivaraStore((s) => s.setShortcuts);

  const setShortcut = useCallback(
    (id: string, combo: string) => {
      setShortcuts((prev: ShortcutMap) => ({ ...prev, [id]: combo }));
    },
    [setShortcuts],
  );

  const resetOne = useCallback(
    (id: string) => {
      setShortcuts((prev: ShortcutMap) => ({ ...prev, [id]: DEFAULT_SHORTCUT_MAP[id] }));
    },
    [setShortcuts],
  );

  const resetAll = useCallback(() => {
    setShortcuts({ ...DEFAULT_SHORTCUT_MAP });
  }, [setShortcuts]);

  /** Return the id that already binds `combo` (excluding `exceptId`), or null. */
  const findConflict = useCallback(
    (combo: string, exceptId?: string): string | null => {
      for (const def of SHORTCUT_DEFS) {
        if (def.id === exceptId) continue;
        if (map[def.id] === combo) return def.id;
      }
      return null;
    },
    [map],
  );

  return { map, setShortcut, resetOne, resetAll, findConflict };
}
