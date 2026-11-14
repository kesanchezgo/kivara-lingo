/**
 * Completing #114 — the card must not query in the wrong language.
 *
 * With the track in Spanish and the learner on English, the word card used to
 * open an English lookup: an English dictionary for a Spanish word, which
 * reads as a broken app. The card now shows the mismatch and never opens the
 * resolve stream.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const streamSpy = vi.hoisted(() => vi.fn(() => ({ close: () => {} })));

vi.mock('../../src/content/resolve-word-stream', () => ({
  openResolveWordStream: streamSpy,
}));

import { WordPopover } from '../../src/content/ui/WordPopover';

const baseProps = {
  visible: true,
  onMouseEnter: () => {},
  onMouseLeave: () => {},
  token: 'taxista',
  sentence: 'El taxista dijo que ya está en la ciudad.',
  sourceLang: 'es',
  includeAi: false,
  kind: 'unknown' as const,
  isExpanded: false,
  isSaved: false,
  parentMWE: null,
  onToggleExpand: () => {},
  onRejoinParent: () => {},
  onSave: () => {},
};

describe('WordPopover with a language mismatch', () => {
  it('shows the mismatch and opens no lookup stream', () => {
    streamSpy.mockClear();
    render(<WordPopover {...baseProps} languageMismatch={{ track: 'es', learning: 'en' }} />);
    expect(screen.getByText(/estás aprendiendo|you are learning/i)).toBeTruthy();
    expect(streamSpy).not.toHaveBeenCalled();
  });

  it('still resolves normally when the languages agree', () => {
    streamSpy.mockClear();
    render(<WordPopover {...baseProps} />);
    expect(streamSpy).toHaveBeenCalled();
  });
});
