import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw, AlertTriangle, Keyboard as KeyboardIcon } from '../../ui/icons';
import { FOCUS, kbdCls } from '../../ui/primitives/settings-primitives';
import { useShortcuts } from '../hooks/useShortcuts';
import {
  SHORTCUT_DEFS, comboFromEvent, comboHasRequiredModifier, normalizeCombo, parseCombo,
} from '../../shared/shortcuts';
import { t } from '../../shared/i18n';

interface ShortcutEditorProps {
  /** When true, renders the compact variant used inside accordions. */
  compact?: boolean;
}

/**
 * Shortcut editor shared by Onboarding and SettingsTab.
 *
 * - Click the combo → captures the next pressed combination.
 * - Esc cancels. Backspace/Delete leaves it unassigned. Blur or an outside
 *   click cancels.
 * - Rejects combos without Ctrl/Alt/Meta and the ones Chrome already owns.
 * - Detects conflicts against the other shortcuts and warns before overwriting.
 *
 * State lives in `useShortcuts` (Zustand → chrome.storage.sync), so changes
 * sync across every extension surface without a reload.
 */
export function ShortcutEditor({ compact = false }: ShortcutEditorProps) {
  const { map, setShortcut, resetOne, resetAll, findConflict, findManifestConflict } = useShortcuts();
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const [warning, setWarning] = useState<{ id: string; msg: string } | null>(null);

  return (
    <div className={compact ? '' : 'space-y-1'}>
      {!compact && (
        <div className="flex items-center justify-between gap-2 px-0.5 pb-1.5">
          <span className="text-[12px] text-zinc-500 dark:text-zinc-400">
            {t('sc.clickToRecord')} <kbd className={kbdCls}>Esc</kbd> {t('sc.escCancels')}
          </span>
          <button
            type="button"
            onClick={() => { resetAll(); setWarning(null); }}
            className={`shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[12px] font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-900/[0.05] dark:hover:bg-white/[0.06] kvl-press ${FOCUS}`}
            title={t('key.resetAllTitle')}
          >
            <RotateCcw size={14} /> {t('sc.resetLabel')}
          </button>
        </div>
      )}

      <div className="rounded-xl bg-white dark:bg-white/[0.03] ring-1 ring-zinc-900/[0.06] dark:ring-white/[0.06] divide-y divide-zinc-900/[0.06] dark:divide-white/[0.06] overflow-hidden">
        {SHORTCUT_DEFS.map((def) => {
          const current = map[def.id] ?? def.defaultCombo;
          const isDefault = current === def.defaultCombo;
          const capturing = capturingId === def.id;
          const showWarning = warning?.id === def.id;
          return (
            <div key={def.id} className={`flex items-center gap-2 px-3.5 ${compact ? 'min-h-[40px] py-1.5' : 'min-h-[44px] py-2'}`}>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100 leading-[18px] truncate" title={def.label}>{def.label}</p>
                {showWarning && (
                  <p className="text-[12px] text-amber-600 dark:text-amber-400 mt-0.5 flex items-start gap-1 leading-[17px]">
                    <AlertTriangle size={12} className="text-amber-500 shrink-0 mt-0.5" /> <span>{warning!.msg}</span>
                  </p>
                )}
              </div>
              <KeyCaptureButton
                combo={current}
                capturing={capturing}
                onStart={() => { setCapturingId(def.id); setWarning(null); }}
                onRejectModifierLess={() => {
                  // Stay in capture mode so the user can press again with a
                  // modifier; the message says what is missing.
                  setWarning({ id: def.id, msg: t('sc.needsModifier') });
                }}
                onCapture={async (combo) => {
                  // The manifest owns this chord — UNLESS it is the chord THIS
                  // action already ships with. Re-picking your own default used
                  // to be refused with "already used", which reads as broken.
                  const ownDefault = normalizeCombo(combo) === normalizeCombo(def.defaultCombo);
                  // Chrome owns this chord — the LIVE answer from
                  // chrome.commands.getAll(), so rebinding in
                  // chrome://extensions/shortcuts stays consistent.
                  const manifestOwned = ownDefault ? null : await findManifestConflict(combo);
                  if (manifestOwned) {
                    setWarning({ id: def.id, msg: t('sc.usedByChrome', { combo: manifestOwned }) });
                    setCapturingId(null);
                    return;
                  }
                  const conflict = ownDefault ? null : findConflict(combo, def.id);
                  if (conflict) {
                    const other = SHORTCUT_DEFS.find((s) => s.id === conflict)?.label ?? conflict;
                    setWarning({ id: def.id, msg: t('sc.alreadyUsedBy', { other }) });
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
                  className={`w-7 h-7 inline-flex items-center justify-center rounded-lg text-zinc-400 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-900/[0.05] dark:hover:bg-white/[0.07] kvl-press shrink-0 ${FOCUS}`}
                  aria-label={t('sc.restoreTo', { combo: def.defaultCombo })}
                  title={t('sc.restoreTo', { combo: def.defaultCombo })}
                >
                  <RotateCcw size={14} />
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
  /** A pressed key with no real modifier: warned about instead of assigned. */
  onRejectModifierLess: () => void;
}

function KeyCaptureButton({
  combo, capturing, onStart, onCapture, onCancel, onClear, onRejectModifierLess,
}: KeyCaptureButtonProps) {
  const btnRef = useRef<HTMLButtonElement>(null);
  // Callbacks in a ref: the parent recreates them every render, and as
  // dependencies they re-subscribed the listeners (and refocused) mid-capture.
  const cb = useRef({ onCancel, onCapture, onClear, onRejectModifierLess });
  cb.current = { onCancel, onCapture, onClear, onRejectModifierLess };

  useEffect(() => {
    if (!capturing) return;
    const onCancel = () => cb.current.onCancel();
    const onCapture = (c: string) => cb.current.onCapture(c);
    const onClear = () => cb.current.onClear();
    const onRejectModifierLess = () => cb.current.onRejectModifierLess();
    btnRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { onCancel(); return; }
      if (e.key === 'Backspace' || e.key === 'Delete') { onClear(); return; }
      if (e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift' || e.key === 'Meta') return;
      if (!comboHasRequiredModifier(e)) { onRejectModifierLess(); return; }
      const next = comboFromEvent(e);
      if (next) onCapture(next);
    };
    // Capture is a modal state: a blur or an outside click cancels it, so the
    // next keystroke elsewhere does not land as the new binding.
    const outsideClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!btnRef.current) return;
      if (target && btnRef.current.contains(target)) return;
      onCancel();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', onCancel);
    const timer = window.setTimeout(() => window.addEventListener('mousedown', outsideClick, true), 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', onCancel);
      window.removeEventListener('mousedown', outsideClick, true);
    };
  }, [capturing]);

  const keys = combo ? parseCombo(combo) : [];

  return (
    <button
      ref={btnRef}
      type="button"
      onClick={(e) => { e.stopPropagation(); if (!capturing) onStart(); }}
      className={`shrink-0 min-w-[88px] max-w-[160px] h-7 px-1.5 rounded-lg text-[12px] font-medium kvl-press flex items-center justify-center gap-1 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
        capturing
          ? 'bg-indigo-500/[0.08] dark:bg-indigo-400/[0.12] text-indigo-600 dark:text-indigo-300 ring-2 ring-indigo-500/40 animate-pulse'
          : 'hover:bg-zinc-900/[0.04] dark:hover:bg-white/[0.05]'
      }`}
    >
      {capturing ? (
        <span className="inline-flex items-center gap-1.5 text-[12px]">
          <KeyboardIcon size={14} /> {t('sc.pressCombo')}
        </span>
      ) : keys.length === 0 ? (
        <span className="text-[12px] text-zinc-400 dark:text-zinc-400">{t('sc.unassigned')}</span>
      ) : (
        keys.map((k, i) => (
          <React.Fragment key={`${k}-${i}`}>
            {i > 0 && <span className="text-zinc-400 dark:text-zinc-600 text-[11px]">+</span>}
            <kbd className={kbdCls}>{k}</kbd>
          </React.Fragment>
        ))
      )}
    </button>
  );
}