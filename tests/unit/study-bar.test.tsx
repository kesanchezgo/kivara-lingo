/**
 * StudyBar tooltips carry the shortcut combos (F6 · docs/REDESIGN-V2.md §7).
 *
 * The bar is the compact version of the rail's controls; a hint that shows the
 * action but not the key is the one thing the prototype's tooltips fixed.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { StudyBar, type StudyBarProps } from '../../src/content/ui/StudyBar';

beforeAll(() => {
  // happy-dom ships no ResizeObserver; the bar only uses it for the compact
  // breakpoint, so a no-op observer is enough for the tooltip assertions.
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
});

function props(overrides: Partial<StudyBarProps> = {}): StudyBarProps {
  return {
    enabled: true,
    playing: false,
    onTogglePlay: vi.fn(),
    onPrev: vi.fn(),
    onReplay: vi.fn(),
    onReplaySlow: vi.fn(),
    onNext: vi.fn(),
    autoPause: false,
    onToggleAutoPause: vi.fn(),
    loop: false,
    onToggleLoop: vi.fn(),
    speed: 1,
    onSpeed: vi.fn(),
    railOpen: false,
    onToggleRail: vi.fn(),
    panelOpen: false,
    onTogglePanel: vi.fn(),
    ...overrides,
  };
}

describe('StudyBar tooltips', () => {
  it('shows the combo for navigation, loop, speed and the column toggles', () => {
    const { container } = render(<StudyBar {...props()} />);
    const titles = Array.from(container.querySelectorAll('[title]')).map(
      (node) => node.getAttribute('title') ?? '',
    );
    expect(titles.some((title) => title.includes('Alt+A'))).toBe(true); // prev
    expect(titles.some((title) => title.includes('Alt+R'))).toBe(true); // replay
    expect(titles.some((title) => title.includes('Alt+Z'))).toBe(true); // next
    expect(titles.some((title) => title.includes('Alt+Q'))).toBe(true); // auto-pause
    expect(titles.some((title) => title.includes('Alt+L'))).toBe(true); // loop
    expect(titles.some((title) => title.includes('Alt+T'))).toBe(true); // transcript
    expect(titles.some((title) => title.includes('Alt+K'))).toBe(true); // panel
  });
});