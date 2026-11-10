import React, { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, X, AlertTriangle } from '../../ui/icons';
import { inputCls } from '../../ui/primitives/controls';
import { markSecretExplicitClear, unreadableSecret, hasHiddenSecret } from '../../shared/secret-store';
import { t } from '../../shared/i18n';

interface SecretKeyInputProps {
  /** Raw stored value (plaintext legacy or ciphertext). NEVER rendered. */
  stored: string | undefined | null;
  onChange: (nextPlaintext: string) => void;
  placeholder?: string;
  className?: string;
  autoCompleteOff?: boolean;
  showToggle?: boolean;
  hintWhenUnreadable?: string;
  /** Show a "Remove key" action when a value exists (default true). */
  showClear?: boolean;
  /** Secret-store identity of this field — required for the Quitar action to
   * register an explicit clear (without it a tombstone is never written from a
   * context that never loaded the baseline). */
  section?: string;
  field?: string;
}

/**
 * Password input that NEVER displays the stored secret — not even masked.
 *
 * The view is the prototype's (inline eye/clear icons); the state machine is
 * the repo's, and every clause of its contract still holds:
 *
 *  - Draft is local state, never seeded from `stored`. The stored value is
 *    never rendered (placeholder shows "•••••••• (saved)").
 *  - The reset effect ignores write-through: it tracks `lastEmitted` and only
 *    resets when `stored` changed OUTSIDE this component.
 *  - Commit on blur, Enter or page hide (not per keystroke).
 *  - A slot that holds a key this context cannot display still looks guarded
 *    and offers the clear action; the probe re-runs after a clear so a failed
 *    tombstone cannot claim the key is gone.
 *  - Empty draft alone never clears: deletion happens through the Quitar action.
 *  - `enc:v1:` ciphertext shows the re-enter hint, never the blob.
 */
export function SecretKeyInput({
  stored,
  onChange,
  placeholder,
  className,
  autoCompleteOff = true,
  showToggle = false,
  hintWhenUnreadable,
  showClear = true,
  section,
  field,
}: SecretKeyInputProps) {
  /** A slot holds a key this context cannot display: a fresh context (no sync
   * blob, so loadSecrets never ran) sees '' while another tab/device already
   * saved one. The input must still look guarded and offer Quitar, otherwise
   * the user cannot remove a key they are not shown. */
  const [hiddenStored, setHiddenStored] = useState(false);
  /** Bumped by Quitar: the store echo cannot tell whether the tombstone
   * landed, so the presence probe runs again instead of clearing state
   * optimistically. */
  const [probeNonce, setProbeNonce] = useState(0);
  const hasStored = !!stored || hiddenStored;
  const unreadable = unreadableSecret(stored);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [show, setShow] = useState(false);
  /** Last value this component pushed to the store — write-through echo. */
  const lastEmittedRef = useRef<string | null>(null);
  /** Refs mirroring state so commit can read them outside React events
   * (unmount cleanup / pagehide) where state setters are already gone. */
  const draftRef = useRef('');
  const dirtyRef = useRef(false);
  draftRef.current = draft;
  dirtyRef.current = dirty;
  /** Latest onChange — the commit effect runs ONCE (empty deps), so a stale
   * closure would call a parent setter captured at first mount. */
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Reset only when `stored` changed from OUTSIDE (another context, a clear,
  // an unreadable-cipher switch). An echo of our own emission must NOT reset
  // the draft mid-typing.
  useEffect(() => {
    if (lastEmittedRef.current !== null && stored === lastEmittedRef.current) {
      lastEmittedRef.current = null;
      return;
    }
    if (lastEmittedRef.current !== null && stored !== lastEmittedRef.current) {
      lastEmittedRef.current = null;
    }
    setDraft('');
    setDirty(false);
  }, [stored]);

  // Presence probe: only when this context has no value to show. Re-runs when
  // `stored` empties (a clear elsewhere) or after a Quitar attempt, so a
  // tombstone that FAILED to write keeps the guarded state (and the button).
  useEffect(() => {
    if (stored || !section || !field) return;
    let cancelled = false;
    void hasHiddenSecret(section, field).then((hidden) => {
      if (!cancelled) setHiddenStored(hidden);
    });
    return () => {
      cancelled = true;
    };
  }, [stored, section, field, probeNonce]);

  const commit = () => {
    // Empty/whitespace draft NEVER clears the key: typing a letter, deleting
    // it and blurring would otherwise silently wipe a saved key.
    if (!dirtyRef.current) return;
    const next = draftRef.current;
    if (!next.trim()) {
      dirtyRef.current = false;
      setDirty(false);
      return;
    }
    // Clear the ref IMMEDIATELY (state updates are async) so a second commit —
    // pagehide followed by unmount cleanup — cannot emit twice.
    dirtyRef.current = false;
    lastEmittedRef.current = next;
    onChangeRef.current(next);
    setDirty(false);
  };

  // Commit before the page goes away:
  //  • visibilitychange → hidden fires EARLIER than pagehide, giving the async
  //    encrypt + storage chain time to complete;
  //  • pagehide stays as the last resort; commit clears dirtyRef, so it cannot
  //    emit a second time.
  useEffect(() => {
    const commitRef = () => commit();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') commitRef();
    };
    window.addEventListener('pagehide', commitRef);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', commitRef);
      document.removeEventListener('visibilitychange', onVisibility);
      commitRef();
    };
  }, []);

  const effectivePlaceholder = hasStored && !dirty
    ? t('key.guarded')
    : (placeholder ?? '');
  const iconBtn = 'w-6 h-6 inline-flex items-center justify-center rounded-md text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-900/[0.05] dark:hover:bg-white/[0.07] kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40';

  return (
    <div className="w-full space-y-1">
      <div className="relative w-full">
        <input
          type={showToggle && show ? 'text' : 'password'}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setDirty(true);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          placeholder={effectivePlaceholder}
          className={`${className ?? `${inputCls} font-mono !text-[12px]`} ${hasStored ? 'pr-16' : 'pr-9'}`}
          autoComplete={autoCompleteOff ? 'off' : undefined}
          spellCheck={false}
        />
        <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
          {showToggle && (
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className={iconBtn}
              title={show ? t('key.hideTitle') : t('key.showTitle')}
              aria-label={show ? t('key.hide') : t('key.show')}
            >
              {show ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          )}
          {showClear && hasStored && (
            <button
              type="button"
              onClick={() => {
                lastEmittedRef.current = '';
                setDraft('');
                setDirty(false);
                setShow(false);
                // Do NOT clear the guarded state here: the tombstone may fail
                // to land (quota, storage hiccup) and the key would still be
                // there. Re-probe instead and let the slot answer.
                setProbeNonce((n) => n + 1);
                // Register the explicit clear BEFORE onChange: the save path
                // consults this flag to decide whether a tombstone may be
                // written from a context without a baseline.
                if (section && field) markSecretExplicitClear(section, field);
                onChange('');
              }}
              className={`${iconBtn} hover:!text-rose-500`}
              title={t('key.clearTitle')}
              aria-label={t('key.clear')}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      {unreadable && !dirty && (
        <span className="inline-flex items-start gap-1.5 text-[12px] leading-[17px] text-amber-600 dark:text-amber-400">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>{hintWhenUnreadable ?? t('key.unreadable')}</span>
        </span>
      )}
    </div>
  );
}