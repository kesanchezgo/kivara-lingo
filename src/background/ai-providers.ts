/// <reference types="chrome" />

import type {
  AiEnrichRequest,
  AiEnrichment,
  AiProvider,
  AiSettings,
} from '../shared/types';

const TIMEOUT_MS = 5000;

/**
 * The raw enrichment payload returned by every provider. The wrapper in
 * `ai-enrich.ts` decorates it with provider/latencyMs/cached.
 */
export type AiEnrichmentPayload = Omit<AiEnrichment, 'provider' | 'latencyMs' | 'cached'>;

export type AiProviderResult =
  | { ok: true; data: AiEnrichmentPayload }
  | { ok: false; error: string; provider: AiProvider };

function withTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timeout),
  );
}

/**
 * The shared prompt used across providers. Producing JSON shaped exactly like
 * `AiEnrichmentPayload` keeps parsing trivial.
 */
function buildPrompt(req: AiEnrichRequest): string {
  return [
    'Eres un asistente de aprendizaje de idiomas. Devuelve SOLO JSON con las claves',
    'contextualDefinition (string), synonyms (array<=5 de strings), collocations (array<=5 de strings),',
    'nuancedTranslation (string), register (formal|neutral|informal|slang|literary),',
    'appropriateness (string corta), mnemonic (string corta en el idioma nativo del',
    'usuario, ayuda mnemotécnica memorable o asociación sonora),',
    'etymology (string corta en el idioma nativo del usuario, origen breve de la',
    'palabra en 1-2 oraciones máximo).',
    `Idioma fuente: ${req.sourceLang}.`,
    `Idioma nativo del usuario: ${req.nativeLang}.`,
    `Palabra/frase objetivo: "${req.token}".`,
    `Oración que la contiene: "${req.sentence}".`,
    `Plataforma: ${req.platform ?? 'desconocida'}.`,
    'Sin texto fuera del JSON. Sin markdown.',
  ].join(' ');
}

function emptyPayload(): AiEnrichmentPayload {
  return {
    contextualDefinition: '',
    synonyms: [],
    collocations: [],
    nuancedTranslation: '',
    register: 'neutral',
    appropriateness: '',
    mnemonic: '',
    etymology: '',
  };
}

function parsePayload(raw: unknown): AiEnrichmentPayload {
  const out = emptyPayload();
  if (!raw || typeof raw !== 'object') return out;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.contextualDefinition === 'string') out.contextualDefinition = obj.contextualDefinition;
  if (Array.isArray(obj.synonyms)) {
    out.synonyms = obj.synonyms.filter((v): v is string => typeof v === 'string').slice(0, 5);
  }
  if (Array.isArray(obj.collocations)) {
    out.collocations = obj.collocations.filter((v): v is string => typeof v === 'string').slice(0, 5);
  }
  if (typeof obj.nuancedTranslation === 'string') out.nuancedTranslation = obj.nuancedTranslation;
  if (
    obj.register === 'formal' ||
    obj.register === 'neutral' ||
    obj.register === 'informal' ||
    obj.register === 'slang' ||
    obj.register === 'literary'
  ) {
    out.register = obj.register;
  }
  if (typeof obj.appropriateness === 'string') out.appropriateness = obj.appropriateness;
  if (typeof obj.mnemonic === 'string') out.mnemonic = obj.mnemonic;
  if (typeof obj.etymology === 'string') out.etymology = obj.etymology;
  return out;
}

/** Strip ```json ... ``` fences and surrounding chatter when present. */
function extractJsonBlock(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  if (fence) return fence[1].trim();
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

async function callOpenAi(
  req: AiEnrichRequest,
  settings: AiSettings,
): Promise<AiProviderResult> {
  if (!settings.apiKey) return { ok: false, error: 'OpenAI API key missing', provider: 'openai' };
  const body = {
    model: settings.model || 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: buildPrompt(req) }],
  };
  let resp: Response;
  try {
    resp = await withTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'OpenAI network error',
      provider: 'openai',
    };
  }
  if (!resp.ok) {
    return { ok: false, error: `OpenAI ${resp.status}`, provider: 'openai' };
  }
  let json: unknown;
  try {
    json = await resp.json();
  } catch {
    return { ok: false, error: 'OpenAI returned non-JSON body', provider: 'openai' };
  }
  const text = (json as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]
    ?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, error: 'OpenAI returned empty content', provider: 'openai' };
  }
  try {
    const data = parsePayload(JSON.parse(extractJsonBlock(text)));
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'OpenAI JSON parse failed',
      provider: 'openai',
    };
  }
}

