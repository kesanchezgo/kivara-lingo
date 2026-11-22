/**
 * Native player-bar anchor resolution.
 *
 * The study bar belongs INSIDE the platform's own control row, not in a
 * floating capsule above the picture. Each platform hides/destroys that row
 * when the pointer leaves the player, so the resolver also tracks whether a
 * native anchor was ever seen in the current <video> session: once seen, a
 * teardown is NOT a reason to show the floating fallback — we wait for the
 * site to re-mount its row on pointer activity and re-insert there.
 */
import { useEffect, useState } from 'react';
import type { SubtitleSource } from '../platform-adapters/types';
import { ShadowHost } from '../shadow-host';

type Platform = SubtitleSource['platform'];

/** ID shared with ShadowHost.mountInlineSlot — used everywhere we skip our own slot. */
export const BAR_SLOT_ID = 'kivara-lingo-bar-slot';

/** Containers where each platform mounts its real control row. */
const PLAYER_ROOT_SELECTORS: Record<Platform, readonly string[]> = {
  netflix: ['.watch-video', '.watch-video--player-view', '[data-uia="watch-video"]'],
  youtube: ['.html5-video-player', '#movie_player'],
  disney: ['.btm-media-player', '.btm-media-overlays'],
  hbo: ['[data-testid="player-container"]', '[class*="Fuse-Web-Play"]', '[class*="PlayerContainer"]'],
  prime: ['.webPlayerSDKContainer', '.atvwebplayersdk-player-container'],
  generic: [],
};

export function resolvePlayerRoot(platform: Platform | undefined, video: HTMLVideoElement | null): HTMLElement | null {
  const selectors = PLAYER_ROOT_SELECTORS[platform ?? 'generic'] ?? [];
  for (const sel of selectors) {
    const closest = video?.closest<HTMLElement>(sel);
    if (closest) return closest;
  }
  for (const sel of selectors) {
    const found = video?.ownerDocument?.querySelector<HTMLElement>(sel);
    if (found) return found;
  }
  return (video?.parentElement?.parentElement as HTMLElement | null)
    ?? (video?.parentElement as HTMLElement | null) ?? null;
}

export interface NativeAnchor {
  parent: HTMLElement;
  before: Node | null;
}

const NETFLIX_BUTTONS = [
  '[data-uia="control-next"]',
  '[data-uia="control-episodes"]',
  '[data-uia="control-audio-subtitle"]',
  '[data-uia="control-speed"]',
  '[data-uia^="control-fullscreen-"]',
];

/** Walk up single-child wrappers to the horizontal row the site owns. */
function nonSlotChildren(parent: HTMLElement): Element[] {
  return Array.from(parent.children).filter((c) => c.id !== BAR_SLOT_ID);
}

function firstNonSlotChild(parent: HTMLElement): Node | null {
  return nonSlotChildren(parent)[0] ?? null;
}

function climbToRow(node: HTMLElement, root: HTMLElement): NativeAnchor | null {
  let current = node;
  while (current.parentElement && current !== root) {
    const parent = current.parentElement;
    if (nonSlotChildren(parent).length > 1) return { parent, before: current };
    current = parent;
  }
  // Never escape to document.body: only return an ancestor still inside root.
  return current.parentElement && root.contains(current.parentElement)
    ? { parent: current.parentElement, before: current }
    : null;
}

/** The right-hand group inside a multi-child flex row. */
function rightGroup(row: HTMLElement): NativeAnchor | null {
  const real = nonSlotChildren(row);
  if (real.length === 0) return null;
  const last = real[real.length - 1] as HTMLElement;
  // [leftControls, rightControls] with space-between: insert at the START of
  // the right group, not at the row's midpoint.
  if (
    real.length >= 2 && last.tagName !== 'BUTTON' && last.getAttribute('role') !== 'button'
    && nonSlotChildren(last).length > 0
  ) {
    return { parent: last, before: firstNonSlotChild(last) };
  }
  return { parent: row, before: last };
}

