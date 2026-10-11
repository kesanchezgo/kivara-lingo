/* StepSection + ToggleRow — shared onboarding step primitives. Moved verbatim. */
import React from 'react';
import { t } from '../../shared/i18n';

export function StepSection({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <header className="space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{title}</h2>
        {subtitle && <p className="text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function ToggleRow({
  label, description, on, onChange, isDarkMode,
}: {
  label: string; description?: string; on: boolean; onChange: (v: boolean) => void; isDarkMode: boolean;
}) {
  const bgOn = isDarkMode ? '#6366f1' : '#4f46e5';
  const bgOff = isDarkMode ? '#3f3f46' : '#d4d4d8';
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-zinc-800 dark:text-zinc-200 leading-snug">{label}</p>
        {description && (
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug mt-0.5">{description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onChange(!on)}
        style={{
          position: 'relative', flexShrink: 0, width: 36, height: 20,
          borderRadius: 9999, backgroundColor: on ? bgOn : bgOff,
          transition: 'background-color 150ms', border: 'none', cursor: 'pointer', padding: 0,
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: 2, width: 16, height: 16,
          borderRadius: 9999, backgroundColor: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
          transition: 'transform 200ms',
          transform: on ? 'translateX(16px)' : 'translateX(0)',
        }} />
      </button>
    </div>
  );
}
