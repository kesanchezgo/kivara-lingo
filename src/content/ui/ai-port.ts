/**
 * Real `AiPort` for the content script (docs/REDESIGN-V2.md §4.2, §7 F7).
 *
 * The view never talks to a provider: it asks the service worker for
 * `AI_EXPLAIN_SENTENCE`, which owns the settings, the call (`callAiJson`) and
 * the Dexie `explain_cache`. The content script only carries the request, so
 * no key and no IndexedDB handle ever live on the page's side.
 */
import { sendMessage } from 'webext-bridge/content-script';
import type { AiPort } from '../../ui/ports/ai';
import type { AiExplainResponse } from '../../shared/types';

export function createAiPort(): AiPort {
  return {
    async explainSentence(input) {
      const response = (await sendMessage(
        'AI_EXPLAIN_SENTENCE',
        input,
        'background',
      )) as AiExplainResponse;
      if (!response.ok) throw new Error(response.error);
      return response.data;
    },
  };
}
