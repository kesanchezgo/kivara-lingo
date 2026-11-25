/**
 * Kivara-owned player bar (ported from .mock/src/app/components/player/
 * PlayerControls.tsx). It is the mock's full-width bottom chrome with the
 * Kivara study capsule inside. Unlike the mock, progress/volume are REAL:
 * seek goes through the adapter/MAIN-world bridge (never video.currentTime)
 * and volume/mute drive the live video element. Used on Netflix instead of
 * appending a tiny band to the site's row.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlignLeft, ChevronLeft, ChevronRight, Layers, Maximize, Pause, Play, Repeat, RotateCcw,
  SkipForward, Subtitles, Volume1, Volume2,
} from '../../ui/icons';
import { BrandGlyph } from '../../ui/BrandGlyph';
import { t } from '../../shared/i18n';
import { useLongPress } from '../../ui/hooks/useLongPress';
import { onRadioKeyDown, radioTabIndex } from '../../ui/primitives/settings-primitives';
import { PLAYBACK_SPEEDS } from '../platform-adapters/playback';
import { usePlaybackTimeMs } from './useStudyPlayback';

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
   * bar. Fires on every visibility flip and every resize.
   */
  onVisibilityChange?: (visible: boolean, heightPx: number) => void;
}

const NAV = 'w-7 h-7 rounded-md flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/[0.08] outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40';
const chip = (on: boolean) => `h-7 px-2 rounded-md flex items-center gap-1.5 text-[12px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${on ? 'bg-indigo-500 text-white' : 'text-zinc-300 hover:text-white hover:bg-white/[0.08]'}`;
const HIDE_AFTER_MS = 3000;

function fmtTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function SeekBar({ duration, onSeek }: { duration: number; onSeek: (ms: number) => void }) {
  const time = usePlaybackTimeMs();
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragMs, setDragMs] = useState<number | null>(null);
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const shown = dragMs ?? time;
  const pct = duration > 0 ? Math.min(100, Math.max(0, (shown / duration) * 100)) : 0;

  const fromClientX = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || duration <= 0) return 0;
    return Math.max(0, Math.min(duration, Math.round(((clientX - rect.left) / rect.width) * duration)));
  };

  const commit = useCallback((value: number) => {
    setDragMs(null);
    onSeek(value);
  }, [onSeek]);

  return (
    <div className="relative py-2">
      <div
        ref={trackRef}
        role="slider"
        aria-label={t('player.seek')}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={fmtTime(shown)}
        tabIndex={0}
        className="w-full h-1 bg-white/30 rounded-full relative cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
        onMouseMove={(e) => setHoverMs(fromClientX(e.clientX))}
        onMouseLeave={() => setHoverMs(null)}
        onMouseDown={(e) => {
          const value = fromClientX(e.clientX);
          setDragMs(value);
          const move = (ev: MouseEvent) => setDragMs(fromClientX(ev.clientX));
          const up = (ev: MouseEvent) => {
            const finalValue = fromClientX(ev.clientX);
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
            commit(finalValue);
          };
          window.addEventListener('mousemove', move);
          window.addEventListener('mouseup', up);
        }}
        onKeyDown={(e) => {
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
        <div className="absolute top-0 left-0 h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-white rounded-full shadow" style={{ left: `${pct}%` }} />
        {hoverMs !== null && (
          <span
            className="absolute -top-8 -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 text-[11px] tabular-nums text-white"
            style={{ left: `${Math.min(100, Math.max(0, (hoverMs / duration) * 100))}%` }}
          >
            {fmtTime(hoverMs)}
          </span>
        )}
      </div>
    </div>
  );
}

function TimeReadout({ duration }: { duration: number }) {
  const time = usePlaybackTimeMs();
  return <span className="text-sm font-medium tabular-nums whitespace-nowrap">{fmtTime(time)} / {fmtTime(duration)}</span>;
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
  const toggleMute = () => {
    const next = !muted;
    // Optimistic UI: the MAIN-world round trip is async and the platform's
    // echo may be late on an audio-track switch.
    setMutedState(next);
    if (onSetMuted) onSetMuted(next);
    else if (video) video.muted = next;
  };
  const change = (value: number) => {
    setVolumeState(value);
    setMutedState(value === 0);
    if (onSetVolume) {
      onSetVolume(value);
      if (value === 0 && onSetMuted) onSetMuted(true);
    } else if (video) {
      video.volume = value;
      video.muted = value === 0;
    }
  };
  return (
    <div className="flex items-center gap-2 group/volume">
      <button type="button" onClick={toggleMute} aria-label={muted || volume === 0 ? t('player.unmute') : t('player.mute')}
        className="rounded-md hover:text-indigo-400 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50">
        {muted || volume === 0 ? <Volume1 size={20} /> : <Volume2 size={20} />}
      </button>
      <input
        type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume}
        aria-label={t('player.volume')}
        onChange={(e) => change(Number(e.target.value))}
        className="w-16 h-1 accent-indigo-500 opacity-0 group-hover/volume:opacity-100 group-focus-within/volume:opacity-100"
      />
    </div>
  );
}

