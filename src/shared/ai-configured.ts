/**
 * "Is the AI usable right now?" (docs/REDESIGN-V2.md §7 F6: the Explain
 * sentence action only renders when AI is configured).
 *
 * Pure and dependency-free so the transcript rail, the study bar and the
 * future F7 client all agree on the same predicate. A provider preset with no
 * key is NOT configured: the button would open a call that can only fail.
 */
import type { AiSettings } from './types';

export function aiConfigured(ai: Pick<AiSettings, 'provider' | 'apiKey'> | null | undefined): boolean {
  if (!ai) return false;
  if (!ai.provider || ai.provider === 'disabled') return false;
  return Boolean(ai.apiKey && ai.apiKey.trim());
}