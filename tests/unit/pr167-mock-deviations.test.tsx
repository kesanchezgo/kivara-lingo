/**
 * RED TESTS — PR #167 (base main@0744adf6).
 *
 * Two mock deviations found in #166 plus three open gaps:
 *   1. the caption plate must be INTRINSIC (`w-fit max-w-full`) with the
 *      primary and dual lines sharing that intrinsic width;
 *   2. the word card's internal order NEVER inverts: only the outer
 *      placement/arrow/bridge change with `placement === 'bottom'`;
 *   3. PlayerBar reports its auto-hide visibility + measured height and
 *      SubtitleOverlay lifts the plate above it by >= 12 px, never during a
 *      clean capture;
 *   4. native CC/Episodes popups stay visible/clickable while our bar hides
 *      the host's row (no inherited `visibility`, no `opacity: 0` ancestor);
 *   5. the Episodes control is exposed next to CC when the host has one, and
 *      a missing native node never falls through to fullscreen.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerBar } from '../../src/content/ui/PlayerBar';
import { SubtitleOverlay } from '../../src/content/ui/SubtitleOverlay';
import { WordPopover, type WordPopoverProps } from '../../src/content/ui/WordPopover';
import { applyOwnedBarCss } from '../../src/content/ui/cleanup-css';
import {
  CAPTION_BAR_CLEARANCE_PX, captionLiftPx, combineControlsVisibility,
} from '../../src/content/ui/overlay-geometry';
import { t } from '../../src/shared/i18n';

/* ── Forced popover side: the component asks the geometry module, which in
      happy-dom (zero rects) always answers "top". The mock keeps the real
      math and only overrides the side, so the DOM contract is what is tested. */
const placementState = vi.hoisted(() => ({ side: 'top' as 'top' | 'bottom' }));

vi.mock('../../src/content/ui/popover-geometry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/content/ui/popover-geometry')>();
  return {
    ...actual,
    computePopoverPlacement: (frame: Parameters<typeof actual.computePopoverPlacement>[0]) => {
      const real = actual.computePopoverPlacement(frame);
      return { ...real, side: placementState.side };
    },
  };
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ── 1. Intrinsic caption plate ───────────────────────────────────────── */

const overlayProps = (overrides: Record<string, unknown> = {}) => ({
  subtitleStyles: {
    keepNativeLineBreaks: false,
    keepNativeAlignment: true,
    fontSize: 20,
    color: '#fff',
    backgroundColor: '#000000',
    backgroundOpacity: 60,
    position: 'bottom' as const,
    fontWeight: 500,
  } as never,
  cue: { id: 'c0', text: 'Run home', start: 0, end: 3000, language: 'en', align: 'left' as const },
  altCue: { id: 'a0', text: 'Corre a casa', start: 0, end: 3000, language: 'es', align: 'left' as const },
  mode: 'learning' as const,
  saveRequestKey: 0,
  onSaveCard: vi.fn(async () => ({ ok: true, noteId: 1 })),
  onTokenHoverChange: () => {},
  initialSavedWords: new Set<string>(),
  study: {
    statusOf: () => 'known' as const,
    detailOf: () => ({ status: 'known', source: 'estimated' } as never),
    setStatus: () => {},
    inAnki: () => false,
    userStatusOf: () => undefined,
  } as never,
  ...overrides,
});

function renderOverlay(overrides: Record<string, unknown> = {}) {
  const props = overlayProps(overrides) as unknown as Parameters<typeof SubtitleOverlay>[0];
  return render(
    <div data-popover-boundary>
      <SubtitleOverlay {...props} />
    </div>,
  );
}

describe('1 — the caption plate hugs its text', () => {
  it('is intrinsic (w-fit max-w-full), never the viewport width', () => {
    renderOverlay();
    const plate = document.querySelector<HTMLElement>('[data-kivara-caption-box]')!;
    expect(plate.classList.contains('w-fit'), 'plate must be w-fit').toBe(true);
    expect(plate.classList.contains('max-w-full'), 'plate must cap at its parent').toBe(true);
    expect(plate.classList.contains('w-full'), 'plate must NOT span the player').toBe(false);
  });

  it('keeps primary and dual lines at 100% of the intrinsic plate so text-align works', () => {
    renderOverlay();
    const plate = document.querySelector<HTMLElement>('[data-kivara-caption-box]')!;
    const primary = plate.querySelector<HTMLElement>(':scope > span')!;
    const dual = plate.querySelector<HTMLElement>('[data-kivara-dual]')!;
    expect(primary.classList.contains('block')).toBe(true);
    expect(primary.classList.contains('w-full')).toBe(true);
    expect(dual.classList.contains('w-full')).toBe(true);
    // Both lines align INSIDE the plate, not against the screen edge.
    expect(plate.style.textAlign).toBe('left');
    expect(dual.style.textAlign).toBe('left');
  });
});

