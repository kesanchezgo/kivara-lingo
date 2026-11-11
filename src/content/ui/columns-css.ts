/**
 * Right-side reservation per platform (F6 · docs/REDESIGN-V2.md §3 H11,
 * decision D1).
 *
 * Netflix and Max paint their player as a fixed layer over the whole viewport:
 * a transcript column drawn on top would hide the picture. The prototype's
 * answer — and v2's — is to SHRINK the player by the rail's width. This module
 * injects that CSS the same way `cleanup-css.ts` injects the visual cleanup:
 * one owned `<style>` node, idempotent, removed when the rail closes.
 *
 * Fullscreen reuses `fullscreen-overlay-core.ts`, which moves the overlay host
 * inside the fullscreen element; the rule below caps the video width there so
 * the column still has room.
 */
import type { SubtitleSource } from '../platform-adapters/types';

export const RAIL_WIDTH_PX = 400;

type Platform = SubtitleSource['platform'];

interface ColumnsRules {
  /** Windowed: the player root that must give up `--kvl-col` on the right. */
  shrink: string[];
  /** Roots positioned with `width` instead of `right`. */
  resize: string[];
}

const RULES: Record<Platform, ColumnsRules> = {
  youtube: {
    // The watch page lays the player inside a flex column; `width` is what
    // actually moves the right edge. `right` would do nothing on a static box.
    shrink: [],
    resize: ['.html5-video-player', '#movie_player'],
  },
  netflix: {
    shrink: ['.watch-video', '.watch-video--player-view', '[data-uia="watch-video"]'],
    resize: [],
  },
  hbo: {
    shrink: ['[data-testid="player-container"]', '#root'],
    resize: [],
  },
  disney: {
    shrink: ['.btm-media-player', '.btm-media-overlays'],
    resize: [],
  },
  prime: {
    shrink: ['.webPlayerSDKContainer', '.atvwebplayersdk-player-container'],
    resize: [],
  },
  generic: { shrink: [], resize: [] },
};

export interface ColumnsCssOptions {
  enabled: boolean;
  platform?: SubtitleSource['platform'];
  widthPx?: number;
}

export function buildColumnsCss({ enabled, platform, widthPx = RAIL_WIDTH_PX }: ColumnsCssOptions): string {
  if (!enabled) return '';
  const rules = RULES[platform ?? 'generic'] ?? RULES.generic;
  const width = Math.max(280, Math.round(widthPx));
  const blocks: string[] = [];

  if (rules.shrink.length > 0) {
    blocks.push(`${Array.from(new Set(rules.shrink)).join(',\n')} {
      right: ${width}px !important;
    }`);
  }
  if (rules.resize.length > 0) {
    // `calc(100% - width)` keeps the player's own aspect handling; only the
    // right edge moves, so the native controls stay where the site drew them.
    blocks.push(`${Array.from(new Set(rules.resize)).join(',\n')} {
      width: calc(100% - ${width}px) !important;
      max-width: calc(100vw - ${width}px) !important;
    }`);
  }
  // Fullscreen: the rail host is inside the fullscreen element, so the video
  // gives up the same strip instead of being covered.
  blocks.push(`:fullscreen video {
    max-width: calc(100% - ${width}px) !important;
  }`);
  return blocks.join('\n\n');
}

/** Inject (or remove) the reservation style. Idempotent per platform. */
export function applyColumnsCss(options: ColumnsCssOptions): void {
  const id = `kivara-columns-${options.platform ?? 'generic'}`;
  const existing = document.getElementById(id) as HTMLStyleElement | null;
  const css = buildColumnsCss(options);
  if (!css) {
    existing?.remove();
    document.documentElement.removeAttribute('data-kvl-columns');
    return;
  }
  const style = existing ?? document.createElement('style');
  style.id = id;
  style.textContent = css;
  if (!existing) document.documentElement.appendChild(style);
  document.documentElement.setAttribute('data-kvl-columns', '1');
}
