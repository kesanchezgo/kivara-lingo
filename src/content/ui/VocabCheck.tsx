/**
 * Vocabulary check (docs/REDESIGN-V2.md §5.3; ported from the prototype,
 * engine from `shared/study/vocabCheck`).
 *
 * Three steps:
 *   1. Mark: «tap the words whose meaning you know». Word tiles of natural
 *      width with an always-present selection circle, so choosing changes the
 *      colour but never the width. Every attempt is a different sample of the
 *      bank.
 *   2. Check: up to five of the marked ones, one at a time, with four answers
 *      and «I don't know». Keys 1–4 and 0. Skipped without glosses in the
 *      learner's language, or without marks.
 *   3. Result: what changes if it is saved (the level, on the same ladder the
 *      Vocabulary tab uses), then the detail. Saving is ALWAYS possible: a
 *      result with many misses arrives already corrected and the screen says
 *      so — the old build blocked it, which was worse.
 *
 * The same piece renders inline (a step in a flow) and in the centred dialog
 * (`layout="dialog"`: header with the step via `onStep`, fixed footer). The
 * dialog itself lives in `VocabTestDialog`.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AlertTriangle, ArrowRight, Check, X } from '../../ui/icons';
import { t, fmtNumber } from '../../shared/i18n';
import {
  checkAnswerOf, checkOptions, glossOf, hasCheckGlosses, isVcRealWord, pickCheckWords,
  sampleTest, scoreVocabCheck, VC_BANDS, VC_FAKES_SHOWN, VC_PER_BAND,
  type VcChecks, type VcItem, type VcResult, type VocabBank,
} from '../../shared/study/vocabCheck';
import type { Estimator } from '../../shared/study/wordStatus';
import { Button, Callout, FOCUS, surface, tx } from '../../ui/primitives/settings-primitives';
import { LevelLadder } from '../../ui/LevelLadder';
import { InfoHint } from '../../app/components/InfoHint';

export type VcStep = 'mark' | 'check' | 'result';

export interface VocabCheckProps {
  bank: VocabBank;
  /** The learner's language (glosses, cognates). */
  l1: string;
  /** Language name for the copy. */
  langName: string;
  /** The estimate before the check, to compare the result with it. */
  before: Estimator;
  /** The estimate with these answers applied, without saving it. */
  preview(test: { answers: string[]; checks?: VcChecks; shown: string[] }): Estimator;
  /** Persist the answers as evidence. Always enabled. */
  onSave(answers: string[], checks: VcChecks, shown: string[]): void;
  /** After saving, with the updated estimate. */
  onDone?: (est: Estimator) => void;
  onCancel?: () => void;
  /** There is progress to lose (the dialog does not close on an outside click). */
  onProgress?: (n: number) => void;
  /** Current step and number of steps with questions (the dialog paints them in its header). */
  onStep?: (step: VcStep, total: number) => void;
  /** Visible heading (a flow where it replaces a list). */
  showTitle?: boolean;
  layout?: 'inline' | 'dialog';
  /** Seed of the first sample (tests); by default every attempt is new. */
  seed?: number;
}

