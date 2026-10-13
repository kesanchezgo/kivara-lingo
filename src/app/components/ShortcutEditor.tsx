import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw, AlertTriangle, Keyboard as KeyboardIcon } from 'lucide-react';
import { useShortcuts } from '../hooks/useShortcuts';
import { SHORTCUT_DEFS, comboFromEvent, comboHasRequiredModifier, parseCombo } from '../../shared/shortcuts';
import { t } from '../../shared/i18n';

interface ShortcutEditorProps {
  /** When true, renders the compact variant used inside accordions. */
  compact?: boolean;
}

/**
 * Editor de atajos compartido por Onboarding y SettingsTab.
 *
 *  - Clic en el combo → captura la siguiente combinación pulsada.
 *  - Esc cancela. Backspace/Delete deja el atajo sin asignar.
 *  - Detecta conflictos contra otros atajos y avisa antes de sobreescribir.
 *
 * El estado vive en `useShortcuts` (Zustand → chrome.storage.sync), por lo
 * que los cambios se sincronizan en todos los surfaces de la extensión sin
 * recargar.
 */
export function ShortcutEditor({ compact = false }: ShortcutEditorProps) {
  const { map, setShortcut, resetOne, resetAll, findConflict, findManifestConflict } = useShortcuts();
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const [warning, setWarning] = useState<{ id: string; msg: string } | null>(null);

  return (
    <div className={compact ? '' : 'space-y-1'}>
      {!compact && (
        <div className="flex items-center justify-between px-1 pb-1">
          <span className="text-[10px] text-zinc-500 dark:text-zinc-500">
            {t('sc.clickToRecord')}<kbd className="font-sans text-[9px] px-1 rounded bg-zinc-100 dark:bg-zinc-800">Esc</kbd> cancela
          </span>
          <button
            type="button"
            onClick={() => { resetAll(); setWarning(null); }}
            className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 inline-flex items-center gap-1 transition-colors"
            title={t('key.resetAllTitle')}
          >
            <RotateCcw size={10} /> Reset
          </button>
        </div>
      )}

      <div className={compact
        ? 'divide-y divide-zinc-100 dark:divide-zinc-800'
        : 'rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800 overflow-hidden'
      }>
        {SHORTCUT_DEFS.map((def) => {
          const current = map[def.id] ?? def.defaultCombo;
          const isDefault = current === def.defaultCombo;
          const capturing = capturingId === def.id;
          const showWarning = warning?.id === def.id;
          return (
            <div key={def.id} className={`flex items-center gap-2 px-3 ${compact ? 'py-1.5' : 'py-2'}`}>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-zinc-700 dark:text-zinc-300 leading-tight truncate">{def.label}</p>
                {showWarning && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 flex items-center gap-1 leading-tight">
                    <AlertTriangle size={9} /> {warning!.msg}
                  </p>
                )}
              </div>
              <KeyCaptureButton
                combo={current}
                capturing={capturing}
                onStart={() => { setCapturingId(def.id); setWarning(null); }}
                onRejectModifierLess={() => {
                  // Stay in capture mode so the user can press again with a
                  // modifier; the message says what is missing instead of
                  // silently ignoring the keypress.
                  setWarning({ id: def.id, msg: t('sc.needsModifier') });
                }}
                onCapture={(combo) => {
                  // Chrome owns this chord (chrome.commands). Binding it in
                  // the editor used to be accepted silently, and the two
                  // handlers — manifest RUN_COMMAND and our in-page one —
                  // could both fire during cold start: one save per press,
                  // or a seek the user never asked for.
                  const manifestOwned = findManifestConflict(combo);
                  if (manifestOwned) {
                    setWarning({ id: def.id, msg: t('sc.usedByChrome', { combo: manifestOwned }) });
                    setCapturingId(null);
                    return;
                  }
                  const conflict = findConflict(combo, def.id);
                  if (conflict) {
                    const other = SHORTCUT_DEFS.find((s) => s.id === conflict)?.label ?? conflict;
                    setWarning({ id: def.id, msg: `Ya usado por "${other}"` });
                    setCapturingId(null);
                    return;
                  }
                  setShortcut(def.id, combo);
                  setCapturingId(null);
                  setWarning(null);
                }}
                onCancel={() => setCapturingId(null)}
                onClear={() => { setShortcut(def.id, ''); setCapturingId(null); setWarning(null); }}
              />
              {!isDefault && !capturing && (
                <button
                  type="button"
                  onClick={() => { resetOne(def.id); setWarning(null); }}
                  className="text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors shrink-0"
                  title={`Restaurar a ${def.defaultCombo}`}
                >
                  <RotateCcw size={11} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface KeyCaptureButtonProps {
  combo: string;
  capturing: boolean;
  onStart: () => void;
  onCapture: (combo: string) => void;
  onCancel: () => void;
  onClear: () => void;
  /** A pressed key with no real modifier: shown instead of binding it. */
  onRejectModifierLess: () => void;
}

function KeyCaptureButton({
  combo, capturing, onStart, onCapture, onCancel, onClear, onRejectModifierLess,
}: KeyCaptureButtonProps) {
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!capturing) return;
    btnRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { onCancel(); return; }
      if (e.key === 'Backspace' || e.key === 'Delete') { onClear(); return; }
      // A combo without Ctrl / Alt / Meta is not a shortcut, it is a keypress:
      // binding `K` or `Space` ran save-word / repeat-cue while the user was
      // typing a capital letter on YouTube, because the in-page handler fires
      // before the page sees the character.
      if (!comboHasRequiredModifier(e)) {
        onRejectModifierLess();
        return;
      }
      const next = comboFromEvent(e);
      if (next) onCapture(next);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [capturing, onCancel, onCapture, onClear, onRejectModifierLess]);

  const keys = combo ? parseCombo(combo) : [];

  return (
    <button
      ref={btnRef}
      type="button"
      onClick={(e) => { e.stopPropagation(); if (!capturing) onStart(); }}
      className={`shrink-0 min-w-[88px] px-2 py-1 rounded-md border text-[10px] font-medium transition-all flex items-center justify-center gap-0.5 ${
        capturing
          ? 'border-indigo-400 dark:border-indigo-500/60 bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 ring-2 ring-indigo-200 dark:ring-indigo-500/30 animate-pulse'
          : 'border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-800/40 hover:border-indigo-300 dark:hover:border-indigo-500/50 hover:bg-indigo-50/40 dark:hover:bg-indigo-500/10'
      }`}
    >
      {capturing ? (
        <span className="inline-flex items-center gap-1 text-[10px]">
          <KeyboardIcon size={10} /> {t('sc.pressCombo')}</span>
      ) : keys.length === 0 ? (
        <span className="text-zinc-400 dark:text-zinc-500 italic">{t('sc.unassigned')}</span>
      ) : (
        keys.map((k, i) => (
          <React.Fragment key={`${k}-${i}`}>
            {i > 0 && <span className="text-zinc-400 dark:text-zinc-600 text-[9px]">+</span>}
            <kbd className="font-sans text-[10px] text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded px-1 py-px shadow-sm">
              {k}
            </kbd>
          </React.Fragment>
        ))
      )}
    </button>
  );
}
