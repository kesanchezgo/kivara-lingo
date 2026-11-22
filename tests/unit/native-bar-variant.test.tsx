/**
 * RED TESTS — native StudyBar variant + inline slot (base main@b74ec17).
 */
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { StudyBar } from '../../src/content/ui/StudyBar';
import { t } from '../../src/shared/i18n';

const base = {
  enabled: true,
  platform: 'netflix' as const,
  playing: true,
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
};

describe('StudyBar variant="native"', () => {
  it('has NO Play/Pause button and NO 3-speed radiogroup at 1×', () => {
    render(<StudyBar {...base} variant="native" />);
    expect(screen.queryByLabelText(t('player.pause'))).toBeNull();
    expect(screen.queryByLabelText(t('player.play'))).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: t('rail.speed') })).toBeNull();
  });

  it('shows a single compact reset chip when speed != 1', () => {
    render(<StudyBar {...base} variant="native" speed={1.25} />);
    const chips = screen.getAllByText('1.25×');
    expect(chips.length).toBe(1);
  });

  it('the floating variant keeps the radiogroup and Play/Pause', () => {
    render(<StudyBar {...base} variant="floating" />);
    expect(screen.queryByLabelText(t('player.pause'))).not.toBeNull();
    expect(screen.queryByRole('radiogroup', { name: t('rail.speed') })).not.toBeNull();
  });
});
