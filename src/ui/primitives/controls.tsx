import React from 'react';
import { ChevronDown } from '../icons';

/**
 * Form controls with the prototype's public API, implemented WITHOUT Radix
 * (docs/REDESIGN-V2.md §3 H1). Radix focus scopes and dismissable layers read
 * `document.activeElement` / document listeners, which break inside the
 * content script's CLOSED shadow root. A styled native `<select>` and a native
 * `<input type="range">` are painted by the browser and work anywhere.
 */

/* ── Text inputs ─────────────────────────────────────────────────────────── */
const fieldBase =
  'w-full rounded-lg bg-white dark:bg-white/[0.06] ring-1 ring-zinc-900/[0.1] dark:ring-white/[0.08] border-0 outline-none shadow-[0_1px_1px_rgba(0,0,0,.03)] dark:shadow-none ' +
  'text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 ' +
  'hover:ring-zinc-900/[0.16] dark:hover:ring-white/[0.12] ' +
  'focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:bg-white dark:focus-visible:bg-zinc-900 ' +
  'transition-[background-color,box-shadow,color] duration-150 disabled:opacity-50 disabled:cursor-not-allowed';
const mdSize = 'h-8 px-2.5 text-[13px]';
const lgSize = 'h-8 px-3 text-[13px]';

export const inputCls = `${fieldBase} ${mdSize}`;
export const inputLgCls = `${fieldBase} ${lgSize}`;

/* ── Select ──────────────────────────────────────────────────────────────── */

/** What Select and Slider hand to `onChange`: a native event shape
 * (`e.target.value`, always a string), a drop-in replacement for
 * `<select>` / `<input type="range">` without `any`. */
export interface ValueChange { target: { value: string } }

type OptionElement = React.ReactElement<{
  value?: string | number;
  children?: React.ReactNode;
}>;

/** Every value a child `<option>` contributes, so the placeholder can be
 * shown only when nothing matches. */
function optionValues(children: React.ReactNode): string[] {
  const out: string[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const el = child as OptionElement;
    if (el.type === 'option') {
      const raw = el.props.value;
      out.push(raw == null ? String(el.props.children ?? '') : String(raw));
    } else if (el.type === 'optgroup') {
      out.push(...optionValues(el.props.children));
    } else if (el.type === React.Fragment) {
      out.push(...optionValues(el.props.children));
    }
  });
  return out;
}

export interface SelectProps {
  value?: string | number;
  onChange?: (e: ValueChange) => void;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  size?: 'md' | 'lg';
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  /** Stable hook for behavior tests (passed through to the native select). */
  'data-testid'?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

/**
 * Styled native `<select>`. Children are real `<option>` / `<optgroup>`
 * elements, exactly as the previous Radix-backed component accepted them.
 */
export function Select({
  value, onChange, children, className = '', style, size, disabled, placeholder, id, ...aria
}: SelectProps) {
  const lg = size === 'lg' || /\bsl-lg\b/.test(className);
  const extra = className.split(/\s+/).filter((c) => c && !['sl-select', 'sl-lg', 'w-full'].includes(c)).join(' ');
  const current = value == null ? '' : String(value);
  const hasOption = optionValues(children).includes(current);
  const showPlaceholder = !!placeholder && !hasOption;

  return (
    <span className="relative inline-flex w-full min-w-0 items-center">
      <select
        id={id}
        value={current}
        disabled={disabled}
        onChange={(e) => onChange?.({ target: { value: e.target.value } })}
        className={`${fieldBase} ${lg ? lgSize : mdSize} appearance-none cursor-pointer pr-8 ${extra}`}
        style={style}
        {...aria}
      >
        {showPlaceholder && <option value={current} disabled hidden>{placeholder}</option>}
        {children}
      </select>
      <ChevronDown
        size={14}
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 shrink-0 text-zinc-400 dark:text-zinc-500"
      />
    </span>
  );
}

/* ── Slider ──────────────────────────────────────────────────────────────── */
export interface SliderProps {
  value: number | string;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  onChange?: (e: ValueChange) => void;
  className?: string;
  disabled?: boolean;
  type?: string; // ignored (drop-in for <input type="range">)
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

/** Native `<input type="range">`, styled by theme.css `.sl-range`. */
export function Slider({ value, min = 0, max = 100, step = 1, onChange, className = '', disabled, id, ...aria }: SliderProps) {
  const extra = className.split(/\s+/).filter((c) => c && c !== 'sl-range' && c !== 'w-full').join(' ');
  return (
    <input
      id={id}
      type="range"
      value={Number(value)}
      min={Number(min)}
      max={Number(max)}
      step={Number(step)}
      disabled={disabled}
      onChange={(e) => onChange?.({ target: { value: e.target.value } })}
      className={`sl-range w-full ${extra}`}
      {...aria}
    />
  );
}