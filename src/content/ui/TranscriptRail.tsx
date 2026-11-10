/**
 * Transcript rail (F6 · docs/REDESIGN-V2.md §5.1, §7 F6).
 *
 * Two views of the same episode: «Lines» (the synced transcript) and «Words»
 * (the F5 `EpisodeWords` list). The rail lives in a column reserved on the
 * right of the player (D1); clicking a line seeks through the
 * PlaybackController — this component never touches the video.
 *
 * Follow rule, unchanged from the prototype: only a USER gesture turns the
 * follow off (wheel, touch, keys that scroll, dragging the scrollbar). The
 * app's own scrolls — active line changed, an explanation opened — do not.
 * The "follow" button brings it back.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlignLeft,
  BookText,
  Check,
  ChevronDown,
  ChevronUp,
  Moon,
  Pause,
  Repeat,
  RotateCcw,
  Search,
  Sparkles,
  Subtitles,
  Sun,
  X,
} from '../../ui/icons';
import { t } from '../../shared/i18n';
import { tokenizeSentence } from '../nlp/tokenize';
import { findRanges, foldForSearch, splitByRanges, type TextRange } from '../../shared/study/textSearch';
import { markContainerAttrs, markOf, markAttrs, MARK_INK, StatusGlyph } from './wordMarks';
import {
  FilterChips,
  IconTile,
  SegPill,
  onRadioKeyDown,
  radioTabIndex,
  segItem,
  segTrack,
  FOCUS,
  surface,
} from '../../ui/primitives/settings-primitives';
import { inputCls } from '../../ui/primitives/controls';
import { useLongPress } from '../../ui/hooks/useLongPress';
import { EpisodeWords, buildEpisodeVocabulary } from './EpisodeWords';
import { SentenceExplain } from './SentenceExplain';
import { PLAYBACK_SPEEDS } from '../platform-adapters/playback';
import { usePlaybackTimeMs } from './useStudyPlayback';
import type { AiPort } from '../../ui/ports/ai';
import type { MediaInfo, SubtitleCue } from '../platform-adapters/types';
import type { StudyBinding } from './study';

export type RailView = 'lines' | 'words';
export type LineFilter = 'all' | 'oneNew' | 'saved';

const VIEWS: { id: RailView; label: string; icon: typeof AlignLeft }[] = [
  { id: 'lines', label: 'rail.viewLines', icon: AlignLeft },
  { id: 'words', label: 'rail.viewWords', icon: BookText },
];

/** Keys that scroll the list by hand (they turn follow off). */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']);
const HIT =
  'rounded-[3px] bg-indigo-500/15 dark:bg-indigo-400/25 text-inherit ring-1 ring-inset ring-indigo-500/25 dark:ring-indigo-400/30';

export interface TranscriptRailProps {
  cues: readonly SubtitleCue[];
  activeIndex: number;
  lang: string;
  study: StudyBinding;
  newMarks: 'dotted' | 'none';
  /** Status keys that already have a card (the overlay's saved-token set). */
  savedWords: ReadonlySet<string>;
  media: MediaInfo | null;
  view: RailView;
  onViewChange(view: RailView): void;
  onSeek(cueIndex: number): void;
  onReplay(): void;
  onReplaySlow(): void;
  capturing?: boolean;
  autoPause: boolean;
  onToggleAutoPause(): void;
  loop: boolean;
  onToggleLoop(): void;
  speed: number;
  onSpeed(value: number): void;
  playing: boolean;
  pauseOnExplain: boolean;
  onStudyPause(): void;
  onStudyResume(): void;
  ai: AiPort | null;
  /**
   * A monotonically increasing tick: when it changes, open the explanation of
   * the active line (the overlay's ✦ action, docs/REDESIGN-V2.md §7 F7).
   */
  explainRequest?: number;
  uiLang: string;
  nativeLang: string;
  panelOpen: boolean;
  onTogglePanel(): void;
  isDarkMode: boolean;
  onToggleDarkMode(): void;
  onClose(): void;
}

