/**
 * Level step (F8; docs/REDESIGN-V2.md §7): the CEFR sentence selector OR the
 * 2-minute vocabulary check. View from the prototype, engine from F5
 * (`shared/study/wordStatus` through `content/ui/study`).
 *
 * It writes the profile OF THE LANGUAGE being learned: the self-assessment is
 * personal (no default value), and the check is evidence of the same profile.
 * Nothing here is the final level — that is computed from all the evidence and
 * advances on its own. The check never blocks saving: its result arrives
 * already corrected, and saving it is always enabled.
 */
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { GraduationCap, Check } from '../../ui/icons';
import { t, fmtNumber, useLocale } from '../../shared/i18n';
import { lookupDictionary } from '../../content/nlp/dictionary';
import { useWordStudy } from '../../content/ui/study';
import { VocabCheck } from '../../content/ui/VocabCheck';
import { COMMITTED_BANK, scoreVocabCheck, withGlosses } from '../../shared/study/vocabCheck';
import { STUDY_LEVELS, type StudyLevel } from '../../shared/study/lexicalModel';
import { Badge, Button, surface } from '../../ui/primitives/settings-primitives';
import { StepSection } from './StepSection';
import { getLang } from './LangMeta';

export function LevelStep({ sourceLang }: { sourceLang: string }) {
  const locale = useLocale();
  const study = useWordStudy(sourceLang);
  const [testOpen, setTestOpen] = useState(false);
  const refs = useRef<Partial<Record<StudyLevel, HTMLButtonElement | null>>>({});
  const name = getLang(sourceLang).name;
  const lang = locale === 'es' ? name.toLocaleLowerCase('es') : name;
  const canTest = study.lang === 'en';

  // The meaning step needs glosses; the bank ships without them, so they come
  // from the bundled dictionary. The SAME object feeds the sample and the
  // scoring, or the denominator would not match what was shown.
  const bank = useMemo(
    () => withGlosses(COMMITTED_BANK, (word) => lookupDictionary(word, 'en')?.translation),
    [],
  );
  const test = study.profile.vocabTest;
  const measured = test ? scoreVocabCheck(new Set(test.answers), study.l1, test.checks, test.shown, bank) : null;

  const pick = (level: StudyLevel) => study.setSelfLevel(level);
  const onKey = (e: KeyboardEvent, i: number) => {
    const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = STUDY_LEVELS[(i + dir + STUDY_LEVELS.length) % STUDY_LEVELS.length]!;
    pick(next);
    refs.current[next]?.focus();
  };

  return (
    <StepSection
      icon={<GraduationCap size={20} />}
      title={t('onb.levelTitle', { lang })}
      subtitle={t('onb.levelSubtitle')}
    >
      {testOpen ? (
        <div className={`${surface.group} p-4`}>
          <VocabCheck
            showTitle
            bank={bank}
            l1={study.l1}
            langName={name}
            before={study.estimator}
            preview={(preview) => study.previewTest(preview)}
            onSave={(answers, checks, shown) => study.applyTest(answers, checks, shown)}
            onDone={() => setTestOpen(false)}
            onCancel={() => setTestOpen(false)}
          />
        </div>
      ) : (
        <>
          <div
            role="radiogroup"
            aria-label={t('ws.selfLevel')}
            className={`rounded-2xl overflow-hidden ${surface.group} divide-y divide-zinc-900/[0.06] dark:divide-white/[0.06]`}
          >
            {STUDY_LEVELS.map((l, i) => {
              const checked = study.profile.selfLevel === l;
              return (
                <button
                  key={l}
                  ref={(el) => { refs.current[l] = el; }}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={checked || (!study.profile.selfLevel && i === 0) ? 0 : -1}
                  onClick={() => pick(l)}
                  onKeyDown={(e) => onKey(e, i)}
                  data-level-option={l}
                  className={`kvl-press w-full flex items-center gap-3.5 px-4 py-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500/40 ${
                    checked ? 'bg-indigo-50/70 dark:bg-indigo-500/[0.10]' : 'hover:bg-zinc-50 dark:hover:bg-white/[0.03]'
                  }`}
                >
                  <span className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center text-[14px] font-semibold tabular-nums tracking-[-0.01em] transition-colors ${
                    checked ? 'bg-indigo-500 text-white shadow-[0_4px_12px_-4px_rgba(79,70,229,.6)]' : 'bg-zinc-900/[0.05] dark:bg-white/[0.07] text-zinc-700 dark:text-zinc-200'
                  }`}>
                    {l}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium leading-[18px] text-zinc-900 dark:text-zinc-100">{t(`ws.level.${l}`)}</span>
                    <span className="block text-[12px] leading-[17px] text-zinc-500 dark:text-zinc-400">{t(`ws.levelCanDo.${l}`)}</span>
                  </span>
                  <span aria-hidden="true" className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center transition-colors ${
                    checked ? 'bg-indigo-500 text-white' : 'ring-1 ring-inset ring-zinc-900/[0.15] dark:ring-white/[0.15]'
                  }`}>
                    {checked && <Check size={11} weight="bold" />}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 2-minute check: the English bank ships with the build (F5). */}
          {canTest && (
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              {measured && (
                <Badge tone="indigo">
                  {measured.ceiling ? t('onb.vocabMeasuredMore', { n: fmtNumber(measured.size) }) : t('onb.vocabMeasured', { n: fmtNumber(measured.size) })}
                </Badge>
              )}
              <Button variant="ghost" size="sm" data-vocab-open onClick={() => setTestOpen(true)}>
                {measured ? t('ws.vocabRetest') : t('onb.vocabCta')}
              </Button>
            </div>
          )}
        </>
      )}

      <p className="text-center text-[12px] leading-[18px] text-zinc-500 dark:text-zinc-400 px-6 pt-1">{t('onb.levelFoot')}</p>
    </StepSection>
  );
}
