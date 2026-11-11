import React from 'react';
import { t, fmtDays } from '../../shared/i18n';
import { Sparkles, CheckCircle2, Ban, KeyRound, AlertTriangle, Cpu, Zap, Brain } from '../../ui/icons';
import type { AiProvider } from '../../shared/types';
import { MODELS_BY_PROVIDER } from '../../shared/ai-models';
import { getAiPreset } from '../../shared/ai-presets';
import { SyncWriteErrorBanner } from '../../app/components/SyncWriteErrorBanner';
import { StepSection, ToggleRow } from './StepSection';

/* ─── AIStep ──────────────────────────────────────────────────────────────── */

export interface AIStepProps {
  aiProvider: AiProvider;
  setAiProvider: (v: AiProvider) => void;
  aiApiKey: string;
  setAiApiKey: (v: string) => void;
  aiModel: string;
  setAiModel: (v: string) => void;
  aiEnrichOnSave: boolean;
  setAiEnrichOnSave: (v: boolean) => void;
  aiEnrichOnHover: boolean;
  setAiEnrichOnHover: (v: boolean) => void;
  aiCacheTtlDays: number;
  setAiCacheTtlDays: (v: number) => void;
}

/** Cache TTL choices offered in the wizard. `SETTINGS → IA premium` keeps the
 *  1–90 slider for an exact value; here the coarse set is enough. */
const CACHE_TTL_DAYS = [1, 7, 14, 30, 60, 90] as const;

