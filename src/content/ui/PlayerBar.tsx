/**
 * Kivara-owned player bar (PR #171): the floating tray.
 *
 * A modern dock that replaces Netflix's own chrome entirely — `inset-x-4
 * bottom-3`, glass, rounded — with the three balanced zones the mock draws:
 * video controls on the left, the Kivara study capsule in the middle, tracks /
 * columns / fullscreen on the right.
 *
 * Progress, volume and seek are REAL: seek always goes through the adapter /
 * MAIN-world Cadmium bridge (Netflix M7375 forbids direct `currentTime` writes),
 * volume rides the same path, and fullscreen is requested synchronously inside
 * the user's gesture so Chromium keeps its user activation.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlignLeft, ChevronLeft, ChevronRight, Layers, Maximize, Pause, Play, Repeat,
  RotateCcw, SkipForward, Subtitles, Volume1, Volume2,
} from '../../ui/icons';
import { BrandGlyph } from '../../ui/BrandGlyph';
import { t } from '../../shared/i18n';
import { useLongPress } from '../../ui/hooks/useLongPress';
import { onRadioKeyDown, radioTabIndex } from '../../ui/primitives/settings-primitives';
import { PLAYBACK_SPEEDS } from '../platform-adapters/playback';
import { useKivaraStore } from '../../shared/use-kivara-store';
import { nativePopupOpen } from './cleanup-css';
import { resolvePlayerRoot } from './native-bar-slot';
import { comboOf, withCombo } from './combo-hints';
import { usePlaybackTimeMs } from './useStudyPlayback';
import { PlayerTrackPopover } from './PlayerTrackPopover';
import { PlayerEpisodesPopover } from './PlayerEpisodesPopover';
import { listEpisodesThroughMainWorld } from '../platform-adapters/netflix-main-bridge';
import type { NetflixEpisodesCatalog } from '../platform-adapters/netflix-episodes';

interface PlayerBarProps {
  playing: boolean;
  duration: number;
  video?: HTMLVideoElement | null;
  autoPauseCue: boolean;
  loopCue: boolean;
  speed: number;
  railOpen: boolean;
  panelOpen: boolean;
  /** A clean capture is running: the bar must not dirty the frame. */
  capturing?: boolean;
  onTogglePlay: () => void;
  onPrev: () => void;
  onReplay: () => void;
  onReplaySlow: () => void;
  onNext: () => void;
  onToggleAutoPause: () => void;
  onToggleLoop: () => void;
  onSpeed: (value: number) => void;
  onToggleRail: () => void;
  onTogglePanel: () => void;
  /** ALWAYS the adapter/controller seek — Netflix M7375 forbids direct currentTime writes. */
  onSeek: (timeMs: number) => void;
  /** Bring Netflix's detached native row back before forwarding a native action. */
  onWakeNative: () => void;
  /**
   * Volume/mute go through the platform controller (MAIN-world Cadmium on
   * Netflix) so the level survives episode and audio-track switches. Absent,
   * the element is the fallback.
   */
  onSetVolume?: (volume: number) => void;
  onSetMuted?: (muted: boolean) => void;
  /**
   * Auto-hide state and measured height, so the caption can lift clear of the
   * bar. Fires on every visibility flip and every resize. The height is this
   * element's OWN border box: the 12px gap under the tray (`bottom-3`) is added
   * by `App`, which knows whether it is the owned bar that is on screen.
   */
  onVisibilityChange?: (visible: boolean, heightPx: number) => void;
  /**
   * A native popup (the CC list, the episodes drawer) is open, so the tray
   * has yielded the pointer. The other pieces of our chrome need it too:
   * the top bar must not cover the menu and the skip pill has no business
   * offering a button while a native list owns the screen.
   */
  onPopupChange?: (open: boolean) => void;
  /** The subtitle watcher must not undo a choice made in OUR menu. */
  onManualSubtitleChoice?: () => void;
  /** Kivara's subtitles are on: the tray's CC dot mirrors the store. */
  subtitlesVisible?: boolean;
}

/**
 * Leaving fullscreen needs an icon the set does not ship (the project has only
 * `Maximize`): the classic four inward arrows, drawn here with the same 1.5
 * stroke weight the rest of the chrome uses. Inline on purpose — the icon
 * builder is a generated file and a new dependency is not allowed.
 */
function ExitFullscreenIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 4v5H4" />
      <path d="M15 4v5h5" />
      <path d="M9 20v-5H4" />
      <path d="M15 20v-5h5" />
    </svg>
  );
}

/** The gap the floating tray leaves under itself (`bottom-3`). */
export const OWNED_BAR_BOTTOM_OFFSET_PX = 12;

const NAV = 'w-7 h-7 rounded-md flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/[0.08] kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40';
const chip = (on: boolean) => `h-7 px-2 rounded-md flex items-center gap-1.5 text-[12px] font-medium kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${on ? 'bg-indigo-500 text-white' : 'text-zinc-300 hover:text-white hover:bg-white/[0.08]'}`;
const SMALL = 'w-8 h-8 rounded-lg flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/[0.08] kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40';
const HIDE_AFTER_MS = 3000;
const TEN_SECONDS_MS = 10_000;

/**
 * `M:SS` up to an hour, `H:MM:SS` past it. A 62-minute episode reading "62:15"
 * is the kind of thing a video player never does.
 */
function fmtTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(seconds).padStart(2, '0')}`;
}

function SeekBar({ duration, onSeek, interactive, video }: {
  duration: number;
  onSeek: (ms: number) => void;
  /** The bar is on screen and no native popup owns the pointer. */
  interactive: boolean;
  video?: HTMLVideoElement | null;
}) {
  const time = usePlaybackTimeMs();
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragMs, setDragMs] = useState<number | null>(null);
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const [bufferedMs, setBufferedMs] = useState(0);
  const shown = dragMs ?? time;
  const pct = duration > 0 ? Math.min(100, Math.max(0, (shown / duration) * 100)) : 0;
  const bufferPct = duration > 0 ? Math.min(100, Math.max(0, (bufferedMs / duration) * 100)) : 0;
  // The global listeners of an in-flight drag, so an unmount mid-drag cannot
  // leave them attached to `window` (they would keep seeking a dead bar).
  const dragCleanup = useRef<(() => void) | null>(null);

  // The loaded ranges, so the bar shows what is actually seekable instead of a
  // flat track. `buffered` is a TimeRanges: its END is what a player paints.
  useEffect(() => {
    if (!video) return;
    const sync = () => {
      const ranges = video.buffered;
      setBufferedMs(ranges && ranges.length > 0 ? ranges.end(ranges.length - 1) * 1000 : 0);
    };
    video.addEventListener('progress', sync);
    video.addEventListener('timeupdate', sync);
    video.addEventListener('loadedmetadata', sync);
    sync();
    return () => {
      video.removeEventListener('progress', sync);
      video.removeEventListener('timeupdate', sync);
      video.removeEventListener('loadedmetadata', sync);
    };
  }, [video]);

  const fromClientX = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || duration <= 0) return 0;
    return Math.max(0, Math.min(duration, Math.round(((clientX - rect.left) / rect.width) * duration)));
  };

  const commit = useCallback((value: number) => {
    setDragMs(null);
    onSeek(value);
  }, [onSeek]);

  useEffect(() => () => { dragCleanup.current?.(); }, []);

  return (
    // The POINTER surface is this padded container: `py-2` gives 20 px of
    // height over a 6 px track, so the user does not have to hit a hairline.
    // `pointer-events` is explicit because the bar root sets `none`.
    <div
      data-kvl-seek-hit=""
      className={`group/seek relative py-2 ${interactive ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'}`}
      onMouseMove={(e) => { if (interactive) setHoverMs(fromClientX(e.clientX)); }}
      onMouseLeave={() => setHoverMs(null)}
      onMouseDown={(e) => {
        if (!interactive) return;
        const value = fromClientX(e.clientX);
        setDragMs(value);
        const move = (ev: MouseEvent) => setDragMs(fromClientX(ev.clientX));
        const up = (ev: MouseEvent) => {
          const finalValue = fromClientX(ev.clientX);
          dragCleanup.current?.();
          commit(finalValue);
        };
        dragCleanup.current = () => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          dragCleanup.current = null;
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      }}
    >
      <div
        ref={trackRef}
        role="slider"
        aria-label={t('player.seek')}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={fmtTime(shown)}
        tabIndex={interactive ? 0 : -1}
        className="w-full h-1.5 group-hover/seek:h-2 transition-all bg-white/[0.16] rounded-full relative outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
        onKeyDown={(e) => {
          if (!interactive) return;
          const delta = e.key === 'ArrowRight' ? 5_000 : e.key === 'ArrowLeft' ? -5_000
            : e.key === 'PageUp' ? 10_000 : e.key === 'PageDown' ? -10_000 : 0;
          if (e.key === 'Home') { e.preventDefault(); commit(0); return; }
          if (e.key === 'End') { e.preventDefault(); commit(duration); return; }
          if (!delta) return;
          e.preventDefault();
          e.stopPropagation();
          commit(Math.max(0, Math.min(duration, Math.round(time + delta))));
        }}
      >
        {/* What is loaded, behind the head. */}
        <div
          data-kvl-seek-buffer=""
          className="absolute top-0 left-0 h-full bg-white/[0.24] rounded-full pointer-events-none"
          style={{ width: `${bufferPct}%` }}
        />
        <div
          data-kvl-seek-progress=""
          className="absolute top-0 left-0 h-full bg-indigo-500 rounded-full pointer-events-none"
          style={{ width: `${pct}%` }}
        />
        <div
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white shadow ring-2 ring-indigo-500/40 transition-transform pointer-events-none ${
            dragMs !== null ? 'scale-100' : 'scale-0 group-hover/seek:scale-100 group-focus-within/seek:scale-100'
          }`}
          style={{ left: `${pct}%` }}
        />
        {hoverMs !== null && duration > 0 && (
          <span
            className="absolute -top-8 -translate-x-1/2 rounded-lg bg-zinc-900/95 ring-1 ring-white/10 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white pointer-events-none"
            style={{ left: `${Math.min(100, Math.max(0, (hoverMs / duration) * 100))}%` }}
          >
            {fmtTime(hoverMs)}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The clock, and the total/remaining switch Netflix has: one click flips
 * between "how long is this" and "how much is left".
 */
function TimeReadout({ duration, compact = false }: { duration: number; compact?: boolean }) {
  const time = usePlaybackTimeMs();
  const [remaining, setRemaining] = useState(false);
  const left = Math.max(0, duration - time);
  return (
    <button
      type="button"
      data-kvl-time-readout=""
      onClick={() => setRemaining((value) => !value)}
      title={remaining ? t('player.timeTotal') : t('player.timeLeft')}
      aria-label={`${remaining ? t('player.timeTotal') : t('player.timeLeft')} ${fmtTime(time)}`}
      className={`${compact ? '' : 'px-1'} text-[13px] font-medium tabular-nums whitespace-nowrap text-zinc-200 hover:text-white kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 rounded-md`}
    >
      {remaining ? `${fmtTime(time)} · -${fmtTime(left)}` : `${fmtTime(time)} / ${fmtTime(duration)}`}
    </button>
  );
}

function VolumeControl({ video, onSetVolume, onSetMuted }: {
  video?: HTMLVideoElement | null;
  onSetVolume?: (volume: number) => void;
  onSetMuted?: (muted: boolean) => void;
}) {
  const [muted, setMutedState] = useState(() => video?.muted ?? false);
  const [volume, setVolumeState] = useState(() => video?.volume ?? 1);
  // The element is the READ side even when the write goes through Cadmium:
  // `volumechange` is what the platform emits after either path applies.
  useEffect(() => {
    if (!video) return;
    const sync = () => { setMutedState(video.muted); setVolumeState(video.volume); };
    video.addEventListener('volumechange', sync);
    sync();
    return () => video.removeEventListener('volumechange', sync);
  }, [video]);
  // The level to come back to when the user unmutes at 0. Seeded from the
  // element so a profile that starts at 40 % restores 40 %, not 100 %.
  const lastNonZeroVolumeRef = useRef(
    video?.volume && video.volume > 0 ? video.volume : 1,
  );
  const applyVolume = (value: number) => {
    if (onSetVolume) onSetVolume(value);
    else if (video) video.volume = value;
  };
  const applyMuted = (value: boolean) => {
    if (onSetMuted) onSetMuted(value);
    else if (video) video.muted = value;
  };
  const toggleMute = () => {
    // `volume === 0` is "effectively muted" even when the flag is false: the
    // old code unmuted silently and left the button reading "Activar sonido".
    const wasMuted = muted || volume === 0;
    const nowMuted = !wasMuted;
    // Optimistic UI: the MAIN-world round trip is async and the platform's
    // echo may be late on an audio-track switch.
    setMutedState(nowMuted);
    if (nowMuted) {
      applyMuted(true);
      return;
    }
    // Coming back from silence: restore a real level, not zero.
    if (volume === 0) {
      const restored = lastNonZeroVolumeRef.current || 1;
      setVolumeState(restored);
      applyVolume(restored);
    }
    applyMuted(false);
  };
  const change = (value: number) => {
    if (value > 0) lastNonZeroVolumeRef.current = value;
    setVolumeState(value);
    setMutedState(value === 0);
    applyVolume(value);
    // Raising the slider out of silence must also clear the mute flag on the
    // platform, or Cadmium stays muted while the UI shows a level.
    if (value > 0 && (muted || video?.muted)) applyMuted(false);
    else if (value === 0) applyMuted(true);
  };
  const level = muted ? 0 : volume;
  return (
    <div className="flex items-center gap-1.5 group/volume">
      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted || volume === 0 ? t('player.unmute') : t('player.mute')}
        className={SMALL}
      >
        {muted || volume === 0 ? <Volume1 size={18} /> : <Volume2 size={18} />}
      </button>
      {/* The Kivara track slides out on hover/focus; the REAL input lives on
          top of it, invisible but fully functional (keyboard, screen readers,
          and the `fireEvent.change` the older specs drive). */}
      <div className="relative flex items-center w-0 overflow-hidden group-hover/volume:w-20 group-focus-within/volume:w-20 transition-[width] duration-200">
        <div data-kvl-volume-track="" aria-hidden="true" className="relative w-20 h-1.5 rounded-full bg-white/[0.18]">
          <div className="absolute inset-y-0 left-0 rounded-full bg-indigo-400" style={{ width: `${Math.round(level * 100)}%` }} />
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white shadow pointer-events-none"
            style={{ left: `${Math.round(level * 100)}%` }}
          />
        </div>
        <input
          type="range" min={0} max={1} step={0.05} value={level}
          aria-label={t('player.volume')}
          onChange={(e) => change(Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
      </div>
    </div>
  );
}

/**
 * Whether a native popup is open. The selector list is the ONE canonical one
 * from `cleanup-css` (the sheet that hides the native row exempts exactly
 * these); the generic menu/dialog selectors are scoped to the player root
 * there, so a page-level dialog never makes the bar yield.
 */
function popupOpenNow(): boolean {
  const platform = document.getElementById('kivara-owned-bar-netflix') ? 'netflix' : undefined;
  const root = platform
    ? resolvePlayerRoot('netflix', document.querySelector<HTMLVideoElement>('video'))
    : null;
  return nativePopupOpen(root ?? document.body);
}

/**
 * Whether the host currently exposes a native control. Netflix MOUNTS its
 * buttons on activity and removes them after a few idle seconds, so a plain
 * `document.querySelector` at render time would hide the button forever after
 * the first idle period. The observer keeps the answer live in both directions
 * — a dead button is never rendered on a movie, and the episodes button
 * appears as soon as the host mounts its control.
 */
function useNativeControl(selector: string): boolean {
  const [present, setPresent] = useState(() => typeof document !== 'undefined' && !!document.querySelector(selector));
  useEffect(() => {
    const check = () => setPresent(!!document.querySelector(selector));
    check();
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(check) : null;
    observer?.observe(document.documentElement, { childList: true, subtree: true });
    return () => observer?.disconnect();
  }, [selector]);
  return present;
}

/** Wake Netflix's detached native row, then click the real control. */
function nativeClick(selector: string, wake: () => void): void {
  wake();
  window.setTimeout(() => {
    document.querySelector<HTMLElement>(selector)?.click();
  }, 80);
}

export function PlayerBar({
  playing, duration: durationProp, video, autoPauseCue, loopCue, speed, railOpen, panelOpen,
  capturing = false,
  onTogglePlay, onPrev, onReplay, onReplaySlow, onNext,
  onToggleAutoPause, onToggleLoop, onSpeed, onToggleRail, onTogglePanel,
  onSeek, onWakeNative, onSetVolume, onSetMuted, onVisibilityChange, onPopupChange,
  onManualSubtitleChoice, subtitlesVisible = true,
}: PlayerBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(Infinity);
  const [height, setHeight] = useState(0);
  const [visible, setVisible] = useState(true);
  const [popupOpen, setPopupOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const hideTimer = useRef<number | null>(null);
  // The duration the element reports. A `<video>` that mounts before metadata
  // answers `NaN`; reading it once at render left the bar at `0:00 / 0:00`
  // for the whole episode because the element reference never changed.
  const [liveDurationMs, setLiveDurationMs] = useState<number | null>(null);
  useEffect(() => {
    if (!video) return;
    const sync = () => {
      setLiveDurationMs(
        Number.isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 : null,
      );
    };
    video.addEventListener('loadedmetadata', sync);
    video.addEventListener('durationchange', sync);
    sync();
    return () => {
      video.removeEventListener('loadedmetadata', sync);
      video.removeEventListener('durationchange', sync);
    };
  }, [video]);
  const duration = liveDurationMs ?? durationProp;
  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    // BORDER box, not content box: the tray's own padding is part of the chrome
    // the caption must clear, and the `bottom-3` gap is added by App (which is
    // the side that knows whether the owned bar is even on screen).
    const observer = new ResizeObserver(([entry]) => {
      const border = entry.borderBoxSize?.[0];
      setWidth(Math.round(border ? border.inlineSize : entry.contentRect.width));
      setHeight(Math.round(border ? border.blockSize : entry.contentRect.height));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const wake = () => {
      setVisible(true);
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      if (!playing || openPopoverRef.current !== null) return;
      hideTimer.current = window.setTimeout(() => setVisible(false), HIDE_AFTER_MS);
    };
    wake();
    window.addEventListener('pointermove', wake, true);
    window.addEventListener('mousemove', wake, true);
    return () => {
      window.removeEventListener('pointermove', wake, true);
      window.removeEventListener('mousemove', wake, true);
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, [playing]);
  // A native Netflix popup (CC list, episodes drawer) sits in the page, BELOW
  // our closed root. While it is open the row must yield pointer events or the
  // user's click lands on our transparent chrome instead of the menu.
  useEffect(() => {
    const check = () => setPopupOpen(popupOpenNow());
    check();
    const observer = typeof MutationObserver === 'function'
      ? new MutationObserver(check)
      : null;
    observer?.observe(document.body, { childList: true, subtree: true });
    return () => observer?.disconnect();
  }, []);
  // The icon follows the real state, which the browser owns, not us.
  useEffect(() => {
    const sync = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    sync();
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  // A clean capture takes the frame: our chrome (and the caption's lift) must
  // not be in it, so the bar reports itself hidden for the whole capture.
  const reportedVisible = visible && !capturing;
  // ONE flag for "the user can touch this bar": on screen AND not yielding to
  // a native popup. Both children derive their pointer-events from it.
  const interactive = reportedVisible && !popupOpen;
  useEffect(() => {
    onVisibilityChange?.(reportedVisible, height);
  }, [onVisibilityChange, reportedVisible, height]);
  useEffect(() => {
    onPopupChange?.(popupOpen);
  }, [onPopupChange, popupOpen]);
  // Keyboard entry re-arms the auto-hide instead of leaving an inert bar: a
  // Tab into `opacity: 0` chrome used to focus controls nobody could see.
  const wakeOnFocus = useCallback(() => {
    if (capturing) return;
    setVisible(true);
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    if (!playing) return;
    hideTimer.current = window.setTimeout(() => setVisible(false), HIDE_AFTER_MS);
  }, [capturing, playing]);
  const compact = width < 860;
  const tight = width < 740;
  const speedIndex = PLAYBACK_SPEEDS.indexOf(speed);
  const replay = useLongPress(onReplay, onReplaySlow);
  // Shortcut hints, exactly like StudyBar: the user's live combo, formatted
  // by the one helper so both bars read the same.
  const shortcuts = useKivaraStore((state) => state.shortcuts);
  const combo = (id: string) => comboOf(shortcuts, id);
  const speedTitle = [t('rail.speed'), [combo('slower'), combo('faster')].filter(Boolean).join(' / ')]
    .filter(Boolean)
    .join(' · ');
  // PR #172: OUR menus. One at a time, and the tray stays on screen while one
  // is open — a menu that fades out with its own sheet is unusable.
  const [openPopover, setOpenPopover] = useState<'tracks' | 'episodes' | null>(null);
  const [catalog, setCatalog] = useState<NetflixEpisodesCatalog | null>(null);
  const menuAnchorRef = useRef<HTMLDivElement>(null);
  // The auto-hide listener lives in an effect that must not re-subscribe on
  // every menu toggle, so it reads the menu state through a ref.
  const openPopoverRef = useRef<'tracks' | 'episodes' | null>(null);
  openPopoverRef.current = openPopover;
  const episodes = useNativeControl('[data-uia="control-episodes"]');
  useEffect(() => {
    let cancelled = false;
    void listEpisodesThroughMainWorld()
      .then((next) => { if (!cancelled) setCatalog(next); })
      .catch(() => { if (!cancelled) setCatalog(null); });
    return () => { cancelled = true; };
  }, []);
  // The tray holds still while a menu is open, and any interruption (a capture,
  // a native popup) closes it: its anchors move under those conditions.
  useEffect(() => {
    if (openPopover !== null && (capturing || popupOpen)) setOpenPopover(null);
  }, [openPopover, capturing, popupOpen]);
  // Opening a menu cancels a hide timer that was ALREADY armed (the pointer
  // armed one up to 3s before the click): otherwise the tray — and the menu it
  // anchors — fade out while the user is reading it.
  useEffect(() => {
    if (openPopover === null || hideTimer.current === null) return;
    window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  }, [openPopover]);
  useEffect(() => {
    if (openPopover === null) return;
    const close = () => setOpenPopover(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Escape closes the MENU, not fullscreen: consume it before the player.
      event.preventDefault();
      event.stopPropagation();
      close();
      menuAnchorRef.current?.querySelector<HTMLElement>('button')?.focus();
    };
    // Two listeners, because a CLOSED root hides its inner nodes from a
    // page-side event: `composedPath` stops at the host, so a page-level check
    // would read a click on our own menu row as a click outside it — and close
    // the menu before the click landed (the bug this pair exists for).
    const root = barRef.current?.getRootNode() as (ParentNode & EventTarget) | null;
    const onInside = (event: Event) => {
      const target = event.target as Node | null;
      if (menuAnchorRef.current && target && menuAnchorRef.current.contains(target)) return;
      close();
    };
    const onPage = (event: Event) => {
      const target = event.target as HTMLElement | null;
      // Retargeted to our host means the click was inside our chrome.
      if (target?.id?.startsWith('kivara-lingo')) return;
      close();
    };
    window.addEventListener('keydown', onKey, true);
    root?.addEventListener('pointerdown', onInside, true);
    window.addEventListener('pointerdown', onPage, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      root?.removeEventListener('pointerdown', onInside, true);
      window.removeEventListener('pointerdown', onPage, true);
    };
  }, [openPopover]);
  const nextEpisode = useNativeControl('[data-uia="control-next"]');
  const time = usePlaybackTimeMs();

  const seekBy = (deltaMs: number) => {
    const target = time + deltaMs;
    // Through the adapter, never the element: Netflix rejects direct writes
    // (M7375) and the controller is what keeps seeking alive across episodes.
    onSeek(deltaMs < 0 ? Math.max(0, target) : duration > 0 ? Math.min(duration, target) : target);
  };

  /**
   * Fullscreen, synchronously: Chromium only honours `requestFullscreen` inside
   * the user's gesture, so a `setTimeout` (what `nativeClick` needs for the
   * native row) would lose the activation and silently do nothing.
   */
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {});
      return;
    }
    const root = resolvePlayerRoot('netflix', video ?? null) as unknown as { requestFullscreen?: () => Promise<void> } | null;
    if (root && typeof root.requestFullscreen === 'function') {
      void root.requestFullscreen().catch(() => {
        nativeClick('[data-uia^="control-fullscreen-"]', onWakeNative);
      });
      return;
    }
    nativeClick('[data-uia^="control-fullscreen-"]', onWakeNative);
  };

  return (
    <div
      ref={barRef}
      data-kvl-player-bar=""
      // The E2E bridge and the hit map read this: a hidden bar must publish
      // no boxes and no clickable controls.
      data-kvl-bar-hidden={reportedVisible ? undefined : ''}
      role="toolbar"
      aria-label={t('rail.title')}
      onFocusCapture={wakeOnFocus}
      className={`absolute inset-x-4 bottom-3 px-4 pt-2.5 pb-2.5 rounded-2xl z-20 bg-zinc-950/85 backdrop-blur-xl ring-1 ring-white/[0.08] shadow-[0_16px_40px_-12px_rgba(0,0,0,0.75)] flex flex-col gap-2 transition-opacity duration-300 pointer-events-none focus-within:opacity-100 [@media(hover:none)]:opacity-100 ${
        reportedVisible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <SeekBar duration={duration} onSeek={onSeek} interactive={interactive} video={video} />
      <div
        data-kvl-player-row=""
        className={`grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-white ${interactive ? 'pointer-events-auto' : 'pointer-events-none'}`}
      >
        {/* ── Left: the video itself ─────────────────────────────────────── */}
        <div className="flex items-center gap-1.5 min-w-0">
          <button type="button" onClick={onTogglePlay} title={playing ? t('player.pause') : t('player.play')}
            aria-label={playing ? t('player.pause') : t('player.play')}
            className="w-9 h-9 rounded-xl bg-white/[0.08] hover:bg-white/[0.15] flex items-center justify-center text-white kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40">
            {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>
          {!compact && (
            <>
              <button type="button" onClick={() => seekBy(-TEN_SECONDS_MS)} aria-label={t('player.back10')} title={t('player.back10')} className={SMALL}>
                <RotateCcw size={16} weight="bold" />
                <span className="sr-only">-10</span>
              </button>
              <button type="button" onClick={() => seekBy(TEN_SECONDS_MS)} aria-label={t('player.forward10')} title={t('player.forward10')} className={SMALL}>
                <RotateCcw size={16} weight="bold" className="rotate-180" />
                <span className="sr-only">+10</span>
              </button>
            </>
          )}
          {nextEpisode && (
            <button type="button" onClick={() => nativeClick('[data-uia="control-next"]', onWakeNative)}
              aria-label={t('player.nextEpisode')} title={t('player.nextEpisode')} className={SMALL}>
              <SkipForward size={16} fill="currentColor" />
            </button>
          )}
          <VolumeControl video={video} onSetVolume={onSetVolume} onSetMuted={onSetMuted} />
          {!tight && <TimeReadout duration={duration} />}
        </div>

        {/* ── Centre: the Kivara study capsule ───────────────────────────── */}
        <div
          data-kvl-study-capsule=""
          className="justify-self-center flex items-center gap-0.5 rounded-xl bg-white/[0.06] ring-1 ring-white/[0.08] p-0.5"
        >
          <button type="button" onClick={onPrev} title={withCombo(t('shortcut.prev'), combo('prev'))} aria-label={t('shortcut.prev')} className={NAV}>
            <ChevronLeft size={14} weight="bold" />
          </button>
          <button type="button" {...replay} title={`${withCombo(t('shortcut.replay'), combo('replay'))}
${withCombo(t('player.holdSlower'), combo('replaySlow'))}`} aria-label={t('shortcut.replay')} className={NAV}>
            <RotateCcw size={13} weight="bold" />
          </button>
          <button type="button" onClick={onNext} title={withCombo(t('shortcut.next'), combo('next'))} aria-label={t('shortcut.next')} className={NAV}>
            <ChevronRight size={14} weight="bold" />
          </button>
          <span className="w-px h-4 bg-white/[0.1] mx-0.5" />
          <button type="button" onClick={onToggleAutoPause} title={withCombo(t('rail.autoPause'), combo('autoPause'))} aria-label={t('rail.autoPause')} aria-pressed={autoPauseCue} className={chip(autoPauseCue)}>
            <Pause size={12} fill="currentColor" />{!compact && t('rail.autoPauseShort')}
          </button>
          <button type="button" onClick={onToggleLoop} title={withCombo(t('rail.loop'), combo('loop'))} aria-label={t('rail.loop')} aria-pressed={loopCue} className={chip(loopCue)}>
            <Repeat size={12} weight="bold" />{!compact && t('rail.loop')}
          </button>
          <span className="w-px h-4 bg-white/[0.1] mx-0.5" />
          <div role="radiogroup" aria-label={t('rail.speed')} title={speedTitle} className="relative flex"
            onKeyDown={(event) => onRadioKeyDown(event, PLAYBACK_SPEEDS, speed, onSpeed)}>
            {speedIndex >= 0 && (
              <span aria-hidden="true" className="kvl-seg-pill absolute inset-y-0 rounded-md bg-white/[0.14] pointer-events-none"
                style={{ width: `${100 / PLAYBACK_SPEEDS.length}%`, left: `${(speedIndex * 100) / PLAYBACK_SPEEDS.length}%` }} />
            )}
            {PLAYBACK_SPEEDS.map((value, index) => (
              <button key={value} type="button" role="radio" aria-checked={speed === value}
                tabIndex={radioTabIndex(speed === value, index, speedIndex >= 0)} onClick={() => onSpeed(value)}
                className={`relative z-10 h-7 w-11 rounded-md text-[12px] font-medium tabular-nums kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${speed === value ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>
                {value}×
              </button>
            ))}
          </div>
        </div>

        {/* ── Right: tracks, columns, fullscreen ─────────────────────────── */}
        <div className="justify-self-end flex items-center gap-1.5">
          <div ref={menuAnchorRef} className="relative flex items-center gap-1.5">
            <button type="button"
              onClick={() => setOpenPopover((open) => (open === 'tracks' ? null : 'tracks'))}
              aria-label={t('player.netflixSubtitles')} title={t('player.netflixSubtitles')}
              aria-haspopup="dialog" aria-expanded={openPopover === 'tracks'}
              className={`${SMALL} relative`}>
              <Subtitles size={18} />
              {/* The dot means Kivara's subtitles are ON (the store's flag). */}
              {subtitlesVisible && (
                <span aria-hidden="true" className="absolute top-0.5 right-0.5 w-2 h-2 bg-indigo-500 rounded-full pointer-events-none" />
              )}
            </button>
            {(episodes || (catalog?.seasons.length ?? 0) > 0) && (
              <button type="button"
                onClick={() => {
                  if ((catalog?.seasons.length ?? 0) > 0) {
                    setOpenPopover((open) => (open === 'episodes' ? null : 'episodes'));
                    return;
                  }
                  nativeClick('[data-uia="control-episodes"]', onWakeNative);
                }}
                aria-label={t('player.episodes')} title={t('player.episodes')}
                aria-haspopup="dialog" aria-expanded={openPopover === 'episodes'} className={SMALL}>
                <Layers size={18} />
              </button>
            )}
            {openPopover === 'tracks' && (
              <PlayerTrackPopover
                onClose={() => setOpenPopover(null)}
                onManualChoice={onManualSubtitleChoice}
                onFallbackNative={() => nativeClick('[data-uia="control-audio-subtitle"]', onWakeNative)}
                availableAbovePx={Math.max(180, height + 12)}
              />
            )}
            {openPopover === 'episodes' && catalog && catalog.seasons.length > 0 && (
              <PlayerEpisodesPopover
                catalog={catalog}
                onClose={() => setOpenPopover(null)}
                availableAbovePx={Math.max(180, height + 12)}
              />
            )}
          </div>
          <span className="w-px h-4 bg-white/[0.1] mx-0.5" />
          <button type="button" onClick={onToggleRail} aria-pressed={railOpen} title={withCombo(t('rail.toggle'), combo('rail'))}
            aria-label={t('rail.toggle')}
            className={`w-8 h-8 rounded-lg flex items-center justify-center kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${railOpen ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-400/30' : 'text-zinc-300 hover:text-white hover:bg-white/[0.08]'}`}>
            <AlignLeft size={18} />
          </button>
          <button type="button" onClick={onTogglePanel} aria-pressed={panelOpen} title={withCombo(t('app.panelToggle'), combo('panel'))}
            aria-label={t('app.panelToggle')}
            className={`w-8 h-8 rounded-lg flex items-center justify-center kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${panelOpen ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-400/30' : 'text-zinc-300 hover:text-white hover:bg-white/[0.08]'}`}>
            <BrandGlyph size={18} />
          </button>
          <button type="button" onClick={toggleFullscreen}
            title={t('player.fullscreen')} aria-label={t('player.fullscreen')} className={SMALL}>
            {isFullscreen ? <ExitFullscreenIcon size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}
