/**
 * Readable "test connection" failures for the AI BYOK panel.
 *
 * The prototype validated the form before calling anything and showed one
 * tailored sentence per failure. The repo actually calls `AI_ENRICH`, so the
 * classifier runs twice in the same place: config gaps are caught before the
 * request is worth sending, and the provider's own answer is decoded back into
 * the same family of messages (401 / 404 / CORS / bad URL / missing model).
 *
 * Pure functions only — no DOM, no `t()`. Callers translate the returned key.
 */

export type AiTestErrorKey =
  | 'set.testErrNoKey'
  | 'set.testErrInvalidKey'
  | 'aicompat.errUrl'
  | 'aicompat.err404'
  | 'aicompat.err401'
  | 'aicompat.errCors'
  | 'aicompat.errModel';

/** Failure shapes the raw provider error can carry. */
export type AiErrorClass = 'unauthorized' | 'forbidden' | 'notFound' | 'cors' | 'timeout' | 'rateLimited' | 'server';

/** Below this length the prototype treated the key as a placeholder. */
export const MIN_AI_KEY_LENGTH = 12;

export interface AiTestInput {
  /** `ai.provider`; 'disabled' means nothing to test. */
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** `response.error` / thrown message, when the request actually ran. */
  error?: string;
  /** Explicit keyless loopback flag (Ollama, LM Studio). */
  keyless?: boolean;
}

/** `https://host.tld[/path]` — the only shape the compatible form accepts. */
function isHttpsUrl(url: string): boolean {
  return /^https:\/\/[^/\s]+\.[^/\s]+/.test(url);
}

/** Loopback endpoints are legitimately plain http (Ollama, LM Studio). */
export function isLocalBaseUrl(url: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(url);
}

/** One error string → the failure family, or null when it says nothing useful. */
export function classifyAiErrorText(message: string): AiErrorClass | null {
  const text = message.trim();
  if (!text) return null;
  if (/\b401\b/.test(text) || /unauthor/i.test(text)) return 'unauthorized';
  if (/\b403\b/.test(text) || /forbidden/i.test(text)) return 'forbidden';
  if (/\b404\b/.test(text) || /not found/i.test(text)) return 'notFound';
  if (/cors|cross-origin|blocked by client/i.test(text)) return 'cors';
  if (/fail(ed)? to fetch|networkerror|load failed|connection (refused|reset)/i.test(text)) return 'cors';
  if (/\b429\b/.test(text) || /rate.?limit|too many requests/i.test(text)) return 'rateLimited';
  if (/\btimeout\b|timed out|aborted|abort/i.test(text)) return 'timeout';
  if (/\b5\d{2}\b/.test(text) || /internal server|bad gateway|service unavailable/i.test(text)) return 'server';
  return null;
}

/**
 * The message the AI settings panel should show, or null to surface the raw
 * provider text (better than inventing a cause the classifier cannot prove).
 *
 * Preflight (no error yet) catches the form gaps the prototype caught; once an
 * error exists, the config checks still run first because they are certain.
 */
export function classifyAiTestError(input: AiTestInput): AiTestErrorKey | null {
  const { provider, model, error } = input;
  const apiKey = input.apiKey ?? '';
  if (provider === 'disabled') return null;

  const compatible = provider === 'openai-compatible';
  const url = (input.baseUrl ?? '').trim().replace(/\/+$/, '');
  const local = compatible && isLocalBaseUrl(url);
  const keyless = compatible && (input.keyless ?? local);
  const key = apiKey.trim();
  const noKey = key.length === 0 && !keyless;

  if (compatible) {
    // http:// on a non-loopback host never reaches the network.
    if (!isHttpsUrl(url) && !local) return 'aicompat.errUrl';
    if (!model.trim() || model === '__custom__') return 'aicompat.errModel';
  }
  if (noKey) return 'set.testErrNoKey';

  const body = (error ?? '').trim();
  if (body) {
    const kind = classifyAiErrorText(body);
    if (!kind) return null;
    if (compatible) {
      if (kind === 'unauthorized') return 'aicompat.err401';
      if (kind === 'notFound') return 'aicompat.err404';
      if (kind === 'cors') return 'aicompat.errCors';
      // 403 / 429 / 5xx / timeout: the provider text is more specific.
      return null;
    }
    if (kind === 'unauthorized' || kind === 'forbidden') return 'set.testErrInvalidKey';
    return null;
  }

  // No request yet: the prototype's placeholder-key rule. An EMPTY key on a
  // keyless loopback server is fine and never reaches this branch.
  if (key.length > 0 && key.length < MIN_AI_KEY_LENGTH) {
    return compatible ? 'aicompat.err401' : 'set.testErrInvalidKey';
  }
  return null;
}
