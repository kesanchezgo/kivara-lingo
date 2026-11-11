import React, { useState } from 'react';
import { t, fmtDays } from '../../shared/i18n';
import { AlertTriangle, Sparkles, Plug, Cpu, KeyRound, Brain, Zap, Ban } from '../../ui/icons';
import type { AiApiFormat, AiProvider } from '../../shared/types';
import {
  API_FORMATS,
  DEFAULT_MODEL_BY_PROVIDER,
  MODELS_BY_PROVIDER,
  OPENAI_COMPATIBLE_PRESETS,
} from '../../shared/ai-models';
import { ensureProviderHosts, requestHosts } from '../../shared/host-permissions';
import { compatibleHostFor } from '../../shared/provider-hosts';
import { SyncWriteErrorBanner } from '../../app/components/SyncWriteErrorBanner';
import { SecretKeyInput } from '../../app/components/SecretKeyInput';
import { InfoHint } from '../../app/components/InfoHint';
import { Select, inputLgCls } from '../../ui/primitives/controls';
import { Button, onRadioKeyDown, radioTabIndex } from '../../ui/primitives/settings-primitives';
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
  /** `openai-compatible` endpoint (the Custom tile). The wizard always passes
   *  them; optional so the existing prop-only call sites stay valid. */
  aiBaseUrl?: string;
  setAiBaseUrl?: (v: string) => void;
  aiApiFormat?: AiApiFormat;
  setAiApiFormat?: (v: AiApiFormat) => void;
}

/** Cache TTL choices offered in the wizard. `SETTINGS → IA premium` keeps the
 *  1–90 slider for an exact value; here the coarse set is enough. */
const CACHE_TTL_DAYS = [1, 7, 14, 30, 60, 90] as const;

/** Label of the provider's default model, read from the shared catalogue —
 *  the same table the SETTINGS tab uses, so a withdrawn id is retired in one
 *  place and never advertised on a tile by accident. */
function defaultModelLabel(p: Exclude<AiProvider, 'disabled'>): string {
  return MODELS_BY_PROVIDER[p].find((m) => m.value === DEFAULT_MODEL_BY_PROVIDER[p])?.label ?? '';
}

