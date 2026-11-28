/**
 * PR #171 — the Kivara top bar for the owned Netflix player.
 *
 * Netflix's own top chrome (the ← back arrow and the ⚑ flag) is hidden by the
 * owned bar's sheet, so the two things that live up there are re-rendered here
 * in the same glass language as the bottom tray: a way back, the title of what
 * is playing, and the three study badges.
 *
 * It follows the bottom tray's visibility so the pair behaves like one piece of
 * chrome: resting pointer and no focus means both fade out together.
 */
import { useCallback, useEffect, useRef } from 'react';
import { ChevronLeft } from '../../ui/icons';
import { t } from '../../shared/i18n';
import { useKivaraStore } from '../../shared/use-kivara-store';
import { wakeNativeRow } from './cleanup-css';
import { resolvePlayerRoot } from './native-bar-slot';
import { StudyBadges } from './StudyBadges';

export interface PlayerTopBarProps {
  /** Same flag the bottom tray reports: on screen and not capturing. */
  visible: boolean;
  capturing?: boolean;
  /** A native popup owns the pointer: our chrome steps out of its way. */
  popupOpen?: boolean;
  /** Main title: the series on a series, the title on a film. */
  title?: string | null;
  /** The detail line: `T1 E8 · Chapter Eight`. */
  subtitle?: string | null;
  /**
   * The join state, which App owns (the overlay shows the same set). Everything
   * else the badges need — listen-first, the mode — lives in the store, so the
   * two hosts read one source of truth instead of a copy.
   */
  expandedMWEs: Set<string>;
  onRejoinAll: () => void;
}

const NATIVE_BACK = '[data-uia="control-nav-back"]';
/** How long the site gets to react before we fall back to history. */
const BACK_FALLBACK_MS = 180;

export function PlayerTopBar({ visible, capturing = false, popupOpen = false, title, subtitle, expandedMWEs, onRejoinAll }: PlayerTopBarProps) {
  // One flag for "the user can touch this bar". The ROOT stays
  // `pointer-events-none` on purpose: it spans the whole top band, and the
  // empty middle of that band must let clicks through to the video (the
  // native chrome it replaces was clickable there — a full-band blocker
  // swallowed the picture).
  const interactive = visible && !capturing && !popupOpen;
  const capsulePointer = capturing || popupOpen
    ? 'pointer-events-none'
    : interactive
      ? 'pointer-events-auto'
      : 'pointer-events-none focus-within:pointer-events-auto';
  const listenFirst = useKivaraStore((state) => state.study.listenFirst);
  const setStudy = useKivaraStore((state) => state.setStudy);
  const mode = useKivaraStore((state) => state.mode);
  const setMode = useKivaraStore((state) => state.setMode);
  const reading = mode === 'reading';
  const backTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (backTimer.current !== null) window.clearTimeout(backTimer.current);
  }, []);

  /**
   * Go back the way the site would: wake its row, click its own control, and
   * only if the URL has not moved after 180 ms take over with `history.back()`.
   * The native node is the one that knows about Netflix's own history state.
   */
  const goBack = useCallback(() => {
    const before = window.location.href;
    wakeNativeRow(resolvePlayerRoot('netflix', document.querySelector<HTMLVideoElement>('video')), null);
    document.querySelector<HTMLElement>(NATIVE_BACK)?.click();
    if (backTimer.current !== null) window.clearTimeout(backTimer.current);
    backTimer.current = window.setTimeout(() => {
      backTimer.current = null;
      if (window.location.href === before) window.history.back();
    }, BACK_FALLBACK_MS);
  }, []);

  const shown = visible && !capturing;

  return (
    <div
      data-kvl-player-top=""
      data-kvl-top-hidden={shown ? undefined : ''}
      className={`absolute top-4 left-4 right-4 z-20 flex items-start justify-between gap-3 transition-opacity duration-300 pointer-events-none focus-within:opacity-100 ${
        shown ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* ── Left: back + what is playing ───────────────────────────────── */}
      <div className="flex min-w-0 items-center gap-2">
        <div className={`h-9 ${title ? 'pl-1.5 pr-3' : 'px-1'} flex items-center gap-2 rounded-xl bg-zinc-950/85 backdrop-blur-xl ring-1 ring-white/[0.08] shadow-[0_12px_32px_-8px_rgba(0,0,0,0.65)] ${capsulePointer}`}>
          <button
            type="button"
            onClick={goBack}
            data-kvl-top-back=""
            aria-label={t('player.back')}
            title={t('player.back')}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-200 hover:text-white hover:bg-white/[0.08] kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
          >
            <ChevronLeft size={16} weight="bold" />
          </button>
          {title && (
            <span className="min-w-0 flex items-baseline gap-1.5">
              <span className="font-semibold text-white text-[13px] truncate">{title}</span>
              {subtitle && (
                <>
                  <span aria-hidden="true" className="text-zinc-500 text-[12px]">·</span>
                  <span className="text-zinc-400 text-[12px] truncate max-w-[42vw]">{subtitle}</span>
                </>
              )}
            </span>
          )}
        </div>
      </div>

      {/* ── Right: the study badges, on the same top line ──────────────── */}
      <div className={`flex items-center gap-1.5 shrink-0 ${capsulePointer}`}>
        <StudyBadges
          expandedMWEs={expandedMWEs}
          onRejoinAll={onRejoinAll}
          listenFirst={listenFirst}
          onToggleListenFirst={() => setStudy((prev) => ({ ...prev, listenFirst: !prev.listenFirst }))}
          reading={reading}
          onToggleMode={() => setMode(reading ? 'learning' : 'reading')}
        />
      </div>
    </div>
  );
}
