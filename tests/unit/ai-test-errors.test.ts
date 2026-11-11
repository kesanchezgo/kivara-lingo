/**
 * AI BYOK "test connection" classifier (`shared/ai-test-errors`).
 *
 * The panel must turn both a form gap and a raw provider error into the one
 * sentence the prototype showed. Pure function: no DOM, no store, no network —
 * keys are returned and the caller translates them.
 */
import { describe, expect, it } from 'vitest';
import {
  MIN_AI_KEY_LENGTH,
  classifyAiErrorText,
  classifyAiTestError,
  isLocalBaseUrl,
} from '../../src/shared/ai-test-errors';

const LONG_KEY = 'sk-' + 'a'.repeat(MIN_AI_KEY_LENGTH);

describe('classifyAiTestError — configuration gaps', () => {
  it('asks for the key when a hosted provider has none', () => {
    expect(classifyAiTestError({ provider: 'openai', apiKey: '', model: 'gpt-4o-mini' }))
      .toBe('set.testErrNoKey');
  });

  it('calls a placeholder-length key invalid', () => {
    expect(classifyAiTestError({ provider: 'openai', apiKey: 'sk-short', model: 'gpt-4o-mini' }))
      .toBe('set.testErrInvalidKey');
  });

  it('rejects a non-https base URL for the compatible provider', () => {
    expect(classifyAiTestError({
      provider: 'openai-compatible',
      apiKey: LONG_KEY,
      model: 'llama3.1:8b',
      baseUrl: 'ftp://models.local/v1',
    })).toBe('aicompat.errUrl');
  });

  it('asks for the model id when the compatible form has none', () => {
    expect(classifyAiTestError({
      provider: 'openai-compatible',
      apiKey: LONG_KEY,
      model: '',
      baseUrl: 'https://api.deepseek.com/v1',
    })).toBe('aicompat.errModel');
    expect(classifyAiTestError({
      provider: 'openai-compatible',
      apiKey: LONG_KEY,
      model: '__custom__',
      baseUrl: 'https://api.deepseek.com/v1',
    })).toBe('aicompat.errModel');
  });
});

describe('classifyAiTestError — provider answers', () => {
  it('reads a 401 from a hosted provider as an invalid key', () => {
    expect(classifyAiTestError({
      provider: 'openai',
      apiKey: LONG_KEY,
      model: 'gpt-4o-mini',
      error: 'HTTP 401 Unauthorized',
    })).toBe('set.testErrInvalidKey');
  });

  it('reads a 401 from a compatible endpoint with the compatible copy', () => {
    expect(classifyAiTestError({
      provider: 'openai-compatible',
      apiKey: LONG_KEY,
      model: 'llama3.1:8b',
      baseUrl: 'https://api.groq.com/openai/v1',
      error: 'HTTP 401 Unauthorized',
    })).toBe('aicompat.err401');
  });

  it('reads a 404 as a missing /v1 suffix', () => {
    expect(classifyAiTestError({
      provider: 'openai-compatible',
      apiKey: LONG_KEY,
      model: 'llama3.1:8b',
      baseUrl: 'https://api.mistral.ai/v1',
      error: 'HTTP 404 Not Found',
    })).toBe('aicompat.err404');
  });

  it('reads a blocked loopback request as CORS (keyless Ollama)', () => {
    expect(classifyAiTestError({
      provider: 'openai-compatible',
      apiKey: '',
      model: 'llama3.1:8b',
      baseUrl: 'http://localhost:11434/v1',
      error: 'Failed to fetch',
    })).toBe('aicompat.errCors');
  });

  it('leaves an unclassifiable provider message for the raw text', () => {
    expect(classifyAiTestError({
      provider: 'openai',
      apiKey: LONG_KEY,
      model: 'gpt-4o-mini',
      error: 'quota exceeded for this project',
    })).toBeNull();
  });

  it('does nothing for the disabled provider', () => {
    expect(classifyAiTestError({ provider: 'disabled', apiKey: '', model: '' })).toBeNull();
  });
});

describe('helpers', () => {
  it('recognises loopback endpoints', () => {
    expect(isLocalBaseUrl('http://localhost:11434/v1')).toBe(true);
    expect(isLocalBaseUrl('http://127.0.0.1:1234/v1')).toBe(true);
    expect(isLocalBaseUrl('https://api.openai.com/v1')).toBe(false);
  });

  it('maps raw text to a failure family', () => {
    expect(classifyAiErrorText('HTTP 403 Forbidden')).toBe('forbidden');
    expect(classifyAiErrorText('request aborted')).toBe('timeout');
    expect(classifyAiErrorText('HTTP 503 Service Unavailable')).toBe('server');
    expect(classifyAiErrorText('')).toBeNull();
  });
});