import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, KeyRound, Loader2, Zap, Info } from '../../../ui/icons';
import { sendMessage } from 'webext-bridge/content-script';
import { t, fmtDays } from '../../../shared/i18n';
import { richText } from '../../../shared/i18n/rich';
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
import { InfoHint } from '../InfoHint';
import {
  Badge, Button, Callout, ListGroup, QuickRow, Row, SubLabel, Toggle,
} from './settings-primitives';
import { Select, inputCls, Slider } from '../../../ui/primitives/controls';

type AiTestStatus =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'ok'; provider: string; latencyMs: number; cached: boolean }
  | { state: 'error'; error: string };

/**
 * BYOK panel for "AI premium".
 *
 * The cards, badges and test affordance are the prototype's; the wiring is the
 * repo's — a real `AI_ENRICH` against the user's key, debounced 600 ms after
 * the key/provider/model settles, with the last validated triplet remembered so
 * a re-render cannot re-bill the provider. Selecting a preset asks for its
 * optional host permission from inside the click, the only place Chrome will
 * show the prompt.
 *
 * `openai-compatible` is part of the store/store type from F2 but its tile
 * stays hidden until F7 ships the curated endpoint list (H13, D7).
 */
export function AiByokSection() {
  const ai = useKivaraStore((s) => s.ai);
  const setAi = useKivaraStore((s) => s.setAi);
  const translate = useKivaraStore((s) => s.translate);

  const [test, setTest] = useState<AiTestStatus>({ state: 'idle' });
  const activePreset = useMemo(() => getAiPreset(ai.provider), [ai.provider]);

  /**
   * Auto-validation guards: the last validated triplet stops the debounced
   * effect from re-firing on unrelated re-renders, and the timer ref coalesces
   * successive keystrokes into one network call.
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
    void ensureProviderHosts(`ai:${provider}`).then((missing) => {
      if (missing) {
        setTest({
          state: 'error',
          error: t('perm.needHost', { path: `${t('nav.settings')} → ${t('set.sectionHostAccess')}` }),
        });
      }
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
    // `test.state` is deliberately excluded: including it would re-arm the
    // timer on every transition and defeat the debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai.provider, ai.apiKey, ai.model, buildValidationKey, runTest]);

  return (
    <div className="space-y-2.5">
      <SubLabel
        hint={<>{t('set.byokIntro')} {richText(t('set.byokPrivacy'), { local: <span className="font-semibold">{t('set.byokLocal')}</span> })}</>}
      >
        {t('set.providerLabel')}
      </SubLabel>
      <ul className="grid grid-cols-1 gap-1 -mt-2">
        {AI_PRESETS.map((preset) => {
          const selected = ai.provider === preset.provider;
          return (
            <li
              key={preset.provider}
              className={`kvl-lift rounded-lg border px-2.5 py-1.5 ${
                selected
                  ? 'border-indigo-300 dark:border-indigo-500/50 bg-indigo-50/60 dark:bg-indigo-500/[0.08] ring-2 ring-indigo-500/10'
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
                    className={`shrink-0 w-3.5 h-3.5 rounded-full border transition-colors flex items-center justify-center ${
                      selected ? 'border-indigo-500 dark:border-indigo-400' : 'border-zinc-300 dark:border-zinc-600'
                    }`}
                    aria-hidden="true"
                  >
                    {selected && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 dark:bg-indigo-400" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100 normal-case">
                        {preset.label}
                      </span>
                      {preset.recommended && <Badge tone="emerald">{t('set.recommendedBadge')}</Badge>}
                      {preset.hasFreeTier && <Badge>{t('set.freeBadge')}</Badge>}
                    </div>
                    <div
                      className="text-[12px] text-zinc-500 dark:text-zinc-400 normal-case leading-[17px] line-clamp-2"
                      title={preset.tagline}
                    >
                      {preset.tagline}
                    </div>
                  </div>
                </button>
                <a
                  href={preset.getKeyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[12px] font-medium text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/[0.08] dark:hover:bg-indigo-400/[0.12] kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
                  title={t('ai.openKeyUrl')}
                >
                  {t('ai.getKey')}
                  <ExternalLink size={14} />
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
          </Row>
          <Row label={t('set.modelLabel')} hint={t('set.modelPresetHint')}>
            {(() => {
              const presets = MODELS_BY_PROVIDER[activePreset.provider] ?? [];
              const isCustom =
                ai.model === '__custom__' ||
                (ai.model.trim() !== '' && !presets.some((p) => p.value === ai.model));
              return (
                <div className="space-y-1">
                  <Select
                    value={isCustom ? '__custom__' : ai.model}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '__custom__') {
                        if (!isCustom) setAi({ ...ai, model: '__custom__' });
                      } else {
                        setAi({ ...ai, model: v });
                      }
                    }}
                    className="w-full"
                  >
                    <option value="">{t('ai.selectModel')}</option>
                    {presets.map((m) => (
                      <option key={m.value} value={m.value}>{m.label} · {m.tag}</option>
                    ))}
                    <option value="__custom__">{t('set.customModel')}</option>
                  </Select>
                  {isCustom && (
                    <input
                      type="text"
                      value={ai.model === '__custom__' ? '' : ai.model}
                      onChange={(e) => setAi({ ...ai, model: e.target.value || '__custom__' })}
                      placeholder={activePreset.defaultModel}
                      className={`${inputCls} font-mono text-[12px] w-full`}
                      spellCheck={false}
                      autoComplete="off"
                      autoFocus
                    />
                  )}
                </div>
              );
            })()}
          </Row>

          <div className="flex items-center gap-1.5">
            <Button
              variant="soft"
              onClick={() => void runTest()}
              disabled={!ai.apiKey.trim() || test.state === 'testing'}
              icon={test.state === 'testing' ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
            >
              {test.state === 'testing' ? t('set.testing') : t('set.testConnection')}
            </Button>
            <Button variant="ghost" onClick={disable}>{t('ai.disableAi')}</Button>
          </div>
          {test.state === 'idle' && ai.apiKey.trim() && (
            <p className="flex items-center gap-1 text-[12px] text-zinc-400 dark:text-zinc-500 px-0.5">
              <Info size={10} /> {t('set.keyAutoValidate')}
            </p>
          )}
          {test.state === 'ok' && (
            <Callout tone="success" icon={<CheckCircle2 size={12} />}>
              {test.cached
                ? t('set.cacheHit')
                : t('set.providerLatency', { provider: test.provider, ms: test.latencyMs })}
            </Callout>
          )}
          {test.state === 'error' && (
            <Callout tone="danger" icon={<AlertTriangle size={12} />}>{test.error}</Callout>
          )}

          <SubLabel>{t('set.aiBehaviour')}</SubLabel>
          <ListGroup>
            <ToggleLine label={t('ai.enrichOnSave')} on={ai.enrichOnSave} onChange={(v) => setAi({ ...ai, enrichOnSave: v })} />
            <ToggleLine label={t('ai.enrichOnHover')} on={ai.enrichOnHover} onChange={(v) => setAi({ ...ai, enrichOnHover: v })} />
            <ToggleLine label={t('set.aiMnemonic')} on={ai.preferAiMnemonic !== false} onChange={(v) => setAi({ ...ai, preferAiMnemonic: v })} />
            <ToggleLine label={t('set.aiEtymology')} on={ai.preferAiEtymology !== false} onChange={(v) => setAi({ ...ai, preferAiEtymology: v })} />
            {ai.provider === 'openai' && (
              <ToggleLine
                label={t('set.dalleFallbackLabel')}
                on={ai.enableDalleFallback === true}
                onChange={(v) => setAi({ ...ai, enableDalleFallback: v })}
              />
            )}
          </ListGroup>
          <div className="space-y-2 pt-0.5">
            <Row label={t('ai.nativeLangOverride')}>
              <input
                type="text"
                value={ai.nativeLanguage ?? ''}
                // Trim on blur, not per keystroke: trimming on change made
                // spaces impossible to type ("Brazilian Portuguese").
                onChange={(e) => setAi({ ...ai, nativeLanguage: e.target.value || undefined })}
                onBlur={(e) => setAi({ ...ai, nativeLanguage: e.target.value.trim() || undefined })}
                placeholder={`auto (${translate.targetLanguage})`}
                className={`${inputCls} w-full`}
              />
            </Row>
            <Row label={t('set.cache')} value={fmtDays(ai.cacheTtlDays)}>
              <Slider
                min={1}
                max={90}
                step={1}
                value={ai.cacheTtlDays}
                onChange={(e) => setAi({ ...ai, cacheTtlDays: Number(e.target.value) })}
                className="w-full"
              />
            </Row>
          </div>

          {!ai.apiKey.trim() && (
            <Callout tone="warning" icon={<AlertTriangle size={12} />}>{t('set.missingKeyWarn')}</Callout>
          )}
        </div>
      ) : (
        <p className="flex items-center gap-1 text-[12px] text-zinc-400 dark:text-zinc-500 px-0.5">
          {t('set.pickProviderShort')}<InfoHint text={t('set.pickProviderFirst')} />
        </p>
      )}
    </div>
  );
}

function ToggleLine({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <QuickRow label={label}>
      <Toggle on={on} onChange={onChange} ariaLabel={label} />
    </QuickRow>
  );
}