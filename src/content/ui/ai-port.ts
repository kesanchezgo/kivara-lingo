/**
 * The "Explain sentence" port for F6 (docs/REDESIGN-V2.md §7 F6/F7).
 *
 * F6 ships the view and the wiring: the button appears only when
 * `aiConfigured(store.ai)` is true, and pressing it calls this port. The
 * request itself is F7 (`AI_EXPLAIN_SENTENCE`, `callAiJson`, Dexie
 * `explain_cache`). Until then the port answers with a typed, named error so
 * the view shows a legible message instead of a spinner that never resolves.
 *
 * Replacing this file with the real client is the whole F7 connection — the
 * view does not change.
 */
import type { AiPort } from '../../ui/ports/ai';

/** Stable error message: tests and logs can assert on this exact string. */
export const AI_EXPLAIN_NOT_IMPLEMENTED = 'AI explain is implemented in F7';

export function createInertAiPort(): AiPort {
  return {
    explainSentence() {
      return Promise.reject(new Error(AI_EXPLAIN_NOT_IMPLEMENTED));
    },
  };
}