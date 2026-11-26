/**
 * RED TESTS — PR #168 (base main@c893204).
 *
 * Five defects verified in audit + real Chromium:
 *
 *   P1  `[data-kvl-player-bar]` is `pointer-events: none` and `<SeekBar>` never
 *       opts back in, so `document.elementFromPoint` over the progress track
 *       hits the `<video>` and pauses instead of seeking. In the opposite
 *       direction, a hidden bar (`reportedVisible === false`) keeps
 *       `pointer-events: auto` on its row and swallows invisible clicks.
 *   P2  The duration is read once at render, so a `<video>` that mounts with
 *       `NaN` leaves the bar at `0:00 / 0:00`; raising the volume while muted
 *       never unmutes, and unmuting at volume 0 stays silent.
 *   P3  `wakeNativeControls` removes the owned-bar stylesheet for 400 ms (two
 *       overlapping bars), and the Netflix cleanup sheet still uses
 *       `opacity: 0`, which makes an open native CC menu invisible.
 *   P4  `fitBodyToCap` measures `body.offsetTop + body.offsetHeight` instead of
 *       the real chrome, so every enrichment batch re-squeezes the body and
 *       the card bounces; the header moved the speaker button to the right.
 *   P5  `PlayerBar` ships no shortcut combos, no `kvl-press`, no CC dot.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerBar } from '../../src/content/ui/PlayerBar';
import { applyOwnedBarCss, buildCleanupCss, wakeNativeRow } from '../../src/content/ui/cleanup-css';
import { WordPopover, type WordPopoverProps } from '../../src/content/ui/WordPopover';
import { t } from '../../src/shared/i18n';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

/* ── P1 · SeekBar pointer events ──────────────────────────────────────── */

describe('P1 — the progress track is clickable and a hidden bar never steals clicks', () => {
  it('the seek hit area opts into pointer events while the bar is visible', () => {
    render(<PlayerBar {...barProps()} />);
    const hitArea = document.querySelector<HTMLElement>('[data-kvl-seek-hit]')!;
    expect(hitArea, 'the 20px pointer surface exists').not.toBeNull();
    expect(hitArea.className).toContain('pointer-events-auto');
    expect(hitArea.className).toContain('cursor-pointer');
    // The interactive surface is the padded container, not the 4px track.
    expect(hitArea.className).toContain('py-2');
  });

  it('a hidden bar marks itself and yields pointer events on BOTH children', async () => {
    vi.useFakeTimers();
    const props = { ...barProps(), playing: true };
    const { container } = render(<PlayerBar {...props} />);
    const bar = container.querySelector<HTMLElement>('[data-kvl-player-bar]')!;
    const hitArea = container.querySelector<HTMLElement>('[data-kvl-seek-hit]')!;
    const row = container.querySelector<HTMLElement>('[data-kvl-player-row]')!;

    expect(bar.hasAttribute('data-kvl-bar-hidden')).toBe(false);
    expect(row.className).toContain('pointer-events-auto');

    await act(async () => { vi.advanceTimersByTime(3_100); });

    expect(bar.hasAttribute('data-kvl-bar-hidden')).toBe(true);
    expect(hitArea.className).toContain('pointer-events-none');
    expect(row.className).toContain('pointer-events-none');
  });

  it('keyboard focus wakes a hidden bar instead of leaving it inert', async () => {
    vi.useFakeTimers();
    const props = { ...barProps(), playing: true };
    const { container } = render(<PlayerBar {...props} />);
    const bar = container.querySelector<HTMLElement>('[data-kvl-player-bar]')!;
    await act(async () => { vi.advanceTimersByTime(3_100); });
    expect(bar.hasAttribute('data-kvl-bar-hidden')).toBe(true);

    await act(async () => {
      bar.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    expect(bar.hasAttribute('data-kvl-bar-hidden')).toBe(false);
  });

  it('the slider is keyboard-reachable only while the bar is interactive', async () => {
    vi.useFakeTimers();
    const props = { ...barProps(), playing: true };
    render(<PlayerBar {...props} />);
    const slider = screen.getByRole('slider', { name: t('player.seek') });
    expect(slider.getAttribute('tabindex')).toBe('0');
    await act(async () => { vi.advanceTimersByTime(3_100); });
    expect(slider.getAttribute('tabindex')).toBe('-1');
  });

  it('drops the global drag listeners when the bar unmounts mid-drag', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount, container } = render(<PlayerBar {...barProps()} />);
    const hitArea = container.querySelector<HTMLElement>('[data-kvl-seek-hit]')!;
    fireEvent.mouseDown(hitArea, { clientX: 40 });
    unmount();
    expect(remove.mock.calls.some(([type]) => type === 'mousemove')).toBe(true);
    expect(remove.mock.calls.some(([type]) => type === 'mouseup')).toBe(true);
  });
});

