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
import type { AiApiFormat, AiProvider } from './types';
import { t } from './i18n/core';

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
    { value: 'gpt-4o',       label: 'GPT-4o',       tag: t('aimodel.balanced') },
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 mini', tag: t('aimodel.latestLight') },
    { value: 'gpt-4.1',      label: 'GPT-4.1',      tag: t('aimodel.topQuality') },
    { value: 'o4-mini',      label: 'o4 mini',      tag: t('aimodel.reasoning') },
  ],
  anthropic: [
    { value: 'claude-haiku-4-5',         label: 'Claude Haiku 4.5',  tag: t('aimodel.fastStable') },
    { value: 'claude-sonnet-4-6',        label: 'Claude Sonnet 4.6', tag: t('aimodel.recommended') },
    { value: 'claude-opus-4-7',          label: 'Claude Opus 4.7',   tag: t('aimodel.topQuality') },
  ],
  'google-ai': [
    { value: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash',      tag: t('aimodel.recommended1500') },
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', tag: t('aimodel.ultraLight') },
    { value: 'gemini-2.5-pro',        label: 'Gemini 2.5 Pro',        tag: t('aimodel.topQuality') },
    { value: 'gemini-flash-latest',   label: 'Gemini Flash latest',   tag: t('aimodel.latestRolling') },
  ],
  // Each endpoint hosts its own model ids, so the picker follows the selected
  // curated preset below and stays free-form everywhere else.
  'openai-compatible': [],
};

/**
 * Wire formats an `openai-compatible` endpoint may speak (F7).
 *
 * `openai-chat` is the de-facto standard (`/chat/completions`).
 * `anthropic-messages` covers gateways that expose Claude's message shape at
 * the same base URL. The store's `AiApiFormat` is the source of truth; this
 * table only adds the path and the UI label.
 */
export const API_FORMATS: { value: AiApiFormat; label: string; path: string }[] = [
  { value: 'openai-chat', label: 'Chat completions', path: '/chat/completions' },
  { value: 'anthropic-messages', label: 'Anthropic messages', path: '/messages' },
];

/** Path appended to `baseUrl` for a wire format. */
export function endpointPath(format: AiApiFormat | undefined): string {
  return (API_FORMATS.find((f) => f.value === (format ?? 'openai-chat')) ?? API_FORMATS[0]).path;
}

/**
 * Curated `openai-compatible` endpoints (docs/REDESIGN-V2.md §3 H13, §9 D7).
 *
 * The extension declares optional host access for exactly these origins, so
 * the list is closed on purpose: an arbitrary URL would need a wildcard over
 * every HTTPS host, which is the broad permission the Chrome Web Store review
 * flags. Every
 * `baseUrl` here has its matching pattern in `shared/provider-hosts.ts` and in
 * `manifest.json → optional_host_permissions`.
 *
 * Local endpoints are keyless (`Ollama`, `LM Studio`); the loopback origins
 * are already mandatory host permissions for AnkiConnect.
 */
export interface CompatPreset {
  /** Stable id used as the React key and in tests. */
  id: string;
  label: string;
  baseUrl: string;
  format: AiApiFormat;
  /** Suggested model id; empty means the user types one. */
  model: string;
  /** Where to get a key. Empty for keyless local servers. */
  getKeyUrl: string;
  /** True for loopback endpoints that need no API key. */
  keyless?: boolean;
}

export const OPENAI_COMPATIBLE_PRESETS: CompatPreset[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    format: 'openai-chat',
    model: 'openrouter/auto',
    getKeyUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    format: 'openai-chat',
    model: '',
    getKeyUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    format: 'openai-chat',
    model: 'deepseek-chat',
    getKeyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    format: 'openai-chat',
    model: 'mistral-small-latest',
    getKeyUrl: 'https://console.mistral.ai/api-keys',
  },
  {
    id: 'together',
    label: 'Together',
    baseUrl: 'https://api.together.xyz/v1',
    format: 'openai-chat',
    model: '',
    getKeyUrl: 'https://api.together.ai/settings/api-keys',
  },
  {
    id: 'xai',
    label: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
    format: 'openai-chat',
    model: '',
    getKeyUrl: 'https://console.x.ai/',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    format: 'openai-chat',
    model: '',
    getKeyUrl: '',
    keyless: true,
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    format: 'openai-chat',
    model: '',
    getKeyUrl: '',
    keyless: true,
  },
];

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
  'openai-compatible': '',
};
