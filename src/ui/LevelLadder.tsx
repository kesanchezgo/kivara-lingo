/**
 * A1–C2 ladder of the CALCULATED level (docs/REDESIGN-V2.md §5.3; ported from
 * the prototype).
 *
 * Levels already passed are full; the current one shows progress inside it on
 * the logarithmic scale of `levelProgress`. One level is on screen: the
 * self-assessment is an input of the calculation, not a second marker (a
 * second marker on the ladder read as a second level). The same piece appears
 * in the Vocabulary tab and in the result of the check.
 */
import { t } from '../shared/i18n';
import { STUDY_LEVELS, type StudyLevel } from '../shared/study/lexicalModel';

export function LevelLadder({ level, next, progress, muted = false }: {
  level: StudyLevel;
  next: StudyLevel | null;
  progress: number;
  muted?: boolean;
}) {
  const current = STUDY_LEVELS.indexOf(level);
  const pct = Math.round(progress * 100);
  const aria = [t('ws.ladderLevel', { level }), next ? t('ws.ladderNext', { pct, next }) : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div role="img" aria-label={aria} data-level-ladder={level} data-level-progress={pct}>
      <div className="grid grid-cols-6 gap-1">
        {STUDY_LEVELS.map((l, i) => (
          <span key={l} className="h-1.5 rounded-full overflow-hidden bg-zinc-900/[0.07] dark:bg-white/[0.08]">
            <span
              className={`block h-full rounded-full transition-[width] duration-500 ${muted ? 'bg-zinc-400 dark:bg-zinc-500' : 'bg-indigo-500 dark:bg-indigo-400'}`}
              style={{ width: i < current ? '100%' : i === current ? `${Math.max(8, pct)}%` : '0%' }}
            />
          </span>
        ))}
      </div>
      <div className="grid grid-cols-6 gap-1 mt-1.5" aria-hidden="true">
        {STUDY_LEVELS.map((l) => (
          <span
            key={l}
            className={`text-[11px] leading-4 tabular-nums ${l === level ? 'font-semibold text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-400'}`}
          >
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}
