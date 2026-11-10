/**
 * AiPort — the "explain this sentence" boundary (docs/REDESIGN-V2.md §4.2, §4.6).
 *
 * Replaces the prototype's `data/sentenceExplain.ts`. Phase F7 replaces the stub
 * factory below with the real client: `AI_EXPLAIN_SENTENCE` over
 * `webext-bridge` to the service worker (`callAiJson`), cached in Dexie's
 * `explain_cache` with TTL `ai.cacheTtlDays`.
 */
import type { ExplainSentenceInput, SentenceExplanation } from './types';

export interface AiPort {
  /** Explain a subtitle line using its neighbours as context. */
  explainSentence(input: ExplainSentenceInput): Promise<SentenceExplanation>;
}

/**
 * Build an AiPort from the injected engine. This is a thin F7 stub: it only
 * forwards the call, so the view tree can mount before the real client lands.
 *
 * @deprecated Phase F7 replaces this factory with the real AI explain client.
 */
export function createAiPort(engine: AiPort): AiPort {
  return {
    explainSentence: (input) => engine.explainSentence(input),
  };
}
