/**
 * RED TESTS — PR #158 audit closeout (base main@b53efb1).
 * All assertions exercise real DOM/React behaviour, never source text.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldRenderFloatingStudyBar, useNativeBarSlot } from '../../src/content/ui/native-bar-slot';
import React from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { ShadowHost } from '../../src/content/shadow-host';
import {
  BAR_SLOT_ID,
  NativeAnchorWatcher,
  findNativeBarAnchor,
  resolvePlayerRoot,
} from '../../src/content/ui/native-bar-slot';
import { StudyBar } from '../../src/content/ui/StudyBar';
import { t } from '../../src/shared/i18n';

const el = (tag: string, cls = '', uia = ''): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (uia) e.setAttribute('data-uia', uia);
  return e;
};

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('1 — idempotent mount on YouTube', () => {
  it('repeated watcher flushes keep ONE slot and the same hostElement', () => {
    const player = el('div', 'html5-video-player');
    const right = el('div', 'ytp-right-controls');
    const first = el('button', 'ytp-button');
    right.append(first, el('button', 'ytp-button'));
    player.append(right);
    document.body.append(player);
    const watcher = new NativeAnchorWatcher();
    let mounted: ReturnType<typeof ShadowHost.mountInlineSlot> | null = null;
    watcher.observe(player, () => {
      const anchor = watcher.currentAnchor();
      if (anchor && !mounted) mounted = ShadowHost.mountInlineSlot(anchor);
    }, 'youtube');
    const host = document.getElementById(BAR_SLOT_ID)!;
    expect(host).not.toBeNull();
    expect(() => { for (let i = 0; i < 5; i++) watcher.flush(); }).not.toThrow();
    expect(document.querySelectorAll(`#${BAR_SLOT_ID}`)).toHaveLength(1);
    expect(mounted!.hostElement).toBe(host);
    watcher.disconnect();
    mounted!.destroy();
  });
});

describe('1 — resolvePlayerRoot + real platform hierarchies', () => {
  it('finds Prime/HBO/Disney/YouTube/Netflix containers from the <video>', () => {
    const cases: Array<[string, string, string]> = [
      ['prime', 'webPlayerSDKContainer', 'atvwebplayersdk-bottompanel-container'],
      ['hbo', 'Fuse-Web-Play', 'ControlsFooterBottom'],
      ['disney', 'btm-media-player', 'controls-bottom-wrap'],
      ['youtube', 'html5-video-player', 'ytp-right-controls'],
      ['netflix', 'watch-video', 'PlayerControlsNeo__bottom-controls'],
    ];
    for (const [platform, outer, inner] of cases) {
      const rootEl = el('div', outer);
      const row = el('div', inner);
      const left = el('div', 'left');
      const right = el('div', 'right');
      right.append(el('button', 'ytp-button', 'control-audio-subtitle'));
      row.append(left, right);
      rootEl.append(row);
      document.body.append(rootEl);
      const video = el('video') as HTMLVideoElement;
      rootEl.append(video);
      const resolved = resolvePlayerRoot(platform as never, video);
      expect(resolved, platform).toBeTruthy();
      expect(findNativeBarAnchor(platform as never, resolved), platform).not.toBeNull();
      document.body.innerHTML = '';
    }
  });

  it('inserts inside the RIGHT group when a row is [leftGroup, rightGroup]', () => {
    const rootEl = el('div', 'watch-video');
    const row = el('div', 'PlayerControlsNeo__bottom-controls');
    const left = el('div', 'left');
    const right = el('div', 'right');
    right.append(el('button'), el('button'), el('button', '', 'control-next'));
    row.append(left, right);
    rootEl.append(row);
    document.body.append(rootEl);
    const anchor = findNativeBarAnchor('netflix', rootEl);
    expect(anchor).not.toBeNull();
    // row has 2 real children: anchor must be INSIDE the right group, not
    // floating in the middle of the row.
    expect(row.parentElement).toBe(rootEl);
    expect(anchor!.parent).toBe(right);
    expect(right.contains(anchor!.before!)).toBe(true);
  });
});

describe('3 — StudyBar native variant', () => {
  const base = {
    enabled: true, variant: 'native' as const, platform: 'netflix' as const,
    playing: true, onTogglePlay: vi.fn(), onPrev: vi.fn(), onReplay: vi.fn(), onReplaySlow: vi.fn(), onNext: vi.fn(),
    autoPause: false, onToggleAutoPause: vi.fn(), loop: false, onToggleLoop: vi.fn(),
    speed: 1, onSpeed: vi.fn(), railOpen: false, onToggleRail: vi.fn(), panelOpen: false, onTogglePanel: vi.fn(),
  };

  it('1× has ONE separator, no text labels on first render, and shows Prev/Next with no measurable video', () => {
    render(<StudyBar {...base} />);
    const seps = document.querySelectorAll('[role="toolbar"] > span[aria-hidden="true"]');
    expect(seps).toHaveLength(2);
    expect(screen.queryByText(t('rail.autoPauseShort'))).toBeNull();
    expect(screen.queryByText(t('rail.loop'))).toBeNull();
    expect(screen.queryByLabelText(t('shortcut.prev'))).not.toBeNull();
    expect(screen.queryByLabelText(t('shortcut.next'))).not.toBeNull();
  });

  it('speed != 1 adds a single reset chip plus its own separator', () => {
    render(<StudyBar {...base} speed={1.25} />);
    expect(screen.getByText('1.25×')).not.toBeNull();
    expect(document.querySelectorAll('[role="toolbar"] > span[aria-hidden="true"]')).toHaveLength(3);
  });
});

describe('1 — keyboard guards', () => {
  it('Space/Enter stop at the slot; f / ArrowRight and pointermove reach document', () => {
    const row = el('div');
    document.body.append(row);
    const slot = ShadowHost.mountInlineSlot({ parent: row, before: null });
    const onKey = vi.fn();
    const onMove = vi.fn();
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointermove', onMove);
    for (const key of [' ', 'Enter']) {
      slot.hostElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
    expect(onKey).toHaveBeenCalledTimes(0);
    for (const key of ['f', 'ArrowRight']) {
      slot.hostElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
    expect(onKey).toHaveBeenCalledTimes(2);
    slot.hostElement.dispatchEvent(new Event('pointermove', { bubbles: true }));
    expect(onMove).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointermove', onMove);
    slot.destroy();
  });
});

describe('PR159 closeout — hook, separators, idle watcher', () => {
  it('native 1× has two NON-ADJACENT separators; 1.25× has three', () => {
    const base = {
      enabled: true, variant: 'native' as const, platform: 'netflix' as const,
      playing: true, onTogglePlay: vi.fn(), onPrev: vi.fn(), onReplay: vi.fn(), onReplaySlow: vi.fn(), onNext: vi.fn(),
      autoPause: false, onToggleAutoPause: vi.fn(), loop: false, onToggleLoop: vi.fn(),
      speed: 1, onSpeed: vi.fn(), railOpen: false, onToggleRail: vi.fn(), panelOpen: false, onTogglePanel: vi.fn(),
    };
    const { unmount } = render(<StudyBar {...base} />);
    let direct = Array.from(document.querySelector('[role="toolbar"]')!.children);
    let seps = direct.filter((e) => e.getAttribute('aria-hidden') === 'true');
    expect(seps).toHaveLength(2);
    for (let i = 1; i < direct.length; i++) {
      expect(direct[i - 1].getAttribute('aria-hidden') === 'true' && direct[i].getAttribute('aria-hidden') === 'true').toBe(false);
    }
    unmount();
    render(<StudyBar {...base} speed={1.25} />);
    direct = Array.from(document.querySelector('[role="toolbar"]')!.children);
    seps = direct.filter((e) => e.getAttribute('aria-hidden') === 'true');
    expect(seps).toHaveLength(3);
    for (let i = 1; i < direct.length; i++) {
      expect(direct[i - 1].getAttribute('aria-hidden') === 'true' && direct[i].getAttribute('aria-hidden') === 'true').toBe(false);
    }
  });

  it('a YouTube watcher with a live slot fires onChange exactly ONCE across 5 flushes', () => {
    const player = el('div', 'html5-video-player');
    const right = el('div', 'ytp-right-controls');
    const first = el('button', 'ytp-button');
    right.append(first, el('button', 'ytp-button'));
    player.append(right);
    document.body.append(player);
    const watcher = new NativeAnchorWatcher();
    // Mount the REAL inline slot from the callback: a watcher that used
    // `right.firstChild` instead of the first NON-slot child would re-anchor
    // on the slot itself on the next flush and fire onChange again.
    let slot: ReturnType<typeof ShadowHost.mountInlineSlot> | null = null;
    const onChange = vi.fn(() => {
      const anchor = watcher.currentAnchor();
      if (anchor && !document.getElementById(BAR_SLOT_ID)) slot = ShadowHost.mountInlineSlot(anchor);
    });
    watcher.observe(player, onChange, 'youtube');
    expect(slot).not.toBeNull();
    expect(slot!.hostElement.parentElement).toBe(right);
    expect(Array.from(right.children).filter((child) => child.id !== BAR_SLOT_ID)[0]).toBe(first);
    for (let i = 0; i < 5; i++) watcher.flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll(`#${BAR_SLOT_ID}`)).toHaveLength(1);
    watcher.disconnect();
    slot!.destroy();
  });

  it('[leftGroup, rightGroup] fallback inserts inside the right group for hbo/disney/prime', () => {
    for (const [platform, cls] of [
      ['hbo', 'ControlsFooterBottom'],
      ['disney', 'controls-bottom-wrap'],
      ['prime', 'atvwebplayersdk-bottompanel-container'],
    ]) {
      const root = el('div', 'watch-video');
      const row = el('div', cls);
      const left = el('div', 'left');
      const right = el('div', 'right');
      right.append(el('button'), el('button'));
      row.append(left, right);
      root.append(row);
      // A subtitle modal OUTSIDE the bottom row must never win — an older
      // resolver grabbed the first Fullscreen/subtitle button in the whole
      // player, including modals.
      const modal = el('div', 'subtitle-modal');
      modal.append(el('button', 'modal-fullscreen'));
      root.append(modal);
      document.body.append(root);
      const anchor = findNativeBarAnchor(platform as never, root);
      expect(anchor?.parent, platform).toBe(right);
      expect(anchor?.before, platform).toBe(right.firstChild);
      document.body.innerHTML = '';
    }
  });
});

describe('PR159 — useNativeBarSlot / shouldRenderFloatingStudyBar', () => {
  function Probe({ enabled, platform, video }: { enabled: boolean; platform: never; video: HTMLVideoElement | null }) {
    const state = useNativeBarSlot(enabled, platform, video);
    return (
      <div
        data-testid="probe"
        data-root={state.reactRoot ? 'yes' : 'no'}
        data-floating={String(state.allowFloating)}
        data-render={String(shouldRenderFloatingStudyBar(enabled, document.createElement('div'), state))}
      />
    );
  }

  it('no native row → floating allowed; after seen + idle teardown → still blocked; new video → allowed', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id as unknown as NodeJS.Timeout));
    const player = el('div', 'watch-video');
    const video = el('video') as HTMLVideoElement;
    player.append(video);
    document.body.append(player);
    const view = render(<Probe enabled platform={'youtube' as never} video={video} />);
    const probe = () => screen.getByTestId('probe');
    expect(probe().getAttribute('data-floating')).toBe('true');
    expect(probe().getAttribute('data-render')).toBe('true');

    const row = el('div', 'ytp-right-controls');
    const right = el('div', 'right');
    right.append(el('button', '', 'control-next'));
    row.append(el('button', 'left'), right);
    player.append(row);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(probe().getAttribute('data-root')).toBe('yes');
    expect(probe().getAttribute('data-floating')).toBe('false');
    expect(probe().getAttribute('data-render')).toBe('false');
    expect(document.getElementById('kivara-lingo-bar-slot')).not.toBeNull();

    row.remove();
    // A second DOM write guarantees the coalesced observer runs even if the
    // first teardown mutation landed before the observer was armed.
    const nudge = el('div');
    player.append(nudge);
    nudge.remove();
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(probe().getAttribute('data-root')).toBe('no');
    expect(document.getElementById('kivara-lingo-bar-slot')).toBeNull();
    expect(probe().getAttribute('data-floating')).toBe('false');
    expect(probe().getAttribute('data-render')).toBe('false');

    // SPA navigation: a NEW <video> resets the session.
    const video2 = el('video') as HTMLVideoElement;
    player.append(video2);
    view.rerender(<Probe enabled platform={'youtube' as never} video={video2} />);
    expect(probe().getAttribute('data-floating')).toBe('true');
    expect(probe().getAttribute('data-render')).toBe('true');
    vi.useRealTimers();
  });
});
