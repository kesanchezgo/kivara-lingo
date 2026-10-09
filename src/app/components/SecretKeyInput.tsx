import React, { useEffect, useRef, useState } from 'react';
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
  /** Show a "Quitar clave" action when a value exists (default true). */
  showClear?: boolean;
  /** Secret-store identity of this field — required for the Quitar action
   * to register an explicit clear (without it a tombstone is never written
   * from a context that never loaded the baseline). */
  section?: string;
  field?: string;
}

/**
 * Password input that NEVER displays the stored secret — not even masked.
 *
 * History (two bugs fixed):
 *  1. `value={maskSecret(stored)}` rendered `sk••••••` (plaintext in
 *     memory) and any keystroke saved the MASKED text. One Backspace
 *     turned `sk-abc123` into `sk•••••••`.
 *  2. First fix reset `draft` in `useEffect([stored])`. Since each
 *     keystroke wrote through to `stored`, every keypress reset the draft
 *     to '' — typing saved only the LAST character (paste worked).
 *
 * Contract:
 *  - Draft is local state, never seeded from `stored`. The stored value
 *    is never rendered (placeholder shows "•••••••• (guardada)").
 *  - The reset effect ignores write-through: it tracks `lastEmitted` and
 *    only resets when `stored` changed OUTSIDE this component.
 *  - Commit on blur or Enter (not per keystroke) so the store is not
 *    hammered and the identity is stable while typing.
 *  - "Quitar clave" explicitly clears (draft-empty alone never deletes).
 *  - Still-encrypted values show the re-enter hint, not `enc:v1:`.
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
  /** A slot holds a key this context cannot display: a fresh context (no
   * sync blob, so loadSecrets never ran) sees '' while another tab/device
   * already saved one. The input must still look "guarded" and offer
   * Quitar — otherwise the user cannot remove a key they are not shown. */
  const [hiddenStored, setHiddenStored] = useState(false);
  /** Bumped by Quitar: the store echo cannot tell us whether the tombstone
   * landed (the value was already ''), so the presence probe has to run
   * again instead of clearing the state optimistically. */
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

  // Reset only when `stored` changed from OUTSIDE (another context, a
  // clear, an unreadable-cipher switch). An echo of our own emission
  // (lastEmitted) must NOT reset the draft mid-typing.
  useEffect(() => {
    if (lastEmittedRef.current !== null && stored === lastEmittedRef.current) {
      // Our own write reflected back — keep draft/dirty as-is.
      lastEmittedRef.current = null;
      return;
    }
    if (lastEmittedRef.current !== null && stored !== lastEmittedRef.current) {
      // External change raced our write — trust the store, start clean.
      lastEmittedRef.current = null;
    }
    setDraft('');
    setDirty(false);
  }, [stored]);

  // Presence probe: only when this context has no value to show. Re-runs when
  // `stored` empties (a clear elsewhere) or after a Quitar attempt, so a
  // tombstone that FAILED to write keeps the guarded state (and the Quitar
  // button) instead of claiming the key is gone.
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
    // Empty/whitespace draft NEVER clears the key: typing a letter,
    // deleting it and blurring would otherwise silently wipe a saved
    // key. Deletion happens exclusively through the Quitar action.
    if (!dirtyRef.current) return;
    const next = draftRef.current;
    if (!next.trim()) {
      dirtyRef.current = false;
      setDirty(false);
      return;
    }
    // Clear the ref IMMEDIATELY (state updates are async) so a second
    // commit — pagehide followed by unmount cleanup — can't emit twice.
    dirtyRef.current = false;
    lastEmittedRef.current = next;
    onChangeRef.current(next);
    setDirty(false);
  };

  // Commit before the page goes away:
  //  • visibilitychange → hidden fires EARLIER than pagehide (the popup is
  //    hidden but not yet unloaded), giving the async encrypt +
  //    chrome.storage.local.set chain time to complete.
  //  • pagehide stays as the last resort; because commit clears dirtyRef,
  //    it cannot emit a second time.
  // Reads the REFS, not state — state is frozen by the time cleanup runs.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const effectivePlaceholder = hasStored && !dirty
    ? t('key.guarded')
    : (placeholder ?? '');

  return (
    <div className="w-full">
      <div className="flex items-center gap-1.5">
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
          className={className ?? 'sl-input sl-mono w-full'}
          autoComplete={autoCompleteOff ? 'off' : undefined}
          spellCheck={false}
        />
        {showToggle && (
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="text-[10px] px-1.5 py-1 rounded border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 shrink-0"
            title={show ? t('key.hideTitle') : t('key.showTitle')}
          >
            {show ? t('key.hide') : t('key.show')}
          </button>
        )}
        {showClear && hasStored && (
          <button
            type="button"
            onClick={() => {
              lastEmittedRef.current = '';
              setDraft('');
              setDirty(false);
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
            className="text-[10px] px-1.5 py-1 rounded border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950 shrink-0"
            title={t('key.clearTitle')}
          >
            {t('key.clear')}
          </button>
        )}
      </div>
      {unreadable && !dirty && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-snug mt-1">
          {hintWhenUnreadable ?? t('key.unreadable')}
        </p>
      )}
    </div>
  );
}