/* ── 2. WordPopover order invariance ──────────────────────────────────── */

const cardProps: WordPopoverProps = {
  visible: true,
  onMouseEnter: () => {},
  onMouseLeave: () => {},
  token: 'run',
  lookupToken: 'run',
  sentence: 'She ran home.',
  sourceLang: 'en',
  includeAi: false,
  kind: 'word',
  lemma: 'run',
  isExpanded: false,
  isSaved: false,
  parentMWE: null,
  onToggleExpand: () => {},
  onRejoinParent: () => {},
  onSave: () => {},
  status: 'new',
  statusDetail: { status: 'new', source: 'estimated' } as never,
  onStatusChange: () => {},
  onStatusClear: () => {},
} as unknown as WordPopoverProps;

function cardParts() {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  const inner = dialog.firstElementChild as HTMLElement;
  const actions = dialog.querySelector<HTMLElement>('[data-kvl-card-actions]')!;
  const header = inner.firstElementChild as HTMLElement;
  const arrow = [...dialog.children].find(
    (el) => el.getAttribute('aria-hidden') === 'true' && el.className.includes('rotate-45'),
  ) as HTMLElement;
  const bridge = [...dialog.children].find(
    (el) => el.getAttribute('aria-hidden') === 'true'
      && el.className.includes('left-0 right-0 h-3'),
  ) as HTMLElement;
  return { dialog, inner, actions, header, arrow, bridge };
}

describe('2 — the word card never flips its internal order', () => {
  it('placement="bottom": header stays on top, actions stay at the bottom', () => {
    placementState.side = 'bottom';
    render(<div data-popover-boundary><WordPopover {...cardProps} /></div>);
    const { dialog, inner, actions, header, arrow, bridge } = cardParts();

    // Position changes only.
    expect(dialog.classList.contains('top-full')).toBe(true);
    expect(dialog.classList.contains('bottom-full')).toBe(false);

    // Internal order NEVER inverts.
    expect(actions.classList.contains('flex-col')).toBe(true);
    expect(actions.classList.contains('flex-col-reverse')).toBe(false);
    expect(actions.classList.contains('order-first')).toBe(false);
    expect(actions.classList.contains('border-t')).toBe(true);
    expect(inner.firstElementChild).toBe(header);
    expect(inner.lastElementChild).toBe(actions);
    expect(actions.firstElementChild?.getAttribute('title')).toBe(t('ws.label'));

    // Arrow + bridge follow the placement.
    expect(arrow.className).toContain('-top-1.5');
    expect(arrow.className).toContain('border-l');
    expect(arrow.className).toContain('border-t');
    expect(bridge.className).toContain('bottom-full');
  });

  it('placement="top": same order, only arrow/bridge/position mirror', () => {
    placementState.side = 'top';
    render(<div data-popover-boundary><WordPopover {...cardProps} /></div>);
    const { dialog, inner, actions, header, arrow, bridge } = cardParts();

    expect(dialog.classList.contains('bottom-full')).toBe(true);
    expect(actions.classList.contains('flex-col')).toBe(true);
    expect(actions.classList.contains('flex-col-reverse')).toBe(false);
    expect(actions.classList.contains('order-first')).toBe(false);
    expect(inner.firstElementChild).toBe(header);
    expect(inner.lastElementChild).toBe(actions);
    expect(arrow.className).toContain('-bottom-1.5');
    expect(arrow.className).toContain('border-r');
    expect(arrow.className).toContain('border-b');
    expect(bridge.className).toContain('top-full');
  });
});

/* ── 3. PlayerBar visibility + caption lift ───────────────────────────── */

