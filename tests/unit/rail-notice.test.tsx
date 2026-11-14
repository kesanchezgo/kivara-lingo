/**
 * Point 2 — the rail renders the notice too. The overlay's notice is covered
 * end-to-end (no-subs-notice.spec.ts); this one pins the RAIL side, which the
 * e2e cannot reach deterministically (the rail's text channel only publishes
 * tab panels, and the view can be either).
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { TranscriptRail } from '../../src/content/ui/TranscriptRail';

const baseProps = {
  cues: [],
  activeIndex: -1,
  lang: 'en',
  study: {
    markWord: vi.fn(),
    markLine: vi.fn(),
    undoLine: vi.fn(),
    knowRest: vi.fn(),
  } as unknown as Parameters<typeof TranscriptRail>[0]['study'],
  newMarks: 'dotted' as const,
  savedWords: new Set<string>(),
  media: null,
  view: 'lines' as const,
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
  playing: false,
  pauseOnExplain: false,
  onStudyPause: vi.fn(),
  onStudyResume: vi.fn(),
  isDarkMode: false,
  onToggleDarkMode: vi.fn(),
  onClose: vi.fn(),
  panelOpen: false,
  onTogglePanel: vi.fn(),
  translation: 'visible' as const,
  onTranslationChange: vi.fn(),
  listenFirst: false,
  nativeCues: null,
  uiLang: 'es',
  nativeLang: 'es',
  explainRequest: 0,
  ai: {
    explainSentence: vi.fn().mockResolvedValue({
      meaning: 'm', grammar: 'g', expressions: [], sound: [],
    }),
  },
  noCuesNotice: true,
  noticePlatform: 'youtube',
};

describe('TranscriptRail: the no-subtitles notice', () => {
  it('renders the notice when there are no cues and the flag is on', () => {
    const { container } = render(<TranscriptRail {...baseProps} />);
    expect(container.textContent).toContain('No hay subtítulos activos');
    expect(container.textContent).toContain('reproductor de YouTube');
  });

  it('does not render it when cues exist', () => {
    const props = {
      ...baseProps,
      cues: [
        {
          start: 0,
          end: 3_000,
          text: 'Hello this is a test cue',
          tokens: [{ text: 'Hello', offset: 0, kind: 'word' as const }],
        },
      ],
      noCuesNotice: true,
    };
    const { container } = render(<TranscriptRail {...(props as unknown as Parameters<typeof TranscriptRail>[0])} />);
    expect(container.textContent).not.toContain('No hay subtítulos activos');
  });

  it('does not render it when the flag is off', () => {
    const { container } = render(<TranscriptRail {...(baseProps as unknown as Parameters<typeof TranscriptRail>[0])} noCuesNotice={false} />);
    expect(container.textContent).not.toContain('No hay subtítulos activos');
  });
});

