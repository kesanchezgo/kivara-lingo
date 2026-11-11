/**
 * Gemini thinking budget per model (issue #37).
 *
 * Gemini 2.5 Pro cannot disable reasoning: `thinkingConfig.thinkingBudget: 0`
 * is answered with a 400, which broke BOTH paths that reach Gemini — the
 * enrichment call (`callAiProvider`) and "Explain sentence" (`callAiJson`).
 * Flash and Flash-Lite accept 0 and that is what these short structured-JSON
 * prompts want. These tests assert the outgoing request body per model and
 * per path, with a fake fetch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiSettings, AiEnrichRequest } from '../../src/shared/types';

const BASE: AiSettings = {
  provider: 'google-ai',
  apiKey: 'k',
  model: 'gemini-2.5-flash',
  enrichOnSave: false,
  enrichOnHover: false,
  cacheTtlDays: 30,
  preferAiMnemonic: true,
  preferAiEtymology: true,
  enableDalleFallback: false,
};

const EXPLANATION = JSON.stringify({ meaning: 'm', grammar: 'g', expressions: [], sound: [] });

const ENRICH_REQUEST: AiEnrichRequest = {
  token: 'sane',
  sentence: 'It is sane.',
  sourceLang: 'en',
  nativeLang: 'es',
};

function geminiEnvelope(text: string): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** Stubs fetch and returns every request body it saw, in order. */
function captureFetch(text = EXPLANATION): Array<Record<string, unknown>> {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return geminiEnvelope(text);
    }),
  );
  return bodies;
}

function generationConfig(body: Record<string, unknown>): Record<string, unknown> {
  return body.generationConfig as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Gemini thinking budget — callAiJson (Explain sentence)', () => {
  it.each(['gemini-2.5-flash', 'gemini-2.5-flash-lite'])(
    '%s asks for zero thinking',
    async (model) => {
      const bodies = captureFetch();
      const { callAiJson } = await import('../../src/background/ai-providers');
      await callAiJson({ system: 's', input: { line: 'x' } }, { ...BASE, model });
      expect(generationConfig(bodies[0]).thinkingConfig).toEqual({ thinkingBudget: 0 });
    },
  );

  it('gemini-2.5-pro OMITS thinkingConfig (budget 0 is a 400 there)', async () => {
    const bodies = captureFetch();
    const { callAiJson } = await import('../../src/background/ai-providers');
    await callAiJson({ system: 's', input: { line: 'x' } }, { ...BASE, model: 'gemini-2.5-pro' });
    expect('thinkingConfig' in generationConfig(bodies[0])).toBe(false);
  });
});

describe('Gemini thinking budget — callAiProvider (enrichment)', () => {
  it.each(['gemini-2.5-flash', 'gemini-2.5-flash-lite'])(
    '%s asks for zero thinking',
    async (model) => {
      const bodies = captureFetch();
      const { callAiProvider } = await import('../../src/background/ai-providers');
      await callAiProvider(ENRICH_REQUEST, { ...BASE, model });
      expect(generationConfig(bodies[0]).thinkingConfig).toEqual({ thinkingBudget: 0 });
    },
  );

  it('gemini-2.5-pro OMITS thinkingConfig (budget 0 is a 400 there)', async () => {
    const bodies = captureFetch();
    const { callAiProvider } = await import('../../src/background/ai-providers');
    await callAiProvider(ENRICH_REQUEST, { ...BASE, model: 'gemini-2.5-pro' });
    expect('thinkingConfig' in generationConfig(bodies[0])).toBe(false);
  });
});
