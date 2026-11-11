/**
 * «This episode» group of the Vocabulary tab (docs/REDESIGN-V2.md §5.2, §5.3;
 * view from the prototype, numbers from `episodeCoverage`).
 *
 * Two states, never mixed: the active profile is the episode's, so the
 * coverage bar and its comprehension verdict apply; or the episode is in
 * another language, so the group explains where those words and cards go
 * instead of showing a percentage for a profile this tab is not rendering.
 *
 * The bar carries the 80% and 95% marks and a visible legend with the same
 * status names Subtitles uses: the colour never speaks alone (WCAG 1.4.1).
 */
import { Languages } from '../../../ui/icons';
import { t } from '../../../shared/i18n';
import type { WordStatus } from '../../../shared/study/wordStatus';
import { Callout, Group, NavRow, Row, ui } from '../../../ui/primitives/settings-primitives';
import { MARK_INK } from '../../../content/ui/wordMarks';
import {
  COVERAGE_MIN, COVERAGE_OPTIMAL, coverageVerdictKey, type EpisodeCoverage,
} from './episodeCoverage';

const COVERAGE_FILL: Record<WordStatus, string> = {
  known: 'bg-zinc-400 dark:bg-zinc-500',
  learning: 'bg-[var(--kvl-ink-learning)]',
  new: 'bg-[var(--kvl-ink-new)]',
};

const COVERAGE_LABEL: Record<WordStatus, string> = {
  known: 'ws.ep.filterKnown',
  learning: 'ws.ep.filterLearning',
  new: 'ws.ep.filterNew',
};

export interface EpisodeGroupProps {
  /** Display name of the episode language. */
  episodeLangName: string;
  /** Display name of the profile this tab is rendering. */
  activeLangName: string;
  /** The active profile is the episode's: coverage applies. */
  sameProfile: boolean;
  /** Coverage of the episode, when `sameProfile`. */
  coverage: EpisodeCoverage | null;
  /** Open the transcript rail's Words view. */
  onOpenWords?: () => void;
}

export function EpisodeGroup({
  episodeLangName, activeLangName, sameProfile, coverage, onOpenWords,
}: EpisodeGroupProps) {
  return (
    <Group title={t('ws.episodeTitle')} hint={t('ws.coverageHint')}>
      {!sameProfile && (
        <Callout
          tone="info"
          icon={<Languages />}
          role="status"
          className="!ring-0 !bg-transparent !rounded-none !pl-0"
          title={t('ws.otherLangTitle', { episode: episodeLangName })}
        >
          <span data-other-lang>
            {t('ws.otherLangBody', { episode: episodeLangName, lang: activeLangName })}
          </span>
        </Callout>
      )}

      {sameProfile && coverage && (
        <div data-episode-coverage>
          <Row label={t('ws.coverage')} value={`${coverage.knownPct}%`}>
            <div className={`relative ${MARK_INK}`}>
              <div
                role="img"
                aria-label={t('ws.coverageAria', {
                  known: coverage.knownPct,
                  learning: coverage.pct('learning'),
                  fresh: coverage.pct('new'),
                })}
                className="flex gap-px h-1.5 rounded-full overflow-hidden bg-zinc-900/[0.06] dark:bg-white/[0.08]"
              >
                {(['known', 'learning', 'new'] as const).map((status) => (
                  <span
                    key={status}
                    data-coverage-segment={status}
                    className={`h-full transition-[width] duration-300 ${COVERAGE_FILL[status]}`}
                    style={{ width: coverage.total ? `${(coverage.occ[status] / coverage.total) * 100}%` : 0 }}
                  />
                ))}
              </div>
              {[{ at: COVERAGE_MIN, title: t('ws.coverageMin') }, { at: COVERAGE_OPTIMAL, title: t('ws.coverageGoal') }].map((mark) => (
                <span
                  key={mark.at}
                  aria-hidden="true"
                  title={mark.title}
                  data-coverage-mark={mark.at}
                  className="absolute top-1/2 -translate-y-1/2 w-px h-2.5 bg-zinc-700 dark:bg-zinc-200"
                  style={{ left: `${mark.at}%` }}
                />
              ))}
            </div>
            <ul
              className={`${MARK_INK} flex flex-wrap gap-x-4 gap-y-1 text-[12px] leading-4 text-zinc-500 dark:text-zinc-400 tabular-nums`}
              aria-hidden="true"
            >
              {(['known', 'learning', 'new'] as const).map((status) => (
                <li key={status} className="inline-flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-[3px] ${COVERAGE_FILL[status]}`} />
                  {t(COVERAGE_LABEL[status])} {coverage.pct(status)}%
                </li>
              ))}
            </ul>
            <p className={ui.desc} data-coverage-verdict>{t(coverageVerdictKey(coverage.knownPct))}</p>
          </Row>
        </div>
      )}

      <NavRow
        data-open-episode-words
        label={t('ws.ep.toggle')}
        where={t('ws.ep.where')}
        title={t('ws.ep.openTitle')}
        onClick={() => onOpenWords?.()}
      />
    </Group>
  );
}
