/**
 * PR #171 · 2 + 4 — the top bar and the skip prompt, plus the one-implementation
 * rule for the badges (they live in exactly ONE place per platform).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PlayerTopBar } from '../../src/content/ui/PlayerTopBar';
import { PlayerSkipPrompt } from '../../src/content/ui/PlayerSkipPrompt';
import { StudyBadges } from '../../src/content/ui/StudyBadges';
import { SubtitleOverlay } from '../../src/content/ui/SubtitleOverlay';
import { t } from '../../src/shared/i18n';
import { useKivaraStore } from '../../src/shared/use-kivara-store';
import type { StudyBinding } from '../../src/content/ui/study';

const CUE = { id: 'c1', text: 'the quick fox jumps', start: 0, end: 3000, language: 'en' };

const study: StudyBinding = {
  statusOf: () => 'new',
  detailOf: () => ({ status: 'new' }) as never,
  setStatus: () => {},
  inAnki: () => false,
  userStatusOf: () => undefined,
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.useRealTimers();
  useKivaraStore.setState({ mode: 'learning', study: { ...useKivaraStore.getState().study, listenFirst: false } });
});

const badgesProps = () => ({ expandedMWEs: new Set<string>(), onRejoinAll: vi.fn() });

describe('PR #171 · the top bar', () => {
  it('carries the way back, the title and the study badges', () => {
    const { container } = render(
      <PlayerTopBar visible title="Stranger Things" subtitle="T1 E8 · Chapter Eight" {...badgesProps()} />,
    );
    const bar = container.querySelector<HTMLElement>('[data-kvl-player-top]')!;
    expect(bar).not.toBeNull();
    const back = screen.getByRole('button', { name: t('player.back') });
    expect(back.getAttribute('data-kvl-top-back')).not.toBeNull();
    expect(bar.textContent).toContain('Stranger Things');
    expect(bar.textContent).toContain('T1 E8');
    // The three badges (by the name a user reads; the E2E marker rides along
    // in the instrumented build only).
    expect(screen.getByRole('button', { name: t('listen.title') })).not.toBeNull();
    expect(screen.getByRole('button', { name: t('subs.modeLearning') })).not.toBeNull();
  });

  it('fades out with the tray and comes back with it', () => {
    const { container, rerender } = render(<PlayerTopBar visible={false} title="X" {...badgesProps()} />);
    const bar = () => container.querySelector<HTMLElement>('[data-kvl-player-top]')!;
    expect(bar().className).toContain('opacity-0');
    expect(bar().hasAttribute('data-kvl-top-hidden')).toBe(true);
    rerender(<PlayerTopBar visible title="X" {...badgesProps()} />);
    expect(bar().className).toContain('opacity-100');
    expect(bar().hasAttribute('data-kvl-top-hidden')).toBe(false);
  });

  it('clicks the site\'s own back control, falling back to history only if it did not navigate', () => {
    vi.useFakeTimers();
    const native = document.createElement('button');
    native.setAttribute('data-uia', 'control-nav-back');
    const nativeClicked = vi.fn();
    native.addEventListener('click', nativeClicked);
    document.body.appendChild(native);
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});

    render(<PlayerTopBar visible title="X" {...badgesProps()} />);
    fireEvent.click(screen.getByRole('button', { name: t('player.back') }));
    expect(nativeClicked, 'the site control is the first path').toHaveBeenCalledTimes(1);
    // The URL did not move: 180 ms later we take over.
    act(() => { vi.advanceTimersByTime(200); });
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('keeps the badges even when the title is unknown', () => {
    const { container } = render(<PlayerTopBar visible title={null} {...badgesProps()} />);
    const bar = container.querySelector<HTMLElement>('[data-kvl-player-top]')!;
    expect(screen.getByRole('button', { name: t('subs.modeLearning') })).not.toBeNull();
    // No stray separator when there is no detail line.
    expect(bar.textContent).not.toContain('·');
  });
});

describe('PR #171 · the skip prompt', () => {
  it('appears for a native contextual button and forwards the click to it', () => {
    const native = document.createElement('button');
    native.setAttribute('data-uia', 'player-skip-intro');
    native.textContent = 'Saltar intro';
    const nativeClicked = vi.fn();
    native.addEventListener('click', nativeClicked);
    document.body.appendChild(native);

    const { container } = render(<PlayerSkipPrompt visible />);
    const pill = container.querySelector<HTMLElement>('[data-kvl-skip-prompt]');
    expect(pill, 'the pill replaces the hidden native button').not.toBeNull();
    expect(pill!.textContent).toContain('Saltar intro');
    fireEvent.click(pill!);
    expect(nativeClicked).toHaveBeenCalledTimes(1);
  });

  it('disappears with the native button, while capturing, and with the tray', async () => {
    const native = document.createElement('button');
    native.setAttribute('data-uia', 'player-skip-recap');
    native.textContent = 'Saltar resumen';
    document.body.appendChild(native);
    const { container, rerender } = render(<PlayerSkipPrompt visible />);
    expect(container.querySelector('[data-kvl-skip-prompt]')).not.toBeNull();

    rerender(<PlayerSkipPrompt visible capturing />);
    expect(container.querySelector('[data-kvl-skip-prompt]'), 'a capture takes a clean frame').toBeNull();

    rerender(<PlayerSkipPrompt visible={false} />);
    expect(container.querySelector('[data-kvl-skip-prompt]')).toBeNull();

    rerender(<PlayerSkipPrompt visible />);
    native.remove();
    // The observer sees the removal on the next microtask, not synchronously.
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-kvl-skip-prompt]'), 'gone with the native node').toBeNull();
  });
});

describe('PR #171 · one badge group per platform', () => {
  it('the overlay renders them, unless the owned bar hosts them', () => {
    const renderOverlay = (hideCornerBadges: boolean) => render(
      <div data-popover-boundary>
        <SubtitleOverlay
          subtitleStyles={{ keepNativeLineBreaks: false } as never}
          cue={CUE}
          altCue={null}
          mode="learning"
          saveRequestKey={null}
          onSaveCard={vi.fn(async () => ({ ok: true }))}
          onTokenHoverChange={() => {}}
          initialSavedWords={new Set()}
          playing={false}
          study={study}
          hideCornerBadges={hideCornerBadges}
        />
      </div>,
    );
    const first = renderOverlay(false);
    expect(screen.queryByRole('button', { name: t('subs.modeLearning') }), 'the overlay shows them').not.toBeNull();
    cleanup();
    renderOverlay(true);
    expect(screen.queryByRole('button', { name: t('subs.modeLearning') }), 'the top bar has them').toBeNull();
  });

  it('renders the rejoin badge only while expressions are joined and not reading', () => {
    const { rerender } = render(
      <StudyBadges expandedMWEs={new Set(['a'])} onRejoinAll={vi.fn()} listenFirst={false} onToggleListenFirst={vi.fn()} reading={false} onToggleMode={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: t('ovl.joinMwe') }), 'joined expressions offer the undo').not.toBeNull();
    rerender(
      <StudyBadges expandedMWEs={new Set(['a'])} onRejoinAll={vi.fn()} listenFirst={false} onToggleListenFirst={vi.fn()} reading onToggleMode={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: t('ovl.joinMwe') }), 'nothing to join in Reading').toBeNull();
  });
});
