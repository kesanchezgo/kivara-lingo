/**
 * perm.groupAiHint names the OpenAI-compatible endpoints (close-out point 4b).
 *
 * The AI group grants more than the three first-party hosts: the curated
 * `openai-compatible` origins (OpenRouter, Groq, DeepSeek, Mistral, Together,
 * x.AI) and the loopback entries local servers like Ollama and LM Studio run
 * on. The hint is the only copy that tells a BYOK user what the switch
 * actually unlocks, in BOTH locales.
 */
import { describe, it, expect } from 'vitest';
import { ALL_MESSAGES } from '../../src/shared/i18n';

describe('perm.groupAiHint', () => {
  it('mentions the OpenAI-compatible endpoints in both locales', () => {
    for (const locale of ['es', 'en'] as const) {
      const hint = ALL_MESSAGES[locale]['perm.groupAiHint'];
      expect(hint, `${locale} copy`).toContain('compatible');
      // The curated compatible list the group requests.
      expect(hint, `${locale} copy`).toContain('OpenRouter');
      expect(hint, `${locale} copy`).toContain('Groq');
      // The loopback hosts local runners (Ollama, LM Studio) listen on.
      expect(hint, `${locale} copy`).toContain('Ollama');
    }
  });
});