const barProps = () => ({
  playing: false,
  duration: 60_000,
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

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  constructor(private cb: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  trigger(width: number, height: number): void {
    this.cb([{
      // The bar's `p-4` means the content box is 32 px shorter than the
      // chrome. Reporting the content height leaves the plate under the bar.
      contentRect: { width, height: height - 32 },
      borderBoxSize: [{ inlineSize: width, blockSize: height }],
    } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}

describe('3 — the caption lifts above the visible PlayerBar', () => {
  it('the pure lift keeps the plate bottom >= 12px above the bar', () => {
    // Host 720, plate bottom at 636; bar 90 + clearance → limit 618 → lift 18.
    expect(CAPTION_BAR_CLEARANCE_PX).toBe(12);
    expect(captionLiftPx({ plateBottomPx: 636, hostHeight: 720, barHeightPx: 90, capturing: false })).toBe(18);
    // Nothing to lift when the caption is high up.
    expect(captionLiftPx({ plateBottomPx: 300, hostHeight: 720, barHeightPx: 90, capturing: false })).toBe(0);
    // No bar / clean capture → no displacement.
    expect(captionLiftPx({ plateBottomPx: 636, hostHeight: 720, barHeightPx: 0, capturing: false })).toBe(0);
    expect(captionLiftPx({ plateBottomPx: 636, hostHeight: 720, barHeightPx: 90, capturing: true })).toBe(0);
  });

  it('combines our bar with a future adapter signal (visible wins, tallest height)', () => {
    expect(combineControlsVisibility({ visible: false, height: 0 }, { visible: true, height: 64 }))
      .toEqual({ visible: true, height: 64 });
    expect(combineControlsVisibility({ visible: true, height: 96 }, { visible: false, height: 0 }))
      .toEqual({ visible: true, height: 96 });
    expect(combineControlsVisibility({ visible: true, height: 96 }, { visible: true, height: 40 }))
      .toEqual({ visible: true, height: 96 });
    expect(combineControlsVisibility({ visible: false, height: 0 }, null))
      .toEqual({ visible: false, height: 0 });
  });

  it('reports (visible, measured height) and turns invisible while capturing', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    FakeResizeObserver.instances = [];
    const onVisibilityChange = vi.fn();
    const props = { ...barProps(), playing: true, onVisibilityChange };
    const { rerender } = render(<PlayerBar {...props} />);
    const ro = FakeResizeObserver.instances.at(-1)!;
    await act(async () => { ro.trigger(900, 96); });
    expect(onVisibilityChange).toHaveBeenLastCalledWith(true, 96);

    await act(async () => { vi.advanceTimersByTime(3100); });
    expect(onVisibilityChange).toHaveBeenLastCalledWith(false, 96);

    // A pointer move brings it back (the bar is on screen)...
    await act(async () => { fireEvent.pointerMove(window); });
    expect(onVisibilityChange).toHaveBeenLastCalledWith(true, 96);

    // ...and a capture hides it again even though `visible` is still true:
    // the frame must be clean.
    rerender(<PlayerBar {...props} capturing />);
    expect(onVisibilityChange).toHaveBeenLastCalledWith(false, 96);
    vi.useRealTimers();
  });

  it('lifts the plate transform by the measured amount, and not during capture', async () => {
    // happy-dom does no layout: the plate needs an offsetHeight for the
    // measurement to run (the real browser reports it from layout).
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) { return this.hasAttribute('data-kivara-caption-box') ? 48 : 0; },
    });
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    FakeResizeObserver.instances = [];
    // The plate's natural bottom is derived from the layer geometry
    // (`top: pct%` + `translateY(-50%)`), never from the displaced rect: the
    // rect carries whatever lift is applied, so measuring it made the NEXT
    // pass cancel the lift back to 0 — the live oscillation this covers.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const rect = (top: number, height: number, width: number) => ({
        x: 0, y: top, top, height, width, bottom: top + height, left: 0, right: width,
        toJSON: () => ({}),
      }) as DOMRect;
      if (this.hasAttribute('data-kivara-caption-box')) {
        // The real rect moves with the layer translate. A measurement-based
        // implementation therefore reads a displaced box and self-cancels.
        const layer = this.parentElement?.parentElement;
        const applied = Number(/-\s*(\d+)px/.exec(layer?.style.transform ?? '')?.[1] ?? 0);
        return rect(588 - applied, 48, 400);
      }
      if (this.hasAttribute('data-popover-boundary')) return rect(0, 720, 960);
      return rect(0, 0, 0);
    });

    // Re-query after every render: a rerender mounts a NEW tree, and reading
    // the previous node would assert on a detached element forever.
    const layerNow = () => document.querySelector<HTMLElement>('[data-kivara-caption-box]')!
      .parentElement!.parentElement!;

    const { rerender } = renderOverlay({ barHeightPx: 90 });
    expect(layerNow().style.transform).toContain('- 18px');

    // The live oscillation: the next measurement (a cue swap / player resize,
    // both delivered through the overlay's ResizeObserver) must NOT cancel
    // the lift. It re-measures the plate with the translate applied and adds
    // it back, so the answer is stable.
    const liftObserver = FakeResizeObserver.instances.at(-1)!;
    await act(async () => { liftObserver.trigger(960, 720); });
    expect(layerNow().style.transform).toContain('- 18px');

    rerender(
      <div data-popover-boundary>
        <SubtitleOverlay {...(overlayProps({ barHeightPx: 90 }) as unknown as Parameters<typeof SubtitleOverlay>[0])} />
      </div>,
    );
    expect(layerNow().style.transform).toContain('- 18px');

    rerender(
      <div data-popover-boundary>
        <SubtitleOverlay {...(overlayProps({ barHeightPx: 90, capturing: true }) as unknown as Parameters<typeof SubtitleOverlay>[0])} />
      </div>,
    );
    expect(layerNow().style.transform).toBe('translateY(-50%)');
    vi.useRealTimers();
  });
});

