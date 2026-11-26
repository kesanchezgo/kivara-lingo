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
import { useKivaraStore } from '../../shared/use-kivara-store';
import { nativePopupOpen } from './cleanup-css';
import { resolvePlayerRoot } from './native-bar-slot';
import { comboOf, withCombo } from './combo-hints';
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

const NAV = 'w-7 h-7 rounded-md flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/[0.08] kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40';
const chip = (on: boolean) => `h-7 px-2 rounded-md flex items-center gap-1.5 text-[12px] font-medium kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${on ? 'bg-indigo-500 text-white' : 'text-zinc-300 hover:text-white hover:bg-white/[0.08]'}`;
const HIDE_AFTER_MS = 3000;

function fmtTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function SeekBar({ duration, onSeek, interactive }: {
  duration: number;
  onSeek: (ms: number) => void;
  /** The bar is on screen and no native popup owns the pointer. */
  interactive: boolean;
}) {
  const time = usePlaybackTimeMs();
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragMs, setDragMs] = useState<number | null>(null);
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const shown = dragMs ?? time;
  const pct = duration > 0 ? Math.min(100, Math.max(0, (shown / duration) * 100)) : 0;
  // The global listeners of an in-flight drag, so an unmount mid-drag cannot
  // leave them attached to `window` (they would keep seeking a dead bar).
  const dragCleanup = useRef<(() => void) | null>(null);

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
    // height over a 4 px track, so the user does not have to hit a hairline.
    // `pointer-events` is explicit because the bar root sets `none`.
    <div
      data-kvl-seek-hit=""
      className={`relative py-2 ${interactive ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'}`}
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
        className="w-full h-1 bg-white/30 rounded-full relative outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
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
        <div className="absolute top-0 left-0 h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-white rounded-full shadow" style={{ left: `${pct}%` }} />
        {hoverMs !== null && duration > 0 && (
          <span
            className="absolute -top-8 -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 text-[11px] tabular-nums text-white pointer-events-none"
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
  onSeek, onWakeNative, onSetVolume, onSetMuted, onVisibilityChange,
}: PlayerBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(Infinity);
  const [height, setHeight] = useState(0);
  const [visible, setVisible] = useState(true);
  const [popupOpen, setPopupOpen] = useState(false);
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
    const check = () => setPopupOpen(popupOpenNow());
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
  // ONE flag for "the user can touch this bar": on screen AND not yielding to
  // a native popup. Both children derive their pointer-events from it.
  const interactive = reportedVisible && !popupOpen;
  useEffect(() => {
    onVisibilityChange?.(reportedVisible, height);
  }, [onVisibilityChange, reportedVisible, height]);
  // Keyboard entry re-arms the auto-hide instead of leaving an inert bar: a
  // Tab into `opacity: 0` chrome used to focus controls nobody could see.
  const wakeOnFocus = useCallback(() => {
    if (capturing) return;
    setVisible(true);
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    if (!playing) return;
    hideTimer.current = window.setTimeout(() => setVisible(false), HIDE_AFTER_MS);
  }, [capturing, playing]);
  const compact = width < 760;
  const tight = width < 720;
  const speedIndex = PLAYBACK_SPEEDS.indexOf(speed);
  const replay = useLongPress(onReplay, onReplaySlow);
  // Shortcut hints, exactly like StudyBar: the user's live combo, formatted
  // by the one helper so both bars read the same.
  const shortcuts = useKivaraStore((state) => state.shortcuts);
  const combo = (id: string) => comboOf(shortcuts, id);
  const speedTitle = [t('rail.speed'), [combo('slower'), combo('faster')].filter(Boolean).join(' / ')]
    .filter(Boolean)
    .join(' · ');
  const episodes = useNativeControl('[data-uia="control-episodes"]');
  const nextEpisode = useNativeControl('[data-uia="control-next"]');

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
      className={`absolute bottom-0 inset-x-0 p-4 z-20 bg-gradient-to-t from-black/90 to-transparent flex flex-col gap-2 transition-opacity duration-300 pointer-events-none focus-within:opacity-100 [@media(hover:none)]:opacity-100 ${
        reportedVisible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <SeekBar duration={duration} onSeek={onSeek} interactive={interactive} />
      <div
        data-kvl-player-row=""
        className={`flex items-center justify-between text-white ${interactive ? 'pointer-events-auto' : 'pointer-events-none'}`}
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
          {!tight && <VolumeControl video={video} onSetVolume={onSetVolume} onSetMuted={onSetMuted} />}
          {!tight && <TimeReadout duration={duration} />}
        </div>
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => nativeClick('[data-uia="control-audio-subtitle"]', onWakeNative)}
            aria-label={t('player.netflixSubtitles')} title={t('player.netflixSubtitles')}
            className="rounded-md hover:text-indigo-400 relative">
            <Subtitles size={20} />
            {/* The mock marks Kivara's subtitles with an indigo dot. */}
            <span aria-hidden="true" className="absolute -top-1 -right-1 w-2 h-2 bg-indigo-500 rounded-full pointer-events-none" />
          </button>
          {episodes && (
            <button type="button" onClick={() => nativeClick('[data-uia="control-episodes"]', onWakeNative)}
              aria-label={t('player.episodes')} title={t('player.episodes')}
              className="rounded-md hover:text-indigo-400">
              <Layers size={20} />
            </button>
          )}
          <button type="button" onClick={onToggleRail} aria-pressed={railOpen} title={withCombo(t('rail.toggle'), combo('rail'))}
            aria-label={t('rail.toggle')} className={`rounded-md ${railOpen ? 'text-indigo-400' : 'hover:text-indigo-400'}`}>
            <AlignLeft size={20} />
          </button>
          <button type="button" onClick={onTogglePanel} aria-pressed={panelOpen} title={withCombo(t('app.panelToggle'), combo('panel'))}
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
