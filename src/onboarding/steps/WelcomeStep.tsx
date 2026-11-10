/* Welcome — first step of the wizard (F8; prototype view, repo i18n). */
import { Subtitles, LayoutGrid, Sparkles, BookText, Rocket } from '../../ui/icons';
import { BrandGlyph } from '../../ui/BrandGlyph';
import { t } from '../../shared/i18n';
import { richText } from '../../shared/i18n/rich';

export function WelcomeStep({ steps }: { steps: number }) {
  const features = [
    { icon: <Subtitles size={16} />, title: t('onb.interactiveSubs'), desc: t('onb.interactiveSubsDesc') },
    { icon: <LayoutGrid size={16} />, title: t('onb.instantCards'), desc: t('onb.saveDirectDesc') },
    { icon: <Sparkles size={16} />, title: t('onb.optionalAi'), desc: t('onb.enrichDesc') },
  ];

  return (
    <section className="kvl-stagger max-w-xl mx-auto pt-4 sm:pt-8 space-y-8">
      {/* Brand + headline */}
      <header className="flex flex-col items-center text-center">
        <div className="relative mb-6">
          <div aria-hidden className="absolute inset-0 -m-3 rounded-[22px] bg-indigo-500/20 blur-xl" />
          <div className="relative w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,.2),0_8px_24px_-8px_rgba(79,70,229,.6)]">
            <BrandGlyph size={28} className="text-white" />
          </div>
        </div>
        <p className="inline-flex items-center gap-1.5 text-[12px] font-medium text-zinc-500 dark:text-zinc-400 mb-3">
          <Rocket size={12} className="text-indigo-500 dark:text-indigo-400" /> {t('onb.setupMeta', { n: steps })}
        </p>
        <h2 className="text-[30px] sm:text-[34px] leading-[1.1] font-semibold tracking-[-0.025em] text-zinc-900 dark:text-white">
          {t('onb.welcomePrefix')}{' '}
          <span className="bg-gradient-to-r from-indigo-600 to-violet-500 dark:from-indigo-300 dark:to-violet-300 bg-clip-text text-transparent">Kivara Lingo</span>
        </h2>
        <p className="mt-3 text-[14px] leading-relaxed text-zinc-500 dark:text-zinc-400 max-w-md">
          {t('onb.heroDesc')}
        </p>
      </header>

      {/* Product preview: frame + subtitle + word bubble */}
      <figure className="space-y-2">
        <div className="relative aspect-[16/7] rounded-2xl overflow-hidden ring-1 ring-zinc-900/[0.08] dark:ring-white/[0.08] shadow-[0_24px_48px_-24px_rgba(16,24,40,.45)] bg-[radial-gradient(120%_90%_at_70%_20%,#3b3f6b_0%,#1c1d33_45%,#0b0b12_100%)]">
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />
          <div className="absolute inset-x-0 bottom-[14%] flex flex-col items-center gap-1">
            <div className="relative">
              <div data-new-marks="dotted" className="rounded-lg bg-black/55 backdrop-blur-sm px-3 pt-1.5 pb-2 text-[17px] sm:text-[19px] font-semibold text-white tracking-[-0.01em]">
                <span>I</span>{' '}
                <span className="relative inline-block px-1 rounded-md bg-indigo-500/90">don&apos;t
                  {/* Bubble */}
                  <span className="block absolute left-1/2 bottom-full mb-3 -translate-x-1/2 w-44 rounded-xl bg-white dark:bg-zinc-900/95 ring-1 ring-zinc-900/[0.08] dark:ring-white/[0.08] shadow-[0_12px_32px_-8px_rgba(0,0,0,.5)] p-3 text-left text-[13px] font-normal tracking-normal sl-animate-badge-pop" style={{ animationDelay: '420ms' }}>
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-semibold text-zinc-900 dark:text-white">don&apos;t</span>
                      <span className="text-[11px] font-medium text-indigo-600 dark:text-indigo-300">aux.</span>
                    </span>
                    <span className="block text-[11px] font-mono text-zinc-400">/doʊnt/</span>
                    <span className="block mt-2 h-px bg-zinc-900/[0.06] dark:bg-white/[0.08]" />
                    <span className="mt-2 flex gap-1">
                      <span className="h-1.5 w-16 rounded-full bg-zinc-200 dark:bg-zinc-700" />
                      <span className="h-1.5 w-8 rounded-full bg-zinc-200 dark:bg-zinc-700" />
                    </span>
                    <span aria-hidden className="absolute left-1/2 -bottom-1 -translate-x-1/2 w-2 h-2 rotate-45 bg-white dark:bg-zinc-900" />
                  </span>
                </span>{' '}
                {/* Same marks as the overlay: learning (solid) and new expression (dotted bracket) */}
                <span className="kvl-tok" data-ws="learning">travel</span>{' '}
                <span className="kvl-tok" data-ws="new" data-expr="">these days</span>
              </div>
            </div>
          </div>
        </div>
        <figcaption className="text-center text-[12px] text-zinc-400 dark:text-zinc-400">{t('onb.previewCaption')}</figcaption>
      </figure>

      {/* Benefits: same grouped list as the panel */}
      <div className="rounded-xl bg-white dark:bg-white/[0.03] ring-1 ring-zinc-900/[0.06] dark:ring-white/[0.06] shadow-[0_1px_2px_rgba(16,24,40,.04)] dark:shadow-none divide-y divide-zinc-900/[0.06] dark:divide-white/[0.06]">
        {features.map((f) => (
          <div key={f.title} className="flex items-start gap-3 px-4 py-3.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/[0.08] dark:bg-indigo-400/[0.12] text-indigo-600 dark:text-indigo-300 flex items-center justify-center shrink-0">
              {f.icon}
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 leading-[18px]">{f.title}</p>
              <p className="text-[12px] leading-[17px] text-zinc-500 dark:text-zinc-400 mt-0.5">{f.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Anki requirement: discreet note */}
      <p className="text-center text-[12px] leading-[18px] text-zinc-500 dark:text-zinc-400 px-4">
        <BookText size={14} className="inline-block align-[-2px] mr-1.5 text-zinc-400" />
        <span>
          <span className="font-medium text-zinc-700 dark:text-zinc-300">{t('onb.noAnkiTitle')}</span>{' '}
          {richText(t('onb.getAnki'), {
            site: <a className="text-indigo-600 dark:text-indigo-300 hover:underline font-medium" href="https://apps.ankiweb.net" target="_blank" rel="noreferrer">apps.ankiweb.net</a>,
            addon: <span className="font-medium text-zinc-700 dark:text-zinc-300">AnkiConnect</span>,
            code: <span className="font-mono text-[11px] bg-zinc-900/[0.05] dark:bg-white/[0.06] px-1.5 py-0.5 rounded-md text-zinc-600 dark:text-zinc-300">2055492159</span>,
          })}
        </span>
      </p>
    </section>
  );
}