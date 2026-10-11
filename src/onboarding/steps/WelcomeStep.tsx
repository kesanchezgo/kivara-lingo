import React from 'react';
import { t } from '../../shared/i18n';
import { Subtitles, Sparkles, Rocket, MousePointerClick, Save, LayoutGrid, BookText } from 'lucide-react';

/* ─── WelcomeStep ─────────────────────────────────────────────────────────── */

export function WelcomeStep() {
  const features = [
    {
      icon: <Subtitles size={18} />,
      iconBg: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 ring-1 ring-indigo-500/20',
      title: t('onb.interactiveSubs'),
      desc: t('onb.interactiveSubsDesc'),
    },
    {
      icon: <LayoutGrid size={18} />,
      iconBg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-1 ring-emerald-500/20',
      title: 'Tarjetas Anki al instante',
      desc: t('onb.saveDirectDesc'),
    },
    {
      icon: <Sparkles size={18} />,
      iconBg: 'bg-amber-500/10 text-amber-600 dark:text-amber-300 ring-1 ring-amber-500/20',
      title: 'IA opcional',
      desc: t('onb.enrichDesc'),
    },
  ];

  return (
    <section className="space-y-6">
      {/* Hero — gradient panel with subtitle preview */}
      <div className="relative overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-gradient-to-br from-indigo-50 via-white to-emerald-50/40 dark:from-indigo-500/10 dark:via-zinc-900 dark:to-emerald-500/5 p-6 sm:p-8">
        {/* decorative glow */}
        <div aria-hidden className="pointer-events-none absolute -top-20 -right-16 w-56 h-56 rounded-full bg-indigo-400/15 dark:bg-indigo-500/15 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-20 -left-16 w-56 h-56 rounded-full bg-emerald-400/10 dark:bg-emerald-500/10 blur-3xl" />

        <div className="relative space-y-3">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/70 dark:bg-zinc-900/60 ring-1 ring-zinc-200/80 dark:ring-zinc-700/60 text-[10.5px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-300">
            <Rocket size={10} /> {t('onb.setupMeta')}</div>
          <h2 className="text-[26px] sm:text-[28px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 leading-tight">
            Bienvenido a <span className="text-indigo-600 dark:text-indigo-300">Kivara Lingo</span>
          </h2>
          <p className="text-[13.5px] leading-relaxed text-zinc-600 dark:text-zinc-300 max-w-xl">
            {t('onb.heroDesc')}</p>

          {/* Subtitle preview — non-interactive mock */}
          <div className="mt-4 pt-2">
            <div className="inline-block rounded-md bg-zinc-900/90 dark:bg-black/70 px-3 py-1.5 shadow-lg ring-1 ring-white/10">
              <span className="text-white text-[14px] leading-none">
                <span className="border-b border-dashed border-white/30 px-0.5">I</span>{' '}
                <span className="px-0.5 rounded bg-indigo-600 text-white shadow-[0_2px_8px_rgba(99,102,241,0.45)]">don't</span>{' '}
                <span className="border-b border-dashed border-white/30 px-0.5">travel</span>{' '}
                <span className="text-amber-300 border-b-2 border-dotted border-amber-400 px-0.5">these days</span>
              </span>
            </div>
            <div className="mt-1 text-[10.5px] text-zinc-500 dark:text-zinc-400 italic">
              Vista previa: tokens, MWE y palabras guardadas
            </div>
          </div>
        </div>
      </div>

      {/* Feature tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {features.map((f, i) => (
          <div
            key={f.title}
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3 sl-animate-fade-up hover:shadow-sm hover:border-zinc-300 dark:hover:border-zinc-700 transition-all"
            style={{ animationDelay: `${80 + i * 90}ms` }}
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${f.iconBg}`}>
              {f.icon}
            </div>
            <div>
              <p className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100 leading-snug">{f.title}</p>
              <p className="text-[12px] text-zinc-500 dark:text-zinc-400 leading-relaxed mt-1">{f.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Anki requirement note */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 flex gap-3">
        <div className="w-9 h-9 rounded-lg bg-amber-500/10 ring-1 ring-amber-500/20 text-amber-600 dark:text-amber-300 flex items-center justify-center shrink-0">
          <BookText size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold text-zinc-800 dark:text-zinc-100 leading-snug">{t('onb.noAnkiTitle')}</p>
          <p className="text-[12px] text-zinc-500 dark:text-zinc-400 leading-relaxed mt-1">
            {t('onb.dlAt')}{' '}
            <a className="text-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-300 hover:underline font-medium" href="https://apps.ankiweb.net" target="_blank" rel="noreferrer">
              apps.ankiweb.net
            </a>{' '}
            {t('onb.installAddonPre')}<span className="font-semibold text-zinc-700 dark:text-zinc-300">AnkiConnect</span> {t('onb.codePre')}<span className="font-mono text-[11px] bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-600 dark:text-zinc-300">2055492159</span>{t('onb.backHerePost')}</p>
        </div>
      </div>
    </section>
  );
}
