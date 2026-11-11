import React from 'react';
import { ChevronDown, ChevronRight, Paypal, RotateCcw } from '../icons';
import { t, fmtNumber } from '../../shared/i18n';
import { InfoHint } from '../../app/components/InfoHint';

/**
 * Shared panel primitives (Subtitles, Vocabulary, Cards, Settings).
 * Ported from the prototype to `src/ui/primitives/`; F9 removed the
 * `app/components/tabs/settings-primitives` shim, so every consumer imports
 * this module directly.
 */

function sectionId(title: string, id?: string): string {
  return id ?? `kivara-section-${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
}

/* ─── Design system ──────────────────────────────────────────────────────
 * ONE scale for panel, transcript, popup and onboarding.
 *
 *  Type (Inter):
 *    title    15px / 600  — titles (brand, surface headers)
 *    display  22px / 600  — onboarding step headers only
 *    label    13px / 500  — row labels
 *    body     13px / 400  — text
 *    small    12px / 400  — descriptions, secondary values, section labels
 *    meta     11px / 500  — kbd, badges, counters (nothing below 11px)
 *
 *  4px spacing grid · 32px controls (sm 28px) · 44px rows
 *  Radii: controls 8px (rounded-lg) · groups and overlays 12px (rounded-xl)
 *  Focus: ring-2 indigo-500/40 · Accent: indigo-500/600
 *  Icons: 16px in rows, 14px in buttons.
 *
 *  Selection — every control has a role:
 *    Tabs (tablist)         navigate between views (panel, transcript)
 *    SegmentedControl       pick a value (weight, level, mode...)
 *    FilterChips            filter a list (Recent, Sentences, Words)
 *    Toggle                 on / off
 *    ↺ per row              appearance settings only, never personal data
 */
const HAIR = 'divide-zinc-900/[0.06] dark:divide-white/[0.06]';
const HAIR_B = 'border-zinc-900/[0.06] dark:border-white/[0.06]';
export const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40';
export const tx = {
  display: 'text-[22px] leading-7 font-semibold tracking-[-0.015em] text-zinc-900 dark:text-white',
  title: 'text-[15px] leading-5 font-semibold tracking-[-0.01em] text-zinc-900 dark:text-white',
  label: 'text-[13px] leading-[18px] font-medium text-zinc-800 dark:text-zinc-100',
  body: 'text-[13px] leading-5 text-zinc-700 dark:text-zinc-300',
  small: 'text-[12px] leading-[17px] text-zinc-500 dark:text-zinc-400',
  meta: 'text-[11px] leading-4 font-medium text-zinc-500 dark:text-zinc-400',
} as const;
export const surface = {
  panel: 'bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100',
  group: 'rounded-xl bg-white dark:bg-white/[0.03] ring-1 ring-zinc-900/[0.06] dark:ring-white/[0.06] shadow-[0_1px_2px_rgba(16,24,40,.04)] dark:shadow-none',
  overlay: 'rounded-xl bg-white dark:bg-zinc-900 ring-1 ring-zinc-900/[0.08] dark:ring-white/[0.08] shadow-[0_12px_32px_-8px_rgba(0,0,0,.25)]',
  hairB: HAIR_B,
} as const;
export const ui = {
  body: 'kvl-stagger px-4 pt-4 pb-10 space-y-6',
  scroll: 'kvl-scroll',
  card: `${surface.group} overflow-hidden`,
  head: 'kvl-row flex items-center justify-between gap-3 px-3.5 min-h-[48px] py-2.5',
  rowHover: 'hover:bg-zinc-900/[0.025] dark:hover:bg-white/[0.025] transition-colors duration-150',
  title: `flex items-center gap-3 min-w-0 ${tx.label}`,
  /** Onboarding icon tile (faint indigo), reused in row headers. */
  tile: 'w-7 h-7 rounded-lg shrink-0 inline-flex items-center justify-center bg-indigo-500/[0.08] dark:bg-indigo-400/[0.12] text-indigo-600 dark:text-indigo-300 [&>svg]:size-[15px]',
  /** Section title outside the group: same weight as the onboarding header. */
  label: 'flex items-center gap-1.5 min-w-0 px-0.5 mb-2.5 text-[13px] leading-[18px] font-semibold tracking-[-0.005em] text-zinc-900 dark:text-white',
  /** Padded content: each child becomes a row with an inset hairline. */
  inner: `ml-3.5 divide-y ${HAIR} [&>*:not(button)]:pr-3.5 [&>*:not(button)]:py-3 [&>button]:my-3`,
  /** Bleed content: children (QuickRow...) set their own height. */
  divide: `ml-3.5 divide-y ${HAIR} [&>*]:pr-3.5`,
  hair: HAIR_B,
  meta: 'text-[12px] text-zinc-500 dark:text-zinc-400',
  desc: 'text-[12px] leading-[17px] text-zinc-500 dark:text-zinc-400',
} as const;

/** Inside a group, Accordions render as rows, not as boxes. */
const InGroupCtx = React.createContext(false);

/** Indigo tile with the row's icon (same language as the onboarding). */
export function IconTile({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span aria-hidden="true" className={`${ui.tile} ${className}`}>{children}</span>;
}

export function Chevron({ open }: { open: boolean }) {
  return <ChevronDown size={14} aria-hidden="true" className={`text-zinc-400 dark:text-zinc-400 transition-transform duration-[220ms] ease-[var(--kvl-ease)] ${open ? 'rotate-180' : ''}`} />;
}

export function Collapse({ open, children, id, labelledBy }: { open: boolean; children: React.ReactNode; id?: string; labelledBy?: string }) {
  return (
    <div
      id={id}
      role={id ? 'region' : undefined}
      aria-labelledby={labelledBy}
      {...({ inert: open ? undefined : '' } as Record<string, string | undefined>)}
      className={`grid transition-[grid-template-rows,opacity] duration-[280ms] ease-[var(--kvl-ease)] ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
    >
      <div className="overflow-hidden min-h-0">{children}</div>
    </div>
  );
}