export function VocabCheck({
  bank, l1, langName, before, preview, onSave, onDone, onCancel, onProgress, onStep,
  showTitle = false, layout = 'inline', seed,
}: VocabCheckProps) {
  const [items, setItems] = useState<VcItem[]>(() => sampleTest(bank, seed));
  const [step, setStep] = useState<VcStep>('mark');
  const [known, setKnown] = useState<Set<string>>(() => new Set());
  const [checkWords, setCheckWords] = useState<string[]>([]);
  const [q, setQ] = useState(0);
  /** Answer per word: the chosen gloss, or `null` = «I don't know». */
  const [picks, setPicks] = useState<Record<string, string | null>>({});
  const [result, setResult] = useState<{ test: VcResult; after: Estimator; checks: VcChecks } | null>(null);
  const advance = useRef<number | undefined>(undefined);
  const dialog = layout === 'dialog';
  const withCheck = hasCheckGlosses(l1) && bank.items.some((it) => it.gloss);
  const shown = useMemo(() => items.map((it) => it.word), [items]);

  // Functional update: two quick taps before a paint do not overwrite each other.
  const toggle = (word: string) => setKnown((prev) => {
    const next = new Set(prev);
    if (next.has(word)) next.delete(word);
    else next.add(word);
    return next;
  });
  useEffect(() => { onProgress?.(known.size); }, [known.size]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onStep?.(step, withCheck ? 2 : 1); }, [step, withCheck]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => window.clearTimeout(advance.current), []);

  const finish = (checks: VcChecks) => {
    const answers = [...known];
    setResult({
      test: scoreVocabCheck(known, l1, checks, shown, bank),
      after: preview({ answers, checks, shown }),
      checks,
    });
    setStep('result');
  };
  const next = () => {
    const words = withCheck ? pickCheckWords(known, bank) : [];
    if (!words.length) {
      finish({});
      return;
    }
    setCheckWords(words);
    setPicks({});
    setQ(0);
    setStep('check');
  };
  // Answering shows the choice for a moment and moves on (the last one shows the result).
  const answer = (word: string, value: string | null) => {
    const nextPicks = { ...picks, [word]: value };
    setPicks(nextPicks);
    window.clearTimeout(advance.current);
    advance.current = window.setTimeout(() => {
      if (q < checkWords.length - 1) setQ(q + 1);
      else finish(Object.fromEntries(checkWords.map((w) => [w, checkAnswerOf(bank, w, nextPicks[w] ?? null)])));
    }, 320);
  };
  const back = () => {
    window.clearTimeout(advance.current);
    if (step === 'check' && q > 0) setQ(q - 1);
    else setStep('mark');
  };
  // Retry = another sample: seeing the same words again would be remembering, not measuring.
  const retry = () => {
    window.clearTimeout(advance.current);
    setItems(sampleTest(bank));
    setKnown(new Set());
    setPicks({});
    setCheckWords([]);
    setQ(0);
    setResult(null);
    setStep('mark');
  };
  const save = () => {
    if (!result) return;
    onSave([...known], result.checks, shown);
    onDone?.(result.after);
  };

  // In the dialog the body scrolls and the footer stays put; inline, everything flows.
  const wrap = dialog ? 'flex flex-col min-h-0 flex-1' : 'space-y-4';
  const body = dialog ? 'flex-1 min-h-0 overflow-y-auto kvl-scroll px-6 py-5 space-y-5' : 'space-y-4';
  const foot = dialog
    ? `shrink-0 flex items-center justify-between gap-3 px-5 py-3 border-t ${surface.hairB} bg-zinc-50/70 dark:bg-white/[0.02]`
    : `flex items-center justify-between gap-3 pt-3 border-t ${surface.hairB}`;
  const btn = dialog ? 'md' : 'sm';
  const inlineHead = (label: string, n?: 1 | 2) => !dialog && (showTitle || (withCheck && n)) && (
    <div className="flex items-center justify-between gap-3">
      {showTitle && <p className={tx.label}>{t('vc.title')}</p>}
      {withCheck && n && (
        <p className="text-[12px] leading-4 text-zinc-500 dark:text-zinc-400" data-vocab-step={n}>
          {t('vc.stepOf', { n, total: 2 })} · {label}
        </p>
      )}
    </div>
  );

  /* ── 3 · Result ──────────────────────────────────────────────────────── */
  if (step === 'result' && result) {
    const { test, after, checks } = result;
    // Without a self-assessment or a previous check, «before» was only a reference: do not compare.
    const moved = !before.provisional && after.level !== before.level;
    const checked = Object.entries(checks);
    return (
      <div data-vocab-result role="group" aria-label={t('vc.title')} className={wrap}>
        <div className={body}>
          {inlineHead(t('vc.resultStep'))}
          <section
            data-vocab-after={after.level}
            aria-label={t('vc.withEvidence', { lang: langName })}
            className="rounded-2xl px-5 pt-4 pb-4 bg-indigo-500/[0.05] dark:bg-indigo-400/[0.07] ring-1 ring-indigo-500/15 dark:ring-indigo-400/20 space-y-3.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className={tx.small}>{t('vc.withEvidence', { lang: langName })}</p>
                <p className="flex items-baseline gap-2 mt-1">
                  {moved && (
                    <>
                      <span className="text-[15px] font-semibold text-zinc-400 dark:text-zinc-400 tabular-nums">{before.level}</span>
                      <ArrowRight size={14} className="self-center text-indigo-500 dark:text-indigo-400" aria-hidden="true" />
                    </>
                  )}
                  <span className={`${tx.display} tabular-nums`}>{after.level}</span>
                  <span className={tx.label}>{t(`ws.level.${after.level}`)}</span>
                </p>
              </div>
              <div className="text-right shrink-0">
                <div className={`${tx.label} tabular-nums`}>{t('ws.aboutN', { n: fmtNumber(after.total) })}</div>
                <div className={tx.small}>{t('ws.words')}</div>
              </div>
            </div>
            <LevelLadder level={after.level} next={after.next} progress={after.progress} />
            <p className={tx.small}>
              {before.provisional ? t('vc.levelFirst', { n: fmtNumber(after.total) })
                : moved ? t('vc.levelMoves', { from: fmtNumber(before.total), to: fmtNumber(after.total) })
                : t('vc.levelStays', { n: fmtNumber(after.total) })}
            </p>
          </section>

          {/* Many misses or invented words marked: it is explained, not blocked. */}
          {test.quality === 'low' && (
            <Callout tone="warning" icon={<AlertTriangle />} role="status">
              {t(test.lowReason === 'fakes' ? 'vc.lowFakes' : 'vc.lowChecks')}
            </Callout>
          )}

          <dl className="grid grid-cols-3 gap-2" data-vocab-size={test.size}>
            <Stat
              label={t('vc.testAlone')}
              value={test.ceiling ? t('vc.moreThan', { n: fmtNumber(test.size) }) : t('ws.aboutN', { n: fmtNumber(test.size) })}
              sub={t('vc.testAloneSub', { level: test.level })}
            />
            <Stat label={t('vc.fakesLabel')} value={t('vc.nOfM', { n: test.falseAlarms, m: test.fakeTotal })} sub={t('vc.fakesSub')} />
            <Stat
              label={t('vc.checkLabel')}
              value={test.checked ? t('vc.nOfM', { n: test.passed, m: test.checked }) : '—'}
              sub={test.checked ? t('vc.checkSub') : t('vc.checkSkipped')}
            />
          </dl>

          {checked.length > 0 && (
            <section className="space-y-2">
              <p className="text-[12px] leading-4 font-medium text-zinc-500 dark:text-zinc-400">{t('vc.checkListTitle')}</p>
              <ul
                className="rounded-xl ring-1 ring-zinc-900/[0.06] dark:ring-white/[0.06] bg-white dark:bg-white/[0.03] divide-y divide-zinc-900/[0.06] dark:divide-white/[0.06]"
                data-vocab-checks
                aria-label={t('vc.checkListTitle')}
              >
                {checked.map(([word, a]) => (
                  <li key={word} className="flex items-center gap-3 px-3.5 h-10 text-[13px]">
                    <span
                      className={`w-5 h-5 shrink-0 rounded-full inline-flex items-center justify-center ${a === 'ok' ? 'bg-emerald-500/[0.12] text-emerald-600 dark:text-emerald-400' : 'bg-zinc-900/[0.06] dark:bg-white/[0.08] text-zinc-500 dark:text-zinc-400'}`}
                      aria-hidden="true"
                    >
                      {a === 'ok' ? <Check size={11} weight="bold" /> : <X size={11} weight="bold" />}
                    </span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-50 truncate">{word}</span>
                    <span className="flex-1 min-w-0 text-zinc-500 dark:text-zinc-400 truncate">{glossOf(bank, word)}</span>
                    <span className={`shrink-0 text-[12px] ${a === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400 dark:text-zinc-400'}`}>
                      {a === 'ok' ? t('vc.checkOk') : a === 'idk' ? t('vc.idk') : t('vc.checkWrong')}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <div className={foot}>
          <span className={`${tx.meta} min-w-0`}>{t('vc.keepNote')}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button variant="ghost" size={btn} onClick={retry}>{t('vc.retryNew')}</Button>
            <Button variant="primary" size={btn} data-vocab-apply onClick={save}>{t('vc.keep')}</Button>
          </div>
        </div>
      </div>
    );
  }

  /* ── 2 · Check: one question at a time ───────────────────────────────── */
  if (step === 'check') {
    const word = checkWords[q];
    return (
      <div data-vocab-checkstep role="group" aria-label={t('vc.title')} className={wrap}>
        <div className={body}>
          {inlineHead(t('vc.stepCheck'), 2)}
          <p className={`${tx.small} text-center`}>{t('vc.checkIntro')}</p>
          <CheckQuestion
            key={word}
            bank={bank}
            word={word}
            index={q}
            total={checkWords.length}
            avoid={checkWords}
            value={picks[word]}
            onAnswer={(v) => answer(word, v)}
          />
        </div>
        <div className={foot}>
          <span className={`${tx.meta} hidden sm:inline`}>{t('vc.keysHint')}</span>
          <Button variant="ghost" size={btn} onClick={back} className="ml-auto">{t('vc.back')}</Button>
        </div>
      </div>
    );
  }

  /* ── 1 · Mark ────────────────────────────────────────────────────────── */
  const realTicks = [...known].filter(isVcRealWord).length;
  return (
    <div data-vocab-check role="group" aria-label={t('vc.title')} className={wrap}>
      <div className={body}>
        {inlineHead(t('vc.stepMark'), 1)}
        <p className={`${tx.body} text-center max-w-[520px] mx-auto !text-zinc-600 dark:!text-zinc-300`}>
          {t('vc.intro')}{'\u00a0'}
          <InfoHint text={t('vc.method')} className="align-[-2px]" />
        </p>
        <div role="group" aria-label={t('vc.groupAria')} className="flex flex-wrap justify-center gap-x-2 gap-y-2.5 px-1" data-vocab-grid>
          {items.map((it) => (
            <WordTile key={it.word} word={it.word} on={known.has(it.word)} onToggle={() => toggle(it.word)} />
          ))}
        </div>
      </div>
      <div className={foot}>
        <span className={`${tx.meta} tabular-nums`} aria-live="polite">
          {t('vc.count', { n: known.size, total: items.length })}
        </span>
        <div className="flex items-center gap-1.5">
          {onCancel && <Button variant="ghost" size={btn} onClick={onCancel}>{t('vc.cancel')}</Button>}
          <Button variant="primary" size={btn} data-vocab-next onClick={next}>
            {withCheck && realTicks > 0 ? t('vc.next') : t('vc.see')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Word-tile surface: soft when off, solid indigo when on (fill and contrast, not hue alone). */
const choiceSurface = (on: boolean) => `kvl-press ring-1 ring-inset transition-colors ${FOCUS} ${
  on
    ? 'bg-indigo-500/[0.08] dark:bg-indigo-400/[0.14] ring-indigo-500/35 dark:ring-indigo-400/40 text-indigo-700 dark:text-indigo-100'
    : 'bg-white dark:bg-white/[0.04] ring-zinc-900/[0.1] dark:ring-white/[0.1] text-zinc-700 dark:text-zinc-200 hover:ring-zinc-900/[0.2] dark:hover:ring-white/[0.2] hover:bg-zinc-50 dark:hover:bg-white/[0.07]'
}`;

function WordTile({ word, on, onToggle }: { word: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={`kvl-press inline-flex items-center h-9 px-4 rounded-full text-[14px] font-medium transition-[background-color,color,box-shadow] duration-150 ${FOCUS} ${
        on
          ? 'bg-indigo-600 dark:bg-indigo-500 text-white shadow-[0_1px_2px_rgba(79,70,229,0.35)]'
          : 'bg-zinc-900/[0.05] dark:bg-white/[0.07] text-zinc-800 dark:text-zinc-100 hover:bg-zinc-900/[0.09] dark:hover:bg-white/[0.12]'
      }`}
    >
      {word}
    </button>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0 rounded-xl px-3.5 py-3 ring-1 ring-zinc-900/[0.06] dark:ring-white/[0.06] bg-white dark:bg-white/[0.03] flex flex-col">
      <dt className="order-2 text-[12px] leading-4 text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="order-1 text-[15px] leading-5 font-semibold tabular-nums text-zinc-900 dark:text-zinc-50 truncate">{value}</dd>
      <dd className="order-3 text-[11px] leading-4 mt-0.5 text-zinc-400 dark:text-zinc-400">{sub}</dd>
    </div>
  );
}

/**
 * One question: «What does … mean?», the word large, four answers (radio
 * group; arrows or keys 1–4) and «I don't know» (key 0) apart. Focus enters the
 * question when it appears, so the keyboard flow continues.
 */
function CheckQuestion({ bank, word, index, total, avoid, value, onAnswer }: {
  bank: VocabBank; word: string; index: number; total: number; avoid: readonly string[];
  value: string | null | undefined; onAnswer: (v: string | null) => void;
}) {
  const options = useMemo(() => checkOptions(bank, word, avoid), [bank, word, avoid]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const n = Number(e.key);
    if (e.key === '0') { e.preventDefault(); onAnswer(null); return; }
    if (n >= 1 && n <= options.length) { e.preventDefault(); onAnswer(options[n - 1]); return; }
    const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1
      : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    const radios = [...(ref.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])];
    const i = radios.indexOf(document.activeElement as HTMLElement);
    radios[(i + dir + radios.length) % radios.length]?.focus();
  };
  return (
    <div ref={ref} tabIndex={-1} onKeyDown={onKey} className="outline-none space-y-5" data-check-word={word}>
      <div className="flex items-center justify-center gap-1.5" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all duration-300 ${i === index ? 'w-6 bg-indigo-500 dark:bg-indigo-400' : i < index ? 'w-1.5 bg-indigo-500/50 dark:bg-indigo-400/50' : 'w-1.5 bg-zinc-900/[0.12] dark:bg-white/[0.14]'}`}
          />
        ))}
      </div>
      <div className="text-center space-y-1">
        <p className="text-[12px] leading-4 text-zinc-500 dark:text-zinc-400">{t('vc.questionOf', { n: index + 1, total })}</p>
        <p id={`vc-q-${word}`} className="text-[28px] leading-9 font-semibold tracking-[-0.02em] text-zinc-900 dark:text-white" aria-live="polite">
          {word}
        </p>
      </div>
      <div role="radiogroup" aria-labelledby={`vc-q-${word}`} className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-[460px] mx-auto">
        {options.map((option, i) => {
          const on = value === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on || (value === undefined && i === 0) || (value === null && i === 0) ? 0 : -1}
              onClick={() => onAnswer(option)}
              className={`${choiceSurface(on)} flex items-center gap-3 h-12 pl-3 pr-4 rounded-xl text-[14px] font-medium text-left`}
            >
              <span
                aria-hidden="true"
                className={`w-6 h-6 shrink-0 rounded-md inline-flex items-center justify-center text-[11px] font-semibold tabular-nums ${on ? 'bg-indigo-500 text-white' : 'bg-zinc-900/[0.05] dark:bg-white/[0.08] text-zinc-500 dark:text-zinc-400'}`}
              >
                {i + 1}
              </span>
              <span className="truncate">{option}</span>
            </button>
          );
        })}
      </div>
      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => onAnswer(null)}
          aria-pressed={value === null}
          className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium kvl-press ${FOCUS} ${
            value === null
              ? 'bg-zinc-900/[0.07] dark:bg-white/[0.1] text-zinc-900 dark:text-white'
              : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-900/[0.05] dark:hover:bg-white/[0.06]'
          }`}
        >
          {t('vc.idk')}
        </button>
      </div>
    </div>
  );
}

/** The size of one attempt, for the dialog's header copy. */
export const VC_ITEMS_PER_ATTEMPT = VC_BANDS * VC_PER_BAND + VC_FAKES_SHOWN;