export function findNativeBarAnchor(platform: Platform | undefined, playerRoot: HTMLElement | null): NativeAnchor | null {
  if (!playerRoot) return null;
  const root = playerRoot;
  switch (platform) {
    case 'netflix': {
      for (const selector of NETFLIX_BUTTONS) {
        const button = root.querySelector<HTMLElement>(selector);
        if (button) return climbToRow(button, root);
      }
      return null;
    }
    case 'youtube': {
      const right = root.querySelector<HTMLElement>('.html5-video-player .ytp-right-controls')
        ?? root.querySelector<HTMLElement>('.ytp-right-controls');
      if (!right) return null;
      return { parent: right, before: firstNonSlotChild(right) };
    }
    case 'disney': {
      const row = root.querySelector<HTMLElement>('.controls-bottom-wrap')
        ?? root.querySelector<HTMLElement>('.controls__container');
      const scope = row ?? root;
      for (const sel of ['button[aria-label*="subtitle" i]', 'button[data-uia*="fullscreen" i]', 'button[class*="Fullscreen"]']) {
        const btn = scope.querySelector<HTMLElement>(sel);
        if (btn) { const a = climbToRow(btn, scope); if (a) return a; }
      }
      return row ? rightGroup(row) : null;
    }
    case 'hbo': {
      const row = root.querySelector<HTMLElement>('[class*="ControlsFooterBottom"]');
      const scope = row ?? root;
      for (const sel of ['button[aria-label*="subtitle" i]', 'button[class*="Fullscreen"]']) {
        const btn = scope.querySelector<HTMLElement>(sel);
        if (btn) { const a = climbToRow(btn, scope); if (a) return a; }
      }
      return row ? rightGroup(row) : null;
    }
    case 'prime': {
      const row = root.querySelector<HTMLElement>('.atvwebplayersdk-bottompanel-container');
      const scope = row ?? root;
      for (const sel of ['button[class*="fullscreen" i]', 'button[aria-label*="subtitle" i]']) {
        const btn = scope.querySelector<HTMLElement>(sel);
        if (btn) { const a = climbToRow(btn, scope); if (a) return a; }
      }
      return row ? rightGroup(row) : null;
    }
    default:
      return null;
  }
}

/** Coalesced observer + "seen once" state for one <video> session. */
export class NativeAnchorWatcher {
  private observer: MutationObserver | null = null;
  private frame: number | null = null;
  private root: HTMLElement | null = null;
  private seen = false;
  private anchor: NativeAnchor | null = null;
  private onChange: (() => void) | null = null;
  private platform: Platform | undefined;

  observe(root: HTMLElement | null, onChange: () => void, platform?: Platform): void {
    this.disconnect();
    this.root = root;
    this.onChange = onChange;
    this.platform = platform;
    this.flush();
    if (!root) return;
    this.observer = new MutationObserver(() => {
      if (this.frame !== null) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        this.flush();
      });
    });
    this.observer.observe(root, { childList: true, subtree: true });
  }

  flush(): void {
    this.refresh(this.platform);
  }

  /** Re-evaluate with the concrete platform of the current adapter. */
  refresh(platform: Platform | undefined): void {
    this.platform = platform;
    const next = findNativeBarAnchor(platform, this.root);
    const changed = next?.parent !== this.anchor?.parent || next?.before !== this.anchor?.before;
    this.anchor = next;
    if (next) this.seen = true;
    if (changed) this.onChange?.();
  }

  hasSeenNativeAnchor(): boolean { return this.seen; }
  currentAnchor(): NativeAnchor | null { return this.anchor; }
  shouldUseFloating(): boolean { return !this.seen; }

  disconnect(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.root = null;
    this.onChange = null;
    this.anchor = null;
    this.seen = false;
  }
}

export interface NativeBarState {
  reactRoot: HTMLElement | null;
  allowFloating: boolean;
}

/**
 * Owns the native-slot lifecycle for one <video> session. Once a native
 * anchor was seen, an idle teardown must NOT restore the floating capsule —
 * only a new video (or disabled extension) returns to the floating fallback.
 */
export function useNativeBarSlot(
  enabled: boolean,
  platform: Platform | undefined,
  videoElement: HTMLVideoElement | null,
): NativeBarState {
  const [state, setState] = useState<NativeBarState>({ reactRoot: null, allowFloating: true });
  useEffect(() => {
    setState({ reactRoot: null, allowFloating: true });
    if (!enabled) return;
    const watcher = new NativeAnchorWatcher();
    let mounted: ReturnType<typeof ShadowHost.mountInlineSlot> | null = null;
    const root = resolvePlayerRoot(platform, videoElement);
    const onChange = () => {
      const anchor = watcher.currentAnchor();
      if (anchor) {
        if (!mounted) mounted = ShadowHost.mountInlineSlot(anchor);
        else if (mounted.hostElement.parentElement !== anchor.parent || mounted.hostElement.nextSibling !== anchor.before) {
          const ref = anchor.before && anchor.before !== mounted.hostElement
            && anchor.before.parentNode === anchor.parent ? anchor.before : null;
          anchor.parent.insertBefore(mounted.hostElement, ref);
        }
        setState({ reactRoot: mounted.reactRoot, allowFloating: false });
      } else {
        mounted?.destroy();
        mounted = null;
        setState({ reactRoot: null, allowFloating: watcher.shouldUseFloating() });
      }
    };
    watcher.observe(root, onChange, platform);
    return () => {
      watcher.disconnect();
      mounted?.destroy();
      setState({ reactRoot: null, allowFloating: true });
    };
  }, [enabled, videoElement, platform]);
  return state;
}

export function shouldRenderFloatingStudyBar(
  enabled: boolean,
  videoOverlayRoot: HTMLElement | null | undefined,
  nativeBar: NativeBarState,
): boolean {
  return Boolean(enabled && videoOverlayRoot && nativeBar.allowFloating && !nativeBar.reactRoot);
}