/** Section label (outside the group): 12px/500, sentence case, no icon. */
export function SectionLabel({ children, hint, right }: { icon?: React.ReactNode; children: React.ReactNode; hint?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="kvl-row flex items-center justify-between gap-2">
      <span className={ui.label}><span className="truncate">{children}</span>{hint && <InfoHint text={hint} size={12} />}</span>
      {right && <span className="shrink-0 mb-2.5 flex items-center text-[12px] text-zinc-500 dark:text-zinc-400">{right}</span>}
    </div>
  );
}

/** Inset group with an optional label above; child Accordions stack as rows. */
export function Section({ icon, title, hint, right, children, flush = true }: {
  icon?: React.ReactNode; title?: React.ReactNode; hint?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; flush?: boolean;
}) {
  return (
    <section>
      {title && <SectionLabel icon={icon} hint={hint} right={right}>{title}</SectionLabel>}
      <div className={`${ui.card} ${flush ? `divide-y ${HAIR}` : ''}`}>
        <InGroupCtx.Provider value>{flush ? children : <div className={ui.inner}>{children}</div>}</InGroupCtx.Provider>
      </div>
    </section>
  );
}

/** Group with a header: the same piece for Subtitles, Cards and Settings. */
export function Group({
  icon, title, hint, right, children, collapsible, open = true, onToggle, flush,
}: {
  icon?: React.ReactNode; title: React.ReactNode; hint?: React.ReactNode; right?: React.ReactNode;
  children: React.ReactNode; collapsible?: boolean; open?: boolean; onToggle?: () => void;
  /** Bleed content (lists with dividers) instead of padded content. */
  flush?: boolean;
}) {
  const body = <div className={flush ? ui.divide : ui.inner}>{children}</div>;
  if (!collapsible) {
    return (
      <section>
        <SectionLabel icon={icon} hint={hint} right={right}>{title}</SectionLabel>
        <div className={ui.card}>{body}</div>
      </section>
    );
  }
  // The header is a real <button> for the title only. The old role="button"
  // div wrapped the InfoHint (itself focusable) and the caller's `right`
  // control, which nests interactive elements — an axe "nested-interactive"
  // violation and a screen-reader trap. Mouse users still get the row hover;
  // the hint and the right-side control keep their own hit areas.
  return (
    <div className={ui.card}>
      <div className={`${ui.head} w-full text-left ${ui.rowHover}`}>
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className={`flex-1 min-w-0 flex items-center gap-3 text-left rounded-md outline-none focus-visible:bg-zinc-900/[0.03] dark:focus-visible:bg-white/[0.04] ${FOCUS}`}
        >
          <span className={ui.title}>{icon && <IconTile>{icon}</IconTile>}<span className="truncate">{title}</span></span>
        </button>
        {hint && <span className="shrink-0 inline-flex"><InfoHint text={hint} /></span>}
        <span className="flex items-center gap-2 shrink-0 text-[12px] text-zinc-500 dark:text-zinc-400">{right}<Chevron open={open} /></span>
      </div>
      <Collapse open={open}><div className={`border-t ${HAIR_B}`}>{body}</div></Collapse>
    </div>
  );
}

