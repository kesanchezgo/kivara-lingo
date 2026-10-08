/**
 * Per-provider model presets surfaced in the AI configuration UI.
 *
 * Used by:
 *   - SettingsTab → IA premium → Modelo (with a "Personalizado…" escape hatch)
 *   - Onboarding → AIStep → Modelo
 *
 * Keep the lists curated rather than exhaustive — listing 30 models hurts the
 * picker UX. The custom-text input below the select handles the long tail.
 */
import type { AiProvider } from './types';
import { t } from './i18n';

export interface AiModelOption {
  /** Exact model id sent to the provider. */
  value: string;
  /** Friendly label rendered in the dropdown. */
  label: string;
  /** Trailing tag — short cost / use-case hint. */
  tag: string;
}

export const MODELS_BY_PROVIDER: Record<
  Exclude<AiProvider, 'disabled'>,
  AiModelOption[]
> = {
  openai: [
    { value: 'gpt-4o-mini',  label: 'GPT-4o mini',  tag: t('aimodel.fastCheap') },
    { value: 'gpt-4o',       label: 'GPT-4o',       tag: 'Balance calidad/coste' },
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 mini', tag: t('aimodel.latestLight') },
    { value: 'gpt-4.1',      label: 'GPT-4.1',      tag: t('aimodel.topQuality') },
    { value: 'o4-mini',      label: 'o4 mini',      tag: 'Razonamiento' },
  ],
  anthropic: [
    { value: 'claude-3-5-haiku-latest',  label: 'Claude 3.5 Haiku',  tag: t('aimodel.fastStable') },
    { value: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet', tag: 'Equilibrado · estable' },
    { value: 'claude-haiku-4-5',         label: 'Claude Haiku 4.5',  tag: t('aimodel.fastCheap') },
    { value: 'claude-sonnet-4-6',        label: 'Claude Sonnet 4.6', tag: 'Recomendado' },
    { value: 'claude-opus-4-7',          label: 'Claude Opus 4.7',   tag: t('aimodel.topQuality') },
  ],
  'google-ai': [
    { value: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash',      tag: t('aimodel.recommended1500') },
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', tag: 'Ultra ligero' },
    { value: 'gemini-2.5-pro',        label: 'Gemini 2.5 Pro',        tag: t('aimodel.topQuality') },
    { value: 'gemini-flash-latest',   label: 'Gemini Flash latest',   tag: t('aimodel.latestRolling') },
    { value: 'gemini-2.0-flash',      label: 'Gemini 2.0 Flash',      tag: 'Estable · multimodal' },
  ],
};

export const PLACEHOLDER_BY_PROVIDER: Record<Exclude<AiProvider, 'disabled'>, string> = {
  openai: 'sk-...',
  anthropic: 'sk-ant-...',
  'google-ai': 'AIza...',
};

/**
 * Default model id picked when the user enables a provider for the first
 * time. Mirrors the mock catalog so the onboarding tile defaults match
 * the SettingsTab dropdown's first selection. Production code typically
 * uses `pickModelForProvider()` from `ai-presets.ts`, but this constant
 * is kept for parity with the mock data file.
 */
export const DEFAULT_MODEL_BY_PROVIDER: Record<Exclude<AiProvider, 'disabled'>, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5',
  'google-ai': 'gemini-2.5-flash',
};