/* ── P2 · live duration + volume/mute coherence ───────────────────────── */

describe('P2 — duration stays live and volume/mute stay coherent', () => {
  it('follows loadedmetadata/durationchange instead of the first render', () => {
    const video = document.createElement('video');
    // A `<video>` that mounts before metadata: NaN until the event arrives.
    Object.defineProperty(video, 'duration', { value: Number.NaN, writable: true, configurable: true });
    render(<PlayerBar {...barProps()} duration={0} video={video} />);
    expect(screen.getByText(/0:00 \/ 0:00/)).toBeTruthy();

    Object.defineProperty(video, 'duration', { value: 754.4, writable: true, configurable: true });
    fireEvent(video, new Event('loadedmetadata'));
    expect(screen.getByText(/0:00 \/ 12:34/)).toBeTruthy();

    Object.defineProperty(video, 'duration', { value: 60, writable: true, configurable: true });
    fireEvent(video, new Event('durationchange'));
    expect(screen.getByText(/0:00 \/ 1:00/)).toBeTruthy();
  });

  it('raising the volume while muted unmutes the player', () => {
    const video = document.createElement('video');
    Object.defineProperty(video, 'volume', { value: 1, writable: true, configurable: true });
    Object.defineProperty(video, 'muted', { value: true, writable: true, configurable: true });
    const onSetVolume = vi.fn();
    const onSetMuted = vi.fn();
    render(<PlayerBar {...barProps()} video={video} onSetVolume={onSetVolume} onSetMuted={onSetMuted} />);

    fireEvent.change(screen.getByRole('slider', { name: t('player.volume') }), { target: { value: '0.4' } });
    expect(onSetVolume).toHaveBeenCalledWith(0.4);
    expect(onSetMuted).toHaveBeenCalledWith(false);
  });

  it('unmuting at volume 0 restores the last audible level', () => {
    const video = document.createElement('video');
    Object.defineProperty(video, 'volume', { value: 0, writable: true, configurable: true });
    Object.defineProperty(video, 'muted', { value: false, writable: true, configurable: true });
    const onSetVolume = vi.fn();
    const onSetMuted = vi.fn();
    render(<PlayerBar {...barProps()} video={video} onSetVolume={onSetVolume} onSetMuted={onSetMuted} />);

    // Start from a real level so there is something to restore.
    fireEvent.change(screen.getByRole('slider', { name: t('player.volume') }), { target: { value: '0.7' } });
    // Drop to zero: the button now offers "unmute".
    fireEvent.change(screen.getByRole('slider', { name: t('player.volume') }), { target: { value: '0' } });
    onSetVolume.mockClear();
    onSetMuted.mockClear();

    fireEvent.click(screen.getByRole('button', { name: t('player.unmute') }));
    expect(onSetMuted).toHaveBeenCalledWith(false);
    expect(onSetVolume).toHaveBeenCalledWith(0.7);
  });
});

/* ── P3 · no 400ms flash + native popups survive the cleanup sheet ────── */

