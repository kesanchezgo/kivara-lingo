import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, KeyRound, Loader2, Zap, Info } from '../../../ui/icons';
import { sendMessage } from 'webext-bridge/content-script';
import { t, fmtDays } from '../../../shared/i18n';
import { richText } from '../../../shared/i18n/rich';
import { useKivaraStore } from '../../../shared/use-kivara-store';
import type { AiApiFormat, AiEnrichResponse, AiSettings } from '../../../shared/types';
import {
  AI_PRESETS,
  getAiPreset,
  pickModelForProvider,
  type ConfigurableAiProvider,
} from '../../../shared/ai-presets';
import {
  API_FORMATS,
  MODELS_BY_PROVIDER,
  OPENAI_COMPATIBLE_PRESETS,
  endpointPath,
} from '../../../shared/ai-models';
import { compatibleHostFor } from '../../../shared/provider-hosts';
import { classifyAiTestError } from '../../../shared/ai-test-errors';
import {
  ensureProviderHosts,
  permissionsApiAvailable,
  requestHosts,
} from '../../../shared/host-permissions';
import { SecretKeyInput } from '../SecretKeyInput';
import { InfoHint } from '../InfoHint';
import {
  Badge, Button, Callout, ListGroup, QuickRow, Row, SubLabel, Toggle,
} from '../../../ui/primitives/settings-primitives';
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

  /**
   * A loopback compatible endpoint is keyless (Ollama, LM Studio). Everything
   * else needs its key before a validation call is worth sending.
   */
  const compatKeyless =
    ai.provider === 'openai-compatible' &&
    Boolean(compatibleHostFor(ai.baseUrl ?? '')?.startsWith('http://'));
  const canValidate =
    ai.provider === 'openai-compatible'
      ? Boolean((ai.baseUrl ?? '').trim()) && Boolean(ai.model.trim()) && (compatKeyless || Boolean(ai.apiKey.trim()))
      : Boolean(ai.apiKey.trim());

  const buildValidationKey = useCallback(
    () => `${ai.provider}|${ai.model}|${ai.baseUrl ?? ''}|${ai.apiFormat ?? ''}|${ai.apiKey}`,
    [ai.provider, ai.model, ai.baseUrl, ai.apiFormat, ai.apiKey],
  );

  function selectPreset(provider: ConfigurableAiProvider) {
    const preset = getAiPreset(provider);
    if (!preset) return;
    lastValidatedKey.current = null;
    setTest({ state: 'idle' });
    if (provider === 'openai-compatible') {
      // The curated endpoints come next; the tile itself asks for nothing.
      // The permission prompt belongs to the gesture that saves ONE origin
      // (H13/D7), not to selecting the group.
      setAi({
        ...ai,
        provider,
        apiFormat: ai.apiFormat ?? 'openai-chat',
        model: pickModelForProvider(provider, ai.model),
      });
      return;
    }
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

  /**
   * Raw provider text → the prototype's tailored sentence. Config gaps (no
   * key, bad URL, missing model) are classified before the message, so a 404
   * from an endpoint that never existed still reads as a URL problem.
   */
  const describeAiTestError = useCallback(
    (raw: string): string => {
      const key = classifyAiTestError({
        provider: ai.provider,
        apiKey: ai.apiKey,
        model: ai.model,
        baseUrl: ai.baseUrl,
        keyless: compatKeyless,
        error: raw,
      });
      return key ? t(key) : raw;
    },
    [ai.provider, ai.apiKey, ai.model, ai.baseUrl, compatKeyless],
  );

  const runTest = useCallback(async () => {
    if (ai.provider === 'disabled' || !canValidate) return;
    const validationKey = `${ai.provider}|${ai.model}|${ai.baseUrl ?? ''}|${ai.apiFormat ?? ''}|${ai.apiKey}`;
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
        setTest({ state: 'error', error: describeAiTestError(response.error) });
      }
    } catch (err) {
      setTest({
        state: 'error',
        error: describeAiTestError(err instanceof Error ? err.message : 'unknown error'),
      });
    }
  }, [
    ai.apiFormat,
    ai.apiKey,
    ai.baseUrl,
    ai.model,
    ai.nativeLanguage,
    ai.provider,
    canValidate,
    describeAiTestError,
    translate.sourceLang,
    translate.targetLanguage,
  ]);

  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    if (ai.provider === 'disabled' || !canValidate) {
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
          {activePreset.provider === 'openai-compatible' && (
            <CompatEndpoint
              ai={ai}
              setAi={(next) => {
                setAi(next);
                setTest({ state: 'idle' });
              }}
              onError={(error) => setTest({ state: 'error', error })}
            />
          )}
          <Row
            label={
              <span className="inline-flex items-center gap-1.5">
                <KeyRound size={10} className="text-zinc-400" />
                API key · {activePreset.label}
              </span>
            }
            hint={activePreset.provider === 'openai-compatible' ? t('aicompat.keyOptional') : undefined}
          >
            <SecretKeyInput
              stored={ai.apiKey}
              onChange={(v) => setAi({ ...ai, apiKey: v })}
              placeholder={
                activePreset.provider === 'openai'
                  ? 'sk-...'
                  : activePreset.provider === 'anthropic'
                    ? 'sk-ant-...'
                    : activePreset.provider === 'openai-compatible'
                      ? 'sk-...'
                      : 'AIza...'
              }
              showToggle
              section="ai"
              field="apiKey"
            />
          </Row>
          <Row
            label={t('set.modelLabel')}
            hint={
              activePreset.provider === 'openai-compatible'
                ? t('aicompat.modelHint')
                : t('set.modelPresetHint')
            }
          >
            {activePreset.provider === 'openai-compatible' ? (
              // Every curated endpoint names its own models: a fixed select
              // would offer ids the endpoint does not serve.
              <input
                type="text"
                value={ai.model === '__custom__' ? '' : ai.model}
                onChange={(e) => setAi({ ...ai, model: e.target.value })}
                placeholder="deepseek-chat · mistral-small-latest · llama3.1:8b"
                className={`${inputCls} font-mono text-[12px] w-full`}
                spellCheck={false}
                autoComplete="off"
              />
            ) : (() => {
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
              disabled={!canValidate || test.state === 'testing'}
              icon={test.state === 'testing' ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
            >
              {test.state === 'testing' ? t('set.testing') : t('set.testConnection')}
            </Button>
            <Button variant="ghost" onClick={disable}>{t('ai.disableAi')}</Button>
          </div>
          {test.state === 'idle' && canValidate && (
            <p className="flex items-center gap-1 text-[12px] text-zinc-400 dark:text-zinc-400 px-0.5">
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

          {!ai.apiKey.trim() && !compatKeyless && (
            <Callout tone="warning" icon={<AlertTriangle size={12} />}>{t('set.missingKeyWarn')}</Callout>
          )}
        </div>
      ) : (
        <p className="flex items-center gap-1 text-[12px] text-zinc-400 dark:text-zinc-400 px-0.5">
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

/**
 * The `openai-compatible` endpoint editor (F7, H13/D7).
 *
 * Curated templates fill the base URL and the wire format; the model stays a
 * free-form id because each endpoint serves its own. "Save endpoint" is the
 * gesture that asks for host access: `requestHosts` calls
 * `chrome.permissions.request` before awaiting anything, so the prompt is
 * still attached to the click. In the content-script panel the permissions
 * API does not exist at all, so the panel points at Options instead of
 * pretending a request happened (same rule as `HostPermissionsRow`).
 */
function CompatEndpoint({
  ai,
  setAi,
  onError,
}: {
  ai: AiSettings;
  setAi: (next: AiSettings) => void;
  onError: (error: string) => void;
}) {
  const url = (ai.baseUrl ?? '').trim().replace(/\/+$/, '');
  const format: AiApiFormat = ai.apiFormat ?? 'openai-chat';
  const curated = OPENAI_COMPATIBLE_PRESETS.find((p) => p.baseUrl.replace(/\/+$/, '') === url);

  const save = () => {
    const pattern = compatibleHostFor(url);
    if (!pattern) {
      onError(t('aicompat.notCurated'));
      return;
    }
    if (!permissionsApiAvailable()) {
      void sendMessage('OPEN_SETTINGS', { section: 'permissions' }, 'background').catch(() => {
        // No worker reachable from this context either.
      });
      return;
    }
    void requestHosts([pattern]).then((missing) => {
      if (missing.length > 0) {
        onError(t('perm.needHost', { path: `${t('nav.settings')} → ${t('set.sectionHostAccess')}` }));
      }
    });
  };

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <SubLabel hint={t('aicompat.previewHint')}>{t('aicompat.preview')}</SubLabel>
        <div className="flex flex-wrap gap-1.5 -mt-1.5">
          {OPENAI_COMPATIBLE_PRESETS.map((preset) => {
            const active = preset.baseUrl.replace(/\/+$/, '') === url;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  setAi({
                    ...ai,
                    baseUrl: preset.baseUrl,
                    apiFormat: preset.format,
                    model: preset.model || ai.model,
                  })
                }
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
      </div>

      <Row
        label={t('aicompat.baseUrl')}
        hint={url ? t('aicompat.baseUrlHint', { url: url + endpointPath(format) }) : undefined}
      >
        <div className="flex items-center gap-1.5">
          <input
            type="url"
            value={ai.baseUrl ?? ''}
            onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })}
            placeholder="https://openrouter.ai/api/v1"
            className={`${inputCls} font-mono text-[12px] w-full min-w-0`}
            spellCheck={false}
            autoComplete="off"
          />
          <Button variant="soft" onClick={save}>{t('aicompat.save')}</Button>
        </div>
      </Row>

      <Row label={t('aicompat.format')} hint={t('aicompat.formatHint')}>
        <Select
          value={format}
          onChange={(e) => setAi({ ...ai, apiFormat: e.target.value as AiApiFormat })}
          className="w-full"
        >
          {API_FORMATS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} ({option.path})
            </option>
          ))}
        </Select>
      </Row>

      {curated?.getKeyUrl && (
        <a
          href={curated.getKeyUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[12px] font-medium text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/[0.08] dark:hover:bg-indigo-400/[0.12] kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
        >
          {t('ai.getKey')} · {curated.label}
          <ExternalLink size={14} />
        </a>
      )}
    </div>
  );
}
