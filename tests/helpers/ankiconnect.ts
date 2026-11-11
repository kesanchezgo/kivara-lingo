/**
 * Shared AnkiConnect fake for tests.
 *
 * Replaces the per-test `vi.stubGlobal('fetch', ...)` stubs with one fake that
 * validates every request against the generated add-on fixture
 * (`tests/fixtures/ankiconnect-signatures.json`) BEFORE answering, so a test
 * can no longer invent an action, a parameter or a `tags` type the real
 * AnkiConnect does not accept. The `tags`-as-string rule is the exact contract
 * the review found broken (an array is rejected by the add-on).
 */
import { vi } from 'vitest';
import signatures from '../fixtures/ankiconnect-signatures.json';

export interface AnkiActionSignature {
  params: string[];
  optional?: string[];
}

export interface AnkiSignaturesFixture {
  _meta: {
    source: string;
    fetchedAt: string;
    sha256: string;
    note: string;
  };
  actions: Record<string, AnkiActionSignature>;
}

/** The generated fixture, typed. */
export const ANKICONNECT_SIGNATURES = signatures as AnkiSignaturesFixture;

export interface AnkiFakeCall {
  action: string;
  params: Record<string, unknown>;
  key?: string;
}

export interface AnkiFakeRejection {
  action: string;
  params: Record<string, unknown>;
  message: string;
}

export interface AnkiFakeOptions {
  /** Per-action answers. An action absent from the map resolves to `null`. */
  resolve?: Record<string, unknown> | ((action: string, params: Record<string, unknown>) => unknown);
}

export interface AnkiFake {
  calls: AnkiFakeCall[];
  rejections: AnkiFakeRejection[];
  restore: () => void;
}

interface AnkiRequestEnvelope {
  action?: string;
  params?: Record<string, unknown>;
  key?: string;
}

/**
 * Install a validating AnkiConnect fetch fake and return its recorded calls,
 * rejection log and a `restore()` that puts the previous global `fetch` back.
 */
export function createAnkiFake(options: AnkiFakeOptions = {}): AnkiFake {
  const calls: AnkiFakeCall[] = [];
  const rejections: AnkiFakeRejection[] = [];
  const resolveOption = options.resolve;

  const resolveValue = (action: string, params: Record<string, unknown>): unknown => {
    if (typeof resolveOption === 'function') return resolveOption(action, params);
    return resolveOption?.[action] ?? null;
  };

  const fakeFetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body ?? '{}')) as AnkiRequestEnvelope;
    const action = body.action ?? '';
    const params = body.params ?? {};

    const call: AnkiFakeCall = { action, params };
    if (body.key !== undefined) call.key = body.key;
    calls.push(call);

    const signature = ANKICONNECT_SIGNATURES.actions[action];
    let error: string | null = null;
    if (!signature) {
      error = `unsupported action: ${action}`;
    } else if ('tags' in params && typeof params.tags !== 'string') {
      error = 'tags must be a string';
    } else {
      const declared = new Set([...signature.params, ...(signature.optional ?? [])]);
      const unknown = Object.keys(params).find((param) => !declared.has(param));
      if (unknown) error = `unexpected param '${unknown}' for ${action}`;
    }

    if (error) rejections.push({ action, params, message: error });

    const envelope = error
      ? { result: null, error }
      : { result: resolveValue(action, params), error: null };
    return new Response(JSON.stringify(envelope), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const hadFetch = 'fetch' in globalThis;
  const originalFetch = globalThis.fetch;
  vi.stubGlobal('fetch', fakeFetch);

  const restore = (): void => {
    if (hadFetch) {
      globalThis.fetch = originalFetch;
    } else {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    }
  };

  return { calls, rejections, restore };
}