/**
 * Accordion — header button carries `aria-expanded` and `aria-controls` that
 * points at the panel, NOT at the button's own ancestor. The deep-link scroll
 * target (`#kivara-section-<id>`) sits on the wrapper exactly once and CONTAINS
 * the button; the panel gets the `-panel` id and stays outside it. The repo's
 * `settings-tab-deep-link` test pins that relationship.
 */
export function Accordion({
  icon, title, summary, summaryColor, open, onToggle, children, noPadding, description, id,
}: {
  icon: React.ReactNode;
  title: string;
  summary?: string;
  summaryColor?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  noPadding?: boolean;
  id?: string;
  /** Shown as an intro line when open (not as a "?" icon). */
  description?: React.ReactNode;
}) {
  const inGroup = React.useContext(InGroupCtx);
  const sid = sectionId(title, id);
  const content = (
    <>
      <button
        id={`${sid}-button`}
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`${sid}-panel`}
        className={`${ui.head} w-full text-left outline-none focus-visible:bg-zinc-900/[0.03] dark:focus-visible:bg-white/[0.04] ${ui.rowHover}`}
      >
        <span className={ui.title}>
          {icon && <IconTile>{icon}</IconTile>}<span className="truncate">{title}</span>
        </span>
        <span className="flex items-center gap-2 ml-auto shrink-0 min-w-0">
          {summary && !open && (
            <span className={`text-[12px] truncate max-w-[132px] ${summaryColor ?? 'text-zinc-500 dark:text-zinc-400'}`}>{summary}</span>
          )}
          <Chevron open={open} />
        </span>
      </button>
      <Collapse open={open} id={`${sid}-panel`} labelledBy={`${sid}-button`}>
        <InGroupCtx.Provider value={false}>
          <div className={`border-t ${HAIR_B}`}>
            {description && <p className={`${ui.desc} px-3.5 pt-3 ${noPadding ? 'pb-1' : '-mb-1'}`}>{description}</p>}
            <div className={noPadding ? '' : ui.inner}>{children}</div>
          </div>
        </InGroupCtx.Provider>
      </Collapse>
    </>
  );
  return inGroup
    ? <div id={id} className="scroll-mt-16">{content}</div>
    : <div id={id} className={`${ui.card} scroll-mt-16`}>{content}</div>;
}

/* ─── NestedAccordion ────────────────────────────────────────────────── */

