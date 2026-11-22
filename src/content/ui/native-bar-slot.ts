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
import type { SubtitleSource } from '../platform-adapters/types';

type Platform = SubtitleSource['platform'];

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
function climbToRow(node: HTMLElement, root: HTMLElement): NativeAnchor | null {
  let current = node;
  while (current.parentElement && current.parentElement !== root.parentElement) {
    const parent = current.parentElement;
    if (parent.children.length > 1) return { parent, before: current };
    current = parent;
  }
  return current.parentElement ? { parent: current.parentElement, before: current } : null;
}

/** The right-hand group inside a multi-child flex row. */
function rightGroup(row: HTMLElement): NativeAnchor | null {
  const last = row.lastElementChild;
  if (!last) return null;
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
      return { parent: right, before: right.firstChild };
    }
    case 'disney': {
      const row = root.querySelector<HTMLElement>('.controls-bottom-wrap')
        ?? root.querySelector<HTMLElement>('.controls__container');
      return row ? rightGroup(row) : null;
    }
    case 'hbo': {
      const row = root.querySelector<HTMLElement>('[class*="ControlsFooterBottom"]');
      return row ? rightGroup(row) : null;
    }
    case 'prime': {
      const row = root.querySelector<HTMLElement>('.atvwebplayersdk-bottompanel-container');
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
