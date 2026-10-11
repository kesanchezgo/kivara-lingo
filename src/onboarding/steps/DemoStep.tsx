import React, { useState } from 'react';
import { t } from '../../shared/i18n';
import { Subtitles, Rocket, MousePointerClick, Save, LayoutGrid, Mic } from 'lucide-react';
import { ShortcutsPreview } from './ShortcutsPreview';
import { StepSection } from './StepSection';

/* ─── DemoStep ────────────────────────────────────────────────────────────── */

export function DemoStep() {
  const items = [
    { icon: <Subtitles size={16} />,         text: t('onb.styledSubs'),                tone: 'indigo' as const },
    { icon: <MousePointerClick size={16} />, text: t('onb.hoverPopover'),       tone: 'sky' as const },
    { icon: <Save size={16} />,              text: t('onb.saveToAnkiHint'),            tone: 'emerald' as const },
    { icon: <LayoutGrid size={16} />,        text: t('onb.sidePanelReady'),     tone: 'amber' as const },
  ];
  const toneMap = {
    indigo:  'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 ring-indigo-500/20',
    sky:     'bg-sky-500/10 text-sky-600 dark:text-sky-300 ring-sky-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-emerald-500/20',
    amber:   'bg-amber-500/10 text-amber-600 dark:text-amber-300 ring-amber-500/20',
  };
  return (
    <StepSection
      title={t('onb.allSetToTry')}
      subtitle={t('onb.allSetToTryDesc')}
    >
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/60 flex items-center gap-2">
          <Rocket size={13} className="text-indigo-500" />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {t('onb.whatYouSee')}</p>
        </div>
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {items.map((item, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-3">
              <div className={`w-8 h-8 rounded-lg ring-1 flex items-center justify-center shrink-0 ${toneMap[item.tone]}`}>
                {item.icon}
              </div>
              <p className="text-[13px] text-zinc-700 dark:text-zinc-300 leading-relaxed mt-1">{item.text}</p>
            </div>
          ))}
        </div>
      </div>

      <ShortcutsPreview />

      <div className="rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/25 p-4 flex gap-3">
        <Mic size={16} className="text-indigo-500 shrink-0 mt-0.5" />
        <p className="text-[12px] text-indigo-700 dark:text-indigo-300 leading-relaxed">
          {t('onb.enableCapturePre')}<span className="font-semibold">{t('popup.capture.off')}</span>.
        </p>
      </div>
    </StepSection>
  );
}
