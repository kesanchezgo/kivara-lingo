/**
 * RED TEST — round 10: the AI block's separator reaches the card edges. Its
 * own px-3.5 stacked on the scroll body's px-3.5 indented the content 28 px
 * and cut the border-t short; the block is now full-bleed via negative
 * margin while the content stays aligned with the rest of the body.
 */
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { WordPopover, type WordPopoverProps } from '../../src/content/ui/WordPopover';

vi.mock('../../src/content/resolve-word-stream', () => ({
  // A stream that NEVER answers: aiLoading stays true, which is what renders
  // the AI block.
  openResolveWordStream: () => ({ close: () => {} }),
}));

const BASE_PROPS = {
  visible: true,
  onMouseEnter: () => {},
  onMouseLeave: () => {},
  token: 'able',
  lookupToken: 'able',
  sentence: 'She is able to swim.',
  sourceLang: 'en',
  includeAi: true,
  kind: 'word',
  lemma: 'able',
  isExpanded: false,
  isSaved: false,
  parentMWE: null,
  onToggleExpand: () => {},
  onRejoinParent: () => {},
  onSave: () => {},
} as unknown as WordPopoverProps;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the AI block is full-bleed', () => {
  it('its border-t spans the card and the content keeps one padding layer', async () => {
    render(<WordPopover {...BASE_PROPS} />);
    await waitFor(() => {
      const block = document.querySelector('[data-kvl-ai-block]');
      expect(block).not.toBeNull();
      const cls = (block as HTMLElement).className;
      expect(cls).toContain('-mx-3.5');
      expect(cls).toContain('px-3.5');
    });
  });
});