export function TranscriptRail(props: TranscriptRailProps) {
  const {
    cues, activeIndex, lang, study, newMarks, savedWords, media, view, onViewChange,
    onSeek, onReplay, onReplaySlow, capturing = false, autoPause, onToggleAutoPause,
    loop, onToggleLoop, speed, onSpeed, playing, pauseOnExplain, onStudyPause,
    onStudyResume, ai, explainRequest = 0, uiLang, nativeLang, panelOpen, onTogglePanel,
    isDarkMode, onToggleDarkMode, onClose,
  } = props;

  const [explainLine, setExplainLine] = useState<number | null>(null);
  const [explainPaused, setExplainPaused] = useState(false);

  // Reading an explanation wants the video still: pause on open and resume on
  // close, but ONLY if the pause was ours (the same contract as word lookup).
  // Never while a capture is running: it would cut the line's recording.
  useEffect(() => {
    if (explainLine !== null && playing && pauseOnExplain && !capturing) {
      onStudyPause();
      setExplainPaused(true);
    } else if (explainLine === null && explainPaused) {
      onStudyResume();
      setExplainPaused(false);
    }
    // Deliberately keyed on the open line only; `playing` changes below reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explainLine]);
  // Resumed from outside (play, shortcut, a line click): the pause is not ours any more.
  useEffect(() => {
    if (playing) setExplainPaused(false);
  }, [playing]);

  // The overlay's ✦ asks for the active line's explanation: the same open
  // action as pressing that row's sparkle, so pausing and the toggle match.
  // Keyed on the tick on purpose — every new press must reopen, even if the
  // same line was already open.
  useEffect(() => {
    if (explainRequest <= 0 || ai === null) return;
    if (activeIndex < 0 || activeIndex >= cues.length) return;
    setExplainLine(activeIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explainRequest]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hitIdx, setHitIdx] = useState(-1);
  const hitRef = useRef(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchBtnRef = useRef<HTMLButtonElement>(null);
  const foldedQuery = foldForSearch(query.trim());
  const searching = searchOpen && foldedQuery.length > 0;

  // Follow: off only on a user gesture.
  const [follow, setFollow] = useState(true);
  const stopFollow = () => {
    if (follow) setFollow(false);
  };
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const tabRefs = useRef<Partial<Record<RailView, HTMLButtonElement | null>>>({});
  const viewIndex = Math.max(0, VIEWS.findIndex((candidate) => candidate.id === view));
  const [lineFilter, setLineFilter] = useState<LineFilter>('all');

  const lineTokens = useMemo(
    () => cues.map((cue) => tokenizeSentence(cue.text, new Set(), lang)),
    [cues, lang],
  );
  const tokenStarts = useMemo(
    () =>
      lineTokens.map((tokens) => {
        let at = 0;
        return tokens.map((token) => {
          const start = at;
          at += token.text.length;
          return start;
        });
      }),
    [lineTokens],
  );

  /** Lines whose text contains a word that already has a card. */
  const savedLines = useMemo(() => {
    const set = new Set<number>();
    lineTokens.forEach((tokens, index) => {
      if (
        tokens.some(
          (token) =>
            token.kind !== 'punct' &&
            (savedWords.has(token.key) || savedWords.has(token.lemma ?? token.key)),
        )
      ) {
        set.add(index);
      }
    });
    return set;
  }, [lineTokens, savedWords]);

  /** Lines with exactly ONE distinct new word (the i+1 mining criterion). */
  const oneNewLines = useMemo(() => {
    const set = new Set<number>();
    lineTokens.forEach((tokens, index) => {
      const seen = new Set<string>();
      for (const token of tokens) {
        if (token.kind === 'punct' || token.kind === 'ignored' || token.kind === 'proper-noun-known') continue;
        const mark = markOf(token, study.statusOf);
        if (mark.status !== 'new') continue;
        seen.add((token.lemma ?? token.key).toLowerCase());
        if (seen.size > 1) break;
      }
      if (seen.size === 1) set.add(index);
    });
    return set;
  }, [lineTokens, study.statusOf]);

  const searchHits = useMemo(
    () =>
      searching
        ? lineTokens.map((tokens) => findRanges(tokens.map((token) => token.text).join(''), foldedQuery))
        : null,
    [searching, foldedQuery, lineTokens],
  );
  const matchLines = useMemo(
    () =>
      searchHits
        ? cues.map((_, index) => index).filter((index) => searchHits[index].length > 0)
        : [],
    [searchHits, cues],
  );
  const shown = useMemo(() => {
    if (searchHits) return matchLines;
    return cues
      .map((_, index) => index)
      .filter((index) =>
        searchOpen || lineFilter === 'all'
          ? true
          : lineFilter === 'oneNew'
            ? oneNewLines.has(index)
            : savedLines.has(index),
      );
    // `isSavedLine` derives from savedLines, which is in the deps.
  }, [cues, searchHits, matchLines, searchOpen, lineFilter, oneNewLines, savedLines]);

  useEffect(() => {
    hitRef.current = -1;
    setHitIdx(-1);
  }, [foldedQuery]);

  const scrollToLine = (index: number) => {
    const element = itemRefs.current[index];
    const list = listRef.current;
    if (!element || !list) return;
    list.scrollTo({
      top: element.offsetTop - list.clientHeight / 2 + element.clientHeight / 2,
      behavior: 'smooth',
    });
  };

  useEffect(() => {
    // Searching, the list does not move on its own: the chosen hit stays put.
    if (!follow || view !== 'lines' || searching) return;
    if (activeIndex < 0) return;
    const element = itemRefs.current[activeIndex];
    const list = listRef.current;
    if (!element || !list) return;
    list.scrollTo({
      top: element.offsetTop - list.clientHeight / 2 + element.clientHeight / 2,
      behavior: 'smooth',
    });
  }, [activeIndex, follow, view, searching]);

  const goToHit = (direction: 1 | -1) => {
    if (matchLines.length === 0) return;
    const current = hitRef.current;
    const next =
      current < 0
        ? direction > 0
          ? 0
          : matchLines.length - 1
        : (current + direction + matchLines.length) % matchLines.length;
    hitRef.current = next;
    setHitIdx(next);
    onSeek(matchLines[next]);
    scrollToLine(matchLines[next]);
  };

  const openSearch = () => {
    setSearchOpen(true);
    requestAnimationFrame(() => searchRef.current?.focus());
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
    setFollow(true);
    requestAnimationFrame(() => searchBtnRef.current?.focus());
  };

  const closeExplain = (index: number) => {
    setExplainLine(null);
    requestAnimationFrame(() =>
      itemRefs.current[index]?.querySelector<HTMLButtonElement>('button[aria-expanded]')?.focus(),
    );
  };

  const revealExplain = (index: number) => {
    const row = itemRefs.current[index];
    const list = listRef.current;
    if (!row || !list) return;
    const top = row.offsetTop - 8;
    const bottom = row.offsetTop + row.offsetHeight + 12;
    const visible = list.scrollTop;
    const target =
      bottom > visible + list.clientHeight
        ? Math.min(top, bottom - list.clientHeight)
        : top < visible
          ? top
          : visible;
    if (Math.abs(target - visible) >= 2) list.scrollTo({ top: target, behavior: 'smooth' });
  };

  const lineCounts: Record<LineFilter, number> = {
    all: cues.length,
    oneNew: oneNewLines.size,
    saved: savedLines.size,
  };
  const words = useMemo(() => (view === 'words' ? buildEpisodeVocabulary(cues, lang) : []), [view, cues, lang]);

  return (
    <aside
      aria-label={t('rail.title')}
      className={`w-full shrink-0 h-full flex flex-col ${surface.panel} border-l border-zinc-900/[0.06] dark:border-white/[0.06] text-zinc-700 dark:text-zinc-200 kvl-ui`}
    >
      <div className="h-16 shrink-0 flex items-center gap-3 pl-4 pr-3">
        <IconTile className="!w-8 !h-8">
          <Subtitles size={16} />
        </IconTile>
        <div className="min-w-0">
          <div className="text-[15px] leading-5 font-semibold tracking-[-0.01em] text-zinc-900 dark:text-white truncate">
            {t('rail.title')}
          </div>
          <div className="text-[12px] leading-tight tabular-nums text-zinc-500 truncate">
            {view === 'lines'
              ? t('rail.lineOf', { n: Math.max(0, activeIndex + 1), total: cues.length })
              : t('rail.wordsTotal', { n: words.length })}
            {media?.series ? ` · ${media.series}` : ''}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton
            title={panelOpen ? t('panel.closeTitle') : t('rail.toPanel')}
            active={panelOpen}
            onClick={onTogglePanel}
          >
            <Subtitles size={16} />
          </IconButton>
          <IconButton
            title={isDarkMode ? t('panel.lightMode') : t('panel.darkMode')}
            onClick={onToggleDarkMode}
          >
            {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
          </IconButton>
          <IconButton title={t('rail.close')} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
      </div>

      <div
        role="tablist"
        aria-label={t('rail.viewsAria')}
        className="px-4 pb-3 shrink-0 border-b border-zinc-900/[0.06] dark:border-white/[0.06]"
      >
        <div className={`relative ${segTrack}`}>
          <SegPill index={viewIndex} count={VIEWS.length} />
          {VIEWS.map((candidate) => {
            const selected = view === candidate.id;
            return (
              <button
                key={candidate.id}
                ref={(element) => {
                  tabRefs.current[candidate.id] = element;
                }}
                role="tab"
                type="button"
                id={`kivara-rail-tab-${candidate.id}`}
                aria-selected={selected}
                aria-controls={selected ? `kivara-rail-body-${candidate.id}` : undefined}
                tabIndex={selected ? 0 : -1}
                onClick={() => onViewChange(candidate.id)}
                onKeyDown={(event) => {
                  const direction =
                    event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                  if (direction === 0) return;
                  event.preventDefault();
                  const next = VIEWS[(viewIndex + direction + VIEWS.length) % VIEWS.length].id;
                  onViewChange(next);
                  requestAnimationFrame(() => tabRefs.current[next]?.focus());
                }}
                className={`${segItem(selected)} flex-1 h-7 rounded-md text-[12px]`}
              >
                <candidate.icon size={14} aria-hidden="true" className="shrink-0" />
                <span className="truncate">{t(candidate.label)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {view === 'words' ? (
        <div
          id="kivara-rail-body-words"
          role="tabpanel"
          aria-labelledby="kivara-rail-tab-words"
          className="flex-1 min-h-0 flex flex-col"
        >
          <EpisodeWords words={words} study={study} onSeek={onSeek} />
        </div>
      ) : (
        <div
          id="kivara-rail-body-lines"
          role="tabpanel"
          aria-labelledby="kivara-rail-tab-lines"
          className={`${MARK_INK} flex-1 min-h-0 flex flex-col`}
        >
          <div className="shrink-0 px-4 pt-3 pb-3 space-y-2.5 border-b border-zinc-900/[0.06] dark:border-white/[0.06]">
            {searchOpen ? (
              <div className="relative">
                <Search
                  size={14}
                  aria-hidden="true"
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500 pointer-events-none"
                />
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.stopPropagation();
                      closeSearch();
                    } else if (event.key === 'Enter') {
                      event.preventDefault();
                      goToHit(event.shiftKey ? -1 : 1);
                    }
                  }}
                  placeholder={t('rail.search')}
                  aria-label={t('rail.search')}
                  spellCheck={false}
                  autoComplete="off"
                  className={`${inputCls} w-full !pl-8 ${searching ? '!pr-[8.5rem]' : '!pr-9'}`}
                />
                <span className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                  {searching && (
                    <span
                      className="text-[11px] font-medium tabular-nums text-zinc-400 dark:text-zinc-500 mr-1"
                      aria-live="polite"
                    >
                      {hitIdx >= 0
                        ? t('rail.searchCount', { i: hitIdx + 1, n: matchLines.length })
                        : matchLines.length === 1
                          ? t('rail.searchTotalOne')
                          : t('rail.searchTotal', { n: matchLines.length })}
                    </span>
                  )}
                  {searching && matchLines.length > 0 && (
                    <>
                      <MiniButton title={t('rail.searchPrev')} onClick={() => goToHit(-1)}>
                        <ChevronUp size={12} weight="bold" />
                      </MiniButton>
                      <MiniButton title={t('rail.searchNext')} onClick={() => goToHit(1)}>
                        <ChevronDown size={12} weight="bold" />
                      </MiniButton>
                    </>
                  )}
                  <MiniButton title={t('rail.searchClose')} onClick={closeSearch}>
                    <X size={12} weight="bold" />
                  </MiniButton>
                </span>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <FilterChips
                  className="flex-1 min-w-0"
                  ariaLabel={t('rail.filterAria')}
                  value={lineFilter}
                  onChange={setLineFilter}
                  options={[
                    { v: 'all', l: t('rail.filterAll'), count: lineCounts.all },
                    {
                      v: 'oneNew',
                      l: t('rail.filterOneNew'),
                      count: lineCounts.oneNew,
                      title: t('rail.oneNewTitle'),
                      icon: <StatusGlyph status="new" />,
                    },
                    {
                      v: 'saved',
                      l: t('rail.filterSaved'),
                      count: lineCounts.saved,
                      icon: <Check size={12} weight="bold" className="text-emerald-600 dark:text-emerald-400" />,
                    },
                  ]}
                />
                <IconButton btnRef={searchBtnRef} title={t('rail.search')} onClick={openSearch}>
                  <Search size={15} />
                </IconButton>
              </div>
            )}
            {!searchOpen && lineFilter === 'oneNew' && (
              <p className="text-[12px] leading-4 text-zinc-500 dark:text-zinc-400">
                {t('rail.oneNewCaption')}
              </p>
            )}
          </div>

          <div
            ref={listRef}
            onWheel={stopFollow}
            onTouchMove={stopFollow}
            onKeyDown={(event) => {
              if (!event.defaultPrevented && SCROLL_KEYS.has(event.key)) stopFollow();
            }}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) stopFollow();
            }}
            className="relative flex-1 min-h-0 overflow-y-auto kvl-scroll py-3 bg-zinc-50/80 dark:bg-transparent"
          >
            {shown.length === 0 && (searchHits || lineFilter !== 'all') && (
              <p className="px-6 py-10 text-center text-[12px] leading-[18px] text-zinc-500 dark:text-zinc-400">
                {searchHits
                  ? t('rail.searchEmpty', { q: query.trim() })
                  : t(lineFilter === 'saved' ? 'rail.emptySaved' : 'rail.emptyOneNew')}
              </p>
            )}
            {shown.map((index) => {
              const cue = cues[index];
              const isActive = index === activeIndex;
              const past = index < activeIndex;
              const saved = savedLines.has(index);
              const hits = searchHits?.[index];
              const jump = t('rail.jumpTitle', { time: fmtTime(cue.start) });
              const explaining = explainLine === index && ai !== null;
              return (
                <div
                  key={cue.id}
                  ref={(element) => {
                    itemRefs.current[index] = element;
                  }}
                  className="group/cue relative mx-3"
                >
                  <div
                    role="button"
                    tabIndex={0}
                    aria-current={isActive ? 'true' : undefined}
                    title={jump}
                    onClick={() => {
                      onSeek(index);
                      setFollow(true);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      onSeek(index);
                      setFollow(true);
                    }}
                    className={`relative pl-3.5 pr-3 py-2.5 rounded-xl cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 transition-[background-color,box-shadow] duration-[220ms] ${
                      isActive
                        ? 'bg-white dark:bg-white/[0.04] ring-1 ring-zinc-900/[0.06] dark:ring-white/[0.06]'
                        : 'hover:bg-zinc-900/[0.03] dark:hover:bg-white/[0.03]'
                    }`}
                  >
                    {isActive && <CueProgress start={cue.start} end={cue.end} />}
                    <div className="flex items-baseline gap-3">
                      <span
                        className={`w-9 text-[12px] tabular-nums shrink-0 ${
                          isActive
                            ? 'text-indigo-500 dark:text-indigo-400 font-medium'
                            : 'text-zinc-400 dark:text-zinc-500'
                        }`}
                      >
                        {fmtTime(cue.start)}
                      </span>
                      <p
                        {...markContainerAttrs(newMarks)}
                        className={`min-w-0 flex-1 text-[13px] leading-relaxed whitespace-pre-line transition-colors duration-200 ${
                          isActive
                            ? 'text-zinc-900 dark:text-white'
                            : past
                              ? 'text-zinc-400 dark:text-zinc-500'
                              : 'text-zinc-700 dark:text-zinc-300'
                        }`}
                      >
                        {lineTokens[index].map((token, tokenIndex) => {
                          const text = hits
                            ? highlight(token.text, tokenStarts[index][tokenIndex], hits)
                            : token.text;
                          if (token.kind === 'punct') return <span key={tokenIndex}>{text}</span>;
                          const mark = markOf(token, study.statusOf);
                          return mark.status ? (
                            <span key={tokenIndex} className="kvl-tok" {...markAttrs(mark)}>
                              {text}
                            </span>
                          ) : (
                            <span key={tokenIndex}>{text}</span>
                          );
                        })}
                      </p>
                    </div>
                  </div>

                  {(isActive || ai) && (
                    <div className="absolute right-2 -top-2 z-10 flex items-center gap-0.5 rounded-full bg-white dark:bg-zinc-800 ring-1 ring-zinc-900/[0.08] dark:ring-white/[0.08] p-0.5 opacity-0 pointer-events-none group-hover/cue:opacity-100 group-hover/cue:pointer-events-auto group-focus-within/cue:opacity-100 group-focus-within/cue:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto">
                      {isActive && <ReplayButton onReplay={onReplay} onReplaySlow={onReplaySlow} />}
                      {ai && (
                        <MiniButton
                          title={explaining ? t('explain.close') : t('explain.action')}
                          expanded={explaining}
                          controls={explaining ? `kivara-explain-${index}` : undefined}
                          onClick={(event) => {
                            event.stopPropagation();
                            setExplainLine(explaining ? null : index);
                          }}
                        >
                          <Sparkles size={11} />
                        </MiniButton>
                      )}
                      {saved && (
                        <span
                          title={t('rail.saved')}
                          aria-label={t('rail.saved')}
                          className="w-6 h-6 flex items-center justify-center text-emerald-500 dark:text-emerald-400"
                        >
                          <Check size={11} weight="bold" />
                        </span>
                      )}
                    </div>
                  )}

                  {explaining && ai && (
                    <SentenceExplain
                      id={`kivara-explain-${index}`}
                      cue={cue}
                      prev={cues[index - 1]?.text}
                      next={cues[index + 1]?.text}
                      lang={lang}
                      uiLang={uiLang}
                      nativeLang={nativeLang}
                      ai={ai}
                      onClose={() => closeExplain(index)}
                      onReady={() => revealExplain(index)}
                    />
                  )}
                </div>
              );
            })}
            {!follow && !searchHits && (
              <button
                type="button"
                onClick={() => setFollow(true)}
                className="sticky bottom-2 left-1/2 -translate-x-1/2 mt-2 flex items-center gap-1 rounded-full bg-zinc-900 dark:bg-white hover:bg-zinc-800 dark:hover:bg-zinc-100 text-white dark:text-zinc-900 text-[12px] font-medium px-3 h-7 shadow-lg kvl-press"
              >
                <ChevronDown size={12} weight="bold" /> {t('rail.follow')}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="shrink-0 border-t border-zinc-900/[0.06] dark:border-white/[0.06] px-3 py-3 flex items-center justify-between gap-1.5">
        <div className={`${segTrack} min-w-0`}>
          <button
            type="button"
            aria-pressed={autoPause}
            title={t('rail.autoPauseHint')}
            onClick={onToggleAutoPause}
            className={`${segItem(autoPause)} h-7 text-[12px] whitespace-nowrap`}
          >
            <Pause size={12} fill="currentColor" /> {t('rail.autoPauseShort')}
          </button>
          <button
            type="button"
            aria-pressed={loop}
            title={t('rail.loopHint')}
            onClick={onToggleLoop}
            className={`${segItem(loop)} h-7 text-[12px] whitespace-nowrap`}
          >
            <Repeat size={12} weight="bold" /> {t('rail.loop')}
          </button>
        </div>
        <div
          className={`relative shrink-0 ${segTrack}`}
          role="radiogroup"
          aria-label={t('rail.speed')}
          onKeyDown={(event) => onRadioKeyDown(event, PLAYBACK_SPEEDS, speed, onSpeed)}
        >
          <SegPill index={Math.max(0, PLAYBACK_SPEEDS.indexOf(speed))} count={PLAYBACK_SPEEDS.length} />
          {PLAYBACK_SPEEDS.map((value, index) => (
            <button
              key={value}
              role="radio"
              aria-checked={speed === value}
              tabIndex={radioTabIndex(speed === value, index, PLAYBACK_SPEEDS.includes(speed))}
              onClick={() => onSpeed(value)}
              className={`${segItem(speed === value)} h-7 w-12 !flex-none text-[12px] tabular-nums !px-0`}
            >
              {value}×
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

/** Progress inside the active cue: the only piece of the rail that follows the clock. */
function CueProgress({ start, end }: { start: number; end: number }) {
  const time = usePlaybackTimeMs();
  const progress = Math.round(
    Math.min(1, Math.max(0, (time - start) / Math.max(1, end - start))) * 100,
  );
  return (
    <span className="absolute left-1 top-3 bottom-3 w-0.5 rounded-full bg-indigo-500/25 overflow-hidden">
      <span
        className="absolute inset-x-0 top-0 bg-indigo-500 dark:bg-indigo-400 transition-[height] duration-100 ease-linear"
        style={{ height: `${progress}%` }}
      />
    </span>
  );
}

function highlight(text: string, start: number, ranges: TextRange[]) {
  if (ranges.length === 0) return text;
  return splitByRanges(text, start, ranges).map((part, index) =>
    part.hit ? (
      <mark key={index} className={HIT}>
        {part.text}
      </mark>
    ) : (
      <span key={index}>{part.text}</span>
    ),
  );
}

function fmtTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

function IconButton({
  children, title, onClick, active, btnRef,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
  btnRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={btnRef}
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`w-7 h-7 rounded-lg flex items-center justify-center kvl-press ${FOCUS} ${
        active
          ? 'text-indigo-500 dark:text-indigo-400 bg-indigo-500/10'
          : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-900/[0.05] dark:hover:bg-white/[0.07]'
      }`}
    >
      {children}
    </button>
  );
}

function MiniButton({
  children, title, onClick, active, expanded, controls,
}: {
  children: React.ReactNode;
  title: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  expanded?: boolean;
  controls?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title.split('\n')[0]}
      onClick={onClick}
      aria-expanded={expanded}
      aria-controls={controls}
      className={`w-6 h-6 rounded-full flex items-center justify-center kvl-press ${FOCUS} ${
        active || expanded
          ? 'text-indigo-600 dark:text-indigo-300 bg-indigo-500/10'
          : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-900/[0.06] dark:hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  );
}

/** ⟲ of the active line: tap repeats the line; hold repeats it slower. */
function ReplayButton({ onReplay, onReplaySlow }: { onReplay: () => void; onReplaySlow: () => void }) {
  const press = useLongPress(
    (event) => {
      event.stopPropagation();
      onReplay();
    },
    onReplaySlow,
  );
  return (
    <button
      type="button"
      title={`${t('shortcut.replay')}\n${t('player.holdSlower')}`}
      aria-label={t('shortcut.replay')}
      {...press}
      className="w-6 h-6 rounded-full flex items-center justify-center kvl-press text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-900/[0.06] dark:hover:bg-white/10"
    >
      <RotateCcw size={11} />
    </button>
  );
}