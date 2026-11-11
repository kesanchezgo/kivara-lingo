/**
 * "Explain sentence" error surface (docs/REDESIGN-V2.md §5.1).
 *
 * The worker answers `AI_EXPLAIN_SENTENCE` with `{ ok: false, error }`, and
 * `content/ui/ai-port.ts` turns that into a rejected promise. The card must
 * show the worker's own reason as the detail — the localized line alone left
 * the user with "could not be explained" and nothing to act on.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SentenceExplain } from '../../src/content/ui/SentenceExplain';
import type { AiPort } from '../../src/ui/ports/ai';
import type { SubtitleCue } from '../../src/content/platform-adapters/types';
import { t } from '../../src/shared/i18n';

const CUE: SubtitleCue = {
  id: 'c1',
  start: 0,
  end: 2000,
  text: 'It keeps her sane.',
  language: 'en',
};

const WORKER_ERROR = 'AI_EXPLAIN_SENTENCE: upstream 429 (rate limited)';

function failingAi(): AiPort {
  return { explainSentence: vi.fn().mockRejectedValue(new Error(WORKER_ERROR)) };
}

afterEach(() => cleanup());

describe('SentenceExplain error state', () => {
  it("shows the worker's message under the localized title", async () => {
    render(
      <SentenceExplain
        id="explain-1"
        cue={CUE}
        lang="en"
        uiLang="es"
        nativeLang="es"
        ai={failingAi()}
        onClose={() => {}}
      />,
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t('explain.error'));
    expect(alert.textContent).toContain(WORKER_ERROR);
  });
});
