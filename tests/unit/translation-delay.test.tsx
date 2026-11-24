/**
 * RED TEST — the secondary caption must not wait for a TRANSLATE round trip
 * when App already prefetched that cue. The request is mocked to hang: a
 * synchronous read from the prefetch cache must still paint on first render.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sendMessage = vi.fn();
vi.mock('webext-bridge/content-script', () => ({ sendMessage: (...args: unknown[]) => sendMessage(...args) }));

import { SubtitleOverlay } from '../../src/content/ui/SubtitleOverlay';
import { rememberTranslation } from '../../src/content/ui/translation-cache';
import { useKivaraStore } from '../../src/shared/use-kivara-store';

afterEach(() => {
  cleanup();
  sendMessage.mockReset();
});

const CUE = { id: 'c0', text: 'Primary line', start: 0, end: 3000, language: 'en' };

function overlay() {
  return (
    <div data-popover-boundary>
      <SubtitleOverlay
        subtitleStyles={{
          keepNativeLineBreaks: false,
          keepNativeAlignment: false,
          fontSize: 20,
          color: '#fff',
          bgOpacity: 0.7,
          position: 'bottom',
          fontWeight: 500,
        } as never}
        cue={CUE}
        altCue={null}
        mode="learning"
        saveRequestKey={0}
        onSaveCard={vi.fn(async () => ({ ok: true, noteId: 1 }))}
        onTokenHoverChange={() => {}}
        initialSavedWords={new Set<string>()}
        study={{
          statusOf: () => 'known' as const,
          detailOf: () => ({ status: 'known', source: 'estimated' } as never),
          setStatus: () => {},
          inAnki: () => false,
          userStatusOf: () => undefined,
        } as never}
      />
    </div>
  );
}

describe('dual caption timing', () => {
  it('paints a prefetched translation on the first frame without a round trip', () => {
    useKivaraStore.setState({ study: { ...useKivaraStore.getState().study, translation: 'visible' } });
    rememberTranslation('Primary line', 'en', 'es', {
      ok: true,
      translatedText: 'Línea secundaria',
    } as never);
    sendMessage.mockImplementation(() => new Promise(() => {}));

    render(overlay());
    // No waitFor: the prefetched line must be in the FIRST painted frame.
    expect(document.querySelector('[data-kivara-dual]')?.textContent).toContain('Línea secundaria');
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
