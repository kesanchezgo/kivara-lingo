/* One slot of the language pair (F8; prototype view). */
import React from 'react';
import type { LangMeta } from './LangMeta';

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
  const tone = accent === 'indigo'
    ? { label: 'text-indigo-600 dark:text-indigo-300', bg: 'bg-indigo-50/60 dark:bg-indigo-500/[0.07]', bar: 'bg-indigo-500' }
    : { label: 'text-emerald-600 dark:text-emerald-300', bg: 'bg-emerald-50/60 dark:bg-emerald-500/[0.06]', bar: 'bg-emerald-500' };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex flex-col items-center text-center px-6 pt-5 pb-6 transition-colors duration-200 ${active ? tone.bg : 'hover:bg-zinc-50 dark:hover:bg-white/[0.02]'}`}
    >
      <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${active ? tone.label : 'text-zinc-500 dark:text-zinc-400'}`}>
        {icon}{label}
      </span>
      <span className="mt-3 text-[34px] leading-none select-none" aria-hidden>{lang.flag}</span>
      <span className="mt-3 text-[17px] font-semibold tracking-[-0.01em] text-zinc-900 dark:text-white leading-tight">{lang.name}</span>
      <span className="mt-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">{lang.native}</span>
      <span aria-hidden className={`absolute bottom-0 left-1/2 -translate-x-1/2 h-[3px] rounded-t-full transition-all duration-300 ${active ? `w-12 ${tone.bar}` : 'w-0 bg-transparent'}`} />
    </button>
  );
}
