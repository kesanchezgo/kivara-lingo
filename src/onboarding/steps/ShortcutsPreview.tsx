import React, { useState } from 'react';
import { t } from '../../shared/i18n';
import { Keyboard } from 'lucide-react';
import { SHORTCUT_DEFS, parseCombo } from '../../shared/shortcuts';
import { useShortcuts } from '../../app/hooks/useShortcuts';
import { ShortcutEditor } from '../../app/components/ShortcutEditor';


export function ShortcutsPreview() {
  const [customize, setCustomize] = useState(false);
  const { map } = useShortcuts();

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/60 flex items-center gap-2">
        <Keyboard size={12} className="text-zinc-500 dark:text-zinc-400" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 flex-1">
          {t('onb.shortcutsTitle')}</p>
        <button
          type="button"
          onClick={() => setCustomize((v) => !v)}
          className="text-[10px] font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors shrink-0 normal-case tracking-normal"
        >
          {customize ? 'Ver defaults' : 'Personalizar'}
        </button>
      </div>

      {!customize ? (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {SHORTCUT_DEFS.map((s) => {
            const combo = map[s.id] ?? s.defaultCombo;
            const keys = combo ? parseCombo(combo) : [];
            return (
              <div key={s.id} className="flex items-center justify-between gap-2 px-4 py-1.5">
                <span className="text-[11.5px] text-zinc-600 dark:text-zinc-400 truncate">{s.label}</span>
                <span className="flex items-center gap-0.5 shrink-0">
                  {keys.length === 0 ? (
                    <span className="text-[10px] text-zinc-400 italic">—</span>
                  ) : keys.map((k, i) => (
                    <React.Fragment key={`${k}-${i}`}>
                      {i > 0 && <span className="text-zinc-400 dark:text-zinc-600 text-[9px] mx-0.5">+</span>}
                      <kbd className="font-sans text-[10px] text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800/70 border border-zinc-200 dark:border-zinc-700 rounded px-1.5 py-px">
                        {k}
                      </kbd>
                    </React.Fragment>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="px-2 py-1.5">
          <ShortcutEditor compact />
        </div>
      )}
    </div>
  );
}
