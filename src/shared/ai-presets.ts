/**
 * Curated AI provider presets surfaced in Settings → "IA premium".
 *
 * The underlying `AiProvider` type already supports the three real backends
 * (`openai`, `anthropic`, `google-ai`); this module simply attaches the
 * human-friendly metadata the BYOK card needs:
 *
 *  - Display name + tagline so users know what they're picking.
 *  - The model id we default to when the user toggles the preset on, so they
 *    don't have to know that "gpt-4o-mini" is the cheap-and-fast OpenAI
 *    model right now.
 *  - A "free tier" hint so a user without budget can pick the right backend
 *    in one glance (Gemini AI Studio is the obvious choice).
 *  - The official URL to obtain a key.
 *
 * Keeping this as a separate module means the React Settings tab and tests
 * both consume the same source of truth.
 */
import type { AiProvider } from './types';
import { t } from './i18n';

export type ConfigurableAiProvider = Exclude<AiProvider, 'disabled'>;

export interface AiPreset {
  /** Internal id — matches `AiSettings.provider`. */
  provider: ConfigurableAiProvider;
  /** Display name shown on the card. */
  label: string;
  /** Compact tagline shown under the label. */
  tagline: string;
  /**
   * Model identifier we default to when the user activates this preset.
   * The user can still override it from the Settings input.
   */
  defaultModel: string;
  /**
   * Public URL where the user obtains an API key. We open it in a new tab
   * when the user clicks "Obtener key".
   */
  getKeyUrl: string;
  /**
   * Freeform copy describing the cost. Used as a small caption — keep it
   * factual and short.
   */
  pricingNote: string;
  /**
   * Whether the provider has a free tier the user can realistically rely on
   * for daily learning sessions. Surfaced as a green "Gratis" badge.
   */
  hasFreeTier: boolean;
  /**
   * Recommended for users with no budget. Used to surface a single
   * "Recomendado" highlight so users aren't paralysed by choice.
   */
  recommended: boolean;
}

export const AI_PRESETS: AiPreset[] = [
  {
    provider: 'google-ai',
    label: 'Google Gemini',
    tagline: t('aipreset.geminiTagline'),
    defaultModel: 'gemini-2.5-flash',
    getKeyUrl: 'https://aistudio.google.com/apikey',
    pricingNote: t('aipreset.geminiPricing'),
    hasFreeTier: true,
    recommended: true,
  },
  {
    provider: 'anthropic',
    label: 'Anthropic Claude',
    tagline: t('aipreset.claudeTagline'),
    defaultModel: 'claude-3-5-haiku-latest',
    getKeyUrl: 'https://console.anthropic.com/settings/keys',
    pricingNote: t('aipreset.claudePricing'),
    hasFreeTier: true,
    recommended: false,
  },
  {
    provider: 'openai',
    label: 'OpenAI',
    tagline: t('aipreset.openaiTagline'),
    defaultModel: 'gpt-4o-mini',
    getKeyUrl: 'https://platform.openai.com/api-keys',
    pricingNote: t('aipreset.openaiPricing'),
    hasFreeTier: false,
    recommended: false,
  },
];

/**
 * Lookup helper used by the Settings tab and tests. Returns `undefined`
 * for the `disabled` provider since there's no preset for that case.
 */
export function getAiPreset(provider: AiProvider): AiPreset | undefined {
  if (provider === 'disabled') return undefined;
  return AI_PRESETS.find((p) => p.provider === provider);
}

/**
 * Decide which model id to write into `AiSettings.model` when the user
 * switches to a different provider preset.
 *
 * Rule:
 *  - If the current value already looks like a valid id for the new provider
 *    (i.e. matches its naming convention), keep it.
 *  - Otherwise, fall back to the preset's recommended default.
 *
 * The naming convention is intentionally loose — model ids change often,
 * we only filter the obvious mismatches (e.g. "gpt-*" when switching to
 * Gemini).
 */
export function pickModelForProvider(
  provider: ConfigurableAiProvider,
  currentModel: string,
): string {
  const trimmed = currentModel.trim();
  if (!trimmed) return providerDefaultModel(provider);
  if (provider === 'openai' && /^(gpt|o1|o3|chatgpt)/i.test(trimmed)) return trimmed;
  if (provider === 'anthropic' && /^claude/i.test(trimmed)) return trimmed;
  if (provider === 'google-ai' && /^(gemini|models\/gemini)/i.test(trimmed)) return trimmed;
  return providerDefaultModel(provider);
}

function providerDefaultModel(provider: ConfigurableAiProvider): string {
  return AI_PRESETS.find((p) => p.provider === provider)?.defaultModel ?? '';
}
