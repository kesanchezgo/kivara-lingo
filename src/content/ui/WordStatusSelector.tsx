/**
 * Word-status selector inside the word card (docs/REDESIGN-V2.md §5.3, §7 F5;
 * ported from the prototype).
 *
 * Three choices — new / learning / known — plus the reason under them: a hand
 * mark, a card in Anki (learning) or a mature one (known), or the lexical
 * model's probability and main reason. «Back to automatic» removes the hand
 * mark and lets Anki or the estimate decide again; when the mark is the source
 * and the word is saved, the caption says the card is in the deck.
 *
 * The selector only changes status. The save action stays in the card's action
 * row; a known word can still be saved, and then it becomes learning (the new
 * card is fresher evidence than the hand mark).
 */
import { t, fmtNumber } from '../../shared/i18n';
import { RotateCcw } from '../../ui/icons';
import { SegmentedControl } from '../../ui/primitives/settings-primitives';
import { StatusGlyph } from './wordMarks';
import type { StatusDetail, StatusReason, WordStatus } from '../../shared/study/wordStatus';

/** Main reason of the estimate → phrase (the same data the model used). */
const WHY_KEY: Record<StatusReason, string> = {
  cognate: 'ws.why.cognate',
  below: 'ws.why.below',
  atLevel: 'ws.why.atLevel',
  frequent: 'ws.why.frequent',
  above: 'ws.why.above',
  rare: 'ws.why.rare',
  beyond: 'ws.why.beyond',
  noData: 'ws.src.default',
};

const LINK =
  'inline-flex items-center gap-1 h-6 px-1 rounded-md text-[11px] font-medium text-indigo-700 dark:text-indigo-300 ' +
  'hover:bg-indigo-500/10 transition-colors normal-case outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40';

/**
 * Why the word has this status: hand mark > Anki (card / mature) > estimate
 * (probability + main reason + the action to take) > no data. The probability
 * is shown between 1 % and 99 %: it is an estimate, never a certainty.
 */
function statusCaption(d: StatusDetail, isSaved: boolean): string {
  if (d.source === 'user') return isSaved ? t('ws.src.userInDeck') : t('ws.src.user');
  if (d.source === 'history') return d.status === 'known' ? t('ws.src.mature') : t('ws.src.deck');
  const b = d.basis;
  if (!b || !d.reason || d.reason === 'noData') return t('ws.src.default');
  // The percentage backs the sentence: «You probably know it (77 %)» /
  // «You probably do not know it yet (61 %)».
  const sure = d.status === 'known' ? b.p : 1 - b.p;
  const pct = t('ws.pct', { n: Math.min(99, Math.max(1, Math.round(sure * 100))) });
  const vars = {
    level: b.level ?? '',
    userLevel: b.userLevel,
    vocab: fmtNumber(b.vocab),
    rank: b.rank !== undefined ? fmtNumber(b.rank) : '',
    word: b.cognate?.word ?? '',
  };
  return [
    d.status === 'known' ? t('ws.est.known', { p: pct }) : t('ws.est.new', { p: pct }),
    t(WHY_KEY[d.reason], vars),
    b.falseFriend ? t('ws.why.falseFriend', { word: b.falseFriend }) : '',
    b.provisional ? t('ws.src.provisionalNote', { study: b.userLevel }) : '',
  ].filter(Boolean).join(' ');
}

export function WordStatusSelector({ token, status, detail, isSaved, onChange, onClear }: {
  token: string;
  status: WordStatus;
  detail?: StatusDetail;
  isSaved: boolean;
  onChange: (status: WordStatus) => void;
  onClear: () => void;
}) {
  const source = detail?.source;
  return (
    <div className="px-3 pt-2 pb-2 border-t border-zinc-900/[0.06] dark:border-white/[0.06] space-y-1.5" title={t('ws.label')}>
      <SegmentedControl
        size="sm"
        className="w-full [&>button]:!px-1"
        ariaLabel={t('ws.statusAria', { word: token })}
        options={[
          { v: 'new', l: t('ws.new'), icon: <StatusGlyph status="new" /> },
          { v: 'learning', l: t('ws.learning'), icon: <StatusGlyph status="learning" /> },
          { v: 'known', l: t('ws.known') },
        ]}
        value={status}
        onChange={(v) => onChange(v as WordStatus)}
      />
      <p
        className="text-[11px] leading-4 text-zinc-500 dark:text-zinc-400 normal-case"
        data-status-source={source}
        data-status-reason={detail?.reason}
      >
        {detail ? statusCaption(detail, isSaved) : t('ws.src.default')}
      </p>
      {source === 'user' && (
        <div className="flex flex-wrap items-center gap-x-3 -ml-1">
          <button type="button" data-status-clear onClick={onClear} title={t('ws.src.useAutoTitle')} className={LINK}>
            <RotateCcw size={10} /> {t('ws.src.useAuto')}
          </button>
        </div>
      )}
    </div>
  );
}
