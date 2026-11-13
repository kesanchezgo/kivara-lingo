/**
 * Kivara study bar (F6 · docs/REDESIGN-V2.md §3 H12, §7 F6).
 *
 * Only Kivara's own group — previous, replay (hold = slower), next, auto-pause,
 * loop, speed — plus the transcript and panel toggles. The platform's native
 * bar is deliberately NOT touched (decision D2): this bar floats above it, at
 * the right of the player on whichever half the caption leaves free, and
 * follows the same visibility rule the site's own controls use — appear on
 * pointer activity over the player, fade out after a couple of seconds.
 *
 * It reads no global state: every value and action arrives from App, which owns
 * the PlaybackController and the persisted preferences.
 */
import { useEffect, useRef, useState } from 'react';
import {
  AlignLeft,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  Subtitles,
} from '../../ui/icons';
import { BrandGlyph } from '../../ui/BrandGlyph';
import { t } from '../../shared/i18n';
import { useKivaraStore } from '../../shared/use-kivara-store';
import { comboOf, withCombo } from './combo-hints';
import { useLongPress } from '../../ui/hooks/useLongPress';
import { onRadioKeyDown, radioTabIndex } from '../../ui/primitives/settings-primitives';
import { placeStudyBar, safeZoneFor, type BarPlacement } from './study-bar-safe-zone';
import type { SubtitleSource } from '../platform-adapters/types';
import { PLAYBACK_SPEEDS } from '../platform-adapters/playback';
import {
  CAPTION_BOX_ATTR,
  captionRect,
  hostOf,
  onCaptionGeometryChange,
  scopeOf,
} from './overlay-geometry';

const HIDE_AFTER_MS = 2600;

export interface StudyBarProps {
  enabled: boolean;
  /** Point 5: the platform drives the bar's SAFE ZONE (margins + native
   * chrome to avoid). */
  platform?: SubtitleSource['platform'];
  playing: boolean;
  onTogglePlay(): void;
  onPrev(): void;
  onReplay(): void;
  onReplaySlow(): void;
  onNext(): void;
  autoPause: boolean;
  onToggleAutoPause(): void;
  loop: boolean;
  onToggleLoop(): void;
  speed: number;
  onSpeed(value: number): void;
  railOpen: boolean;
  onToggleRail(): void;
  panelOpen: boolean;
  onTogglePanel(): void;
}

