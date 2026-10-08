import React, { useEffect, useState } from 'react';
import { unreadableSecret } from '../../shared/secret-store';

interface SecretKeyInputProps {
  /** Raw stored value (plaintext legacy or ciphertext). NEVER rendered. */
  stored: string | undefined | null;
  onChange: (nextPlaintext: string) => void;
  placeholder?: string;
  className?: string;
  autoCompleteOff?: boolean;
  showToggle?: boolean;
  hintWhenUnreadable?: string;
}

/**
 * Password input that NEVER displays the stored secret — not even masked.
 *
 * The previous approach (`value={maskSecret(stored)}`) corrupted keys: the
 * store holds plaintext in memory, so the input rendered `sk••••••` and any
 * keystroke sent that masked text to onChange, which encrypted and saved
 * the mask itself. One Backspace turned `sk-abc123` into `sk•••••••`.
 *
 * Contract:
 *  - Local draft starts EMPTY; placeholder shows "•••••••• (guardada)" when
 *    a value exists, so the user knows a key is set without seeing it.
 *  - onChange fires ONLY with fresh user-typed text (dirty). Untouched =
 *    no write, the stored key survives re-renders and saves.
 *  - Clearing the draft explicitly (select-all + delete + blur with empty
 *    draft after having typed) clears the key; simply focusing does nothing.
 *  - Still-encrypted values (unreadable on this device) show the re-enter
 *    hint instead of the raw `enc:v1:` blob.
 */
export function SecretKeyInput({
  stored,
  onChange,
  placeholder,
  className,
  autoCompleteOff = true,
  showToggle = false,
  hintWhenUnreadable,
}: SecretKeyInputProps) {
  const hasStored = !!stored;
  const unreadable = unreadableSecret(stored);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [show, setShow] = useState(false);

  // A new stored identity (different ciphertext / cleared elsewhere) resets
  // the draft so a stale in-progress edit can't leak across keys.
  useEffect(() => {
    setDraft('');
    setDirty(false);
  }, [stored]);

  const effectivePlaceholder = hasStored && !dirty
    ? '•••••••• (guardada — escribe para reemplazar)'
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
            onChange(e.target.value);
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
            title={show ? 'Ocultar' : 'Mostrar lo escrito'}
          >
            {show ? 'Ocultar' : 'Ver'}
          </button>
        )}
      </div>
      {unreadable && !dirty && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-snug mt-1">
          {hintWhenUnreadable ?? 'Clave no legible en este dispositivo (cifrada en otro). Vuelve a introducirla aquí para usarla en este equipo.'}
        </p>
      )}
    </div>
  );
}
