/**
 * Words of the episode — the «Words» view of the transcript
 * (docs/REDESIGN-V2.md §5.1, §5.3; ported from the prototype).
 *
 * Only the current episode: review the new words before watching and fix
 * marks (for example after marking a run of words as known). What is already
 * in Anki says so; the list never creates a second card.
 *
 * Real size: a 45-minute episode has ~5,000–7,000 running words and ~1,000–
 * 1,500 distinct lemmas, so the list is a full-height column with a fixed
 * filter on top and pages of 40 (the next page loads on scroll or with the
 * «show more» button, which is keyboard reachable).
 *
 * Per LEMMA (like the status): «was», «were» and «aren't» count as «be».
 * Order: frequency in the episode, then alphabetical.
 *
 * The transcript rail itself is F6; this module ships the view and its
 * vocabulary builder, so F6 only wires the rail (and the seek callback, which
 * must go through the platform PlaybackController).
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Check } from '../../ui/icons';
import { t, useLocale } from '../../shared/i18n';
import { tokenizeSentence } from '../nlp/tokenize';
import { lookupDictionary } from '../nlp/dictionary';
import { normalizeStatusKey, type WordStatus } from '../../shared/study/wordStatus';
import { StatusGlyph, MARK_INK } from './wordMarks';
import { FilterChips, FOCUS, buttonCls } from '../../ui/primitives/settings-primitives';
import type { StudyBinding } from './study';

export const PAGE_SIZE = 40;
const FILTERS: readonly WordStatus[] = ['new', 'learning', 'known'];

export interface EpisodeWord {
  /** Status key of the first appearance (the lemma). */
  key: string;
  label: string;
  level?: string;
  count: number;
  /** Index of the cue of the first appearance. */
  firstCue: number;
  /** Start of that cue, in ms (the jump title). */
  start: number;
  expr: boolean;
  /** Surface forms in the episode, when they differ from the label. */
  forms: string[];
}

/** A cue as the adapter hands it over (only what the vocabulary needs). */
export interface EpisodeCue { text: string; start: number }

/** Distinct vocabulary of a track, per lemma. Pure: same cues, same list. */
export function buildEpisodeVocabulary(cues: readonly EpisodeCue[], lang = 'en'): EpisodeWord[] {
  const byLemma = new Map<string, EpisodeWord & { formSet: Set<string> }>();
  cues.forEach((cue, i) => {
    for (const tok of tokenizeSentence(cue.text, new Set(), lang)) {
      const expr = tok.kind === 'mwe';
      // Same criterion as the subtitle marks: expressions and vocabulary,
      // never proper nouns or punctuation.
      if (!expr && tok.kind !== 'known' && tok.kind !== 'unknown' && tok.kind !== 'mastered') continue;
      const lemma = normalizeStatusKey(tok.lemma ?? tok.key);
      if (!lemma) continue;
      const seen = byLemma.get(lemma);
      if (seen) {
        seen.count += 1;
        seen.formSet.add(tok.text);
        continue;
      }
      const entry = lookupDictionary(lemma, lang);
      byLemma.set(lemma, {
        key: lemma,
        label: entry && !entry.lemmaOf ? entry.token : lemma,
        level: entry?.level,
        count: 1,
        firstCue: i,
        start: cue.start,
        expr,
        forms: [],
        formSet: new Set([tok.text]),
      });
    }
  });
  return [...byLemma.values()].map(({ formSet, ...word }) => ({
    ...word,
    forms: [...formSet].filter((form) => form.toLowerCase() !== word.label.toLowerCase()),
  }));
}

/** mm:ss of a cue start. */
function fmtTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

