import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, KeyRound, Loader2, Zap } from 'lucide-react';
import { sendMessage } from 'webext-bridge/content-script';
import { t } from '../../../shared/i18n';
import { useKivaraStore } from '../../../shared/store';
import type { AiEnrichResponse } from '../../../shared/types';
import {
  AI_PRESETS,
  getAiPreset,
  pickModelForProvider,
  type ConfigurableAiProvider,
} from '../../../shared/ai-presets';
import { MODELS_BY_PROVIDER } from '../../../shared/ai-models';
import { ensureProviderHosts } from '../../../shared/host-permissions';
import { SecretKeyInput } from '../SecretKeyInput';
import { NestedAccordion, Row, Toggle } from './settings-primitives';

type AiTestStatus =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'ok'; provider: string; latencyMs: number; cached: boolean }
  | { state: 'error'; error: string };

/**
 * BYOK ("bring your own key") panel for the AI premium accordion.
 *
 * Three-card layout that surfaces each supported provider as a clickable
 * preset (Gemini · Claude · OpenAI). Selecting a card switches
 * `ai.provider`, fills in the recommended model id, and reveals the key
 * input + a t('set.testConnection') button that fires a real `AI_ENRICH` against
 * the user's key. The kept-everywhere advanced toggles (hover / save /
 * cache) live below in a compact row so users who already configured the
 * provider can flip them without scrolling.
 */
