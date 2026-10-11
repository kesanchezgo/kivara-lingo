import type { LangMeta } from './LangMeta';
import { getLang } from './LangMeta';
import React, { useState } from 'react';

export function SlotCard({
  icon, label, lang, active, accent, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  lang: LangMeta;
  active: boolean;
  accent: 'indigo' | 'emerald';
  onClick: () => void;
}) {
  const accentClasses = active
    ? accent === 'indigo'
      ? 'border-transparent ring-2 ring-indigo-500/70 dark:ring-indigo-400/70 bg-indigo-50/70 dark:bg-indigo-500/10'
      : 'border-transparent ring-2 ring-emerald-500/70 dark:ring-emerald-400/70 bg-emerald-50/70 dark:bg-emerald-500/10'
    : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700';
  const labelColor = accent === 'indigo'
    ? 'text-indigo-700 dark:text-indigo-300'
    : 'text-emerald-700 dark:text-emerald-300';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-xl border p-3 transition-all ${accentClasses}`}
    >
      <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${labelColor}`}>
        {icon}<span>{label}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2.5">
        <span className="text-2xl leading-none select-none" aria-hidden>{lang.flag}</span>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-50 leading-tight truncate">{lang.name}</div>
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-tight truncate">{lang.native}</div>
        </div>
      </div>
    </button>
  );
}
