/* StepSection + ToggleRow — shared onboarding step primitives (F8, prototype view). */
import React from 'react';
import { Toggle } from '../../ui/primitives/settings-primitives';

export function StepSection({
  title, subtitle, icon, children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="max-w-xl mx-auto pt-2 sm:pt-6 space-y-7">
      <header className="flex flex-col items-center text-center sl-animate-fade-up">
        {icon && (
          <div className="relative mb-5">
            <div aria-hidden className="absolute inset-0 -m-2 rounded-[18px] bg-indigo-500/15 blur-lg" />
            <div className="relative w-11 h-11 rounded-xl bg-white dark:bg-zinc-900 ring-1 ring-zinc-900/[0.06] dark:ring-white/[0.08] shadow-[0_4px_14px_-6px_rgba(79,70,229,.35)] text-indigo-600 dark:text-indigo-300 flex items-center justify-center">
              {icon}
            </div>
          </div>
        )}
        <h2 className="text-[26px] sm:text-[28px] font-semibold tracking-[-0.025em] leading-[1.15] text-zinc-900 dark:text-white">{title}</h2>
        {subtitle && <p className="mt-2.5 text-[14px] leading-relaxed text-zinc-500 dark:text-zinc-400 max-w-md">{subtitle}</p>}
      </header>
      <div className="kvl-stagger space-y-3">{children}</div>
    </section>
  );
}

export function ToggleRow({
  label, description, on, onChange,
}: {
  label: string;
  description?: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-zinc-800 dark:text-zinc-200 leading-snug">{label}</p>
        {description && (
          <p className="text-[12px] text-zinc-500 dark:text-zinc-400 leading-snug mt-0.5">{description}</p>
        )}
      </div>
      <Toggle on={on} onChange={onChange} ariaLabel={label} />
    </div>
  );
}