export function NestedAccordion({
  title, open, onToggle, children,
}: {
  title: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="!py-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-2 min-h-[44px] text-left rounded-md group/na ${FOCUS}`}
      >
        <span className={`${tx.label} group-hover/na:text-zinc-950 dark:group-hover/na:text-white transition-colors`}>{title}</span>
        <ChevronRight size={14} className={`text-zinc-400 dark:text-zinc-400 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>
      <Collapse open={open}>
        <div className="pb-4 space-y-4">{children}</div>
      </Collapse>
    </div>
  );
}

/* ─── ValueRow ───────────────────────────────────────────────────────────
 * Row for Subtitles and Vocabulary: label (+ always-visible "?") with its
 * value on the right and the control below. `onReset` adds the per-row ↺
 * (appearance settings only, never personal data such as level).
 */
export function ValueRow({ label, value, children, onReset, hint, description }: { label: string; value?: string; children: React.ReactNode; onReset?: () => void; hint?: React.ReactNode; description?: React.ReactNode }) {
  return (
    <div className="space-y-2.5 group/row">
      <div className="flex items-center justify-between gap-1.5 min-h-[20px]">
        <label className={`${tx.label} flex items-center gap-1.5 min-w-0`}><span className="truncate">{label}</span>{hint && <InfoHint text={hint} />}</label>
        <div className="flex items-center gap-1 shrink-0">
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              title={t('subs.resetValueTitle')}
              aria-label={t('subs.resetValueTitle')}
              className="opacity-0 group-hover/row:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity w-6 h-6 inline-flex items-center justify-center rounded-md text-zinc-400 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-900/[0.05] dark:hover:bg-white/[0.06]"
            >
              <RotateCcw size={12} />
            </button>
          )}
          {value && <span className="text-[12px] tabular-nums text-zinc-500 dark:text-zinc-400">{value}</span>}
        </div>
      </div>
      {description && <p className={`${ui.desc} -mt-1`}>{description}</p>}
      {children}
    </div>
  );
}

/* ─── NavRow ─────────────────────────────────────────────────────────────
 * Navigation row inside a group: label (+ optional description) on the left
 * and where it leads ("In the transcript ›") on the right. The same piece
 * for jumping to another panel tab or to the transcript.
 */
export function NavRow({
  label, description, where, onClick, title, ...rest
}: {
  label: React.ReactNode; description?: React.ReactNode; where: React.ReactNode; onClick: () => void; title?: string;
} & Record<`data-${string}`, string | boolean | undefined>) {
  return (
    <div>
      <button
        type="button"
        {...rest}
        onClick={onClick}
        title={title}
        className={`group/link w-full flex items-center justify-between gap-3 min-h-[20px] -my-1 py-1 rounded-md text-left ${FOCUS}`}
      >
        <span className="min-w-0">
          <span className={`${tx.label} block truncate`}>{label}</span>
          {description && <span className="block text-[12px] leading-4 mt-0.5 text-zinc-500 dark:text-zinc-400 truncate">{description}</span>}
        </span>
        <span className="flex items-center gap-1 shrink-0 text-[12px] text-zinc-500 dark:text-zinc-400 group-hover/link:text-zinc-900 dark:group-hover/link:text-zinc-100 transition-colors">
          {where}
          <ChevronRight size={14} aria-hidden="true" className="transition-transform duration-200 group-hover/link:translate-x-0.5" />
        </span>
      </button>
    </div>
  );
}

/* ─── QuickRow ───────────────────────────────────────────────────────── */

/** 44px row: label on the left, secondary value (muted) + control on the right. */
export function QuickRow({
  label, hint, info, children,
}: {
  label: string; hint?: string; info?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="kvl-row flex items-center justify-between gap-3 min-h-[44px] py-2">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={`${tx.label} truncate`}>{label}</span>
        {info && <InfoHint text={info} className="shrink-0" />}
      </div>
      <div className="flex items-center gap-3 shrink-0 min-w-0">
        {hint && <span className="text-[12px] text-zinc-400 dark:text-zinc-400 truncate max-w-[110px]">{hint}</span>}
        {children}
      </div>
    </div>
  );
}

/* ─── Row ────────────────────────────────────────────────────────────── */

export function Row({
  label, value, children, hint, inline, description,
}: {
  label: React.ReactNode;
  value?: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
  /** Supporting text shown under the label (only when it adds value). */
  description?: React.ReactNode;
  /** Control to the right of the label (toggles) instead of below. */
  inline?: boolean;
}) {
  if (inline) {
    return (
      <div className="kvl-row flex items-center justify-between gap-3 min-h-[20px]">
        <div className="min-w-0">
          <label className={`flex items-center gap-1.5 min-w-0 ${tx.label}`}>
            <span className="truncate">{label}</span>
            {hint && <InfoHint text={hint} />}
          </label>
          {description && <p className={`${ui.desc} mt-0.5`}>{description}</p>}
        </div>
        {children}
      </div>
    );
  }
  return (
    <div className="kvl-row space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <label className={`flex items-center gap-1.5 min-w-0 ${tx.label}`}>
          <span className="truncate">{label}</span>
          {hint && <InfoHint text={hint} />}
        </label>
        {value && (
          <span className="text-[12px] tabular-nums text-zinc-500 dark:text-zinc-400">{value}</span>
        )}
      </div>
      {description && <p className={`${ui.desc} -mt-1.5`}>{description}</p>}
      {children}
    </div>
  );
}

/* ─── Field ──────────────────────────────────────────────────────────────
 * Small label above a control (grid forms: languages, keys...).
 */
export function Field({ label, children, className = '', htmlFor }: { label: React.ReactNode; children: React.ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={`min-w-0 space-y-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="block text-[12px] leading-4 font-medium text-zinc-500 dark:text-zinc-400 truncate">{label}</label>
      {children}
    </div>
  );
}

/* ─── SegmentedControl ───────────────────────────────────────────────── */

export const segTrack = 'flex bg-zinc-900/[0.05] dark:bg-white/[0.06] rounded-lg p-0.5';
/** Option of a segmented control. `<SegPill/>` paints the active surface (it slides). */
export const segItem = (active: boolean) => `kvl-press relative z-10 flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 truncate font-medium px-2.5 rounded-md ${FOCUS} ${
  active
    ? 'text-zinc-900 dark:text-white'
    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
}`;

/**
 * Keyboard for the ARIA "radiogroup" pattern (segmented and chips): a single
 * Tab stop —the checked option, or the first one when none is checked— and
 * arrows / Home / End that move focus and select. Not propagated: on the
 * platform page the arrows would seek the video.
 */
export function onRadioKeyDown<T>(e: React.KeyboardEvent<HTMLElement>, values: readonly T[], value: T | null, onChange: (v: T) => void) {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const n = values.length;
  const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
  // With no checked option (e.g. "Your level" with nothing picked) it advances
  // from the focused one, as WAI-ARIA describes.
  const checked = values.indexOf(value as T);
  const i = checked >= 0 ? checked : radios.indexOf(document.activeElement as HTMLElement);
  const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
  const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
  const next = fwd ? (i < 0 ? 0 : (i + 1) % n)
    : back ? (i < 0 ? n - 1 : (i - 1 + n) % n)
    : e.key === 'Home' ? 0
    : e.key === 'End' ? n - 1
    : -1;
  if (next < 0 || !n) return;
  e.preventDefault();
  e.stopPropagation();
  if (values[next] !== value) onChange(values[next]);
  radios[next]?.focus();
}
export const radioTabIndex = (checked: boolean, index: number, anyChecked: boolean) => (checked || (!anyChecked && index === 0) ? 0 : -1);

export function SegmentedControl<T extends string>({
  options, value, onChange, size = 'md', className = '', ariaLabel,
}: {
  /** `title`: hover help and accessible name (must contain the visible text, WCAG 2.5.3). */
  options: { v: T; l: React.ReactNode; icon?: React.ReactNode; title?: string }[]; value: T | null; onChange: (v: T) => void;
  /** md → 32px (default) · sm → 28px. */
  size?: 'sm' | 'md'; className?: string;
  /** Group name. Optional so existing repo callers keep compiling. */
  ariaLabel?: string;
}) {
  // No match (e.g. "Your level" not picked yet): nothing checked, no pill.
  const idx = options.findIndex((o) => o.v === value);
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={`relative ${segTrack} ${className}`}
      onKeyDown={(e) => onRadioKeyDown(e, options.map((o) => o.v), value, onChange)}>
      {idx >= 0 && <SegPill index={idx} count={options.length} />}
      {options.map((opt, i) => (
        <button
          key={opt.v}
          type="button"
          role="radio"
          aria-checked={value === opt.v}
          tabIndex={radioTabIndex(value === opt.v, i, idx >= 0)}
          title={opt.title}
          aria-label={opt.title}
          onClick={() => onChange(opt.v)}
          className={`${segItem(value === opt.v)} ${size === 'sm' ? 'h-6 text-[12px]' : 'h-7 text-[12px]'}`}
        >
          {opt.icon}
          <span className="truncate">{opt.l}</span>
        </button>
      ))}
    </div>
  );
}

