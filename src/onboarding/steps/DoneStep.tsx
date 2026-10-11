import React from 'react';
import { t } from '../../shared/i18n';
import { CheckCircle2, ExternalLink, Rocket } from 'lucide-react';
import { StepSection } from './StepSection';

/* ─── DoneStep ────────────────────────────────────────────────────────────── */

export function DoneStep({ completedAt, onComplete }: { completedAt: number | null; onComplete: () => void }) {
  return (
    <StepSection title={t('onb.allSet')} subtitle="">
      <div className="flex flex-col items-center gap-8 py-8">
        <div className="relative">
          <div
            className="absolute inset-0 rounded-full animate-pulse"
            style={{ background: 'radial-gradient(circle, rgba(74,222,128,0.25) 0%, transparent 70%)' }}
          />
          <div className="relative w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-500/15 ring-4 ring-emerald-200 dark:ring-emerald-500/30 ring-offset-2 ring-offset-white dark:ring-offset-zinc-950 flex items-center justify-center sl-animate-celebrate">
            <CheckCircle2 size={36} className="text-emerald-600 dark:text-emerald-400" />
          </div>
        </div>

        <div className="text-center space-y-2 max-w-sm">
          <p className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">{t('onb.readyTitle')}</p>
          <p className="text-[13px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
            {t('onb.reopenWizardPre')}{' '}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">{t('onb.repeatInit')}</span>.
          </p>
          {completedAt && (
            <p className="text-[10px] text-zinc-400 dark:text-zinc-600">
              {t('onb.completedOn')}{new Date(completedAt).toLocaleString()}
            </p>
          )}
        </div>

        <button
          onClick={onComplete}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm hover:shadow-md hover:shadow-indigo-500/25 transition-all"
        >
          <span style={{ fontSize: 14, fontWeight: 600 }}>Ir al reproductor</span>
          <ExternalLink size={14} />
        </button>
      </div>
    </StepSection>
  );
}

/* ─── LangStep ────────────────────────────────────────────────────────────── */