/**
 * Native Netflix popups that must survive the owned bar's hiding CSS and
 * receive clicks even while our chrome is on top. Any of them being open
 * makes the control row yield `pointer-events` so the native menu is usable.
 */
const NATIVE_POPUP_SELECTORS = [
  '[data-uia="selector-audio-subtitle"]',
  '[data-uia="selector-audio"]',
  '[data-uia="selector-subtitle"]',
  '[data-uia="episodes-selector"]',
  '[data-uia="episode-selector"]',
  '[data-uia="player-episodes"]',
  '[role="menu"]',
];

function nativePopupOpen(): boolean {
  return NATIVE_POPUP_SELECTORS.some((selector) => !!document.querySelector(selector));
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
  playing, duration, video, autoPauseCue, loopCue, speed, railOpen, panelOpen,
  capturing = false,
  onTogglePlay, onPrev, onReplay, onReplaySlow, onNext,
  onToggleAutoPause, onToggleLoop, onSpeed, onToggleRail, onTogglePanel,
  onSeek, onWakeNative, onSetVolume, onSetMuted, onVisibilityChange,
}: PlayerBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(Infinity);
  const [height, setHeight] = useState(0);
  const [visible, setVisible] = useState(true);
  const [popupOpen, setPopupOpen] = useState(false);
  const hideTimer = useRef<number | null>(null);
  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    // BORDER box, not content box: the bar carries `p-4`, so the content box
    // is 32 px shorter than the chrome the caption must clear. Reporting the
    // content height lifted the plate to 20 px UNDER the bar's real top edge.
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
      if (!playing) return;
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
    const check = () => setPopupOpen(nativePopupOpen());
    check();
    const observer = typeof MutationObserver === 'function'
      ? new MutationObserver(check)
      : null;
    observer?.observe(document.body, { childList: true, subtree: true });
    return () => observer?.disconnect();
  }, []);
  // A clean capture takes the frame: our chrome (and the caption's lift) must
  // not be in it, so the bar reports itself hidden for the whole capture.
  const reportedVisible = visible && !capturing;
  useEffect(() => {
    onVisibilityChange?.(reportedVisible, height);
  }, [onVisibilityChange, reportedVisible, height]);
  const compact = width < 760;
  const tight = width < 720;
  const speedIndex = PLAYBACK_SPEEDS.indexOf(speed);
  const replay = useLongPress(onReplay, onReplaySlow);
  const episodes = useNativeControl('[data-uia="control-episodes"]');
  const nextEpisode = useNativeControl('[data-uia="control-next"]');

  return (
    <div
      ref={barRef}
      data-kvl-player-bar=""
      role="toolbar"
      aria-label={t('rail.title')}
      className={`absolute bottom-0 inset-x-0 p-4 z-20 bg-gradient-to-t from-black/90 to-transparent flex flex-col gap-2 transition-opacity duration-300 pointer-events-none focus-within:opacity-100 [@media(hover:none)]:opacity-100 ${
        reportedVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      <SeekBar duration={duration} onSeek={onSeek} />
      <div
        data-kvl-player-row=""
        className={`flex items-center justify-between text-white ${popupOpen ? 'pointer-events-none' : 'pointer-events-auto'}`}
      >
        <div className="flex items-center gap-4">
          <button type="button" onClick={onTogglePlay} title={playing ? t('player.pause') : t('player.play')}
            aria-label={playing ? t('player.pause') : t('player.play')}
            className="rounded-md hover:text-indigo-400 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60">
            {playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
          </button>
          {nextEpisode && (
            <button type="button" onClick={() => nativeClick('[data-uia="control-next"]', onWakeNative)}
              aria-label={t('player.nextEpisode')}
              className="rounded-md hover:text-indigo-400">
              <SkipForward size={20} fill="currentColor" />
            </button>
          )}
          <div className="flex items-center gap-0.5 rounded-lg bg-zinc-900/70 ring-1 ring-white/[0.08] backdrop-blur-md p-0.5">
            <button type="button" onClick={onPrev} title={t('shortcut.prev')} aria-label={t('shortcut.prev')} className={NAV}>
              <ChevronLeft size={14} weight="bold" />
            </button>
            <button type="button" {...replay} title={t('shortcut.replay')} aria-label={t('shortcut.replay')} className={NAV}>
              <RotateCcw size={13} weight="bold" />
            </button>
            <button type="button" onClick={onNext} title={t('shortcut.next')} aria-label={t('shortcut.next')} className={NAV}>
              <ChevronRight size={14} weight="bold" />
            </button>
            <span className="w-px h-4 bg-white/[0.1] mx-0.5" />
            <button type="button" onClick={onToggleAutoPause} title={t('rail.autoPause')} aria-label={t('rail.autoPause')} aria-pressed={autoPauseCue} className={chip(autoPauseCue)}>
              <Pause size={12} fill="currentColor" />{!compact && t('rail.autoPauseShort')}
            </button>
            <button type="button" onClick={onToggleLoop} title={t('rail.loop')} aria-label={t('rail.loop')} aria-pressed={loopCue} className={chip(loopCue)}>
              <Repeat size={12} weight="bold" />{!compact && t('rail.loop')}
            </button>
            <span className="w-px h-4 bg-white/[0.1] mx-0.5" />
            <div role="radiogroup" aria-label={t('rail.speed')} className="relative flex"
              onKeyDown={(event) => onRadioKeyDown(event, PLAYBACK_SPEEDS, speed, onSpeed)}>
              {speedIndex >= 0 && (
                <span aria-hidden="true" className="kvl-seg-pill absolute inset-y-0 rounded-md bg-white/[0.14] pointer-events-none"
                  style={{ width: `${100 / PLAYBACK_SPEEDS.length}%`, left: `${(speedIndex * 100) / PLAYBACK_SPEEDS.length}%` }} />
              )}
              {PLAYBACK_SPEEDS.map((value, index) => (
                <button key={value} type="button" role="radio" aria-checked={speed === value}
                  tabIndex={radioTabIndex(speed === value, index, speedIndex >= 0)} onClick={() => onSpeed(value)}
                  className={`relative z-10 h-7 w-11 rounded-md text-[12px] font-medium tabular-nums ${speed === value ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>
                  {value}×
                </button>
              ))}
            </div>
          </div>
          {!tight && <VolumeControl video={video} onSetVolume={onSetVolume} onSetMuted={onSetMuted} />}
          {!tight && <TimeReadout duration={duration} />}
        </div>
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => nativeClick('[data-uia="control-audio-subtitle"]', onWakeNative)}
            aria-label={t('player.netflixSubtitles')} className="rounded-md hover:text-indigo-400">
            <Subtitles size={20} />
          </button>
          {episodes && (
            <button type="button" onClick={() => nativeClick('[data-uia="control-episodes"]', onWakeNative)}
              aria-label={t('player.episodes')} title={t('player.episodes')}
              className="rounded-md hover:text-indigo-400">
              <Layers size={20} />
            </button>
          )}
          <button type="button" onClick={onToggleRail} aria-pressed={railOpen} title={t('rail.toggle')}
            aria-label={t('rail.toggle')} className={`rounded-md ${railOpen ? 'text-indigo-400' : 'hover:text-indigo-400'}`}>
            <AlignLeft size={20} />
          </button>
          <button type="button" onClick={onTogglePanel} aria-pressed={panelOpen} title={t('app.panelToggle')}
            aria-label={t('app.panelToggle')} className={`rounded-md ${panelOpen ? 'text-indigo-400' : 'hover:text-indigo-400'}`}>
            <BrandGlyph size={20} />
          </button>
          <button type="button" onClick={() => nativeClick('[data-uia^="control-fullscreen-"]', onWakeNative)}
            title={t('player.fullscreen')} aria-label={t('player.fullscreen')} className="rounded-md hover:text-indigo-400">
            <Maximize size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
