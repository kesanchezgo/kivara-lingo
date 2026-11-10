/**
 * Vocabulary tab (docs/REDESIGN-V2.md §5.2, §5.3, §7 F5; view from the
 * prototype, engine from `shared/study`).
 *
 * Your level in the language you are learning, and what moves it:
 *
 *   1. The CALCULATED level: ≈ words, the ladder and what is missing for the
 *      next level. There is no second marker for the self-assessment — it is
 *      an input of the calculation, and its row says how much it still weighs.
 *   2. The evidence: self-assessment (a Select), the 2-minute check (its own
 *      dialog) and the Anki cards (the link goes to the Cards tab). What you
 *      mark in the subtitles counts too; it has no row because a counter there
 *      teaches nothing the group's hint does not.
 *
 * Same primitives as the rest of the panel (Group, Row, NavRow, Select,
 * Button). Everything is the profile of the active language.
 */
import { useMemo, useState } from 'react';
import { GraduationCap } from '../../../ui/icons';
import { t, fmtDate, fmtNumber, useLocale } from '../../../shared/i18n';
import { lookupDictionary } from '../../../content/nlp/dictionary';
import { useWordStudy } from '../../../content/ui/study';
import { VocabTestDialog } from '../../../content/ui/VocabTestDialog';
import { LevelLadder } from '../../../ui/LevelLadder';
import { Select } from '../../../ui/primitives/controls';
import { Badge, Button, Group, NavRow, Row, ui } from '../../../ui/primitives/settings-primitives';
import { isPending, useRecentCards } from './RecentCards';
import { MODEL, STUDY_LEVELS, type StudyLevel } from '../../../shared/study/lexicalModel';
import { COMMITTED_BANK, scoreVocabCheck, withGlosses } from '../../../shared/study/vocabCheck';

/** F5 opens the tab: the word status, the level and the check are real now. */
export const VOCAB_TAB_ENABLED = true;