/** Pill that slides under the active option (panel tabs, segmented, speed). */
export function SegPill({ index, count }: { index: number; count: number }) {
  return (
    <span
      aria-hidden="true"
      className="kvl-seg-pill absolute top-0.5 bottom-0.5 rounded-md bg-white dark:bg-zinc-700/70 shadow-[0_1px_2px_rgba(0,0,0,.08),0_0_0_0.5px_rgba(0,0,0,.05)] dark:shadow-[0_1px_2px_rgba(0,0,0,.3)] pointer-events-none"
      style={{ width: `calc((100% - 4px) / ${count})`, left: `calc(2px + ${index} * (100% - 4px) / ${count})` }}
    />
  );
}

/* ─── Filter chips ───────────────────────────────────────────────────────
 * They filter a list (Sentences and Words views of the transcript). They are
 * deliberately different from a segmented control: segmented/tabs navigate,
 * chips filter. Selected in indigo, like the rest of the selections.
 * Multiple selection (vocabulary test): the same `filterChip` as an
 * `aria-pressed` button with ✓, not as a radio.
 */
const filterChip = (on: boolean) => `kvl-press inline-flex items-center gap-1.5 h-7 pl-2.5 pr-2 rounded-full text-[12px] font-medium ring-1 ring-inset transition-colors ${FOCUS} ${
  on
    ? 'bg-indigo-500/[0.08] dark:bg-indigo-400/[0.12] text-indigo-700 dark:text-indigo-200 ring-indigo-500/25 dark:ring-indigo-400/30'
    : 'text-zinc-600 dark:text-zinc-300 ring-zinc-900/[0.1] dark:ring-white/[0.1] hover:bg-zinc-900/[0.04] dark:hover:bg-white/[0.05]'
}`;

