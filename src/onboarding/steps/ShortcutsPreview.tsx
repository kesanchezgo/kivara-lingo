/* Shortcuts preview on the demo step (F8; prototype view, repo registry). */
import React, { useState } from 'react';
import { Keyboard, ChevronDown } from '../../ui/icons';
import { t } from '../../shared/i18n';
import { SHORTCUT_DEFS, parseCombo } from '../../shared/shortcuts';
import { useShortcuts } from '../../app/hooks/useShortcuts';
import { ShortcutEditor } from '../../app/components/ShortcutEditor';
import { Button, FOCUS, ui } from '../../ui/primitives/settings-primitives';

/** Daily-use shortcuts on screen; the rest behind one click. */
const ESSENTIAL_IDS = new Set(['save', 'toggle', 'replay', 'panel', 'prev', 'next', 'loop']);

export function ShortcutsPreview() {
  const [customize, setCustomize] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const { map } = useShortcuts();
  const essential = SHORTCUT_DEFS.filter((s) => ESSENTIAL_IDS.has(s.id));
  const rest = SHORTCUT_DEFS.length - essential.length;

  return (
    <div className="space-y-3 pt-4">
      <div className="flex items-center gap-2 px-1">
        <Keyboard size={15} className="text-zinc-400" />
        <p className="text-[15px] font-semibold tracking-[-0.01em] text-zinc-900 dark:text-white flex-1">
          {t('onb.shortcutsTitle')}
        </p>
        <Button variant="soft" size="sm" onClick={() => setCustomize((v) => !v)} className="duration-150">
          {customize ? t('onb.viewDefaults') : t('onb.customize')}
        </Button>
      </div>

      <div className="rounded-xl bg-white dark:bg-white/[0.03] ring-1 ring-zinc-900/[0.06] dark:ring-white/[0.06] shadow-[0_1px_2px_rgba(16,24,40,.04)] dark:shadow-none overflow-hidden">
        {!customize ? (
          <>
            <div id="kivara-onb-shortcuts" className="divide-y divide-zinc-900/[0.06] dark:divide-white/[0.06]">
              {(showAll ? SHORTCUT_DEFS : essential).map((s) => {
                const combo = map[s.id] ?? s.defaultCombo;
                const keys = combo ? parseCombo(combo) : [];
                return (
                  <div key={s.id} className="flex items-center justify-between gap-2 px-4 h-10">
                    <span className="text-[13px] text-zinc-700 dark:text-zinc-300 truncate">{s.label}</span>
                    <span className="flex items-center gap-0.5 shrink-0">
                      {keys.length === 0
                        ? <span className="text-[12px] text-zinc-400 italic">—</span>
                        : keys.map((k, i) => (
                          <React.Fragment key={`${k}-${i}`}>
                            {i > 0 && <span className="text-zinc-400 dark:text-zinc-600 text-[12px] mx-0.5">+</span>}
                            <kbd className="inline-flex items-center h-5 px-1.5 rounded-md font-sans text-[11px] font-medium leading-none text-zinc-600 dark:text-zinc-300 bg-white dark:bg-white/[0.06] ring-1 ring-zinc-900/[0.08] dark:ring-white/[0.08]">
                              {k}
                            </kbd>
                          </React.Fragment>
                        ))}
                    </span>
                  </div>
                );
              })}
            </div>
            {rest > 0 && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                aria-expanded={showAll}
                aria-controls="kivara-onb-shortcuts"
                className={`w-full flex items-center justify-center gap-1.5 h-10 border-t border-zinc-900/[0.06] dark:border-white/[0.06] text-[12px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 ${ui.rowHover} ${FOCUS}`}
              >
                {showAll ? t('onb.shortcutsLess') : t('onb.shortcutsMore', { n: rest })}
                <ChevronDown size={14} className={`transition-transform duration-200 ${showAll ? 'rotate-180' : ''}`} />
              </button>
            )}
          </>
        ) : (
          <div className="px-2 py-1.5">
            <ShortcutEditor compact />
          </div>
        )}
      </div>
    </div>
  );
}