async function callAnthropic(
  req: AiEnrichRequest,
  settings: AiSettings,
): Promise<AiProviderResult> {
  if (!settings.apiKey)
    return { ok: false, error: 'Anthropic API key missing', provider: 'anthropic' };
  const body = {
    model: settings.model || 'claude-3-5-haiku-latest',
    max_tokens: 800,
    messages: [{ role: 'user', content: buildPrompt(req) }],
  };
  let resp: Response;
  try {
    resp = await withTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
        // MV3 service workers fetch from a chrome-extension://… origin, which
        // Anthropic accepts; the explicit opt-in header keeps the request
        // working from any future content-script fallback.
        'anthropic-dangerous-direct-browser-access': 'true',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Anthropic network error',
      provider: 'anthropic',
    };
  }
  if (!resp.ok) {
    return { ok: false, error: `Anthropic ${resp.status}`, provider: 'anthropic' };
  }
  let json: unknown;
  try {
    json = await resp.json();
  } catch {
    return { ok: false, error: 'Anthropic returned non-JSON body', provider: 'anthropic' };
  }
  const blocks = (json as { content?: Array<{ type?: string; text?: string }> }).content;
  const text = Array.isArray(blocks)
    ? blocks
        .filter((b) => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('\n')
    : '';
  if (!text.trim()) {
    return { ok: false, error: 'Anthropic returned empty content', provider: 'anthropic' };
  }
  try {
    const data = parsePayload(JSON.parse(extractJsonBlock(text)));
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Anthropic JSON parse failed',
      provider: 'anthropic',
    };
  }
}

async function callGemini(
  req: AiEnrichRequest,
  settings: AiSettings,
): Promise<AiProviderResult> {
  if (!settings.apiKey)
    return { ok: false, error: 'Gemini API key missing', provider: 'google-ai' };
  const model = settings.model || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(settings.apiKey)}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: buildPrompt(req) }] }],
    generationConfig: { responseMimeType: 'application/json' },
  };
  let resp: Response;
  try {
    resp = await withTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Gemini network error',
      provider: 'google-ai',
    };
  }
  if (!resp.ok) {
    return { ok: false, error: `Gemini ${resp.status}`, provider: 'google-ai' };
  }
  let json: unknown;
  try {
    json = await resp.json();
  } catch {
    return { ok: false, error: 'Gemini returned non-JSON body', provider: 'google-ai' };
  }
  const candidates = (json as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  }).candidates;
  const text = candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .filter((t): t is string => typeof t === 'string')
    .join('\n');
  if (!text || !text.trim()) {
    return { ok: false, error: 'Gemini returned empty content', provider: 'google-ai' };
  }
  try {
    const data = parsePayload(JSON.parse(extractJsonBlock(text)));
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Gemini JSON parse failed',
      provider: 'google-ai',
    };
  }
}

/**
 * Dispatch to the configured provider. Returns a discriminated union so the
 * caller can distinguish failures without throwing.
 */
export async function callAiProvider(
  req: AiEnrichRequest,
  settings: AiSettings,
): Promise<AiProviderResult> {
  switch (settings.provider) {
    case 'openai':
      return callOpenAi(req, settings);
    case 'anthropic':
      return callAnthropic(req, settings);
    case 'google-ai':
      return callGemini(req, settings);
    case 'disabled':
    default:
      return { ok: false, error: 'AI disabled', provider: 'disabled' };
  }
}

/**
 * Generate a mnemonic image for the given vocabulary card.
 *
 * Currently only OpenAI DALL-E 3 is implemented because:
 *   - Anthropic doesn't host an image-generation endpoint.
 *   - Google Gemini's image gen requires a paid project + Vertex AI
 *     setup (overkill for a single mnemonic).
 *
 * Returns the absolute image URL ready to embed in a popover or Anki
 * card. The URL is short-lived (~1 h on OpenAI's CDN); the orchestrator
 * caches the result alongside the rest of the VIP payload so a re-hover
 * within the cache TTL never re-bills the API.
 *
 * Cost note: DALL-E 3 standard 1024×1024 is ~$0.04 per image. At the
 * popover level we don't fire it on hover (`enrichOnHover` doesn't
 * trigger image gen), only on save when `enrichOnSave` is on AND the
 * user explicitly mapped a field to `image`. That keeps a typical
 * power-user under $5/month.
 */
export async function generateAiImage(
  prompt: string,
  settings: AiSettings,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (settings.provider !== 'openai') {
    return { ok: false, error: 'Image gen only available for OpenAI provider' };
  }
  if (!settings.apiKey) {
    return { ok: false, error: 'OpenAI API key missing' };
  }
  let resp: Response;
  try {
    resp = await withTimeout('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        size: '1024x1024',
        n: 1,
        quality: 'standard',
        response_format: 'url',
      }),
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    return { ok: false, error: `OpenAI ${resp.status}: ${body.slice(0, 160)}` };
  }
  let data: unknown;
  try {
    data = await resp.json();
  } catch {
    return { ok: false, error: 'OpenAI returned non-JSON' };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const url = (data as any)?.data?.[0]?.url as string | undefined;
  if (!url) return { ok: false, error: 'OpenAI image response missing URL' };
  return { ok: true, url };
}
