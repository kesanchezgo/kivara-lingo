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
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignLeft,
  BookText,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Moon,
  Pause,
  Plus,
  Repeat,
  RotateCcw,
  Search,
  Sparkles,
  Subtitles,
  Sun,
  X,
} from '../../ui/icons';
import { t } from '../../shared/i18n';
import { useKivaraStore } from '../../shared/use-kivara-store';
import { NEXT_TRANSLATION, type TranslationMode } from '../../shared/study/studyModes';
import { comboOf, withCombo } from './combo-hints';
import { tokenizeSentence, type Token } from '../nlp/tokenize';
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
import { NoSubtitlesNotice } from './no-cues-notice';
import { LanguageMismatchNotice } from './language-mismatch';
import { SentenceExplain } from './SentenceExplain';
import { PLAYBACK_SPEEDS } from '../platform-adapters/playback';
import { usePlaybackTimeMs } from './useStudyPlayback';
import type { AiPort } from '../../ui/ports/ai';
import type { MediaInfo, SubtitleCue } from '../platform-adapters/types';
import type { StudyBinding } from './study';

export type RailView = 'lines' | 'words';
export type LineFilter = 'all' | 'oneNew' | 'saved';

/** A line of the platform's own translated track, aligned by time. */
export interface NativeLineCue {
  start: number;
  end: number;
  text: string;
}

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
  /** Point 2: after ~5 s of playback with zero cues, explain the empty state. */
  noCuesNotice?: boolean;
  noticePlatform?: string;
  /** Point 4: the track's language differs from the learned one. */
  languageMismatch?: { track: string; learning: string } | null;
  activeIndex: number;
  lang: string;
  study: StudyBinding;
  newMarks: 'dotted' | 'none';
  /** Status keys that already have a card (the overlay's saved-token set). */
  savedWords: ReadonlySet<string>;
  /**
   * The platform's FULL native track, when it exists. The translated line under
   * each sentence comes from here; with no track nothing is rendered and the
   * search ignores the second line.
   */
  nativeCues?: readonly NativeLineCue[] | null;
  /** The shared study preference (video and transcript use ONE value). */
  translation: TranslationMode;
  onTranslationChange(mode: TranslationMode): void;
  /** Listen-first: blurs the current and upcoming lines while the video plays. */
  listenFirst: boolean;
  /** Save the single new word of a line through the overlay's capture flow. */
  onSaveWord?(word: string, sentence: string): void;
  /** Panel is docked: move focus to its first control instead of closing it. */
  onFocusPanel?(): void;
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
    cues, noCuesNotice = false, noticePlatform, languageMismatch = null, activeIndex, lang, study, newMarks, savedWords, media, view, onViewChange,
    onSeek, onReplay, onReplaySlow, capturing = false, autoPause, onToggleAutoPause,
    loop, onToggleLoop, speed, onSpeed, playing, pauseOnExplain, onStudyPause,
    onStudyResume, ai, explainRequest = 0, uiLang, nativeLang, panelOpen, onTogglePanel,
    isDarkMode, onToggleDarkMode, onClose,
    nativeCues = null, translation, onTranslationChange, listenFirst,
    onSaveWord, onFocusPanel,
  } = props;
  const shortcuts = useKivaraStore((state) => state.shortcuts);
  const combo = (id: string) => comboOf(shortcuts, id);

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

  /**
   * Lines with exactly ONE distinct new word (the i+1 mining criterion), plus
   * that word's surface form — the save button sends the same token the line
   * shows, through the overlay's capture flow.
   */
  const { oneNewLines, oneNewWord } = useMemo(() => {
    const set = new Set<number>();
    const words = new Map<number, string>();
    lineTokens.forEach((tokens, index) => {
      const seen = new Set<string>();
      let word: string | undefined;
      for (const token of tokens) {
        if (token.kind === 'punct' || token.kind === 'ignored' || token.kind === 'proper-noun-known') continue;
        const mark = markOf(token, study.statusOf);
        if (mark.status !== 'new') continue;
        seen.add((token.lemma ?? token.key).toLowerCase());
        if (word === undefined) word = token.text;
        if (seen.size > 1) break;
      }
      if (seen.size === 1 && word !== undefined) {
        set.add(index);
        words.set(index, word);
      }
    });
    return { oneNewLines: set, oneNewWord: words };
  }, [lineTokens, study.statusOf]);

  /** The translated line under each sentence, aligned by time. */
  const nativeLines = useMemo(
    () => alignNativeLines(cues, nativeCues ?? []),
    [cues, nativeCues],
  );

  const searchHits = useMemo(
    () =>
      searching
        ? lineTokens.map((tokens) => findRanges(tokens.map((token) => token.text).join(''), foldedQuery))
        : null,
    [searching, foldedQuery, lineTokens],
  );
  // The search covers the translated line too: a word that only appears in
  // the native track still finds its sentence.
  const nativeHits = useMemo(
    () =>
      searching && translation !== 'hidden'
        ? nativeLines.map((line) => (line ? findRanges(line, foldedQuery) : []))
        : null,
    [searching, foldedQuery, nativeLines, translation],
  );
  const matchLines = useMemo(
    () =>
      searchHits
        ? cues
          .map((_, index) => index)
          .filter(
            (index) =>
              searchHits[index].length > 0 || (nativeHits?.[index]?.length ?? 0) > 0,
          )
        : [],
    [searchHits, nativeHits, cues],
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

  // Stable identities: every one of these is a prop of the memoised cue row,
  // and a fresh closure here would defeat `memo` for all 900 lines at once.
  const registerRow = useCallback((index: number, element: HTMLDivElement | null) => {
    itemRefs.current[index] = element;
  }, []);
  const selectRow = useCallback(
    (index: number) => {
      onSeek(index);
      setFollow(true);
    },
    [onSeek],
  );
  const toggleExplain = useCallback((index: number) => {
    setExplainLine((current) => (current === index ? null : index));
  }, []);

  const closeExplain = useCallback((index: number) => {
    setExplainLine(null);
    requestAnimationFrame(() =>
      itemRefs.current[index]?.querySelector<HTMLButtonElement>('button[aria-expanded]')?.focus(),
    );
  }, []);

  const revealExplain = useCallback((index: number) => {
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
  }, []);

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
            title={
              translation === 'visible'
                ? t('rail.blur')
                : translation === 'blur'
                  ? t('rail.unblur')
                  : t('rail.showNative')
            }
            active={translation !== 'visible'}
            onClick={() => onTranslationChange(NEXT_TRANSLATION[translation])}
          >
            {translation === 'hidden' ? <EyeOff size={16} /> : <Eye size={16} />}
          </IconButton>
          <IconButton
            title={
              panelOpen
                ? withCombo(t('panel.closeTitle'), combo('panel'))
                : withCombo(t('rail.toPanel'), combo('panel'))
            }
            active={panelOpen}
            onClick={panelOpen && onFocusPanel ? onFocusPanel : onTogglePanel}
          >
            <Subtitles size={16} />
          </IconButton>
          <IconButton
            title={isDarkMode ? t('panel.lightMode') : t('panel.darkMode')}
            onClick={onToggleDarkMode}
          >
            {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
          </IconButton>
          <IconButton title={withCombo(t('rail.close'), combo('rail'))} onClick={onClose}>
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

      {noCuesNotice && cues.length === 0 && (
        <div className="shrink-0 px-3 pt-3">
          <NoSubtitlesNotice platform={noticePlatform} />
        </div>
      )}

      {languageMismatch && (
        <div className="shrink-0 px-3 pt-3">
          <LanguageMismatchNotice
            track={languageMismatch.track}
            learning={languageMismatch.learning}
            platform={noticePlatform}
          />
        </div>
      )}

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
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-400 pointer-events-none"
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
                      className="text-[11px] font-medium tabular-nums text-zinc-400 dark:text-zinc-400 mr-1"
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
            {shown.map((index) => (
              <CueRow
                key={cues[index].id}
                cue={cues[index]}
                index={index}
                tokens={lineTokens[index]}
                starts={tokenStarts[index]}
                hits={searchHits?.[index]}
                active={index === activeIndex}
                past={index < activeIndex}
                saved={savedLines.has(index)}
                explaining={explainLine === index && ai !== null}
                newMarks={newMarks}
                statusOf={study.statusOf}
                prevText={cues[index - 1]?.text}
                nextText={cues[index + 1]?.text}
                lang={lang}
                uiLang={uiLang}
                nativeLang={nativeLang}
                ai={ai}
                registerRow={registerRow}
                onSelect={selectRow}
                onToggleExplain={toggleExplain}
                onCloseExplain={closeExplain}
                onRevealExplain={revealExplain}
                onReplay={onReplay}
                onReplaySlow={onReplaySlow}
                nativeText={nativeLines[index]}
                nativeHits={nativeHits?.[index]}
                nativeHidden={translation === 'hidden'}
                nativeBlurred={
                  translation === 'blur'
                  || (listenFirst && playing && index >= activeIndex)
                }
                saveWord={oneNewWord.get(index)}
                onSaveWord={onSaveWord}
                replayCombo={combo('replay')}
                replaySlowCombo={combo('replaySlow')}
              />
            ))}
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
            title={withCombo(t('rail.autoPauseHint'), combo('autoPause'))}
            onClick={onToggleAutoPause}
            className={`${segItem(autoPause)} h-7 text-[12px] whitespace-nowrap`}
          >
            <Pause size={12} fill="currentColor" /> {t('rail.autoPauseShort')}
          </button>
          <button
            type="button"
            aria-pressed={loop}
            title={withCombo(t('rail.loopHint'), combo('loop'))}
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
          title={withCombo(t('rail.speed'), `${combo('slower') ?? ''} / ${combo('faster') ?? ''}`)}
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

interface CueRowProps {
  cue: SubtitleCue;
  index: number;
  tokens: readonly Token[];
  starts: readonly number[];
  hits: TextRange[] | undefined;
  active: boolean;
  past: boolean;
  saved: boolean;
  explaining: boolean;
  newMarks: 'dotted' | 'none';
  statusOf: StudyBinding['statusOf'];
  prevText: string | undefined;
  nextText: string | undefined;
  lang: string;
  uiLang: string;
  nativeLang: string;
  ai: AiPort | null;
  registerRow(index: number, element: HTMLDivElement | null): void;
  onSelect(index: number): void;
  onToggleExplain(index: number): void;
  onCloseExplain(index: number): void;
  onRevealExplain(index: number): void;
  onReplay(): void;
  onReplaySlow(): void;
  /** The aligned native line, when the platform ships one. */
  nativeText: string | null | undefined;
  nativeHits: TextRange[] | undefined;
  nativeHidden: boolean;
  nativeBlurred: boolean;
  /** The only new word of this line, when there is exactly one. */
  saveWord: string | undefined;
  onSaveWord?(word: string, sentence: string): void;
  /** The user's replay combo, resolved once by the parent (rows stay memoised). */
  replayCombo: string | undefined;
  /** Same, for the slow replay the hold triggers. */
  replaySlowCombo: string | undefined;
}

/**
 * One transcript line.
 *
 * Memoised on purpose: an episode runs to ~900 cues, and the rail re-renders
 * for reasons that do not touch a given row (search open, filter chip, the
 * active line moving). Every prop is primitive or a stable parent identity —
 * callbacks come from `useCallback`, token arrays from `useMemo` — so an
 * unrelated rail update skips all rows instead of reconciling 900 of them.
 *
 * `content-visibility: auto` is the second layer: offscreen rows keep their
 * DOM node (scroll maths, refs and search jumps stay exact) but the browser
 * skips their layout and paint. `contain-intrinsic-size` keeps the scrollbar
 * stable while they are skipped.
 */
const CueRow = memo(function CueRow({
  cue, index, tokens, starts, hits, active, past, saved, explaining, newMarks,
  statusOf, prevText, nextText, lang, uiLang, nativeLang, ai, registerRow,
  onSelect, onToggleExplain, onCloseExplain, onRevealExplain, onReplay, onReplaySlow,
  nativeText, nativeHits, nativeHidden, nativeBlurred, saveWord, onSaveWord,
  replayCombo, replaySlowCombo,
}: CueRowProps) {
  const jump = t('rail.jumpTitle', { time: fmtTime(cue.start) });
  return (
    <div
      ref={(element) => registerRow(index, element)}
      data-kvl-cue={index}
      className="group/cue relative mx-3 [content-visibility:auto] [contain-intrinsic-size:auto_56px]"
    >
      <div
        role="button"
        tabIndex={0}
        aria-current={active ? 'true' : undefined}
        title={jump}
        onClick={() => onSelect(index)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onSelect(index);
        }}
        className={`relative pl-3.5 pr-3 py-2.5 rounded-xl cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 transition-[background-color,box-shadow] duration-[220ms] ${
          active
            ? 'bg-white dark:bg-white/[0.04] ring-1 ring-zinc-900/[0.06] dark:ring-white/[0.06]'
            : 'hover:bg-zinc-900/[0.03] dark:hover:bg-white/[0.03]'
        }`}
      >
        {active && <CueProgress start={cue.start} end={cue.end} />}
        <div className="flex items-baseline gap-3">
          <span
            className={`w-9 text-[12px] tabular-nums shrink-0 ${
              active
                ? 'text-indigo-500 dark:text-indigo-400 font-medium'
                : 'text-zinc-400 dark:text-zinc-400'
            }`}
          >
            {fmtTime(cue.start)}
          </span>
          <p
            {...markContainerAttrs(newMarks)}
            className={`min-w-0 flex-1 text-[13px] leading-relaxed whitespace-pre-line transition-colors duration-200 ${
              active
                ? 'text-zinc-900 dark:text-white'
                : past
                  ? 'text-zinc-400 dark:text-zinc-400'
                  : 'text-zinc-700 dark:text-zinc-300'
            }`}
          >
            {tokens.map((token, tokenIndex) => {
              const text = hits
                ? highlight(token.text, starts[tokenIndex], hits)
                : token.text;
              if (token.kind === 'punct') return <span key={tokenIndex}>{text}</span>;
              const mark = markOf(token, statusOf);
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

      {nativeText && !nativeHidden && (
        <p
          data-kvl-native={index}
          tabIndex={nativeBlurred ? 0 : undefined}
          className={`mt-1 pl-[3.25rem] pr-3 text-[12px] leading-snug text-zinc-500 dark:text-zinc-400 whitespace-pre-line rounded outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 transition-[filter] duration-200 ${
            nativeBlurred
              ? 'blur-[3px] select-none group-hover/cue:blur-none group-focus-within/cue:blur-none'
              : ''
          }`}
        >
          {nativeHits ? highlight(nativeText, 0, nativeHits) : nativeText}
        </p>
      )}

      {(active || ai || saveWord) && (
        <div className="absolute right-2 -top-2 z-10 flex items-center gap-0.5 rounded-full bg-white dark:bg-zinc-800 ring-1 ring-zinc-900/[0.08] dark:ring-white/[0.08] p-0.5 opacity-0 pointer-events-none group-hover/cue:opacity-100 group-hover/cue:pointer-events-auto group-focus-within/cue:opacity-100 group-focus-within/cue:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto">
          {saveWord && onSaveWord && (
            <MiniButton
              title={t('rail.saveWordTitle', { word: saveWord })}
              onClick={(event) => {
                event.stopPropagation();
                onSaveWord(saveWord, cue.text);
              }}
            >
              <Plus size={11} weight="bold" />
            </MiniButton>
          )}
          {active && <ReplayButton onReplay={onReplay} onReplaySlow={onReplaySlow} combo={replayCombo} comboSlow={replaySlowCombo} />}
          {ai && (
            <MiniButton
              title={explaining ? t('explain.close') : t('explain.action')}
              expanded={explaining}
              controls={explaining ? `kivara-explain-${index}` : undefined}
              onClick={(event) => {
                event.stopPropagation();
                onToggleExplain(index);
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
          prev={prevText}
          next={nextText}
          lang={lang}
          uiLang={uiLang}
          nativeLang={nativeLang}
          ai={ai}
          onClose={() => onCloseExplain(index)}
          onReady={() => onRevealExplain(index)}
        />
      )}
    </div>
  );
});

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

/**
 * Align the platform's native track to the source cues by maximum temporal
 * overlap. Both lists are sorted the same way, so one cursor walks the native
 * track for the whole episode instead of a scan per line. A source line with
 * no overlap gets `null`: nothing is rendered for it.
 */
export function alignNativeLines(
  cues: readonly SubtitleCue[],
  native: readonly NativeLineCue[],
): (string | null)[] {
  let cursor = 0;
  return cues.map((cue) => {
    while (cursor < native.length && native[cursor].end <= cue.start) cursor += 1;
    let best: string | null = null;
    let bestOverlap = 0;
    for (let i = cursor; i < native.length && native[i].start < cue.end; i += 1) {
      const overlap = Math.min(cue.end, native[i].end) - Math.max(cue.start, native[i].start);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = native[i].text;
      }
    }
    return best;
  });
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
          : 'text-zinc-400 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-900/[0.05] dark:hover:bg-white/[0.07]'
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
function ReplayButton({ onReplay, onReplaySlow, combo, comboSlow }: { onReplay: () => void; onReplaySlow: () => void; combo?: string; comboSlow?: string }) {
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
      title={`${withCombo(t('shortcut.replay'), combo)}\n${withCombo(t('player.holdSlower'), comboSlow)}`}
      aria-label={withCombo(t('shortcut.replay'), combo)}
      {...press}
      className="w-6 h-6 rounded-full flex items-center justify-center kvl-press text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-900/[0.06] dark:hover:bg-white/10"
    >
      <RotateCcw size={11} />
    </button>
  );
}
