/**
 * PR #171 · 3 — the modern PlayerBar: floating tray, three zones, a real seek
 * bar, Kivara volume, ±10 s, hours and fullscreen.
 *
 * Every contract the earlier PRs pinned is preserved on purpose: the hidden
 * `role="slider"` volume input (`fireEvent.change`), the measured height the
 * caption lifts by, the auto-hide and the native-popup yield.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OWNED_BAR_BOTTOM_OFFSET_PX, PlayerBar } from '../../src/content/ui/PlayerBar';
import { t } from '../../src/shared/i18n';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const barProps = () => ({
  playing: true,
  duration: 3_725_000, // 1:02:05 — over an hour, so the format has to fold
  autoPauseCue: false,
  loopCue: false,
  speed: 1,
  railOpen: false,
  panelOpen: false,
  onTogglePlay: vi.fn(),
  onPrev: vi.fn(),
  onReplay: vi.fn(),
  onReplaySlow: vi.fn(),
  onNext: vi.fn(),
  onToggleAutoPause: vi.fn(),
  onToggleLoop: vi.fn(),
  onSpeed: vi.fn(),
  onToggleRail: vi.fn(),
  onTogglePanel: vi.fn(),
  onSeek: vi.fn(),
  onWakeNative: vi.fn(),
});

const byLabel = (label: string) => screen.getByRole('button', { name: label });

describe('PR #171 · the floating tray', () => {
  it('is the modern dock: inset, rounded, blurred, above the bottom edge', () => {
    const { container } = render(<PlayerBar {...barProps()} />);
    const bar = container.querySelector<HTMLElement>('[data-kvl-player-bar]')!;
    expect(bar.className).toContain('inset-x-4');
    expect(bar.className).toContain('bottom-3');
    expect(bar.className).toContain('rounded-2xl');
    expect(bar.className).toContain('backdrop-blur-xl');
    expect(bar.className).toContain('bg-zinc-950/85');
    // The caption needs to clear the 12px gap under the tray: App adds it, and
    // the constant is exported so App and the tests share one number.
    expect(OWNED_BAR_BOTTOM_OFFSET_PX).toBe(12);
  });

  it('lays the controls out in the three balanced zones', () => {
    const { container } = render(<PlayerBar {...barProps()} />);
    const row = container.querySelector<HTMLElement>('[data-kvl-player-row]')!;
    expect(row.className, 'the three-zone grid').toContain('grid-cols-[1fr_auto_1fr]');
    const capsule = container.querySelector<HTMLElement>('[data-kvl-study-capsule]');
    expect(capsule, 'the study capsule is its own landmark').not.toBeNull();
    // The capsule holds the study controls: prev/replay/next, both chips, 3 speeds.
    expect(capsule!.querySelectorAll('[role="radio"]')).toHaveLength(3);
    expect(capsule!.textContent).toContain(t('rail.autoPauseShort'));
    expect(capsule!.textContent).toContain(t('rail.loop'));
  });
});

describe('PR #171 · ±10 s through the platform, never the element', () => {
  it('seeks back and forward ten seconds with the adapter seek', () => {
    const onSeek = vi.fn();
    const video = document.createElement('video');
    let wroteTime = 0;
    Object.defineProperty(video, 'currentTime', {
      get: () => 0,
      set: (value: number) => { wroteTime += 1; void value; },
      configurable: true,
    });
    render(<PlayerBar {...barProps()} video={video} onSeek={onSeek} />);

    fireEvent.click(byLabel(t('player.forward10')));
    expect(onSeek, 'forward ten seconds through the controller').toHaveBeenCalledWith(10_000);
    fireEvent.click(byLabel(t('player.back10')));
    expect(onSeek, 'and back, clamped at zero').toHaveBeenCalledWith(0);
    expect(wroteTime, 'the element is never written directly').toBe(0);
  });
});

describe('PR #171 · the seek bar', () => {
  it('shows a real buffer fill behind the head', () => {
    const { container } = render(<PlayerBar {...barProps()} />);
    const bar = container.querySelector<HTMLElement>('[data-kvl-player-bar]')!;
    const track = bar.querySelector<HTMLElement>('[role="slider"][aria-label="' + t('player.seek') + '"]')!;
    expect(track.className).toContain('h-1.5');
    expect(track.querySelector('[data-kvl-seek-buffer]'), 'the buffered fill exists').not.toBeNull();
    expect(track.querySelector('[data-kvl-seek-progress]'), 'and the progress fill').not.toBeNull();
  });

  it('reads hours when the media is over an hour, and toggles total ⇄ remaining', () => {
    render(<PlayerBar {...barProps()} />);
    const readout = screen.getByRole('button', { name: /0:00/ });
    expect(readout.textContent, 'hours fold, minutes do not').toContain('1:02:05');
    // WCAG 2.5.3: the accessible name CONTAINS the visible text, so dictation
    // and voice control can name the control the user is reading.
    expect(readout.getAttribute('aria-label')).toContain(readout.textContent!);
    fireEvent.click(readout);
    expect(readout.textContent, 'the second click shows the time left').toMatch(/-\d/);
    expect(readout.getAttribute('aria-label'), 'and the name follows the visible text').toContain(readout.textContent!);
  });
});

describe('PR #171 · the Kivara volume control', () => {
  it('keeps a real slider for the keyboard while painting our own track', () => {
    const { container } = render(<PlayerBar {...barProps()} />);
    // The #167/#168 contracts drive this exact node with fireEvent.change.
    const range = screen.getByRole('slider', { name: t('player.volume') }) as HTMLInputElement;
    expect(range.tagName).toBe('INPUT');
    expect(range.className, 'the native look is hidden, not the input').toContain('opacity-0');
    expect(container.querySelector('[data-kvl-volume-track]'), 'our own painted track').not.toBeNull();
  });
});

describe('PR #171 · the tray publishes the native-popup state', () => {
  it('reports an open native popup, and clears it when it closes', async () => {
    const onPopupChange = vi.fn();
    render(<PlayerBar {...barProps()} onPopupChange={onPopupChange} />);
    expect(onPopupChange, 'nothing open yet').toHaveBeenLastCalledWith(false);

    // A native CC menu appears in the page: the tray yields, and the rest of
    // our chrome has to know (the top bar must not cover it, the skip pill has
    // no business over it).
    const cc = document.createElement('div');
    cc.setAttribute('data-uia', 'selector-audio-subtitle');
    document.body.appendChild(cc);
    await act(async () => { await Promise.resolve(); });
    await expect.poll(() => onPopupChange.mock.calls.at(-1)?.[0], { timeout: 3_000 }).toBe(true);

    cc.remove();
    await act(async () => { await Promise.resolve(); });
    await expect.poll(() => onPopupChange.mock.calls.at(-1)?.[0], { timeout: 3_000 }).toBe(false);
  });
});

describe('PR #171 · fullscreen happens in the gesture', () => {
  it('calls requestFullscreen synchronously and exits when already in fullscreen', () => {
    // The element the code will pick: `resolvePlayerRoot('netflix', video)`
    // resolves `.watch-video` first, so the stub goes on THAT node.
    const container = document.createElement('div');
    container.className = 'watch-video';
    const video = document.createElement('video');
    container.appendChild(video);
    document.body.appendChild(container);
    const requestFullscreen = vi.fn(() => Promise.resolve());
    (container as unknown as { requestFullscreen: unknown }).requestFullscreen = requestFullscreen;
    // The native fallback, which the sync path must not reach.
    const nativeButton = document.createElement('button');
    nativeButton.setAttribute('data-uia', 'control-fullscreen-toggle');
    const nativeClicked = vi.fn();
    nativeButton.addEventListener('click', nativeClicked);
    document.body.appendChild(nativeButton);

    render(<PlayerBar {...barProps()} video={video} />);
    fireEvent.click(screen.getByRole('button', { name: t('player.fullscreen') }));
    // Synchronous: asserted in the same tick as the click, while the native
    // fallback sits behind an 80 ms timer that has not fired.
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(nativeClicked, 'the native button is not the first path').not.toHaveBeenCalled();

    const exitFullscreen = vi.fn(() => Promise.resolve());
    Object.defineProperty(document, 'fullscreenElement', { value: container, configurable: true });
    (document as unknown as { exitFullscreen: unknown }).exitFullscreen = exitFullscreen;
    fireEvent.click(screen.getByRole('button', { name: t('player.fullscreen') }));
    expect(exitFullscreen, 'the exit path is the browser one').toHaveBeenCalled();
  });
});
