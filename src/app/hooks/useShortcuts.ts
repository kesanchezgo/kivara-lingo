import { useCallback } from 'react';
import { useKivaraStore } from '../../shared/store';
import { SHORTCUT_DEFS, DEFAULT_SHORTCUT_MAP, normalizeCombo, readManifestCombos, type ShortcutMap } from '../../shared/shortcuts';

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
        // NORMALIZED on both sides. The raw map holds whatever the user or an
        // older build typed ("command+s" from the mac default, "Ctrl+S"), and
        // the captured combo is canonical ("Meta+S"), so a verbatim compare
        // let a user bind the same chord twice — the second one silently
        // shadowing the first, and in the manifest case firing BOTH handlers.
        if (map[def.id] && normalizeCombo(map[def.id]) === normalizeCombo(combo)) return def.id;
      }
      return null;
    },
    [map],
  );

  /**
   * Combos Chrome itself owns (`chrome.commands`). Binding one in the editor
   * produced a silent double-fire: the manifest path fired RUN_COMMAND while
   * the in-page handler ALSO matched, because App.tsx discards any combo
   * present in `manifestCombosRef` and the conflict check knew nothing about
   * them. The editor now refuses them with a reason.
   */
  const findManifestConflict = useCallback(
    (combo: string): string | null => {
      const want = normalizeCombo(combo);
      const owned = readManifestCombos();
      for (const c of owned) {
        if (c === want) return c;
      }
      return null;
    },
    [],
  );

  return { map, setShortcut, resetOne, resetAll, findConflict, findManifestConflict };
}