export function AiByokSection() {
  const ai = useKivaraStore((s) => s.ai);
  const setAi = useKivaraStore((s) => s.setAi);
  const translate = useKivaraStore((s) => s.translate);

  const [test, setTest] = useState<AiTestStatus>({ state: 'idle' });
  const activePreset = useMemo(() => getAiPreset(ai.provider), [ai.provider]);

  /**
   * Auto-validation guards. We track the last-validated triplet so the
   * debounced effect doesn't re-fire on unrelated re-renders, and we hold a
   * timer ref so successive keystrokes coalesce into a single network call.
   */
  const lastValidatedKey = useRef<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildValidationKey = useCallback(
    () => `${ai.provider}|${ai.model}|${ai.apiKey}`,
    [ai.provider, ai.model, ai.apiKey],
  );

  function selectPreset(provider: ConfigurableAiProvider) {
    const preset = getAiPreset(provider);
    if (!preset) return;
    lastValidatedKey.current = null;
    setTest({ state: 'idle' });
    setAi({
      ...ai,
      provider,
      model: pickModelForProvider(provider, ai.model),
    });
    // Optional host permission: this runs INSIDE the click, which is the only
    // place chrome will show a prompt (the service worker cannot, and the AI
    // request would otherwise fail with a CORS/network error nobody can read).
    void ensureProviderHosts(`ai:${provider}`).then((missing) => {
      if (missing) setTest({ state: 'error', error: t('perm.needHost') });
    });
  }

  function disable() {
    lastValidatedKey.current = null;
    setTest({ state: 'idle' });
    setAi({ ...ai, provider: 'disabled' });
  }

  const runTest = useCallback(async () => {
    if (ai.provider === 'disabled' || !ai.apiKey.trim()) return;
    const validationKey = `${ai.provider}|${ai.model}|${ai.apiKey}`;
    setTest({ state: 'testing' });
    try {
      const response = (await sendMessage(
        'AI_ENRICH',
        {
          token: 'hello',
          sentence: 'Hello, how are you today?',
          sourceLang: translate.sourceLang || 'en',
          nativeLang: ai.nativeLanguage || translate.targetLanguage || 'es',
          platform: 'settings-byok-test',
        },
        'background',
      )) as AiEnrichResponse;
      if (response.ok) {
        lastValidatedKey.current = validationKey;
        setTest({
          state: 'ok',
          provider: response.data.provider,
          latencyMs: response.data.latencyMs,
          cached: response.data.cached,
        });
      } else {
        // Cache the error fingerprint too — we don't want to spam the
        // provider with the same bad key on every re-render.
        lastValidatedKey.current = validationKey;
        setTest({ state: 'error', error: response.error });
      }
    } catch (err) {
      setTest({
        state: 'error',
        error: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }, [ai.apiKey, ai.model, ai.nativeLanguage, ai.provider, translate.sourceLang, translate.targetLanguage]);

  /**
   * Debounced auto-validation: 600 ms after the user stops typing the key
   * (or switching the provider / model), fire a real `AI_ENRICH` to confirm
   * the credential works. The same `lastValidatedKey` ref shields us from
   * re-firing when the result already lives in state.
   */
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    if (ai.provider === 'disabled' || !ai.apiKey.trim()) {
      if (test.state !== 'idle') setTest({ state: 'idle' });
      return;
    }
    const key = buildValidationKey();
    if (key === lastValidatedKey.current) return;
    debounceTimer.current = setTimeout(() => {
      void runTest();
    }, 600);
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
    };
    // We intentionally exclude `test.state` from deps — including it would
    // re-arm the timer every time the test transitions, defeating the
    // debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai.provider, ai.apiKey, ai.model, buildValidationKey, runTest]);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug">
        {t('set.byokIntro')}<span className="font-medium text-zinc-700 dark:text-zinc-300">Tu key vive solo en tu navegador</span> {t('set.byokNeverUpload')}</p>

      <ul className="grid grid-cols-1 gap-1.5">
        {AI_PRESETS.map((preset) => {
          const selected = ai.provider === preset.provider;
          return (
            <li
              key={preset.provider}
              className={`rounded border px-2 py-1.5 transition-colors ${
                selected
                  ? 'border-indigo-400 dark:border-indigo-600/70 bg-indigo-50/60 dark:bg-indigo-500/10'
                  : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => selectPreset(preset.provider)}
                  className="flex-1 min-w-0 text-left flex items-center gap-2"
                >
                  <span
                    className={`shrink-0 w-3.5 h-3.5 rounded-full border-2 transition-colors ${
                      selected
                        ? 'border-indigo-500 dark:border-indigo-400 bg-indigo-500'
                        : 'border-zinc-300 dark:border-zinc-700'
                    }`}
                    aria-hidden="true"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5 flex-wrap">
                      <span className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-100 normal-case">
                        {preset.label}
                      </span>
                      {preset.recommended && (
                        <span className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                          Recomendado
                        </span>
                      )}
                      {preset.hasFreeTier && (
                        <span className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                          Gratis
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-500 dark:text-zinc-400 normal-case leading-snug">
                      {preset.tagline}
                    </div>
                    <div className="text-[10px] text-zinc-400 dark:text-zinc-500 normal-case">
                      {preset.pricingNote}
                    </div>
                  </div>
                </button>
                <a
                  href={preset.getKeyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 inline-flex items-center gap-1 text-[10px] px-1.5 py-1 rounded border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  title={`Abrir ${preset.getKeyUrl}`}
                >
                  Obtener key
                  <ExternalLink size={9} />
                </a>
              </div>
            </li>
          );
        })}
      </ul>

      {activePreset ? (
        <div className="space-y-2">
          <Row
            label={
              <span className="inline-flex items-center gap-1.5">
                <KeyRound size={10} className="text-zinc-400" />
                API key · {activePreset.label}
              </span>
            }
          >
            <div className="flex items-center gap-1.5">
              <div className="flex-1">
                <SecretKeyInput
                  stored={ai.apiKey}
                  onChange={(v) => setAi({ ...ai, apiKey: v })}
                  placeholder={
                    activePreset.provider === 'openai'
                      ? 'sk-...'
                      : activePreset.provider === 'anthropic'
                        ? 'sk-ant-...'
                        : 'AIza...'
                  }
                  showToggle
                  section="ai"
                  field="apiKey"
                />
              </div>
            </div>
          </Row>
          <Row
            label="Modelo"
            hint={t('set.modelPresetHint')}
          >
            {(() => {
              const presets = MODELS_BY_PROVIDER[activePreset.provider] ?? [];
              const isCustom =
                ai.model === '__custom__' ||
                (ai.model.trim() !== '' && !presets.some((p) => p.value === ai.model));
              return (
                <div className="space-y-1">
                  <select
                    value={isCustom ? '__custom__' : ai.model}
                    onChange={(e) => {
                      const v = e.target.value;
                      // "__custom__" reveals the free-form input below.
                      if (v === '__custom__') {
                        if (!isCustom) setAi({ ...ai, model: '__custom__' });
                      } else {
                        setAi({ ...ai, model: v });
                      }
                    }}
                    className="sl-select w-full"
                  >
                    <option value="">— Selecciona un modelo —</option>
                    {presets.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label} · {m.tag}
                      </option>
                    ))}
                    <option value="__custom__">Personalizado…</option>
                  </select>
                  {isCustom && (
                    <input
                      type="text"
                      value={ai.model === '__custom__' ? '' : ai.model}
                      onChange={(e) => setAi({ ...ai, model: e.target.value || '__custom__' })}
                      placeholder={activePreset.defaultModel}
                      className="sl-input sl-mono w-full"
                      spellCheck={false}
                      autoComplete="off"
                      autoFocus
                    />
                  )}
                </div>
              );
            })()}
          </Row>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => void runTest()}
              disabled={!ai.apiKey.trim() || test.state === 'testing'}
              className="text-[11px] inline-flex items-center gap-1.5 px-2 py-1 rounded border border-indigo-300 dark:border-indigo-700/60 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {test.state === 'testing' ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Zap size={11} />
              )}
              {test.state === 'testing' ? 'Probando…' : t('set.testConnection')}
            </button>
            <button
              type="button"
              onClick={disable}
              className="text-[10px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 underline-offset-2 hover:underline"
            >
              Desactivar IA
            </button>
            {test.state === 'idle' && ai.apiKey.trim() && (
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                {t('set.keyAutoValidate')}</span>
            )}
            {test.state === 'ok' && (
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 size={11} />
                {test.cached ? t('set.cacheHit') : t('set.providerLatency', { provider: test.provider, ms: test.latencyMs })}
              </span>
            )}
            {test.state === 'error' && (
              <span className="inline-flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400">
                <AlertTriangle size={11} />
                {test.error}
              </span>
            )}
          </div>

          <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40 p-2 space-y-1.5">
            <Row label="Enriquecer al guardar">
              <Toggle on={ai.enrichOnSave} onChange={(v) => setAi({ ...ai, enrichOnSave: v })} />
            </Row>
            <Row label="Enriquecer en hover">
              <Toggle on={ai.enrichOnHover} onChange={(v) => setAi({ ...ai, enrichOnHover: v })} />
            </Row>
            <Row label={t('set.aiMnemonic')}>
              <Toggle on={ai.preferAiMnemonic !== false} onChange={(v) => setAi({ ...ai, preferAiMnemonic: v })} />
            </Row>
            <Row label={t('set.aiEtymology')}>
              <Toggle on={ai.preferAiEtymology !== false} onChange={(v) => setAi({ ...ai, preferAiEtymology: v })} />
            </Row>
            {ai.provider === 'openai' && (
              <Row label={t('set.dalleFallbackLabel')}>
                <Toggle on={ai.enableDalleFallback === true} onChange={(v) => setAi({ ...ai, enableDalleFallback: v })} />
              </Row>
            )}
            <Row label="Idioma nativo (override)">
              <input
                type="text"
                value={ai.nativeLanguage ?? ''}
                onChange={(e) => setAi({ ...ai, nativeLanguage: e.target.value.trim() || undefined })}
                placeholder={`auto (${translate.targetLanguage})`}
                className="sl-input w-full"
              />
            </Row>
            <Row label={t('set.cache')} value={`${ai.cacheTtlDays}d`}>
              <input
                type="range"
                min={1}
                max={90}
                step={1}
                value={ai.cacheTtlDays}
                onChange={(e) => setAi({ ...ai, cacheTtlDays: Number(e.target.value) })}
                className="sl-range w-full"
              />
            </Row>
          </div>

          {!ai.apiKey.trim() && (
            <p className="text-[10px] text-rose-600 dark:text-rose-400 leading-snug">
              {t('set.missingKeyWarn')}</p>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug">
          {t('set.pickProviderFirst')}</p>
      )}
    </div>
  );
}