describe('P3 — waking native controls never flashes two bars', () => {
  it('never removes the owned-bar stylesheet while waking the native row', async () => {
    applyOwnedBarCss(true, 'netflix');
    expect(document.getElementById('kivara-owned-bar-netflix')).not.toBeNull();

    const root = document.createElement('div');
    document.body.appendChild(root);
    wakeNativeRow(root, null);
    // Synchronously and after the old 400 ms window, the sheet is still there.
    expect(document.getElementById('kivara-owned-bar-netflix')).not.toBeNull();
    await new Promise((r) => setTimeout(r, 450));
    expect(document.getElementById('kivara-owned-bar-netflix')).not.toBeNull();
    applyOwnedBarCss(false, 'netflix');
  });

  it('dispatches BOTH pointermove and mousemove so Netflix remounts its row', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const seen: string[] = [];
    root.addEventListener('pointermove', () => seen.push('pointermove'));
    root.addEventListener('mousemove', () => seen.push('mousemove'));
    wakeNativeRow(root, null);
    expect(seen).toContain('pointermove');
    expect(seen).toContain('mousemove');
  });

  it('the Netflix cleanup sheet hides with visibility, never opacity, and exempts the popups', () => {
    const css = buildCleanupCss({ hideUI: true, hideShadows: false, controlsIdle: true, platform: 'netflix' });
    expect(css).not.toContain('opacity: 0');
    expect(css).toContain('visibility: hidden !important');
    expect(css).toContain('[data-uia="selector-audio-subtitle"]');
    expect(css).toMatch(/\[data-uia="selector-audio-subtitle"[\s\S]*visibility: visible !important/);
    expect(css).toMatch(/\[data-uia="selector-audio-subtitle"[\s\S]*opacity: 1 !important/);
  });

  it('gradients may still fade while the chrome is hidden with visibility', () => {
    // Both toggles at once: the gradients keep their fade, the chrome row does
    // not — one shared rule would either leave the menu invisible or lose the
    // gradient fade.
    const css = buildCleanupCss({ hideUI: true, hideShadows: true, controlsIdle: true, platform: 'netflix' });
    expect(css).toContain('.watch-video--bottom-gradient');
    expect(css).toMatch(/\.watch-video--bottom-gradient[\s\S]*opacity: 0 !important/);
    expect(css).toMatch(/\[data-uia="player-controls"\][\s\S]*?visibility: hidden !important/);
    // Split the sheet into rule blocks and prove NO block that lists a chrome
    // selector carries `opacity: 0` (one shared rule is exactly the bug).
    const blocks = css.split('}').filter((block) => block.includes('{'));
    const chromeBlocks = blocks.filter((block) => block.includes('[data-uia="player-controls"]'));
    expect(chromeBlocks.length).toBeGreaterThan(0);
    for (const block of chromeBlocks) {
      const [selectors] = block.split('{');
      // Only the chrome-only block matters: a block that also lists gradients
      // is the shared rule this test exists to forbid.
      if (selectors.includes('.watch-video--bottom-gradient')) {
        expect(block, 'chrome and gradients must not share one opacity rule').not.toContain('opacity: 0');
      }
    }
  });

  it('one canonical popup list feeds both the CSS and the runtime check', async () => {
    const { NATIVE_POPUP_SELECTORS } = await import('../../src/content/ui/cleanup-css');
    expect(NATIVE_POPUP_SELECTORS).toContain('[data-uia="selector-audio-subtitle"]');
    expect(NATIVE_POPUP_SELECTORS).toContain('[data-uia="episodes-selector"]');
    const css = buildCleanupCss({ hideUI: true, hideShadows: false, controlsIdle: true, platform: 'netflix' });
    for (const selector of NATIVE_POPUP_SELECTORS) expect(css).toContain(selector);
  });
});

/* ── P4 · no card bounce + mock header ────────────────────────────────── */

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
} as unknown as WordPopoverProps;