export function FilterChips<T extends string>({
  options, value, onChange, ariaLabel, className = '',
}: {
  options: { v: T; l: string; count: number; icon?: React.ReactNode; title?: string }[];
  value: T; onChange: (v: T) => void; ariaLabel: string; className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={`flex flex-wrap items-center gap-1.5 ${className}`}
      onKeyDown={(e) => onRadioKeyDown(e, options.map((o) => o.v), value, onChange)}>
      {options.map((o, i) => (
        <button key={o.v} type="button" role="radio" aria-checked={value === o.v} tabIndex={radioTabIndex(value === o.v, i, options.some((x) => x.v === value))}
          title={o.title} onClick={() => onChange(o.v)} className={filterChip(value === o.v)}>
          {o.icon}
          {/* The space is not painted (flex gap) but it gives the accessible
              name "New 5", not "New5". */}
          {o.l}{' '}
          <span className="tabular-nums opacity-60">{fmtNumber(o.count)}</span>
        </button>
      ))}
    </div>
  );
}

/* ─── Toggle ─────────────────────────────────────────────────────────── */

export function Toggle({
  on, onChange, disabled = false, disabledTitle, ariaLabel,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  disabledTitle?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => { if (!disabled) onChange(!on); }}
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      title={disabled ? disabledTitle : undefined}
      className={`relative shrink-0 w-9 h-5 rounded-full p-0 border-0 transition-colors duration-200 ease-[var(--kvl-ease)] ${FOCUS} ${
        on ? 'bg-indigo-500' : 'bg-zinc-900/[0.12] dark:bg-white/[0.14]'
      } ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
    >
      <span
        className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.2),0_0_0_0.5px_rgba(0,0,0,.04)] transition-transform duration-[260ms] ease-[var(--kvl-spring)]"
        style={{ transform: on ? 'translateX(16px)' : 'translateX(0)' }}
      />
    </button>
  );
}

/* ─── IconButton ─────────────────────────────────────────────────────────
 * Single-icon button (headers, row actions): 28px, 14–16px icon.
 */
export function IconButton({ className = '', active, size = 'md', children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      {...rest}
      className={`${size === 'sm' ? 'w-6 h-6 rounded-md' : 'w-7 h-7 rounded-lg'} shrink-0 inline-flex items-center justify-center kvl-press ${FOCUS} disabled:opacity-40 disabled:cursor-not-allowed ${
        active ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-500/[0.08] dark:bg-indigo-400/[0.12]' : 'text-zinc-400 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-900/[0.05] dark:hover:bg-white/[0.07]'
      } ${className}`}
    >
      {children}
    </button>
  );
}

/* ─── Kbd ────────────────────────────────────────────────────────────── */
export const kbdCls = 'inline-flex items-center h-5 px-1.5 rounded-md font-sans text-[11px] font-medium leading-none text-zinc-600 dark:text-zinc-300 bg-white dark:bg-white/[0.06] ring-1 ring-zinc-900/[0.08] dark:ring-white/[0.08] shadow-[0_1px_0_rgba(0,0,0,.04)] whitespace-nowrap';
export function Kbd({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <kbd className={`${kbdCls} ${className}`}>{children}</kbd>;
}

/* ─── DonateBtn ──────────────────────────────────────────────────────── */

export function DonateBtn({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`w-7 h-7 inline-flex items-center justify-center rounded-lg text-zinc-400 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-900/[0.05] dark:hover:bg-white/[0.07] transition-colors ${FOCUS}`}
      title={t('common.donateVia', { label })}
      aria-label={t('common.donateVia', { label })}
    >
      {icon}
    </a>
  );
}

export function PaypalIcon() {
  return <Paypal size={14} aria-hidden="true" />;
}

/* ─── Button ─────────────────────────────────────────────────────────────
 * Single button vocabulary:
 *  primary   → main action (solid indigo)
 *  secondary → neutral action (white/zinc with ring)
 *  soft      → highlighted action without weight (faint indigo)
 *  danger    → destructive action (rose text)
 *  ghost     → tertiary action
 *  Heights: md 32px · sm 28px · lg 36px (onboarding CTA only).
 */
type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'danger' | 'dangerSolid' | 'ghost';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-indigo-500 text-white hover:bg-indigo-600 dark:hover:bg-indigo-400 shadow-[0_1px_2px_rgba(79,70,229,.25),inset_0_1px_0_rgba(255,255,255,.12)]',
  secondary: 'bg-white dark:bg-white/[0.06] ring-1 ring-zinc-900/[0.1] dark:ring-white/[0.08] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/[0.09] shadow-[0_1px_1px_rgba(0,0,0,.03)]',
  soft: 'bg-indigo-500/[0.08] dark:bg-indigo-400/[0.12] text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/[0.13] dark:hover:bg-indigo-400/[0.18]',
  danger: 'text-rose-600 dark:text-rose-400 bg-white dark:bg-white/[0.06] ring-1 ring-zinc-900/[0.1] dark:ring-white/[0.08] hover:bg-rose-500/[0.06] dark:hover:bg-rose-400/[0.1]',
  dangerSolid: 'bg-rose-600 text-white hover:bg-rose-500 shadow-sm',
  ghost: 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-900/[0.05] dark:hover:bg-white/[0.06]',
};

const BUTTON_SIZES = {
  sm: 'gap-1.5 h-7 px-2.5 text-[12px] [&>svg]:size-3.5',
  md: 'gap-1.5 h-8 px-3 text-[13px] [&>svg]:size-3.5',
  lg: 'gap-2 h-8 px-4 text-[13px] [&>svg]:size-3.5',
} as const;

export function buttonCls(variant: ButtonVariant = 'secondary', size: 'sm' | 'md' | 'lg' = 'md') {
  return `inline-flex items-center justify-center whitespace-nowrap ${BUTTON_SIZES[size]} rounded-lg font-medium kvl-press ${FOCUS} disabled:opacity-40 disabled:cursor-not-allowed shrink-0 ${BUTTON_VARIANTS[variant]}`;
}

export function Button({
  variant = 'secondary', size = 'md', icon, block, className = '', children, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  block?: boolean;
}) {
  return (
    <button
      type="button"
      {...rest}
      className={`${buttonCls(variant, size)} ${block ? 'w-full' : ''} ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}

/* ─── Callout ────────────────────────────────────────────────────────────
 * Inline notice: neutral surface; the tone only colors the icon.
 */
type CalloutTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'vip';

const CALLOUT_ICON: Record<CalloutTone, string> = {
  neutral: 'text-zinc-400 dark:text-zinc-400',
  info:    'text-indigo-500 dark:text-indigo-400',
  success: 'text-emerald-500 dark:text-emerald-400',
  warning: 'text-amber-500 dark:text-amber-400',
  danger:  'text-rose-500 dark:text-rose-400',
  vip:     'text-fuchsia-500 dark:text-fuchsia-400',
};

export function Callout({
  tone = 'neutral', icon, title, children, action, role, className = '',
}: {
  className?: string;
  tone?: CalloutTone;
  icon?: React.ReactNode;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  role?: 'alert' | 'status';
}) {
  return (
    <div role={role} className={`flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-[12px] leading-[17px] bg-white dark:bg-white/[0.03] ring-1 ring-zinc-900/[0.06] dark:ring-white/[0.06] text-zinc-500 dark:text-zinc-400 ${className}`}>
      {icon && <span className={`shrink-0 mt-px [&>svg]:size-3.5 ${CALLOUT_ICON[tone]}`}>{icon}</span>}
      <div className="flex-1 min-w-0 space-y-0.5">
        {title && <div className="text-[12px] font-medium text-zinc-800 dark:text-zinc-100">{title}</div>}
        {children && <div>{children}</div>}
      </div>
      {action && <div className="shrink-0 -my-1">{action}</div>}
    </div>
  );
}

/* ─── SubLabel ───────────────────────────────────────────────────────────
 * Subgroup header inside a section.
 */
export function SubLabel({ children, hint, right }: { children: React.ReactNode; hint?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="kvl-row flex items-center gap-1.5 px-0.5 min-h-[20px]">
      <span className="text-[12px] font-medium text-zinc-500 dark:text-zinc-400 truncate">{children}</span>
      {hint && <InfoHint text={hint} size={12} />}
      {right && <span className="ml-auto flex items-center gap-1.5 shrink-0 text-[12px] text-zinc-500 dark:text-zinc-400">{right}</span>}
    </div>
  );
}

/* ─── ListGroup ──────────────────────────────────────────────────────────
 * Container with dividers for row lists (sources, permissions...).
 * Inside a group it uses white to separate from the zinc-50 background.
 */
export function ListGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className={`rounded-xl bg-white dark:bg-white/[0.03] ring-1 ring-zinc-900/[0.06] dark:ring-white/[0.06] divide-y ${HAIR} overflow-hidden [&>.kvl-row]:px-3.5`}>
      {children}
    </div>
  );
}

