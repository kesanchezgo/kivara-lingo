/**
 * "Is the AI usable right now?" (docs/REDESIGN-V2.md §7 F6/F7: the Explain
 * sentence action only renders when AI is configured).
 *
 * Pure and dependency-free apart from the curated-host check, so the
 * transcript rail, the study bar, the overlay and the F7 client all agree on
 * the same predicate. A provider preset with no key is NOT configured — the
 * button would open a call that can only fail. The one exception is a
 * curated loopback endpoint (Ollama, LM Studio), which is keyless by design.
 */
import { compatibleHostFor } from './provider-hosts';
import type { AiSettings } from './types';

export function aiConfigured(
  ai: Pick<AiSettings, 'provider' | 'apiKey' | 'baseUrl'> | null | undefined,
): boolean {
  if (!ai) return false;
  if (!ai.provider || ai.provider === 'disabled') return false;
  if (ai.provider === 'openai-compatible') {
    const host = compatibleHostFor(ai.baseUrl ?? '');
    if (!host) return false;
    // Only the loopback patterns are http; hosted endpoints need a key.
    return host.startsWith('http://') || Boolean(ai.apiKey && ai.apiKey.trim());
  }
  return Boolean(ai.apiKey && ai.apiKey.trim());
}