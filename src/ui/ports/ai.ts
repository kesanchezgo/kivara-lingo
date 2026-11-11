/**
 * AiPort — the "explain this sentence" boundary (docs/REDESIGN-V2.md §4.2, §4.6).
 *
 * The view never talks to a provider: `AI_EXPLAIN_SENTENCE` goes over
 * `webext-bridge` to the service worker, which owns the settings, the call
 * (`callAiJson`) and the Dexie `explain_cache`. The real client lives in
 * `content/ui/ai-port.ts`; this module is the contract both sides speak.
 *
 * Type-only imports by design: `src/ui/**` must not pull runtime code from
 * `chrome.*` or `../shared/db`.
 */
import type { AiExplainRequest, SentenceExplanation } from '../../shared/types';

export interface AiPort {
  /** Explain a subtitle line using its neighbours as context. */
  explainSentence(input: AiExplainRequest): Promise<SentenceExplanation>;
}