/* ─── Badge ──────────────────────────────────────────────────────────────
 * Single compact label (11px, 20px tall).
 */
type BadgeTone = 'neutral' | 'indigo' | 'emerald' | 'amber' | 'rose' | 'fuchsia';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-zinc-900/[0.05] dark:bg-white/[0.07] text-zinc-500 dark:text-zinc-400',
  indigo:  'bg-indigo-500/[0.08] dark:bg-indigo-400/[0.12] text-indigo-600 dark:text-indigo-300',
  emerald: 'bg-emerald-500/[0.08] dark:bg-emerald-400/[0.1] text-emerald-700 dark:text-emerald-300',
  amber:   'bg-amber-500/[0.1] dark:bg-amber-400/[0.1] text-amber-700 dark:text-amber-300',
  rose:    'bg-rose-500/[0.08] dark:bg-rose-400/[0.1] text-rose-600 dark:text-rose-300',
  fuchsia: 'bg-fuchsia-500/[0.08] dark:bg-fuchsia-400/[0.1] text-fuchsia-600 dark:text-fuchsia-300',
};

export function Badge({ tone = 'neutral', children, title, className = '' }: { tone?: BadgeTone; children: React.ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 shrink-0 whitespace-nowrap h-5 text-[11px] leading-none font-medium px-1.5 rounded-md [&>svg]:size-3 ${BADGE_TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}