describe('P4 — the body is capped by the real chrome, not by its own box', () => {
  beforeEach(() => {
    // happy-dom does no layout: give the card, header, body and actions a
    // real box so the cap arithmetic is observable.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-kvl-card-body')) return 300;
      if (this.getAttribute('data-kvl-card-actions') !== null) return 120;
      if (this.getAttribute('role') === 'dialog') return 500;
      // The header is the inner column's FIRST child.
      const inner = this.parentElement;
      if (inner && inner.parentElement?.getAttribute('role') === 'dialog'
        && inner.firstElementChild === this) return 80;
      return 0;
    });
  });

  it('caps the body at cap - (header + actions) and does not re-squeeze on growth', async () => {
    // A real frame: the token sits on a plate inside the boundary, so the
    // open-time reservation is a real number (380 = chrome 200 + body 180)
    // instead of the degenerate 0-room the bare wrapper would give.
    const rect = (top: number, height: number, width = 400): DOMRect => ({
      x: 0, y: top, top, bottom: top + height, left: 0, right: width, width, height,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.hasAttribute?.('data-popover-boundary')) return rect(0, 900);
      return rect(500, 20, 60);
    });

    const view = (lookupToken: string) => (
      <div data-popover-boundary><div data-kvl-plate><WordPopover {...cardProps} lookupToken={lookupToken} /></div></div>
    );
    const { container, rerender } = render(view('run'));
    const body = () => container.querySelector<HTMLElement>('[data-kvl-card-body]')!;
    expect(container.querySelector<HTMLElement>('[role="dialog"]')!.style.maxHeight).toBe('380px');

    // 380 reserved − (header 80 + actions 120) = 180. The old formula
    // subtracted `body.offsetTop + body.offsetHeight` (0 + 300) and stored
    // 80, mis-measuring the chrome by the body's own height; every later
    // batch re-derived it from a shrinking box and the card bounced.
    expect(body().style.maxHeight, 'the chrome is header + actions, not the body itself').toBe('180px');

    // A second batch with the same chrome must not move the box again.
    rerender(view('running'));
    await act(async () => { await Promise.resolve(); });
    expect(body().style.maxHeight, 'the cap is idempotent').toBe('180px');
  });

  it('puts the speaker button first and the phonetic chip last, like the mock', () => {
    render(<div data-popover-boundary><WordPopover {...cardProps} /></div>);
    const header = document.querySelector<HTMLElement>('[role="dialog"] > div > div')!;
    const speak = within(header).getByRole('button', { name: t('popover.playPronunciation') });
    // The speaker is inside the LEFT group, before the headword block.
    const leftGroup = header.firstElementChild as HTMLElement;
    expect(leftGroup.contains(speak)).toBe(true);
    expect(leftGroup.firstElementChild).toBe(speak);
    // The headword block follows it.
    expect(leftGroup.children[1].textContent).toContain('run');
    // The phonetic chip, when present, is the last element of the header.
    const phonetic = [...header.children].find((el) => el.className.includes('font-mono'));
    if (phonetic) expect(header.lastElementChild).toBe(phonetic);
  });
});

/* ── P5 · mock parity: combos, press feedback, CC dot ─────────────────── */

describe('P5 — PlayerBar matches the mock chrome', () => {
  it('shows the user shortcut combos in the tooltips', () => {
    render(<PlayerBar {...barProps()} />);
    const prev = screen.getByRole('button', { name: t('shortcut.prev') });
    const replay = screen.getByRole('button', { name: t('shortcut.replay') });
    const next = screen.getByRole('button', { name: t('shortcut.next') });
    const autoPause = screen.getByRole('button', { name: t('rail.autoPause') });
    const loop = screen.getByRole('button', { name: t('rail.loop') });
    // Every one of them carries a combo in parentheses, like StudyBar does.
    for (const [label, el] of [['prev', prev], ['replay', replay], ['next', next], ['autoPause', autoPause], ['loop', loop]] as const) {
      expect(el.getAttribute('title'), `${label} title`).toMatch(/\(.+\)/);
    }
    // Replay advertises BOTH gestures, on two lines.
    expect(replay.getAttribute('title')).toContain('\n');
    expect(replay.getAttribute('title')).toContain(t('player.holdSlower'));
  });

  it('the speed group advertises slower/faster and the nav buttons press', () => {
    const { container } = render(<PlayerBar {...barProps()} />);
    const group = container.querySelector<HTMLElement>('[role="radiogroup"]')!;
    expect(group.getAttribute('title')).toContain(t('rail.speed'));
    expect(group.getAttribute('title')).toContain('/');
    // kvl-press on the nav buttons, the chips and the radios.
    expect(screen.getByRole('button', { name: t('shortcut.prev') }).className).toContain('kvl-press');
    expect(screen.getByRole('button', { name: t('rail.autoPause') }).className).toContain('kvl-press');
    expect(screen.getByRole('radio', { name: '1×' }).className).toContain('kvl-press');
  });

  it('marks the CC button with the indigo dot', () => {
    const { container } = render(<PlayerBar {...barProps()} />);
    const cc = screen.getByRole('button', { name: t('player.netflixSubtitles') });
    expect(cc.className).toContain('relative');
    const dot = cc.querySelector<HTMLElement>('[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain('bg-indigo-500');
    expect(dot!.className).toContain('rounded-full');
    // It must not eat the click.
    expect(dot!.className).toContain('pointer-events-none');
    expect(container.querySelector('[data-kvl-player-bar]')).not.toBeNull();
  });
});