export function AIStep({
  aiProvider, setAiProvider, aiApiKey, setAiApiKey, aiModel, setAiModel,
  aiEnrichOnSave, setAiEnrichOnSave, aiEnrichOnHover, setAiEnrichOnHover,
  aiCacheTtlDays, setAiCacheTtlDays,
}: AIStepProps) {
  /** The free-text model id is a UI mode, not store state: `ai.model` already
   *  holds any string, and persisting a sentinel like `__custom__` would send
   *  it to the provider if the user moved on without typing. */
  const [customModel, setCustomModel] = React.useState(false);
  /** The preset's suggested model for a provider — the same table the SETTINGS
   *  tab uses, so a withdrawn id is retired in one place and never offered
   *  here by accident. */
  const defaultModelFor = (provider: AiProvider): string =>
    getAiPreset(provider)?.defaultModel ?? '';

  type ProviderTile = {
    value: AiProvider;
    label: string;
    tag: string;
    icon: React.ReactNode;
    tone: 'zinc' | 'emerald' | 'amber' | 'sky';
    defaultModel?: string;
  };
  const providers: ProviderTile[] = [
    { value: 'disabled',  label: t('onb.noAi'),          tag: t('onb.aiDictsOnly'),   icon: <Ban size={18} />,      tone: 'zinc' },
    { value: 'openai',    label: 'OpenAI',          tag: 'GPT-4o mini',         icon: <Sparkles size={18} />, tone: 'emerald', defaultModel: 'gpt-4o-mini' },
    { value: 'anthropic', label: 'Anthropic',       tag: 'Claude Haiku',        icon: <Brain size={18} />,    tone: 'amber',   defaultModel: 'claude-haiku-4-5' },
    // The model comes from the preset table, NOT from a literal here. The
    // tile used to offer `gemini-1.5-flash`, which Google has withdrawn: the
    // API answers 404 and every enrichment from this step failed with a
    // message about an unknown model. One source of truth also means the next
    // withdrawal is a single edit in ai-presets.ts.
    { value: 'google-ai', label: 'Google Gemini',   tag: 'Gemini 2.5 Flash',    icon: <Zap size={18} />,      tone: 'sky',     defaultModel: defaultModelFor('google-ai') },
  ];

  const toneClasses: Record<ProviderTile['tone'], { ring: string; bg: string; iconBg: string; iconText: string; label: string }> = {
    zinc:    { ring: 'ring-zinc-400/60 dark:ring-zinc-500/60',     bg: 'bg-zinc-50 dark:bg-zinc-800/40',         iconBg: 'bg-zinc-100 dark:bg-zinc-800',         iconText: 'text-zinc-500 dark:text-zinc-400',     label: 'text-zinc-700 dark:text-zinc-200' },
    emerald: { ring: 'ring-emerald-500/70 dark:ring-emerald-400/70', bg: 'bg-emerald-50 dark:bg-emerald-500/10', iconBg: 'bg-emerald-500/10',                    iconText: 'text-emerald-600 dark:text-emerald-300', label: 'text-emerald-700 dark:text-emerald-300' },
    amber:   { ring: 'ring-amber-500/70 dark:ring-amber-400/70',   bg: 'bg-amber-50 dark:bg-amber-500/10',       iconBg: 'bg-amber-500/10',                      iconText: 'text-amber-600 dark:text-amber-300',   label: 'text-amber-700 dark:text-amber-300' },
    sky:     { ring: 'ring-sky-500/70 dark:ring-sky-400/70',       bg: 'bg-sky-50 dark:bg-sky-500/10',           iconBg: 'bg-sky-500/10',                        iconText: 'text-sky-600 dark:text-sky-300',       label: 'text-sky-700 dark:text-sky-300' },
  };

  const placeholderFor = (p: AiProvider) =>
    p === 'openai' ? 'sk-...' : p === 'anthropic' ? 'sk-ant-...' : 'AIza...';

  return (
    <StepSection
      icon={<Sparkles size={20} />}
      title={t('onb.aiEnrichmentOptional')}
      subtitle={t('onb.aiStepDesc')}
    >
      {/* Provider tiles */}
      <div className="grid grid-cols-2 gap-2.5">
        {providers.map((p) => {
          const active = aiProvider === p.value;
          const t = toneClasses[p.tone];
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => {
                setAiProvider(p.value);
                if (p.defaultModel && !aiModel) setAiModel(p.defaultModel);
              }}
              className={[
                'group relative flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all active:scale-[0.99]',
                active
                  ? `border-transparent ring-2 ${t.ring} ${t.bg} shadow-sm`
                  : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-sm',
              ].join(' ')}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${t.iconBg} ${t.iconText}`}>
                {p.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-[13px] font-semibold leading-tight ${active ? t.label : 'text-zinc-800 dark:text-zinc-100'}`}>{p.label}</p>
                <p className="text-[10.5px] text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">{p.tag}</p>
              </div>
              {active && (
                <CheckCircle2 size={15} className={`shrink-0 ${t.iconText}`} />
              )}
            </button>
          );
        })}
      </div>

      {aiProvider !== 'disabled' && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800 overflow-hidden">
          <div className="p-4 space-y-1.5">
            <label className="flex items-center gap-1.5 text-[12px] font-semibold text-zinc-700 dark:text-zinc-300">
              <KeyRound size={12} className="text-zinc-400" /> API key
            </label>
            <input
              type="password"
              value={aiApiKey}
              onChange={(e) => setAiApiKey(e.target.value)}
              placeholder={placeholderFor(aiProvider)}
              className="sl-input sl-lg w-full font-mono"
            />
            {!aiApiKey && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <AlertTriangle size={11} />
                {t('onb.noKeyNote')}</p>
            )}
            {/* The key is entered here, so the "could not be encrypted, not
                saved" refusal belongs here too: onboarding used to have no
                banner at all, and the user typed a key into a void. */}
            <SyncWriteErrorBanner compact />
          </div>
          <div className="p-4 space-y-1.5">
            <label className="flex items-center gap-1.5 text-[12px] font-semibold text-zinc-700 dark:text-zinc-300">
              <Cpu size={12} className="text-zinc-400" /> {t('set.modelLabel')}
            </label>
            {(() => {
              const opts = MODELS_BY_PROVIDER[aiProvider as Exclude<AiProvider, 'disabled'>] ?? [];
              const currentInList = opts.some((m) => m.value === aiModel);
              // A model saved by an older build (or typed in Settings) is not
              // in the preset list: keep it visible instead of rendering an
              // empty select that looks like the choice was lost.
              const showingCustom = customModel || (aiModel !== '' && !currentInList);
              return (
                <>
                  <select
                    data-testid="onboarding-ai-model"
                    value={showingCustom ? '__custom__' : aiModel}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '__custom__') {
                        setCustomModel(true);
                        if (currentInList) setAiModel('');
                      } else {
                        setCustomModel(false);
                        setAiModel(v);
                      }
                    }}
                    className="sl-select sl-lg w-full font-mono"
                  >
                    <option value="">{t('ai.selectModel')}</option>
                    {opts.map((m) => (
                      <option key={m.value} value={m.value}>{m.label} · {m.tag}</option>
                    ))}
                    <option value="__custom__">{t('set.customModel')}</option>
                  </select>
                  {showingCustom && (
                    <input
                      type="text"
                      data-testid="onboarding-ai-custom-model"
                      value={currentInList ? '' : aiModel}
                      onChange={(e) => setAiModel(e.target.value)}
                      placeholder="deepseek-chat"
                      aria-label={t('set.customModel')}
                      className="sl-input sl-lg w-full font-mono"
                      spellCheck={false}
                      autoComplete="off"
                    />
                  )}
                  {aiModel && !showingCustom && (
                    <p className="text-[10.5px] text-zinc-500 dark:text-zinc-400 leading-snug pt-0.5">
                      {opts.find((m) => m.value === aiModel)?.tag ?? t('set.customModel')}
                    </p>
                  )}
                </>
              );
            })()}
          </div>
          <div className="p-4 space-y-1.5">
            <label
              htmlFor="onboarding-ai-cache-ttl"
              className="flex items-center gap-1.5 text-[12px] font-semibold text-zinc-700 dark:text-zinc-300"
            >
              {t('set.cache')}
            </label>
            <select
              id="onboarding-ai-cache-ttl"
              data-testid="onboarding-ai-cache-ttl"
              value={String(aiCacheTtlDays)}
              onChange={(e) => setAiCacheTtlDays(Number(e.target.value))}
              className="sl-select sl-lg w-full"
            >
              {CACHE_TTL_DAYS.map((days) => (
                <option key={days} value={days}>{fmtDays(days)}</option>
              ))}
              {/* A value saved from the Settings slider (1–90, any number) is
                  never silently rewritten: it keeps its own option. */}
              {!CACHE_TTL_DAYS.includes(aiCacheTtlDays as (typeof CACHE_TTL_DAYS)[number]) && (
                <option value={aiCacheTtlDays}>{fmtDays(aiCacheTtlDays)}</option>
              )}
            </select>
          </div>
          <div className="p-4">
            <ToggleRow
              label={t("ai.enrichOnSave")}
              description={t('onb.enrichOnSaveDesc')}
              on={aiEnrichOnSave}
              onChange={setAiEnrichOnSave}
            />
          </div>
          <div className="p-4">
            <ToggleRow
              label={t('onb.synonymsOnHover')}
              description={t('onb.synonymsOnHoverDesc')}
              on={aiEnrichOnHover}
              onChange={setAiEnrichOnHover}
            />
          </div>
        </div>
      )}

      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed px-0.5">
        {t('onb.cacheTtlNote')}<span className="font-medium text-zinc-700 dark:text-zinc-300">{`${t('nav.settings')} → ${t('set.sectionAiPremium')}`}</span> {t('onb.wheneverPost')}</p>
    </StepSection>
  );
}
