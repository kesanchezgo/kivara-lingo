/**
 * Point 4 — «Limpieza visual» behaves like the mock: the chrome hides while
 * the pointer is idle and comes back on pointer activity; the texts say so;
 * and the capture (drawImage on the <video>) never depended on the toggle.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildCleanupCss } from '../../src/content/ui/cleanup-css';
import { usePointerIdleOverPlayer } from '../../src/content/ui/pointer-idle';
import { renderHook, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const NETFLIX_HIDE = '[data-uia="player-controls"]';

describe('buildCleanupCss: the controlsIdle gate', () => {
  it('with controlsIdle FALSE the hide-UI selectors are withheld (controls visible)', () => {
    const css = buildCleanupCss({
      hideUI: true,
      hideShadows: false,
      controlsIdle: false,
      platform: 'netflix',
    });
    expect(css).not.toContain(NETFLIX_HIDE);
    expect(css).toBe('');
  });

  it('with controlsIdle TRUE the chrome hides (the previous behavior)', () => {
    const css = buildCleanupCss({
      hideUI: true,
      hideShadows: false,
      controlsIdle: true,
      platform: 'netflix',
    });
    expect(css).toContain(NETFLIX_HIDE);
  });

  it('hideShadows keeps its always-on behavior regardless of the pointer', () => {
    const css = buildCleanupCss({
      hideUI: false,
      hideShadows: true,
      controlsIdle: false,
      platform: 'netflix',
    });
    expect(css).toContain('.watch-video--bottom-gradient');
  });

  it('the default keeps the always-hidden behavior for callers without the pointer', () => {
    const css = buildCleanupCss({ hideUI: true, hideShadows: false, platform: 'netflix' });
    expect(css).toContain(NETFLIX_HIDE);
  });
});

describe('usePointerIdleOverPlayer', () => {
  function makeVideo(): HTMLVideoElement {
    const el = document.createElement('video');
    // jsdom rects are all-zero: give the video a real box so the hook's
    // over-the-video check has something to work with.
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360 }) as DOMRect;
    document.body.appendChild(el);
    return el;
  }
  const move = (x: number, y: number) =>
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y }));

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('starts idle (hidden), shows on pointer activity, hides again after the rest period', () => {
    const video = makeVideo();
    const { result } = renderHook(() => usePointerIdleOverPlayer(video, true, 2_500));
    expect(result.current).toBe(true);
    move(320, 180); // inside the video
    void act(() => vi.advanceTimersByTime(300));
    expect(result.current).toBe(false); // pointer active → chrome visible
    void act(() => vi.advanceTimersByTime(2_600));
    expect(result.current).toBe(true); // idle again → chrome hidden
  });

  it('pointer activity OUTSIDE the video does not count', () => {
    const video = makeVideo();
    const { result } = renderHook(() => usePointerIdleOverPlayer(video, true, 2_500));
    move(1_500, 900); // outside the rect
    void act(() => vi.advanceTimersByTime(5_000));
    expect(result.current).toBe(true);
  });

  it('disables itself with enabled=false (chrome shows)', () => {
    const video = makeVideo();
    const { result, rerender } = renderHook((p) => usePointerIdleOverPlayer(video, p.enabled, 2_500), {
      initialProps: { enabled: true },
    });
    void act(() => vi.advanceTimersByTime(3_000));
    expect(result.current).toBe(true);
    rerender({ enabled: false });
    move(320, 180);
    void act(() => vi.advanceTimersByTime(300));
    expect(result.current).toBe(false);
  });
});

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');

describe('the copy says what the feature does (es/en)', () => {

  it('the Spanish description describes hiding + pointer restore', () => {
    const settings = read('src/shared/i18n/settings.ts');
    expect(settings).toContain(
      '"set.cleanupDesc": "Oculta los controles y sombras del reproductor mientras ves. Vuelven al mover el ratón sobre el vídeo."',
    );
    expect(settings).not.toContain('para que la captura salga limpia');
  });

  it('the English description describes hiding + pointer restore', () => {
    const settings = read('src/shared/i18n/settings.ts');
    expect(settings).toContain(
      '"set.cleanupDesc": "Hides the player’s controls and shadows while you watch. They come back when you move the mouse over the video."',
    );
    expect(settings).not.toContain('so the screenshot comes out clean');
  });
});

describe('the capture does not depend on this setting', () => {
  it('frame capture never imports the cleanup module', () => {
    const frame = read('src/content/capture/frame.ts');
    expect(frame).not.toContain('cleanup-css');
    expect(frame).not.toContain('hideUI');
    // The capture draws the video element directly — the chrome was never in
    // the frame: drawImage(video) reads the pixels, not the DOM.
    expect(frame).toContain('drawImage');
  });
});
