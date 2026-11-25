/**
 * Kivara-owned player bar (ported from .mock/src/app/components/player/
 * PlayerControls.tsx). It is the mock's full-width bottom chrome with the
 * Kivara study capsule inside, but every playback action delegates to the
 * real adapter/controller — the mock's clock and decorative controls are NOT
 * copied. Used on Netflix instead of appending a tiny band to the site's row.
 */
import { useEffect, useRef, useState } from 'react';
import {
  AlignLeft, ChevronLeft, ChevronRight, Maximize, Pause, Play, Repeat, RotateCcw,
  SkipForward, Subtitles, Volume2,
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
  autoPauseCue: boolean;
  loopCue: boolean;
  speed: number;
  railOpen: boolean;
  panelOpen: boolean;
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
}

const NAV = 'w-7 h-7 rounded-md flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/[0.08] outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40';
const chip = (on: boolean) => `h-7 px-2 rounded-md flex items-center gap-1.5 text-[12px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${on ? 'bg-indigo-500 text-white' : 'text-zinc-300 hover:text-white hover:bg-white/[0.08]'}`;

function fmtTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function Progress({ duration }: { duration: number }) {
  const time = usePlaybackTimeMs();
  const pct = duration > 0 ? `${Math.min(100, (time / duration) * 100)}%` : '0%';
  return (
    <div aria-hidden="true" className="w-full h-1 bg-white/30 rounded-full relative">
      <div className="absolute top-0 left-0 h-full bg-indigo-500 rounded-full" style={{ width: pct }} />
      <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-white rounded-full shadow" style={{ left: pct }} />
    </div>
  );
}

function TimeReadout({ duration }: { duration: number }) {
  const time = usePlaybackTimeMs();
  return <span className="text-sm font-medium tabular-nums whitespace-nowrap">{fmtTime(time)} / {fmtTime(duration)}</span>;
}

/** Netflix's own controls stay real: the owned bar forwards clicks to them. */
function clickNative(selector: string): void {
  const button = document.querySelector<HTMLElement>(selector);
  button?.click();
}

export function PlayerBar({
  playing, duration, autoPauseCue, loopCue, speed, railOpen, panelOpen,
  onTogglePlay, onPrev, onReplay, onReplaySlow, onNext,
  onToggleAutoPause, onToggleLoop, onSpeed, onToggleRail, onTogglePanel,
}: PlayerBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(Infinity);
  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const compact = width < 760;
  const tight = width < 720;
  const speedIndex = PLAYBACK_SPEEDS.indexOf(speed);
  const replay = useLongPress(onReplay, onReplaySlow);

  return (
    <div
      ref={barRef}
      data-kvl-player-bar=""
      role="toolbar"
      aria-label={t('rail.title')}
      className="absolute bottom-0 inset-x-0 p-4 z-20 transition-opacity duration-200 bg-gradient-to-t from-black/90 to-transparent flex flex-col gap-2 pointer-events-none"
    >
      <Progress duration={duration} />
      <div className="flex items-center justify-between text-white pointer-events-auto">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onTogglePlay}
            title={playing ? t('player.pause') : t('player.play')}
            aria-label={playing ? t('player.pause') : t('player.play')}
            className="rounded-md hover:text-indigo-400 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
          >
            {playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
          </button>
          <button type="button" onClick={() => clickNative('[data-uia="control-next"]')} aria-label={t('player.nextEpisode')} className="rounded-md hover:text-indigo-400">
            <SkipForward size={20} fill="currentColor" />
          </button>
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
            <div
              role="radiogroup"
              aria-label={t('rail.speed')}
              className="relative flex"
              onKeyDown={(event) => onRadioKeyDown(event, PLAYBACK_SPEEDS, speed, onSpeed)}
            >
              {speedIndex >= 0 && (
                <span
                  aria-hidden="true"
                  className="kvl-seg-pill absolute inset-y-0 rounded-md bg-white/[0.14] pointer-events-none"
                  style={{ width: `${100 / PLAYBACK_SPEEDS.length}%`, left: `${(speedIndex * 100) / PLAYBACK_SPEEDS.length}%` }}
                />
              )}
              {PLAYBACK_SPEEDS.map((value, index) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={speed === value}
                  tabIndex={radioTabIndex(speed === value, index, speedIndex >= 0)}
                  onClick={() => onSpeed(value)}
                  className={`relative z-10 h-7 w-11 rounded-md text-[12px] font-medium tabular-nums ${speed === value ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  {value}×
                </button>
              ))}
            </div>
          </div>
          {!tight && (
            <div aria-hidden="true" className="flex items-center gap-2">
              <Volume2 size={20} />
            </div>
          )}
          {!tight && <TimeReadout duration={duration} />}
        </div>
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => clickNative('[data-uia="control-audio-subtitle"]')} aria-label={t('player.netflixSubtitles')} className="rounded-md hover:text-indigo-400">
            <Subtitles size={20} />
          </button>
          <button type="button" onClick={onToggleRail} aria-pressed={railOpen} title={t('rail.toggle')} aria-label={t('rail.toggle')} className={`rounded-md ${railOpen ? 'text-indigo-400' : 'hover:text-indigo-400'}`}>
            <AlignLeft size={20} />
          </button>
          <button type="button" onClick={onTogglePanel} aria-pressed={panelOpen} title={t('app.panelToggle')} aria-label={t('app.panelToggle')} className={`rounded-md ${panelOpen ? 'text-indigo-400' : 'hover:text-indigo-400'}`}>
            <BrandGlyph size={20} />
          </button>
          <button type="button" onClick={() => clickNative('[data-uia="control-fullscreen"]')} title={t('player.fullscreen')} aria-label={t('player.fullscreen')} className="rounded-md hover:text-indigo-400">
            <Maximize size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