const FILTER_LABEL: Record<WordStatus, string> = {
  new: 'ws.ep.filterNew', learning: 'ws.ep.filterLearning', known: 'ws.ep.filterKnown',
};
const EMPTY_LABEL: Record<WordStatus, string> = {
  new: 'ws.ep.emptyNew', learning: 'ws.ep.emptyLearning', known: 'ws.ep.emptyKnown',
};
const META_BADGE = 'text-[11px] font-medium text-zinc-600 dark:text-zinc-300 bg-zinc-900/[0.05] dark:bg-white/[0.07] h-5 inline-flex items-center px-1.5 rounded-md shrink-0 tabular-nums';
/** Row action: appears on hover or focus (always on touch screens), like «Undo» in Recent. */
const ROW_ACTION = 'opacity-0 group-hover/w:opacity-100 group-focus-within/w:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity';
/** Main action per status: new and learning → known; known → new. */
const nextStatus = (s: WordStatus): WordStatus => (s === 'known' ? 'new' : 'known');

export interface EpisodeWordsProps {
  words: readonly EpisodeWord[];
  study: StudyBinding;
  /** Seek to a cue: F6 routes it through the platform PlaybackController. */
  onSeek?: (cueIndex: number) => void;
}

function EpisodeWordsView({ words, study, onSeek }: EpisodeWordsProps) {
  const locale = useLocale();
  const [filter, setFilter] = useState<WordStatus>('new');
  const [shown, setShown] = useState(PAGE_SIZE);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  // After marking, the row leaves the list: focus goes to the next one (or to the filter when empty).
  const pendingFocus = useRef<number | null>(null);

  const { statusOf } = study;

  const { groups, counts } = useMemo(() => {
    const grouped: Record<WordStatus, (EpisodeWord & { status: WordStatus })[]> = { new: [], learning: [], known: [] };
    words.forEach((word) => {
      const status = statusOf(word.key);
      grouped[status].push({ ...word, status });
    });
    const collator = new Intl.Collator(locale, { sensitivity: 'base' });
    FILTERS.forEach((status) => grouped[status].sort((a, b) => b.count - a.count || collator.compare(a.label, b.label)));
    return { groups: grouped, counts: { new: grouped.new.length, learning: grouped.learning.length, known: grouped.known.length } };
  }, [words, statusOf, locale]);

  const list = groups[filter];
  const visible = list.slice(0, shown);
  const remaining = list.length - visible.length;
  const hasMore = remaining > 0;

  // Changing filter goes back to the top and to the first page.
  const changeFilter = (next: WordStatus) => {
    setFilter(next);
    setShown(PAGE_SIZE);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  // Load at the end: the «show more» button doubles as a sentinel.
  useEffect(() => {
    const el = moreRef.current;
    const root = scrollRef.current;
    if (!hasMore || !el || !root || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setShown((n) => n + PAGE_SIZE);
    }, { root, rootMargin: '0px 0px 160px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [filter, shown, hasMore]);

  useLayoutEffect(() => {
    const index = pendingFocus.current;
    if (index === null) return;
    pendingFocus.current = null;
    const rows = listRef.current?.querySelectorAll<HTMLButtonElement>('[data-ep-word]');
    if (rows && rows.length) rows[Math.min(index, rows.length - 1)].focus();
    else filterRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  });

  const mark = (word: EpisodeWord, index: number, status: WordStatus) => {
    const previous = study.userStatusOf(word.key) ?? null;
    pendingFocus.current = index;
    study.setStatus(word.key, status);
    toast(t(status === 'known' ? 'ws.ep.markedKnown' : 'ws.ep.markedNew', { word: word.label }), {
      duration: 5000,
      action: { label: t('recent.undo'), onClick: () => study.setStatus(word.key, previous) },
    });
  };

  return (
    <div data-episode-words className={`${MARK_INK} flex-1 min-h-0 flex flex-col @container`}>
      {/* Fixed filter: the list may have hundreds of rows. */}
      <div className="shrink-0 px-4 pt-3 pb-3 space-y-2.5 border-b border-zinc-900/[0.06] dark:border-white/[0.06]">
        <div ref={filterRef}>
          <FilterChips
            ariaLabel={t('ws.ep.filterAria')}
            value={filter}
            onChange={changeFilter}
            options={FILTERS.map((status) => ({
              v: status,
              l: t(FILTER_LABEL[status]),
              count: counts[status],
              // Glyph only when it fits: in the narrowest column the three chips would wrap.
              icon: status === 'known' ? undefined : <span className="inline-flex @max-[380px]:hidden"><StatusGlyph status={status} /></span>,
            }))}
          />
        </div>
        <p className="text-[12px] leading-4 text-zinc-500 dark:text-zinc-400">{t('ws.ep.caption')}</p>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto kvl-scroll py-2 bg-zinc-50/80 dark:bg-transparent">
        {list.length === 0 ? (
          <p className="px-6 py-10 text-center text-[12px] leading-[18px] text-zinc-500 dark:text-zinc-400">{t(EMPTY_LABEL[filter])}</p>
        ) : (
          <ul ref={listRef} role="list" aria-label={t('ws.ep.listAria', { status: t(FILTER_LABEL[filter]), n: list.length })} className="px-3">
            {visible.map((word, i) => {
              const jump = t('ws.ep.jumpTitle', { time: fmtTime(word.start) });
              const occurrences = t(word.count === 1 ? 'ws.ep.countOne' : 'ws.ep.count', { n: word.count });
              return (
                <li
                  key={word.key}
                  role="listitem"
                  data-ep-row={word.label}
                  className="group/w flex items-center gap-2.5 min-h-[40px] pl-2.5 pr-1.5 rounded-xl hover:bg-zinc-900/[0.03] dark:hover:bg-white/[0.03] transition-colors"
                >
                  <span className="w-3 shrink-0 flex items-center justify-center"><StatusGlyph status={word.status} expr={word.expr} tint /></span>
                  <button
                    type="button"
                    data-ep-word
                    onClick={() => onSeek?.(word.firstCue)}
                    title={[jump, word.forms.join(', ')].filter(Boolean).join(' · ')}
                    className={`min-w-0 truncate text-left text-[13px] leading-[18px] font-medium text-zinc-800 dark:text-zinc-100 hover:text-indigo-600 dark:hover:text-indigo-300 rounded px-0.5 -mx-0.5 ${FOCUS}`}
                  >
                    {word.label}
                    <span className="sr-only">{` — ${jump}`}</span>
                  </button>
                  {/* Green = in Anki, in any status (same as the word card). */}
                  {study.inAnki(word.key) && (
                    <span className="shrink-0 inline-flex text-emerald-600 dark:text-emerald-400" title={t('ws.ep.inAnki')} data-in-anki>
                      <Check size={12} weight="bold" aria-hidden="true" />
                      <span className="sr-only">{t('ws.ep.inAnki')}</span>
                    </span>
                  )}
                  {word.level && <span className={META_BADGE} title={t('wp.cefrLevel', { level: word.level })}>{word.level}</span>}
                  <span className="ml-auto shrink-0 text-[12px] tabular-nums text-zinc-400 dark:text-zinc-400" title={occurrences}>
                    <span aria-hidden="true">×{word.count}</span>
                    <span className="sr-only">{occurrences}</span>
                  </span>
                  {/* Learning can also become known (the card stays in Anki). */}
                  <button
                    type="button"
                    onClick={() => mark(word, i, nextStatus(word.status))}
                    aria-label={`${t(word.status === 'known' ? 'ws.ep.markNew' : 'ws.ep.markKnown')}: ${word.label}`}
                    className={`${buttonCls('ghost', 'sm')} !px-2 ${ROW_ACTION}`}
                  >
                    {word.status === 'known' ? <StatusGlyph status="new" /> : <Check size={12} weight="bold" />}
                    {t(word.status === 'known' ? 'ws.ep.markNew' : 'ws.ep.markKnown')}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {hasMore && (
          <div className="px-3 pt-1">
            <button
              ref={moreRef}
              type="button"
              onClick={() => setShown((n) => n + PAGE_SIZE)}
              className={`w-full h-9 rounded-xl text-[12px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-900/[0.04] dark:hover:bg-white/[0.05] ${FOCUS}`}
            >
              {t('ws.ep.showMore', { n: Math.min(PAGE_SIZE, remaining) })}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Memoised and with no player props: a new cue does not re-render it. */
export const EpisodeWords = memo(EpisodeWordsView);