/* ── 4. Native popups survive the owned-bar CSS ───────────────────────── */

describe('4 — native Netflix popups stay visible and clickable', () => {
  it('never sets opacity:0 on the hidden row and exempts the native popups', () => {
    applyOwnedBarCss(true, 'netflix');
    const css = document.getElementById('kivara-owned-bar-netflix')!.textContent ?? '';
    expect(css).not.toContain('opacity: 0');
    expect(css).toContain('[data-uia="selector-audio-subtitle"]');
    expect(css).toMatch(/\[data-uia="selector-audio-subtitle"[\s\S]*visibility: visible !important/);
    expect(css).toMatch(/\[data-uia="selector-audio-subtitle"[\s\S]*pointer-events: auto !important/);
    applyOwnedBarCss(false, 'netflix');
    expect(document.getElementById('kivara-owned-bar-netflix')).toBeNull();
  });

  it('yields pointer events while a native popup is open', async () => {
    render(<PlayerBar {...barProps()} />);
    const row = document.querySelector<HTMLElement>('[data-kvl-player-row]')!;
    expect(row.className).toContain('pointer-events-auto');

    const popup = document.createElement('div');
    popup.setAttribute('data-uia', 'selector-audio-subtitle');
    document.body.appendChild(popup);
    await act(async () => { await Promise.resolve(); });
    expect(row.className).toContain('pointer-events-none');

    popup.remove();
    await act(async () => { await Promise.resolve(); });
    expect(row.className).toContain('pointer-events-auto');
  });
});

/* ── 5. Episodes control, next to CC ──────────────────────────────────── */

describe('5 — the Episodes control is exposed next to CC', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="watch-video">
        <button data-uia="control-audio-subtitle">CC</button>
        <button data-uia="control-episodes">Episodios</button>
        <button data-uia="control-fullscreen">FS</button>
      </div>`;
  });

  it('renders the Episodes button when the host has the control and forwards the click', async () => {
    vi.useFakeTimers();
    const props = barProps();
    const nativeEpisodes = document.querySelector<HTMLElement>('[data-uia="control-episodes"]')!;
    const clickSpy = vi.spyOn(nativeEpisodes, 'click');
    render(<PlayerBar {...props} />);

    const episodes = within(screen.getByRole('toolbar')).getByRole('button', { name: t('player.episodes') });
    await act(async () => { fireEvent.click(episodes); });
    expect(props.onWakeNative).toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(clickSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('hides the Episodes button on a title without one, and a missing CC never clicks fullscreen', async () => {
    vi.useFakeTimers();
    document.querySelector('[data-uia="control-episodes"]')!.remove();
    const props = barProps();
    const nativeFullscreen = document.querySelector<HTMLElement>('[data-uia="control-fullscreen"]')!;
    const fsSpy = vi.spyOn(nativeFullscreen, 'click');
    document.querySelector('[data-uia="control-audio-subtitle"]')!.remove();
    render(<PlayerBar {...props} />);

    expect(within(screen.getByRole('toolbar')).queryByRole('button', { name: t('player.episodes') })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t('player.netflixSubtitles') }));
    });
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(fsSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

/* ── 6. Volume/mute go through the controller (MAIN world), not the element */
describe('6 — volume/mute delegate to the platform controller', () => {
  it('uses onSetVolume/onSetMuted instead of writing the element directly', () => {
    const video = document.createElement('video');
    const onSetVolume = vi.fn();
    const onSetMuted = vi.fn();
    render(<PlayerBar {...barProps()} video={video} onSetVolume={onSetVolume} onSetMuted={onSetMuted} />);

    fireEvent.click(screen.getByRole('button', { name: t('player.mute') }));
    expect(onSetMuted).toHaveBeenCalledWith(true);
    expect(video.muted).toBe(false);

    fireEvent.change(screen.getByRole('slider', { name: t('player.volume') }), { target: { value: '0.4' } });
    expect(onSetVolume).toHaveBeenCalledWith(0.4);
    expect(video.volume).toBe(1);
  });

  it('keeps syncing the UI from the element volumechange event', () => {
    const video = document.createElement('video');
    const onSetMuted = vi.fn();
    render(<PlayerBar {...barProps()} video={video} onSetMuted={onSetMuted} />);
    // Native menu changed the level: the bar follows the element.
    video.muted = true;
    fireEvent(video, new Event('volumechange'));
    expect(screen.getByRole('button', { name: t('player.unmute') })).toBeTruthy();
    // And a user click still goes through the controller, not the element.
    fireEvent.click(screen.getByRole('button', { name: t('player.unmute') }));
    expect(onSetMuted).toHaveBeenCalledWith(false);
  });
});
