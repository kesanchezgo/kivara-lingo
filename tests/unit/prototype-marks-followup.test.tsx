/**
 * RED TESTS — prototype fidelity follow-up (base main@cced9f0).
 *
 * Three Block A details that #161 left on the floor: compact status radios in
 * the word card must show the prototype's miniature marks on panel ink, the
 * read-only status block must use the same panel ink, and transcript lines
 * already passed by the playhead must carry `kvl-past` so their underlines
 * dim. Every assertion runs on rendered DOM; the click at the end of each case
 * keeps the cosmetic contract tied to real behaviour.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WordPopover, type WordPopoverProps } from '../../src/content/ui/WordPopover';
import { WordStatusSelector } from '../../src/content/ui/WordStatusSelector';
import { TranscriptRail, type TranscriptRailProps } from '../../src/content/ui/TranscriptRail';
import { MARK_INK } from '../../src/content/ui/wordMarks';
import type { StudyBinding } from '../../src/content/ui/study';
import type { SubtitleCue } from '../../src/content/platform-adapters/types';
import { t } from '../../src/shared/i18n';

const inkClasses = MARK_INK.trim().split(/\s+/);
function expectPanelInk(element: Element): void {
  for (const cls of inkClasses) expect(element.classList.contains(cls), `missing ink class ${cls}`).toBe(true);
}

const popoverProps: WordPopoverProps = {
  visible: true,
  onMouseEnter: () => {},
  onMouseLeave: () => {},
  token: 'run',
  lookupToken: 'run',
  sentence: 'She ran home.',
  sourceLang: 'en',
  includeAi: false,
  kind: 'unknown',
  lemma: 'run',
  isExpanded: false,
  isSaved: false,
  parentMWE: null,
  onToggleExpand: () => {},
  onRejoinParent: () => {},
  onSave: () => {},
} as unknown as WordPopoverProps;

const cues: SubtitleCue[] = [
  { id: 'a', start: 0, end: 3000, text: 'Hello there.', language: 'en' },
  { id: 'b', start: 3000, end: 6000, text: 'The rat ships frames.', language: 'en' },
  { id: 'c', start: 6000, end: 9000, text: 'Every crumb gets gnawed.', language: 'en' },
];

const study: StudyBinding = {
  statusOf: () => 'new',
  detailOf: () => ({ status: 'new', source: 'estimated' } as never),
  setStatus: vi.fn(),
  inAnki: () => false,
  userStatusOf: () => undefined,
};

function railProps(overrides: Partial<TranscriptRailProps> = {}): TranscriptRailProps {
  return {
    cues,
    activeIndex: 2,
    lang: 'en',
    study,
    newMarks: 'dotted',
    savedWords: new Set<string>(),
    nativeCues: null,
    translation: 'visible',
    onTranslationChange: vi.fn(),
    listenFirst: false,
    media: null,
    view: 'lines',
    onViewChange: vi.fn(),
    onSeek: vi.fn(),
    onReplay: vi.fn(),
    onReplaySlow: vi.fn(),
    autoPause: false,
    onToggleAutoPause: vi.fn(),
    loop: false,
    onToggleLoop: vi.fn(),
    speed: 1,
    onSpeed: vi.fn(),
    playing: true,
    pauseOnExplain: true,
    onStudyPause: vi.fn(),
    onStudyResume: vi.fn(),
    ai: null,
    uiLang: 'es',
    nativeLang: 'es',
    panelOpen: false,
    onTogglePanel: vi.fn(),
    isDarkMode: true,
    onToggleDarkMode: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe('prototype marks follow-up', () => {
  it('draws the prototype glyphs on panel ink inside the compact status radios', () => {
    const onWordStatus = vi.fn();
    render(<WordPopover {...popoverProps} wordStatus="new" onWordStatus={onWordStatus} />);

    const group = screen.getByRole('radiogroup');
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expectPanelInk(group);
    expect(radios[0].querySelector('.kvl-glyph')?.getAttribute('data-ws')).toBe('new');
    expect(radios[1].querySelector('.kvl-glyph')?.getAttribute('data-ws')).toBe('learning');
    expect(radios[2].querySelector('.kvl-glyph')).toBeNull();

    fireEvent.click(radios[2]);
    expect(onWordStatus).toHaveBeenCalledWith('known');
  });

  it('keeps panel ink on the read-only status block of the word card', () => {
    render(
      <WordStatusSelector
        token="run"
        status="learning"
        isSaved
        readOnly
        onChange={vi.fn()}
        onClear={vi.fn()}
      />,
    );

    const block = screen.getByTitle(t('ws.label'));
    expectPanelInk(block);
    expect(block.querySelectorAll('.kvl-glyph')).toHaveLength(1);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('dims past transcript lines with kvl-past while keeping them clickable', () => {
    const onSeek = vi.fn();
    const { container } = render(<TranscriptRail {...railProps({ onSeek })} />);
    const lines = Array.from(container.querySelectorAll<HTMLElement>('[data-kvl-cue] p[data-new-marks]'));
    expect(lines).toHaveLength(3);
    expect(lines[0].classList.contains('kvl-past')).toBe(true);
    expect(lines[1].classList.contains('kvl-past')).toBe(true);
    expect(lines[2].classList.contains('kvl-past')).toBe(false);

    const row = container.querySelector<HTMLElement>('[data-kvl-cue="0"] [role="button"]')!;
    fireEvent.click(row);
    expect(onSeek).toHaveBeenCalledWith(0);
  });
});