export function VocabTab({ onOpenCards }: {
  /** Jump to the Cards tab (the Anki row); absent on hosts without tabs. */
  onOpenCards?: () => void;
}) {
  const locale = useLocale();
  const study = useWordStudy();
  const { lang, l1, estimator: est, profile, range, summary } = study;
  const langName = locale === 'es'
    ? t(`lang.${lang}`).toLocaleLowerCase('es')
    : t(`lang.${lang}`);
  const canTest = lang === 'en';
  const [testOpen, setTestOpen] = useState(false);

  // The meaning step needs glosses; the bank ships without them, so they come
  // from the bundled dictionary. The SAME object feeds the sample and the
  // scoring, or the denominator would not match what was shown.
  const bank = useMemo(
    () => withGlosses(COMMITTED_BANK, (word) => lookupDictionary(word, 'en')?.translation),
    [],
  );

  const queued = useRecentCards().filter(isPending).length;
  const test = profile.vocabTest;
  const testScore = useMemo(
    () => (test ? scoreVocabCheck(new Set(test.answers), l1, test.checks, test.shown, bank) : null),
    [test, l1, bank],
  );
  const testStale = !!test && Date.now() - test.at > MODEL.staleTestDays * 86_400_000;
  const testDesc = test && testScore
    ? [
      t('ws.evTestDone', { date: fmtDate(test.at) }),
      `${testScore.ceiling ? t('vc.moreThan', { n: fmtNumber(testScore.size) }) : t('ws.aboutN', { n: fmtNumber(testScore.size) })} ${t('ws.words')}`,
      testStale ? t('ws.evTestStale') : '',
    ].filter(Boolean).join(' · ')
    : canTest ? t('ws.evTestNone') : t('ws.evTestOnlyEn');

  // How much the self-assessment still weighs: the level if A1 or C2 were
  // chosen with the current evidence. Measured by the real distance between the
  // two ends, not by «is there evidence»: Anki cards add words but do not
  // calibrate the base, so with cards alone the self-assessment still decides.
  const spread = STUDY_LEVELS.indexOf(range.high.level) - STUDY_LEVELS.indexOf(range.low.level);
  const selfDesc = !profile.selfLevel ? t('ws.selfNoteUnset', { level: est.startLevel })
    : spread === 0 ? t('ws.selfNoteLow', { level: est.level })
    : spread <= 2 ? t('ws.selfNoteSpan', { lo: range.low.level, hi: range.high.level })
    : t('ws.selfNoteAll');
  const gap = est.nextAt ? Math.max(50, est.nextAt - est.total) : 0;

  return (
    <div className="flex flex-col h-full min-h-0 text-zinc-900 dark:text-zinc-100 overflow-y-auto kvl-scroll">
      <div className={ui.body}>
        {/* 1 · Your level and what moves it */}
        <div data-level-card>
          <Group title={t('ws.levelIn', { lang: langName })} hint={t('ws.levelHint')}>
            <Row
              label={(
                <span className="inline-flex items-center gap-2" data-level-value={est.level}>
                  {est.level} · {t(`ws.level.${est.level}`)}
                  {est.provisional && <Badge>{t('ws.refBadge')}</Badge>}
                </span>
              )}
              value={`≈\u00a0${fmtNumber(est.total)} ${t('ws.words')}`}
            >
              <LevelLadder level={est.level} next={est.next} progress={est.progress} muted={est.provisional} />
              <p className={`${ui.desc} tabular-nums`} data-level-next>
                {est.next && est.nextAt
                  ? t('ws.nextAt', { next: est.next, gap: fmtNumber(gap) })
                  : t('ws.levelTopShort')}
              </p>
            </Row>

            <div data-evidence="self">
              <Row inline label={t('ws.selfLevel')} hint={t('ws.selfLevelHint')} description={selfDesc}>
                <div className="w-[164px] shrink-0">
                  <Select
                    value={profile.selfLevel ?? ''}
                    onChange={(e) => study.setSelfLevel((e.target.value || null) as StudyLevel | null)}
                    placeholder={t('ws.levelUnset')}
                    aria-label={t('ws.selfLevel')}
                    className="w-full"
                  >
                    {STUDY_LEVELS.map((level) => (
                      <option key={level} value={level}>{`${level} · ${t(`ws.level.${level}`)}`}</option>
                    ))}
                  </Select>
                </div>
              </Row>
            </div>

            <div data-evidence="test" data-test-stale={testStale || undefined}>
              <Row inline label={t('vc.title')} description={testDesc}>
                {canTest && (
                  <Button
                    size="sm"
                    variant={!test || testStale ? 'soft' : 'secondary'}
                    data-vocab-open
                    onClick={() => setTestOpen(true)}
                    className="shrink-0"
                  >
                    {test ? t('ws.retestShort') : t('ws.measureShort')}
                  </Button>
                )}
              </Row>
            </div>

            <NavRow
              data-evidence="anki"
              data-open-cards
              label={t('ws.ankiTitle')}
              description={(
                <>
                  {summary.total
                    ? t('ws.ankiCounts', { mature: fmtNumber(summary.mature), learning: fmtNumber(summary.learning) })
                    : t('ws.ankiNone')}
                  {/* The last refresh failed: the numbers are the kept cache, so
                      «none» may really mean «unreachable». Say it honestly. */}
                  {study.coverage.state === 'stale' && (
                    <span className="text-amber-700 dark:text-amber-400"> · {t('cards.offline')}</span>
                  )}
                  {queued > 0 && <span className="text-amber-700 dark:text-amber-400"> · {t('recent.queuedCount', { n: queued })}</span>}
                </>
              )}
              where={t('ws.openCards')}
              title={t('ws.openCardsTitle')}
              onClick={() => onOpenCards?.()}
            />
          </Group>
        </div>

        {/* 2 · The precedence, in one line. The word card is where it acts; the
            tab explains what the numbers are made of. */}
        <Group icon={<GraduationCap size={13} />} title={t('ws.sectionTitle')} hint={t('ws.sectionHint')}>
          <p className={`${ui.desc} px-0.5`} data-precedence-note>{t('ws.precedenceNote')}</p>
        </Group>
      </div>

      {canTest && (
        <VocabTestDialog
          open={testOpen}
          onOpenChange={setTestOpen}
          bank={bank}
          l1={l1}
          langName={langName}
          before={est}
          preview={(preview) => study.previewTest(preview)}
          onSave={(answers, checks, shown) => study.applyTest(answers, checks, shown)}
        />
      )}
    </div>
  );
}