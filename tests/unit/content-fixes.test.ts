/**
 * Pins two content-script fixes from the post-61bf3e2 review.
 *
 *  1. ShadowHost.mount applies `all: initial` BEFORE the positional styles.
 *     It used to be the LAST assignment, and the shorthand wiped every
 *     non-inherited property below it: the host mounted `position: static`,
 *     `z-index: auto`, `pointer-events: auto` (measured on a real page
 *     through getComputedStyle). Nothing overlaid the video, which is why
 *     the closed-root overlay guard never engaged.
 *
 *  2. The intercepted adapter's poll survives `showNativeSubtitles()`.
 *     App.tsx toggles native captions with Alt+C. The old handler called
 *     `stopPolling()`, and the adapter has no re-arm path, so the interval
 *     went to zero and the overlay froze on its first subtitle — while
 *     the video kept playing.
 *
 * Neither case can live in a DOM assertion alone for 2 (the timer is the
 * contract), so the poll check is a timer-count assertion: the interval
 * must remain armed through the cycle.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ShadowHost } from '../../src/content/shadow-host';
import { createInterceptedAdapter } from '../../src/content/platform-adapters/intercepted-adapter';

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('ShadowHost.mount', () => {
  it('mounts the overlay host so it actually overlays the page', () => {
    const host = ShadowHost.mount(document.body, { isOverlay: true });
    const el = host.hostElement;
    // The failure this pins: these read `static` / `auto` / `auto` before
    // `all: initial` was moved above the block.
    expect(el.style.position).toBe('absolute');
    expect(el.style.zIndex).toBe('2147483647');
    expect(el.style.left).toBe('0px');
    expect(el.style.top).toBe('0px');
    expect(el.style.width).toBe('100%');
    expect(el.style.height).toBe('100%');
  });

  it('mounts the main host fixed, zero-height, click-through', () => {
    const main = ShadowHost.mount(document.body);
    const el = main.hostElement;
    expect(el.style.position).toBe('fixed');
    expect(el.style.height).toBe('0px');
    expect(el.style.pointerEvents).toBe('none');
    expect(el.style.zIndex).toBe('2147483647');
  });
});

describe('the intercepted adapter poll survives native-subtitle toggles', () => {
  it('keeps the poll interval armed through hide→show cycles', () => {
    vi.useFakeTimers();
    const adapter = createInterceptedAdapter({
      platform: 'netflix',
      language: 'es-ES',
      hideNativeCss: '.watch-video--player-view + div',
      getVideo: () => null,
    });

    expect(vi.getTimerCount(), 'the poll interval never started').toBeGreaterThan(0);

    // App.tsx toggles native captions with Alt+C: show → hide → show.
    // The regression was `showNative()` calling `stopPolling()`, which
    // cleared the interval and never re-armed it, so subsequent cues
    // never reached the overlay.
    adapter.hideNativeSubtitles();
    adapter.showNativeSubtitles();
    adapter.hideNativeSubtitles();
    adapter.showNativeSubtitles();

    expect(vi.getTimerCount(), 'the poll interval was cleared and never re-armed').toBeGreaterThan(0);

    // destroy() is the ONE place the timer is allowed to go — the
    // complement of this pin.
    adapter.destroy?.();
    expect(vi.getTimerCount()).toBe(0);
  });
});
