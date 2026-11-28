/**
 * PR #171 — the three study badges, in ONE place.
 *
 * They used to live inside `SubtitleOverlay` and nothing else. The owned Netflix
 * bar hosts them on its top tray now, so either both render them (duplicated) or
 * one component does. This is that component: the overlay renders it when the
 * owned bar is not on screen, `PlayerTopBar` renders it when it is, and the
 * markup, the classes and the E2E markers are identical in both.
 */
import { BookOpenCheck, Ear, GraduationCap, Link2 } from '../../ui/icons';
import { t } from '../../shared/i18n';

export interface StudyBadgesProps {
  /** MWEs currently joined and shown as one card. */
  expandedMWEs: Set<string>;
  /** Undo every join at once. */
  onRejoinAll: () => void;
  /** "Listen first": the line plays before it is read. */
  listenFirst: boolean;
  onToggleListenFirst: () => void;
  /** Reading mode hides the join badge (there are no cards to join). */
  reading: boolean;
  onToggleMode: () => void;
}

export function StudyBadges({
  expandedMWEs, onRejoinAll, listenFirst, onToggleListenFirst, reading, onToggleMode,
}: StudyBadgesProps) {
  return (
    <>
      {expandedMWEs.size > 0 && !reading && (
        <button
          type="button"
          onClick={onRejoinAll}
          className="h-8 bg-zinc-900/80 backdrop-blur-md text-zinc-200 hover:text-white text-[12px] font-medium px-2.5 rounded-lg ring-1 ring-white/[0.08] shadow-lg flex items-center gap-1.5 hover:bg-zinc-800/90 kvl-press"
          title={t('overlay.rejoinAllTitle')}
          aria-label={t('ovl.joinMwe')}
          {...(__E2E__ ? { 'data-kivara-badge': 'rejoin' } : {})}
        >
          <Link2 size={14} /> {t('ovl.joinMwe')}
        </button>
      )}
      <button
        type="button"
        onClick={onToggleListenFirst}
        aria-pressed={listenFirst}
        className={`w-8 h-8 rounded-lg backdrop-blur-md ring-1 flex items-center justify-center kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 ${
          listenFirst
            ? 'bg-indigo-500 ring-indigo-300/30 text-white shadow-[0_4px_14px_-4px_rgba(99,102,241,.6)]'
            : 'bg-zinc-900/80 hover:bg-zinc-800/90 ring-white/[0.08] text-zinc-400 hover:text-zinc-200'
        }`}
        title={t('listen.title')}
        aria-label={t('listen.title')}
        {...(__E2E__ ? { 'data-kivara-badge': 'listen-first' } : {})}
      >
        <Ear size={16} />
      </button>
      <button
        type="button"
        onClick={onToggleMode}
        className="group/badge w-8 h-8 rounded-lg bg-zinc-900/80 hover:bg-zinc-800/90 backdrop-blur-md ring-1 ring-white/[0.08] flex items-center justify-center kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
        title={!reading ? t('subs.modeLearning') : t('subs.modeReading')}
        aria-label={!reading ? t('subs.modeLearning') : t('subs.modeReading')}
        {...(__E2E__ ? { 'data-kivara-badge': 'mode' } : {})}
      >
        {!reading ? (
          <span className="relative flex items-center justify-center">
            <span className="absolute w-1.5 h-1.5 rounded-full bg-emerald-400/40 animate-ping [animation-duration:2.4s]" />
            <GraduationCap size={16} className="text-indigo-300/90 group-hover/badge:text-indigo-200" strokeWidth={2} />
          </span>
        ) : (
          <BookOpenCheck size={16} className="text-zinc-400 group-hover/badge:text-zinc-200" strokeWidth={2} />
        )}
      </button>
    </>
  );
}
