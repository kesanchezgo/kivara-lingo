/* Language step — the pair the rest of the wizard configures (F8, prototype view). */
import React, { useState } from 'react';
import { t } from '../../shared/i18n';
import { richText } from '../../shared/i18n/rich';
import { Languages, GraduationCap, ArrowLeftRight, AlertTriangle } from '../../ui/icons';
import { Callout } from '../../ui/primitives/settings-primitives';
import { StepSection } from './StepSection';
import { SlotCard } from './SlotCard';
import { getLang, ONBOARDING_LANGS } from './LangMeta';

export function LangStep({
  sourceLang, setSourceLang, targetLang, setTargetLang,
}: {
  sourceLang: string; setSourceLang: (v: string) => void;
  targetLang: string; setTargetLang: (v: string) => void;
}) {
  const [activeSlot, setActiveSlot] = useState<'source' | 'target'>('source');
  const sameLanguage = sourceLang === targetLang;
  const learning = getLang(sourceLang);
  const native = getLang(targetLang);

  const swap = () => {
    const a = sourceLang, b = targetLang;
    setSourceLang(b);
    setTargetLang(a);
  };

  const pickLang = (code: string) => {
    if (activeSlot === 'source') {
      // Picking the same code as the other slot auto-swaps, so a duplicate
      // never lands: the pair stays two different languages.
      if (code === targetLang) setTargetLang(sourceLang);
      setSourceLang(code);
      setActiveSlot('target');
    } else {
      if (code === sourceLang) setSourceLang(targetLang);
      setTargetLang(code);
      setActiveSlot('source');
    }
  };

  return (
    <StepSection
      icon={<Languages size={20} />}
      title={t('onb.whatLanguage')}
      subtitle={t('onb.langPairSubtitle')}
    >
      {/* The pair, as the main piece — same weight as the welcome preview */}
      <div className="relative grid grid-cols-2 rounded-2xl bg-white dark:bg-white/[0.03] ring-1 ring-zinc-900/[0.06] dark:ring-white/[0.06] shadow-[0_12px_32px_-18px_rgba(16,24,40,.25)] dark:shadow-none overflow-hidden">
        <SlotCard
          icon={<GraduationCap size={13} />}
          label={t('onb.learning')}
          lang={learning}
          active={activeSlot === 'source'}
          accent="indigo"
          onClick={() => setActiveSlot('source')}
        />
        <SlotCard
          icon={<Languages size={13} />}
          label={t('onb.nativeLang')}
          lang={native}
          active={activeSlot === 'target'}
          accent="emerald"
          onClick={() => setActiveSlot('target')}
        />
        <div aria-hidden className="absolute inset-y-4 left-1/2 w-px bg-zinc-900/[0.06] dark:bg-white/[0.08]" />
        <button
          type="button"
          onClick={swap}
          title={t('onb.swapLangs')}
          className="kvl-press absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white dark:bg-zinc-900 ring-1 ring-zinc-900/[0.08] dark:ring-white/[0.1] shadow-[0_2px_8px_-2px_rgba(16,24,40,.15)] text-zinc-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-300 flex items-center justify-center"
        >
          <ArrowLeftRight size={14} />
        </button>
      </div>

      {/* Which slot is being edited */}
      <p className="text-center text-[12px] text-zinc-500 dark:text-zinc-400 pt-2">
        {richText(t('onb.selectLang'), {
          verb: (
            <span className={`font-medium ${activeSlot === 'source' ? 'text-indigo-600 dark:text-indigo-300' : 'text-emerald-600 dark:text-emerald-300'}`}>
              {activeSlot === 'source' ? t('onb.learnVerb') : t('onb.speakVerb')}
            </span>
          ),
        })}
      </p>

      {/* Languages: one surface with dividers, like the benefits list */}
      <div className="grid grid-cols-3 gap-px rounded-xl overflow-hidden bg-zinc-900/[0.06] dark:bg-white/[0.06] ring-1 ring-zinc-900/[0.06] dark:ring-white/[0.06] shadow-[0_1px_2px_rgba(16,24,40,.04)] dark:shadow-none">
        {ONBOARDING_LANGS.map((l) => {
          const isLearning = l.code === sourceLang;
          const isNative = l.code === targetLang;
          const isActiveSelection =
            (activeSlot === 'source' && isLearning) || (activeSlot === 'target' && isNative);
          const activeBg = activeSlot === 'source'
            ? 'bg-indigo-50 dark:bg-indigo-500/[0.12]'
            : 'bg-emerald-50 dark:bg-emerald-500/[0.10]';
          return (
            <button
              key={l.code}
              type="button"
              onClick={() => pickLang(l.code)}
              aria-pressed={isActiveSelection}
              className={[
                'relative flex items-center gap-2.5 h-14 px-3.5 text-left transition-colors kvl-press',
                isActiveSelection ? activeBg : 'bg-white dark:bg-zinc-950',
                'hover:bg-zinc-50 dark:hover:bg-white/[0.04]',
              ].join(' ')}
            >
              <span className="text-[20px] leading-none select-none" aria-hidden>{l.flag}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium leading-tight truncate text-zinc-900 dark:text-zinc-100">{l.name}</span>
                <span className="block text-[12px] text-zinc-500 dark:text-zinc-400 leading-tight truncate">{l.native}</span>
              </span>
              {(isLearning || isNative) && (
                <span className="flex gap-1 shrink-0">
                  {isLearning && <span title={t('onb.learning')} className="w-1.5 h-1.5 rounded-full bg-indigo-500" />}
                  {isNative && <span title={t('onb.nativeLang')} className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {sameLanguage && (
        <Callout tone="warning" role="alert" icon={<AlertTriangle size={14} />}>
          {t('onb.sameLangWarn')}
        </Callout>
      )}

      <p className="text-center text-[12px] leading-[18px] text-zinc-500 dark:text-zinc-400 px-6 pt-1">
        {t('onb.pairControls')}
      </p>
    </StepSection>
  );
}