/** Root of the player as a rectangle: the bar is shown while the pointer is over it. */
function playerRect(): DOMRect | null {
  const video = document.querySelector<HTMLVideoElement>('video');
  if (!video) return null;
  const rect = video.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

export function StudyBar(props: StudyBarProps) {
  const {
    platform, enabled, playing, onTogglePlay, onPrev, onReplay, onReplaySlow, onNext,
    autoPause, onToggleAutoPause, loop, onToggleLoop, speed, onSpeed,
    railOpen, onToggleRail, panelOpen, onTogglePanel,
  } = props;

  const [visible, setVisible] = useState(false);
  const shortcuts = useKivaraStore((state) => state.shortcuts);
  const combo = (id: string) => comboOf(shortcuts, id);
  const hideTimer = useRef<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(Number.POSITIVE_INFINITY);

  // Pointer activity over the player. `pointermove` in the capture phase sees
  // the move even when a player wrapper calls stopPropagation (HBO's does),
  // which is the same reason App's hover watchdog listens that way.
  useEffect(() => {
    if (!enabled) {
      setVisible(false);
      return;
    }
    const armHide = () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setVisible(false), HIDE_AFTER_MS);
    };
    const onMove = (event: PointerEvent) => {
      const rect = playerRect();
      if (!rect) return;
      const overVideo =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      const overBar = barRef.current?.contains(event.target as Node) ?? false;
      if (overVideo || overBar) {
        setVisible(true);
        armHide();
      }
    };
    const onLeave = () => setVisible(false);
    document.addEventListener('pointermove', onMove, { capture: true });
    document.addEventListener('pointerleave', onLeave);
    document.addEventListener('pointercancel', onLeave);
    return () => {
      document.removeEventListener('pointermove', onMove, { capture: true });
      document.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('pointercancel', onLeave);
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, [enabled]);

  // Width of the PLAYER decides icon-only mode, not the bar's own width.
  //
  // Measuring the bar was self-fulfilling: hiding the labels shrank the bar to
  // ~260 px, which stayed under 760 px forever, so the labels never came back
  // even on a 1920 px player. The overlay container is the player's box, so
  // its width is what "a small player" means.
  useEffect(() => {
    const element = barRef.current;
    if (!element) return;
    const host = hostOf(element);
    const measure = () => {
      const source = host ?? element.parentElement;
      if (!source) return;
      const measured = Math.round(source.getBoundingClientRect().width);
      setWidth(measured);
      // E2E-ONLY: the suite has to know WHEN the bar has learned the player's
      // width, or it would read a hit map published by the previous measure.
      if (__E2E__) host?.setAttribute('data-kivara-e2e-width', String(measured));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host ?? element.parentElement ?? element);
    return () => observer.disconnect();
  }, []);
  const compact = width < 760;

  /**
   * Where the bar sits: on the half of the player the caption does NOT occupy.
   *
   * `bottom-16` was a guess. At 640×360 the caption sits at ~85 % of the
   * player, so the bar landed ON it and swallowed clicks on the words it
   * covered. The bar measures the caption's text plate
   * (`[data-kivara-caption-box]`, published by SubtitleOverlay) and parks on
   * the opposite half — never just above the plate, because the sentence
   * toolbar opens 48 px over it and the bar ended up under its own hover
   * toolbar.
   *
   * No poll: `ResizeObserver` on the player and on the plate covers resizes,
   * and `SubtitleOverlay` announces every cue change because the plate can MOVE
   * without resizing (a new cue, a different vertical offset) — the one event
   * no observer in this component can see.
   */
  const [placement, setPlacement] = useState<BarPlacement>({ side: 'bottom', top: null, bottom: 12 });
  useEffect(() => {
    if (!enabled) return;
    const element = barRef.current;
    if (!element) return;
    const scope = scopeOf(element);
    const host = hostOf(element);

    const place = () => {
      const plate = captionRect(scope);
      const hostRect = host?.getBoundingClientRect();
      if (!hostRect || hostRect.height === 0) {
        setPlacement({ side: 'bottom', top: null, bottom: 12 });
        return;
      }
      const zone = safeZoneFor(platform);
      const controls = zone.controls.length
        ? [...document.querySelectorAll<HTMLElement>(zone.controls.join(','))]
            .map((el) => el.getBoundingClientRect())
            .filter((r) => r.width > 0 && r.height > 0)
            .map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }))
        : [];
      setPlacement(placeStudyBar({
        host: { x: hostRect.x, y: hostRect.y, width: hostRect.width, height: hostRect.height },
        caption: plate
          ? { x: plate.x, y: plate.y, width: plate.width, height: plate.height }
          : null,
        bar: { width: element?.getBoundingClientRect().width || 260, height: element?.getBoundingClientRect().height || 30 },
        zone,
        controls,
      }));
    };

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    const observePlate = () => {
      if (!observer) return;
      const plate = scope.querySelector<HTMLElement>(`[${CAPTION_BOX_ATTR}]`);
      if (plate) observer.observe(plate);
    };

    if (host && observer) observer.observe(host);
    const controlSelectors = safeZoneFor(platform).controls;
    if (observer && controlSelectors.length > 0) {
      for (const el of document.querySelectorAll<HTMLElement>(controlSelectors.join(','))) {
        observer.observe(el);
      }
    }
    observePlate();
    place();
    const off = onCaptionGeometryChange(() => {
      observePlate();
      place();
    });
    return () => {
      off();
      observer?.disconnect();
    };
  }, [enabled, platform]);

  // The E2E hit map for BOTH roots is mounted by App (see e2e-hitmap.ts);
  // the bar only publishes the width it measured, which is what the
  // compact-mode assertions wait on.

  const replay = useLongPress(onReplay, onReplaySlow);

  if (!enabled) return null;

  return (
    <div
      ref={barRef}
      className={`absolute right-3 z-30 flex items-center gap-0.5 rounded-lg bg-zinc-900/80 ring-1 ring-white/[0.08] backdrop-blur-md p-0.5 text-white transition-opacity duration-200 ${
        visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      } [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto`}
      style={placement.top !== null ? { top: placement.top } : { bottom: placement.bottom ?? 12 }}
      role="toolbar"
      aria-label={t('rail.title')}
    >
      <button type="button" onClick={onTogglePlay} title={playing ? t('player.pause') : t('player.play')} aria-label={playing ? t('player.pause') : t('player.play')} className={`${NAV} w-7`}>
        {playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
      </button>
      <button type="button" onClick={onPrev} title={withCombo(t('shortcut.prev'), combo('prev'))} aria-label={t('shortcut.prev')} className={NAV}>
        <ChevronLeft size={14} weight="bold" />
      </button>
      <button
        type="button"
        {...replay}
        title={`${withCombo(t('shortcut.replay'), combo('replay'))}\n${withCombo(t('player.holdSlower'), combo('replaySlow'))}`}
        aria-label={t('shortcut.replay')}
        className={NAV}
      >
        <RotateCcw size={13} weight="bold" />
      </button>
      <button type="button" onClick={onNext} title={withCombo(t('shortcut.next'), combo('next'))} aria-label={t('shortcut.next')} className={NAV}>
        <ChevronRight size={14} weight="bold" />
      </button>

      <span aria-hidden="true" className="w-px h-4 bg-white/[0.1] mx-0.5" />

      <button
        type="button"
        aria-pressed={autoPause}
        title={withCombo(t('rail.autoPause'), combo('autoPause'))}
        aria-label={t('rail.autoPause')}
        onClick={onToggleAutoPause}
        className={chip(autoPause)}
      >
        <Pause size={12} fill="currentColor" />
        {!compact && <span>{t('rail.autoPauseShort')}</span>}
      </button>
      <button
        type="button"
        aria-pressed={loop}
        title={withCombo(t('rail.loop'), combo('loop'))}
        aria-label={t('rail.loop')}
        onClick={onToggleLoop}
        className={chip(loop)}
      >
        <Repeat size={12} weight="bold" />
        {!compact && <span>{t('rail.loop')}</span>}
      </button>

      <span aria-hidden="true" className="w-px h-4 bg-white/[0.1] mx-0.5" />

      <div
        role="radiogroup"
        aria-label={t('rail.speed')}
        title={withCombo(t('rail.speed'), `${combo('slower') ?? ''} / ${combo('faster') ?? ''}`)}
        className="relative flex"
        onKeyDown={(event) => onRadioKeyDown(event, PLAYBACK_SPEEDS, speed, onSpeed)}
      >
        {PLAYBACK_SPEEDS.map((value, index) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={speed === value}
            tabIndex={radioTabIndex(speed === value, index, PLAYBACK_SPEEDS.includes(speed))}
            onClick={() => onSpeed(value)}
            className={`relative h-7 w-10 rounded-md text-[12px] font-medium tabular-nums kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
              speed === value ? 'bg-white/[0.14] text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {value}×
          </button>
        ))}
      </div>

      <span aria-hidden="true" className="w-px h-4 bg-white/[0.1] mx-0.5" />

      <button
        type="button"
        aria-pressed={railOpen}
        title={withCombo(t('rail.toggle'), combo('rail'))}
        aria-label={t('rail.toggle')}
        onClick={onToggleRail}
        className={`${NAV} ${railOpen ? 'text-indigo-400' : ''}`}
      >
        <AlignLeft size={16} />
      </button>
      <button
        type="button"
        aria-pressed={panelOpen}
        title={withCombo(t('app.panelToggle'), combo('panel'))}
        aria-label={t('app.panelToggle')}
        onClick={onTogglePanel}
        className={`${NAV} ${panelOpen ? 'text-indigo-400' : ''}`}
      >
        <BrandGlyph size={16} />
      </button>
      <span aria-hidden="true" className="text-zinc-500 px-0.5">
        <Subtitles size={14} />
      </span>
    </div>
  );
}

const NAV =
  'w-6 h-6 rounded-md flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/[0.08] kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40';

function chip(on: boolean): string {
  return `h-6 px-1.5 rounded-md flex items-center gap-1 text-[12px] font-medium kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
    on ? 'bg-indigo-500 text-white' : 'text-zinc-300 hover:text-white hover:bg-white/[0.08]'
  }`;
}
