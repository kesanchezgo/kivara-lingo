/**
 * Transcript rail: the click → seek wiring (F6 · docs/REDESIGN-V2.md §7).
 *
 * The rail lives inside the content script's CLOSED shadow root, which no
 * Playwright locator can enter, so this is where the interaction is asserted:
 * clicking a line (or pressing Enter on it) must call `onSeek` with that line's
 * index. The seek itself belongs to the PlaybackController and is covered by
 * `tests/unit/playback-controller.test.ts` and `tests/e2e/study-playback.spec.ts`.
 *
 * Rows are addressed as `[role="button"]`: their text is split into per-token
 * spans (the status marks), so `getByText` cannot match a whole line.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TranscriptRail, type TranscriptRailProps } from '../../src/content/ui/TranscriptRail';
import type { StudyBinding } from '../../src/content/ui/study';
import type { SubtitleCue } from '../../src/content/platform-adapters/types';

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

/** Only «rat» is new: exactly one i+1 line in the fixture. */
const oneNewStudy: StudyBinding = {
  ...study,
  statusOf: (key: string) => (key.toLowerCase() === 'rat' ? 'new' : 'known'),
};

function props(overrides: Partial<TranscriptRailProps> = {}): TranscriptRailProps {
  return {
    cues,
    activeIndex: 0,
    lang: 'en',
    study,
    newMarks: 'dotted',
    savedWords: new Set<string>(),
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

/** The three line rows: `role="button"` with a title, inside the scroll list. */
function lineRows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="button"][title]'));
}

describe('TranscriptRail', () => {
  it('seeks to the clicked line', () => {
    const onSeek = vi.fn();
    const { container } = render(<TranscriptRail {...props({ onSeek })} />);
    const rows = lineRows(container);
    expect(rows).toHaveLength(3);
    fireEvent.click(rows[1]);
    expect(onSeek).toHaveBeenCalledWith(1);
  });

  it('seeks with Enter on a focused line', () => {
    const onSeek = vi.fn();
    const { container } = render(<TranscriptRail {...props({ onSeek })} />);
    fireEvent.keyDown(lineRows(container)[2], { key: 'Enter' });
    expect(onSeek).toHaveBeenCalledWith(2);
  });

  it('filters to the single line with one new word', () => {
    const { container } = render(<TranscriptRail {...props({ study: oneNewStudy })} />);
    const oneNew = screen
      .getAllByRole('radio')
      .find((option) => /palabra nueva|new word/i.test(option.textContent ?? ''));
    expect(oneNew).toBeTruthy();
    fireEvent.click(oneNew!);
    const rows = lineRows(container);
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('rat');
  });
});
