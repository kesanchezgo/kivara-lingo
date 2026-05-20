/**
 * Unit tests for the curated AI provider presets used by Settings → BYOK.
 *
 * Pure helpers — no IndexedDB / fetch / React.
 */
import { describe, expect, it } from 'vitest';
import {
  AI_PRESETS,
  getAiPreset,
  pickModelForProvider,
} from '../../src/shared/ai-presets';

describe('AI_PRESETS', () => {
  it('exposes the three configurable providers in priority order', () => {
    expect(AI_PRESETS.map((p) => p.provider)).toEqual([
      'google-ai',
      'anthropic',
      'openai',
    ]);
  });

  it('marks Gemini as the recommended free-tier default', () => {
    const recommended = AI_PRESETS.filter((p) => p.recommended);
    expect(recommended).toHaveLength(1);
    expect(recommended[0].provider).toBe('google-ai');
    expect(recommended[0].hasFreeTier).toBe(true);
  });

  it('flags free-tier availability per provider', () => {
    const byProvider = Object.fromEntries(AI_PRESETS.map((p) => [p.provider, p]));
    expect(byProvider['google-ai'].hasFreeTier).toBe(true);
    expect(byProvider.anthropic.hasFreeTier).toBe(true);
    expect(byProvider.openai.hasFreeTier).toBe(false);
  });

  it('uses unique provider ids and https get-key urls', () => {
    const seen = new Set<string>();
    for (const preset of AI_PRESETS) {
      expect(seen.has(preset.provider)).toBe(false);
      seen.add(preset.provider);
      expect(preset.getKeyUrl).toMatch(/^https:\/\//);
      expect(preset.defaultModel.length).toBeGreaterThan(0);
    }
  });
});

describe('getAiPreset', () => {
  it('returns the matching preset for a configurable provider', () => {
    expect(getAiPreset('openai')?.label).toBe('OpenAI');
    expect(getAiPreset('anthropic')?.label).toBe('Anthropic Claude');
    expect(getAiPreset('google-ai')?.label).toBe('Google Gemini');
  });

  it('returns undefined for the disabled provider', () => {
    expect(getAiPreset('disabled')).toBeUndefined();
  });
});

describe('pickModelForProvider', () => {
  it('falls back to the preset default when the current model is empty', () => {
    expect(pickModelForProvider('openai', '')).toBe('gpt-4o-mini');
    expect(pickModelForProvider('anthropic', '')).toBe('claude-3-5-haiku-latest');
    expect(pickModelForProvider('google-ai', '')).toBe('gemini-1.5-flash');
  });

  it('preserves a model id that already matches the new provider naming', () => {
    expect(pickModelForProvider('openai', 'gpt-5-turbo')).toBe('gpt-5-turbo');
    expect(pickModelForProvider('openai', 'o1-mini')).toBe('o1-mini');
    expect(pickModelForProvider('anthropic', 'claude-4-opus')).toBe('claude-4-opus');
    expect(pickModelForProvider('google-ai', 'gemini-2.0-pro')).toBe('gemini-2.0-pro');
    expect(pickModelForProvider('google-ai', 'models/gemini-1.5-flash')).toBe(
      'models/gemini-1.5-flash',
    );
  });

  it('replaces a mismatched model id with the new provider default', () => {
    expect(pickModelForProvider('openai', 'gemini-1.5-flash')).toBe('gpt-4o-mini');
    expect(pickModelForProvider('anthropic', 'gpt-4o-mini')).toBe('claude-3-5-haiku-latest');
    expect(pickModelForProvider('google-ai', 'claude-3-5-sonnet')).toBe('gemini-1.5-flash');
  });

  it('trims surrounding whitespace before deciding', () => {
    expect(pickModelForProvider('openai', '   ')).toBe('gpt-4o-mini');
    expect(pickModelForProvider('openai', '  gpt-4o-mini  ')).toBe('gpt-4o-mini');
  });

  it('is case-insensitive when matching prefixes', () => {
    expect(pickModelForProvider('openai', 'GPT-4o-mini')).toBe('GPT-4o-mini');
    expect(pickModelForProvider('anthropic', 'Claude-3-5-Haiku')).toBe('Claude-3-5-Haiku');
  });
});
