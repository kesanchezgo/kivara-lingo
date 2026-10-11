import React, { useState } from 'react';
import { t } from '../../shared/i18n';
import { Languages, GraduationCap, ArrowLeftRight, AlertTriangle } from 'lucide-react';
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
      // If user picks the same code as the other slot, auto-swap to avoid duplicate
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
      title={t('onb.whatLanguage')}
      subtitle={t('onb.langPairSubtitle')}
    >
      {/* Pair display: Aprendo ↔ Nativo */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
        <SlotCard
          icon={<GraduationCap size={13} />}
          label="Aprendo"
          lang={learning}
          active={activeSlot === 'source'}
          accent="indigo"
          onClick={() => setActiveSlot('source')}
        />
        <button
          type="button"
          onClick={swap}
          title="Intercambiar idiomas"
          className="self-center w-9 h-9 rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-300 hover:border-indigo-300 dark:hover:border-indigo-500/50 hover:shadow-md hover:shadow-indigo-500/10 transition-all flex items-center justify-center active:scale-95"
        >
          <ArrowLeftRight size={14} />
        </button>
        <SlotCard
          icon={<Languages size={13} />}
          label="Nativo"
          lang={native}
          active={activeSlot === 'target'}
          accent="emerald"
          onClick={() => setActiveSlot('target')}
        />
      </div>

      {/* Helper line: which slot is being edited */}
      <div className="flex items-center justify-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
        <span>{t('onb.selectLangPre')}</span>
        <span className={`font-semibold ${activeSlot === 'source' ? 'text-indigo-600 dark:text-indigo-300' : 'text-emerald-600 dark:text-emerald-300'}`}>
          {activeSlot === 'source' ? 'aprendes' : 'ya hablas'}
        </span>
      </div>

      {/* Language grid */}
      <div className="grid grid-cols-3 gap-2">
        {ONBOARDING_LANGS.map((l) => {
          const isLearning = l.code === sourceLang;
          const isNative = l.code === targetLang;
          const isActiveSelection =
            (activeSlot === 'source' && isLearning) || (activeSlot === 'target' && isNative);
          const accentRing = activeSlot === 'source'
            ? 'ring-indigo-500/70 dark:ring-indigo-400/70 bg-indigo-50 dark:bg-indigo-500/10'
            : 'ring-emerald-500/70 dark:ring-emerald-400/70 bg-emerald-50 dark:bg-emerald-500/10';
          return (
            <button
              key={l.code}
              type="button"
              onClick={() => pickLang(l.code)}
              className={[
                'group relative flex flex-col items-center justify-center gap-1 py-3 px-2 rounded-xl border transition-all duration-150 active:scale-[0.98]',
                isActiveSelection
                  ? `border-transparent ring-2 ${accentRing} shadow-sm`
                  : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-sm',
              ].join(' ')}
            >
              {/* Role badges in the corner — quietly show both assignments */}
              <div className="absolute top-1.5 right-1.5 flex gap-0.5">
                {isLearning && (
                  <span title="Aprendo" className="w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-sm">
                    <GraduationCap size={9} strokeWidth={2.5} />
                  </span>
                )}
                {isNative && (
                  <span title="Nativo" className="w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-sm">
                    <Languages size={9} strokeWidth={2.5} />
                  </span>
                )}
              </div>
              <span className="text-2xl leading-none select-none" aria-hidden>{l.flag}</span>
              <span className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-100 leading-tight">{l.name}</span>
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-tight">{l.native}</span>
            </button>
          );
        })}
      </div>

      {sameLanguage && (
        <div className="rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 p-3 flex items-start gap-2">
          <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <p className="text-[12px] text-amber-800 dark:text-amber-300 leading-relaxed">
            {t('onb.sameLangWarn')}</p>
        </div>
      )}

      <div className="rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 p-3">
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
          {t('onb.pairControls')}</p>
      </div>
    </StepSection>
  );
}