export function AIStep({
  aiProvider, setAiProvider, aiApiKey, setAiApiKey, aiModel, setAiModel,
  aiEnrichOnSave, setAiEnrichOnSave, aiEnrichOnHover, setAiEnrichOnHover,
  aiCacheTtlDays, setAiCacheTtlDays,
  aiBaseUrl, setAiBaseUrl, aiApiFormat, setAiApiFormat,
}: AIStepProps) {
  /** The free-text model id is a UI mode, not store state: `ai.model` already
   *  holds any string, and persisting a sentinel like `__custom__` would send
   *  it to the provider if the user moved on without typing. */
  const [customModel, setCustomModel] = useState(false);
  /** Denied / refused host access, phrased with the same `perm.needHost` copy
   *  the SETTINGS tab uses. Set from inside the click that requests origins. */
  const [permError, setPermError] = useState<string | null>(null);

  type ProviderTile = {
    value: AiProvider;
    label: string;
    tag: string;
    icon: React.ReactNode;
    tone: 'zinc' | 'emerald' | 'amber' | 'sky';
    defaultModel?: string;
  };
  const providers: ProviderTile[] = [
    { value: 'disabled',  label: t('onb.noAi'),   tag: t('onb.aiDictsOnly'), icon: <Ban size={16} />,      tone: 'zinc' },
    { value: 'openai',    label: 'OpenAI',        tag: defaultModelLabel('openai'),       icon: <Sparkles size={16} />, tone: 'emerald', defaultModel: DEFAULT_MODEL_BY_PROVIDER.openai },
    { value: 'anthropic', label: 'Anthropic',     tag: defaultModelLabel('anthropic'),    icon: <Brain size={16} />,    tone: 'amber',   defaultModel: DEFAULT_MODEL_BY_PROVIDER.anthropic },
    { value: 'google-ai', label: 'Google Gemini', tag: defaultModelLabel('google-ai'),    icon: <Zap size={16} />,      tone: 'sky',     defaultModel: DEFAULT_MODEL_BY_PROVIDER['google-ai'] },
    { value: 'openai-compatible', label: t('aicompat.label'), tag: t('aicompat.tagline'), icon: <Plug size={16} />, tone: 'zinc', defaultModel: DEFAULT_MODEL_BY_PROVIDER['openai-compatible'] },
  ];
  const isCompat = aiProvider === 'openai-compatible';
  const baseUrl = aiBaseUrl ?? '';
  const apiFormat: AiApiFormat = aiApiFormat ?? 'openai-chat';

  // The prototype retinted every tone to the same indigo accent; the record
  // stays so a per-provider color is a one-row change again.
  const toneClasses: Record<ProviderTile['tone'], { iconBg: string; iconText: string }> = {
    zinc:    { iconBg: 'bg-zinc-900/[0.04] dark:bg-white/[0.06]',        iconText: 'text-zinc-500 dark:text-zinc-400' },
    emerald: { iconBg: 'bg-indigo-500/[0.08] dark:bg-indigo-400/[0.12]', iconText: 'text-indigo-600 dark:text-indigo-300' },
    amber:   { iconBg: 'bg-indigo-500/[0.08] dark:bg-indigo-400/[0.12]', iconText: 'text-indigo-600 dark:text-indigo-300' },
    sky:     { iconBg: 'bg-indigo-500/[0.08] dark:bg-indigo-400/[0.12]', iconText: 'text-indigo-600 dark:text-indigo-300' },
  };

  const needHostCopy = () =>
    t('perm.needHost', { path: `${t('nav.settings')} → ${t('set.sectionHostAccess')}` });

  const placeholderFor = (p: AiProvider) =>
    p === 'openai' || p === 'openai-compatible' ? 'sk-...' : p === 'anthropic' ? 'sk-ant-...' : 'AIza...';

  // Click and arrow keys (radiogroup pattern) choose alike.
  const chooseProvider = (value: AiProvider) => {
    const p = providers.find((x) => x.value === value);
    if (!p) return;
    setAiProvider(p.value);
    setPermError(null);
    // Another provider's model is useless here: the default is restored.
    const opts = p.value === 'disabled' ? [] : MODELS_BY_PROVIDER[p.value];
    if (p.defaultModel && (!aiModel || (p.value !== 'openai-compatible' && !opts.some((m) => m.value === aiModel)))) {
      setAiModel(p.defaultModel);
    }
    // Same grant flow as `AiByokSection.selectPreset`: the request runs inside
    // the click (the only place Chrome shows the prompt) and a denial reads as
    // the standard "grant access" note. The Custom tile asks for nothing here —
    // its prompt belongs to the gesture that saves ONE origin, below.
    if (p.value !== 'disabled' && p.value !== 'openai-compatible') {
      void ensureProviderHosts(`ai:${p.value}`).then((missing) => {
        if (missing) setPermError(needHostCopy());
      });
    }
  };

  /**
   * The Custom tile's per-origin grant, the same flow as `AiByokSection`'s
   * `CompatEndpoint.save`: `compatibleHostFor` maps the URL to its curated
   * manifest pattern (anything else is refused before a request), then
   * `requestHosts` asks for that one origin inside the click. Onboarding is an
   * extension page, so the permissions API always exists here — the panel's
   * "open Options" fallback has no counterpart.
   */
  const saveCompatEndpoint = () => {
    const url = baseUrl.trim().replace(/\/+$/, '');
    const pattern = compatibleHostFor(url);
    if (!pattern) {
      setPermError(t('aicompat.notCurated'));
      return;
    }
    void requestHosts([pattern]).then((missing) => {
      setPermError(missing.length > 0 ? needHostCopy() : null);
    });
  };

  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '');

  return (
    <StepSection
      icon={<Sparkles size={20} />}
      title={t('onb.aiEnrichmentOptional')}
      subtitle={t('onb.aiStepDesc')}
    >
      {/* Providers: one list with radio-style selection */}
      <div
        role="radiogroup"
        aria-label={t('onb.aiEnrichmentOptional')}
        onKeyDown={(e) => onRadioKeyDown(e, providers.map((x) => x.value), aiProvider, chooseProvider)}
        className="rounded-2xl bg-white dark:bg-white/[0.03] ring-1 ring-zinc-900/[0.06] dark:ring-white/[0.06] shadow-[0_12px_32px_-18px_rgba(16,24,40,.25)] dark:shadow-none divide-y divide-zinc-900/[0.06] dark:divide-white/[0.06] overflow-hidden"
      >
        {providers.map((p, i) => {
          const active = aiProvider === p.value;
          const tc = toneClasses[p.tone];
          return (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={radioTabIndex(active, i, providers.some((x) => x.value === aiProvider))}
              onClick={() => chooseProvider(p.value)}
              className={`kvl-press w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${active ? 'bg-indigo-50/50 dark:bg-indigo-500/[0.07]' : 'hover:bg-zinc-50/70 dark:hover:bg-white/[0.02]'}`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${tc.iconBg} ${tc.iconText}`}>
                {p.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 leading-[18px]">{p.label}</p>
                <p className="text-[12px] leading-[17px] text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">{p.tag}</p>
              </div>
              <span aria-hidden className={`w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0 transition-colors ${active ? 'bg-indigo-600' : 'ring-1 ring-inset ring-zinc-300 dark:ring-zinc-600'}`}>
                {active && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
              </span>
            </button>
          );
        })}
      </div>

      {permError && (
        <p role="alert" className="flex items-center gap-1.5 text-[12px] text-amber-600 dark:text-amber-400 px-1">
          <AlertTriangle size={12} className="shrink-0" />
          {permError}
        </p>
      )}

      {aiProvider !== 'disabled' && (
        <div className="rounded-xl bg-white dark:bg-white/[0.03] ring-1 ring-zinc-900/[0.06] dark:ring-white/[0.06] shadow-[0_1px_2px_rgba(16,24,40,.04)] dark:shadow-none divide-y divide-zinc-900/[0.06] dark:divide-white/[0.06] overflow-hidden">
          {isCompat && (
            <div className="p-4 space-y-2">
              {/* Curated endpoints (H13/D7): picking one fills URL and wire
                  format; the model stays a free-form id. */}
              <div className="flex flex-wrap gap-1.5">
                {OPENAI_COMPATIBLE_PRESETS.map((preset) => {
                  const active = preset.baseUrl.replace(/\/+$/, '') === normalizedBaseUrl;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setAiBaseUrl?.(preset.baseUrl);
                        setPermError(null);
                        if (preset.model) setAiModel(preset.model);
                      }}
                      className={`inline-flex items-center h-6 px-2 rounded-full text-[11px] font-medium ring-1 kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
                        active
                          ? 'bg-indigo-50 dark:bg-indigo-500/[0.12] text-indigo-700 dark:text-indigo-300 ring-indigo-300 dark:ring-indigo-500/50'
                          : 'text-zinc-600 dark:text-zinc-300 ring-zinc-200 dark:ring-zinc-700 hover:bg-zinc-900/[0.04] dark:hover:bg-white/[0.06]'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              <div className="space-y-1">
                <label className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-500 dark:text-zinc-400">
                  <Plug size={12} className="text-zinc-400" /> {t('aicompat.baseUrl')}
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="url"
                    value={baseUrl}
                    onChange={(e) => setAiBaseUrl?.(e.target.value)}
                    placeholder="https://api.example.com/v1"
                    className={`${inputLgCls} w-full font-mono`}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  {/* The grant gesture: one curated origin, never a wildcard. */}
                  <Button variant="soft" onClick={saveCompatEndpoint}>{t('aicompat.save')}</Button>
                </div>
              </div>
              <div className="space-y-1">
                <label className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-500 dark:text-zinc-400">
                  {t('aicompat.format')}
                  <InfoHint text={t('aicompat.formatHint')} />
                </label>
                <Select
                  data-testid="onboarding-ai-format"
                  value={apiFormat}
                  onChange={(e) => setAiApiFormat?.(e.target.value as AiApiFormat)}
                  size="lg"
                  className="w-full"
                >
                  {API_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label} ({f.path})</option>)}
                </Select>
              </div>
            </div>
          )}
          <div className="p-4 space-y-1.5">
            <label className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-500 dark:text-zinc-400">
              <KeyRound size={12} className="text-zinc-400" /> {t('cards.apiKey')}
            </label>
            <SecretKeyInput
              stored={aiApiKey}
              onChange={setAiApiKey}
              placeholder={placeholderFor(aiProvider)}
              showToggle
              section="ai"
              field="apiKey"
              className={`${inputLgCls} w-full font-mono`}
            />
            {!aiApiKey && !(isCompat && /localhost|127\.0\.0\.1/.test(baseUrl)) && (
              <p className="text-[12px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <AlertTriangle size={12} />
                {t('onb.noKeyNote')}
              </p>
            )}
            {/* The key is entered here, so the "could not be encrypted, not
                saved" refusal belongs here too. */}
            <SyncWriteErrorBanner compact />
          </div>
          <div className="p-4 space-y-1.5">
            <label className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-500 dark:text-zinc-400">
              <Cpu size={12} className="text-zinc-400" /> {t('set.modelLabel')}
            </label>
            {isCompat ? (
              <>
                {/* Every curated endpoint names its own models: a fixed select
                    would offer ids the endpoint does not serve. */}
                <input
                  type="text"
                  data-testid="onboarding-ai-custom-model"
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  placeholder="deepseek-chat"
                  aria-label={t('set.modelLabel')}
                  className={`${inputLgCls} w-full font-mono`}
                  spellCheck={false}
                  autoComplete="off"
                />
                <p className="text-[12px] text-zinc-500 dark:text-zinc-400 leading-snug pt-0.5">{t('aicompat.modelHint')}</p>
              </>
            ) : (() => {
              const opts = MODELS_BY_PROVIDER[aiProvider as Exclude<AiProvider, 'disabled'>] ?? [];
              const currentInList = opts.some((m) => m.value === aiModel);
              // A model saved by an older build (or typed in Settings) is not
              // in the preset list: keep it visible instead of rendering an
              // empty select that looks like the choice was lost.
              const showingCustom = customModel || (aiModel !== '' && !currentInList);
              return (
                <>
                  <Select
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
                    size="lg"
                    className="w-full font-mono"
                  >
                    <option value="">{t('ai.selectModel')}</option>
                    {opts.map((m) => (
                      <option key={m.value} value={m.value}>{m.label} · {m.tag}</option>
                    ))}
                    <option value="__custom__">{t('set.customModel')}</option>
                  </Select>
                  {showingCustom && (
                    <input
                      type="text"
                      data-testid="onboarding-ai-custom-model"
                      value={currentInList ? '' : aiModel}
                      onChange={(e) => setAiModel(e.target.value)}
                      placeholder="deepseek-chat"
                      aria-label={t('set.customModel')}
                      className={`${inputLgCls} w-full font-mono`}
                      spellCheck={false}
                      autoComplete="off"
                    />
                  )}
                  {aiModel && !showingCustom && (
                    <p className="text-[12px] text-zinc-500 dark:text-zinc-400 leading-snug pt-0.5">
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
              className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-500 dark:text-zinc-400"
            >
              {t('set.cache')}
            </label>
            <Select
              id="onboarding-ai-cache-ttl"
              data-testid="onboarding-ai-cache-ttl"
              value={String(aiCacheTtlDays)}
              onChange={(e) => setAiCacheTtlDays(Number(e.target.value))}
              className="w-full"
            >
              {CACHE_TTL_DAYS.map((days) => (
                <option key={days} value={days}>{fmtDays(days)}</option>
              ))}
              {/* A value saved from the Settings slider (1–90, any number) is
                  never silently rewritten: it keeps its own option. */}
              {!CACHE_TTL_DAYS.includes(aiCacheTtlDays as (typeof CACHE_TTL_DAYS)[number]) && (
                <option value={aiCacheTtlDays}>{fmtDays(aiCacheTtlDays)}</option>
              )}
            </Select>
          </div>
          <div className="p-4">
            <ToggleRow
              label={t('ai.enrichOnSave')}
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

      <p className="text-center text-[12px] leading-[18px] text-zinc-500 dark:text-zinc-400 px-6 pt-1">
        {t('onb.cacheTtlNote')}<span className="font-medium text-zinc-700 dark:text-zinc-300">{`${t('nav.settings')} → ${t('set.sectionAiPremium')}`}</span> {t('onb.wheneverPost')}
      </p>
    </StepSection>
  );
}
