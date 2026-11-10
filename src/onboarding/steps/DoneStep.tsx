/* Done — summary of what was configured (F8; prototype view, F5 level/deck). */
import { Check, ChevronRight, ExternalLink, LayoutGrid, Sparkles, Languages, ListChecks, GraduationCap } from '../../ui/icons';
import type { AnkiMapping, AiProvider } from '../../shared/types';
import { t, fmtDateTime } from '../../shared/i18n';
import { richText } from '../../shared/i18n/rich';
import { useWordStudy } from '../../content/ui/study';
import { deckFor } from '../../shared/study/decks';
import { Button } from '../../ui/primitives/settings-primitives';
import { getLang } from './LangMeta';

export function DoneStep({
  onComplete, completedAt, sourceLang, targetLang, mapping, aiProvider,
}: {
  onComplete: () => void;
  completedAt: number | null;
  sourceLang: string;
  targetLang: string;
  mapping: AnkiMapping;
  aiProvider: AiProvider;
}) {
  const src = getLang(sourceLang);
  const dst = getLang(targetLang);
  // The calculated level of the language just configured (F5): a saved check
  // shows here even when the self-assessment was skipped.
  const study = useWordStudy(sourceLang);
  const est = study.estimator;
  const aiLabel: Record<AiProvider, string> = {
    disabled: t('onb.sumAiOff'),
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    'google-ai': 'Google Gemini',
    'openai-compatible': t('aicompat.label'),
  };
  const rows = [
    {
      icon: <Languages size={16} />,
      label: t('onb.sumLangs'),
      value: (
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden>{src.flag}</span>{src.name}
          <ChevronRight size={12} className="text-zinc-400" />
          <span aria-hidden>{dst.flag}</span>{dst.name}
        </span>
      ),
    },
    // Starting point: the self-assessment or, if only the check was taken,
    // what it indicates.
    {
      icon: <GraduationCap size={16} />,
      label: t('ws.level'),
      value: est.provisional ? t('ws.levelUnset') : `${est.level} · ${t(`ws.level.${est.level}`)}`,
    },
    { icon: <LayoutGrid size={16} />, label: t('onb.sumDeck'), value: deckFor(mapping, sourceLang) || '—' },
    { icon: <ListChecks size={16} />, label: t('onb.sumModel'), value: mapping.modelName || '—' },
    { icon: <Sparkles size={16} />, label: t('onb.sumAi'), value: aiLabel[aiProvider] ?? aiProvider },
  ];

  return (
    <section className="max-w-xl mx-auto pt-2 sm:pt-6 space-y-7">
      <header className="flex flex-col items-center text-center sl-animate-fade-up">
        <div className="relative mb-5">
          <div aria-hidden className="absolute inset-0 -m-2 rounded-[18px] bg-emerald-500/25 blur-lg" />
          <div className="relative w-11 h-11 rounded-xl bg-emerald-500 text-white flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,.25),0_6px_18px_-6px_rgba(16,185,129,.7)] sl-animate-celebrate">
            <Check size={22} weight="bold" />
          </div>
        </div>
        <h2 className="text-[26px] sm:text-[28px] font-semibold tracking-[-0.025em] leading-[1.15] text-zinc-900 dark:text-white">{t('onb.allSet')}</h2>
        <p className="mt-2.5 text-[14px] leading-relaxed text-zinc-500 dark:text-zinc-400 max-w-md">{t('onb.readyTitle')}.</p>
      </header>

      <div className="kvl-stagger space-y-3">
        {/* Main piece: configuration summary + primary action */}
        <div className="rounded-2xl bg-white dark:bg-white/[0.03] ring-1 ring-zinc-900/[0.06] dark:ring-white/[0.06] shadow-[0_12px_32px_-18px_rgba(16,24,40,.25)] dark:shadow-none overflow-hidden">
          <p className="px-5 pt-4 pb-2 text-[12px] font-medium text-zinc-500 dark:text-zinc-400">{t('onb.sumTitle')}</p>
          <div className="divide-y divide-zinc-900/[0.06] dark:divide-white/[0.06]">
            {rows.map((r) => (
              <div key={r.label} className="flex items-center gap-3 px-5 h-12">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/[0.08] dark:bg-indigo-400/[0.12] text-indigo-600 dark:text-indigo-300 flex items-center justify-center shrink-0">{r.icon}</div>
                <span className="text-[13px] text-zinc-500 dark:text-zinc-400 flex-1">{r.label}</span>
                <span className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 truncate max-w-[60%] text-right">{r.value}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-zinc-900/[0.06] dark:border-white/[0.06] bg-zinc-50/70 dark:bg-white/[0.02] px-5 py-3.5 flex items-center justify-between gap-3">
            <span className="text-[12px] text-zinc-500 dark:text-zinc-400 tabular-nums">
              {completedAt ? `${t('onb.completedOn')} ${fmtDateTime(completedAt)}` : ''}
            </span>
            <Button variant="primary" onClick={onComplete} className="h-9 px-4 text-[13px] font-semibold">
              {t('onb.goToPlayer')}
              <ExternalLink size={13} />
            </Button>
          </div>
        </div>

        <p className="text-center text-[12px] leading-[18px] text-zinc-500 dark:text-zinc-400 px-6 pt-1">
          {richText(t('onb.reopenWizard'), {
            path: <span className="font-medium text-zinc-700 dark:text-zinc-300">{t('nav.settings')} › {t('onb.repeatInit')}</span>,
          })}
        </p>
      </div>
    </section>
  );
}