/**
 * Interactive subtitle layer (fused from docs/REDESIGN-V2.md §5.1).
 *
 * VIEW follows the prototype: word marks on the text, a sentence toolbar, a
 * free-selection toolbar, the Alt+wheel expression split, the one-tab-stop
 * keyboard walk, Listen-first blur and the three translation modes.
 *
 * LOGIC follows the repo: the tokenizer and its taxonomy (mwe / known /
 * proper-noun-known / unknown / ignored / mastered / punct), the platform's
 * alt cue before automatic MT, the saved-words highlight (only painted after
 * the save promise resolves ok) and the hover signal App uses to pause the
 * video (kivaraPausedRef: only resume what Kivara paused).
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../shared/i18n';
import { NoSubtitlesNotice } from './no-cues-notice';
import { sendMessage } from 'webext-bridge/content-script';
import { toast } from 'sonner';
import {
  Volume1, Copy, Check, Quote, MousePointerClick, Link2, Ear, GraduationCap, BookOpenCheck,
  ListChecks,
} from '../../ui/icons';
import type {
  SubtitleStyles,
  Mode,
  TranslateResponse,
  CreateCardResponse,
  CreateCardKind,
  CueAlign,
} from '../../shared/types';
import { tokenizeSentence } from '../nlp/tokenize';
import { lookupDictionary } from '../nlp/dictionary';
import { eventPathIsEditable } from '../utils/keyboard';
import { useKivaraStore } from '../../shared/use-kivara-store';
import { aiConfigured } from '../../shared/ai-configured';
import { WordPopover } from './WordPopover';
import { CARD_UNDONE_EVENT, cardKindOf } from './save-actions';
import { markOf, markAttrs, markContainerAttrs } from './wordMarks';
import { WordStatusSelector } from './WordStatusSelector';
import type { StudyBinding } from './study';
import {
  barRect,
  CAPTION_BOX_ATTR,
  captionRect,
  hostOf,
  notifyCaptionGeometryChange,
  oppositeSide,
  placeBadgeGroup,
  scopeOf,
  toBox,
} from './overlay-geometry';

export interface SubtitleOverlayProps {
  subtitleStyles: SubtitleStyles;
  cue: {
    id?: string;
    text: string;
    start?: number;
    end?: number;
    language?: string;
    align?: CueAlign;
  } | null;
  /**
   * Native-language alt cue running in parallel to the source caption — e.g.
   * the platform's official Spanish subtitle track when the source is
   * English. Preferred as the dual-caption source over MT.
   */
  altCue?: {
    id?: string;
    text: string;
    start?: number;
    end?: number;
    language?: string;
    align?: CueAlign;
  } | null;
  mode: Mode;
  saveRequestKey?: number | null;
  /** Save the given token + sentence as an Anki note. Resolves with the real
   * envelope so the saved highlight only lands on a confirmed note. */
  onSaveCard: (token: string | undefined, sentence: string) => Promise<CreateCardResponse>;
  /** "See in Anki" for a saved token (F4). */
  onSeeInAnki?: (token: string) => void;
  /** "Add this scene" to the note a saved token already has (F4). `kind` is
   * the real card flavour (word / expression), never a default. */
  onAddContext?: (token: string, sentence: string, kind: CreateCardKind) => void;
  /** True while a lookup/card is open; App decides whether to pause. */
  onTokenHoverChange?: (hovered: boolean) => void;
  /** Words already in Anki, pre-fetched at mount. */
  initialSavedWords?: Set<string>;
  /** The video is playing — drives Listen-first blur. */
  playing?: boolean;
  /** Point 2: explain a zero-cue playback after ~5 s. */
  noCuesNotice?: boolean;
  noticePlatform?: string;
  /** Expressions split by hand (Alt+wheel or the card). Owned by App. */
  expandedMWEs?: Set<string>;
  setExpandedMWEs?: React.Dispatch<React.SetStateAction<Set<string>>>;
  /** A capture is running: the overlay takes no clicks. */
  capturing?: boolean;
  /** Explain this line (AI). The button only renders when both exist. */
  onExplain?: () => void;
  /**
   * The save shortcut had nothing unambiguous to save: several new words in
   * the line, or none. App explains what to do instead of guessing a word —
   * the prototype's rule, and the reason a mis-fired shortcut never creates a
   * card for the wrong token.
   */
  onNothingToSave?: (reason: 'several' | 'none') => void;
  /**
   * Study profile of the subtitle language (F5): resolves each token's status,
   * feeds the word card's status selector and knows which words already have
   * an Anki card. Absent, the overlay draws only the expression bracket (F3).
   */
  study?: StudyBinding;
}

const hexToRgb = (hex: string) => {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r ? `${parseInt(r[1], 16)}, ${parseInt(r[2], 16)}, ${parseInt(r[3], 16)}` : '0,0,0';
};

const kbd =
  'inline-flex items-center h-5 px-1.5 rounded-md font-sans text-[11px] font-medium leading-none text-zinc-300 bg-white/[0.06] ring-1 ring-white/[0.08]';

const HINT_KEY = 'kvl:hoverHintSeen';

export function SubtitleOverlay({
  subtitleStyles,
  cue,
  altCue,
  mode,
  saveRequestKey,
  onSaveCard,
  onSeeInAnki,
  onAddContext,
  onTokenHoverChange,
  initialSavedWords,
  playing = false,
  noCuesNotice = false,
  noticePlatform,
  expandedMWEs: controlledExpanded,
  setExpandedMWEs: controlledSetExpanded,
  capturing = false,
  onExplain,
  onNothingToSave,
  study,
}: SubtitleOverlayProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  // Word hover: a repeated word in the line opens ONE card, keyed by index.
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  // The line is ONE Tab stop (roving tabindex); this is the word that holds it.
  const [rovingIdx, setRovingIdx] = useState(-1);
  // The word whose card the FOCUS opened (not the pointer): only that one
  // closes on blur.
  const focusOpenRef = useRef<number | null>(null);
  const [altExpandedKey, setAltExpandedKey] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ a: number; b: number } | null>(null);
  const [savedTokens, setSavedTokens] = useState<Set<string>>(
    () => initialSavedWords ?? new Set(),
  );

  const [localExpanded, setLocalExpanded] = useState<Set<string>>(new Set());
  const expandedMWEs = controlledExpanded ?? localExpanded;
  const setExpandedMWEs = controlledSetExpanded ?? setLocalExpanded;

  // Live handle on the study binding for callbacks that outlive their render
  // (the Undo inside a toast lives for 5 s). Refreshed on every render so a
  // long-lived callback reads CURRENT marks instead of the ones it was built
  // with.
  const studyRef = useRef(study);
  studyRef.current = study;

  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wordHoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors for listeners that must not re-register per render.
  const hoveredKeyRef = useRef<string | null>(null);
  const hoveredIdxRef = useRef<number | null>(null);
  const selectionRef = useRef(selection);
  useLayoutEffect(() => {
    hoveredKeyRef.current = hoveredKey;
    hoveredIdxRef.current = hoveredIdx;
    selectionRef.current = selection;
  });

  // Study preferences (store v3). F2 already migrated `showDualSubtitle`.
  const translation = useKivaraStore((s) => s.study.translation);
  const listenFirst = useKivaraStore((s) => s.study.listenFirst);
  const newMarks = useKivaraStore((s) => s.study.newMarks);
  const setStudy = useKivaraStore((s) => s.setStudy);
  const setMode = useKivaraStore((s) => s.setMode);
  const includeAi = useKivaraStore(
    (s) => s.ai.provider !== 'disabled' && !!s.ai.apiKey && s.ai.enrichOnHover,
  );
  // Explain is a separate capability from hover enrichment: it is available
  // whenever the AI is configured (F7), even with enrichOnHover off.
  const explainReady = useKivaraStore((s) => aiConfigured(s.ai));
  const nativeLanguage = useKivaraStore((s) => s.translate.targetLanguage || 'es');

  const targetSentence = cue?.text ?? '';
  const cueLanguage = cue?.language ?? 'en';
  const reading = mode === 'reading';
  const cardTheme = subtitleStyles.cardTheme ?? 'dark';

  // First-run hint: once per browser, never a permanent banner.
  const [hintSeen, setHintSeen] = useState(() => {
    try {
      return localStorage.getItem(HINT_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const markHintSeen = () => {
    setHintSeen(true);
    try {
      localStorage.setItem(HINT_KEY, 'true');
    } catch {
      /* private mode: the hint just repeats next mount */
    }
  };
  useEffect(() => {
    if (hintSeen) return;
    const id = setTimeout(markHintSeen, 7000);
    return () => clearTimeout(id);
  }, [hintSeen]);

  const clearLookup = () => {
    if (wordHoverTimeout.current) clearTimeout(wordHoverTimeout.current);
    setHoveredKey(null);
    setHoveredIdx(null);
    setSelection(null);
  };

  // A new cue unmounts the hovered token without a mouseleave — drop the card.
  useEffect(() => {
    clearLookup();
    setAltExpandedKey(null);
    setRovingIdx(-1);
    focusOpenRef.current = null;
  }, [cue?.id, cue?.text]);

  // Reading mode has no cards or selection: nothing invisible stays open.
  useEffect(() => {
    if (reading) clearLookup();
  }, [reading]);

  // Escape closes the card and the free selection (hover never focuses it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (!hoveredKeyRef.current && !selectionRef.current)) return;
      const idx = hoveredIdxRef.current;
      // Return focus to the word the card was opened from, then close.
      if (idx !== null) {
        subsRef.current?.querySelector<HTMLElement>(`[data-tok-idx="${idx}"]`)?.focus();
      }
      clearLookup();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Alt held over an expression splits it temporarily. Only Alt is claimed,
  // and only when a phrase is under the pointer: everywhere else Alt stays
  // the browser's / the page's.
  useEffect(() => {
    let owned = false;
    const down = (e: KeyboardEvent) => {
      if (eventPathIsEditable(e)) return;
      if (e.key !== 'Alt') return;
      const key = hoveredKeyRef.current;
      if (!key) return;
      const isPhrase = lookupDictionary(key, cueLanguage)?.type === 'phrase';
      const isPartOfExpanded = !isPhrase && Array.from(expandedMWEs).some(
        (phrase) => phrase.split(' ').includes(key.toLowerCase()),
      );
      if (!isPhrase && !isPartOfExpanded) return;
      owned = true;
      e.preventDefault();
      if (isPhrase) setAltExpandedKey(key);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== 'Alt' && e.altKey) return;
      if (e.key === 'Alt' && owned) e.preventDefault();
      owned = false;
      setAltExpandedKey(null);
    };
    const blur = () => setAltExpandedKey(null);
    const visibility = () => {
      if (document.hidden) setAltExpandedKey(null);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [expandedMWEs, cueLanguage]);

  // Alt+wheel must stop the page scroll (YouTube's layout). React's onWheel is
  // passive, so the cancel is done by a native listener; the actual split/join
  // is the React handler below.
  const subsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = subsRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.altKey && (e.target as HTMLElement | null)?.closest('[data-wheelable]')) e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ── Corner icons (Listen-first, mode). Their position comes from measured
  // rectangles, never from a CSS corner: at 640×360 a two-line caption reaches
  // the right edge and the old `top-4 right-4` sat on top of it.
  const layerRef = useRef<HTMLDivElement>(null);
  const badgesRef = useRef<HTMLDivElement>(null);
  const [badgePlacement, setBadgePlacement] = useState<{ left: number; top: number } | null>(null);

  /**
   * Re-seat the icon group outside the caption plate.
   *
   * Same measurements StudyBar takes (`[data-kivara-caption-box]` + host rect +
   * `oppositeSide`), plus the bar's own rect so a candidate can never land on
   * it. Positions are relative to the band because that is the containing
   * block of the icon group (and it moves as one piece with the plate).
   */
  const placeBadges = useCallback(() => {
    const layer = layerRef.current;
    const group = badgesRef.current;
    if (!layer || !group) return;
    const groupRect = group.getBoundingClientRect();
    if (groupRect.width === 0 || groupRect.height === 0) return;
    const scope = scopeOf(layer);
    const layerRect = layer.getBoundingClientRect();
    const hostRect = hostOf(layer)?.getBoundingClientRect() ?? layerRect;
    if (hostRect.width === 0 || hostRect.height === 0) return;
    const plate = captionRect(scope);
    const bar = barRect(scope);
    const placement = placeBadgeGroup(
      toBox(hostRect),
      plate ? toBox(plate) : null,
      { width: groupRect.width, height: groupRect.height },
      plate ? oppositeSide(plate, hostRect) : 'bottom',
      bar ? toBox(bar) : null,
    );
    const next = {
      left: Math.round(placement.x - layerRect.x),
      top: Math.round(placement.y - layerRect.y),
    };
    setBadgePlacement((prev) => (
      prev && prev.left === next.left && prev.top === next.top ? prev : next
    ));
  }, []);

  // The plate can move WITHOUT resizing (a new cue, another vertical offset),
  // which no observer can see. This component owns the cue, so it announces the
  // change for StudyBar and the E2E map, then re-seats its own icons.
  useLayoutEffect(() => {
    notifyCaptionGeometryChange();
    placeBadges();
  });

  // A resize does not re-render this component — the plate re-wraps in place —
  // so the player and the plate are observed directly.
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const layer = layerRef.current;
    if (!layer) return;
    const observer = new ResizeObserver(placeBadges);
    observer.observe(layer);
    const plate = scopeOf(layer).querySelector<HTMLElement>(`[${CAPTION_BOX_ATTR}]`);
    if (plate) observer.observe(plate);
    return () => observer.disconnect();
  }, [placeBadges]);

  useEffect(() => () => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    if (wordHoverTimeout.current) clearTimeout(wordHoverTimeout.current);
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  // Sub-10ms after mount, `initialSavedWords` arrives from the SW; merge it
  // (the useState initializer ran before the fetch resolved).
  useEffect(() => {
    if (!initialSavedWords || initialSavedWords.size === 0) return;
    setSavedTokens((prev) => {
      const next = new Set(prev);
      for (const w of initialSavedWords) next.add(w);
      return next;
    });
  }, [initialSavedWords]);

  // The saved toast's Undo deletes the note through the service worker, which
  // already drops the registry row and the F5 interval cache. The green mark
  // painted here is view state, so it has to follow: without this, a card the
  // user just undid keeps reading as saved until the next mount.
  useEffect(() => {
    const onCardUndone = (event: Event) => {
      const token = (event as CustomEvent<{ token?: string }>).detail?.token;
      if (!token) return;
      const key = token.toLowerCase();
      setSavedTokens((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    };
    window.addEventListener(CARD_UNDONE_EVENT, onCardUndone);
    return () => window.removeEventListener(CARD_UNDONE_EVENT, onCardUndone);
  }, []);

  const effectiveExpanded = useMemo(() => {
    if (!altExpandedKey) return expandedMWEs;
    const next = new Set(expandedMWEs);
    next.add(altExpandedKey);
    return next;
  }, [expandedMWEs, altExpandedKey]);

  const sourceText = useMemo(() => {
    const src = targetSentence;
    if (subtitleStyles.keepNativeLineBreaks) return src.replace(/\r\n?/g, '\n');
    return src.replace(/\r?\n+/g, ' ').replace(/\s{2,}/g, ' ');
  }, [targetSentence, subtitleStyles.keepNativeLineBreaks]);

  const tokens = useMemo(
    () => tokenizeSentence(sourceText, effectiveExpanded, cueLanguage),
    [sourceText, effectiveExpanded, cueLanguage],
  );
  // The new words of this line, deduped by lemma: the toolbar's "know the
  // rest" button marks them in one click. Only vocabulary carries a status —
  // punctuation, proper nouns and speaker notes never do.
  const newKeys = useMemo(() => {
    if (!study) return [] as string[];
    const seen = new Set<string>();
    for (const tok of tokens) {
      if (tok.kind === 'punct' || tok.kind === 'ignored') continue;
      const key = tok.lemma ?? tok.key;
      if (study.detailOf(key).status !== 'new') continue;
      seen.add(key);
    }
    return [...seen];
  }, [tokens, study]);

  const selectionText = useMemo(() => {
    if (!selection) return '';
    const lo = Math.min(selection.a, selection.b);
    const hi = Math.max(selection.a, selection.b);
    return tokens
      .slice(lo, hi + 1)
      .map((tk) => tk.text)
      .join('')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }, [selection, tokens]);

  // A split/join invalidates index-based ranges.
  useEffect(() => {
    setSelection(null);
  }, [tokens]);

  // ── Keyboard: ←/→ and Home/End walk the words, the focused word opens its
  // card, Tab enters it, Escape returns, Shift+←/→ extends the selection.
  // Proper nouns (`ignored`) are text, never stops.
  const wordIdxs = useMemo(
    () => tokens.flatMap((tk, i) => (tk.kind === 'punct' || tk.kind === 'ignored' ? [] : [i])),
    [tokens],
  );
  const tabStop = wordIdxs.includes(rovingIdx) ? rovingIdx : (wordIdxs[0] ?? -1);
  const focusWord = (i: number) => {
    subsRef.current?.querySelector<HTMLElement>(`[data-tok-idx="${i}"]`)?.focus();
  };
  const handleTokenKey = (e: React.KeyboardEvent, i: number, key: string) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return; // extension / browser shortcuts
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation(); // Space would pause the video on YouTube/Netflix
      handleTokenEnter(key, i);
      return;
    }
    const pos = wordIdxs.indexOf(i);
    const target = e.key === 'ArrowRight' ? wordIdxs[pos + 1]
      : e.key === 'ArrowLeft' ? wordIdxs[pos - 1]
      : e.key === 'Home' ? wordIdxs[0]
      : e.key === 'End' ? wordIdxs[wordIdxs.length - 1]
      : null;
    if (target === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (target === undefined) return; // already at the edge
    if (e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      setSelection((prev) => (prev ? { a: prev.a, b: target } : { a: i, b: target }));
    }
    focusWord(target);
  };

  // ── Dual caption: platform alt cue first, then automatic MT (repo order).
  const nativeAltText = altCue?.text?.trim() || null;
  const [translatedSentence, setTranslatedSentence] = useState<string | null>(null);
  const translationVisible = translation !== 'hidden';
  useEffect(() => {
    const src = targetSentence.trim();
    const sameLanguage = (cueLanguage || 'en').slice(0, 2) === nativeLanguage.slice(0, 2);
    if (!translationVisible || !src || sameLanguage || nativeAltText) {
      setTranslatedSentence(null);
      return;
    }
    let cancelled = false;
    setTranslatedSentence(null);
    sendMessage(
      'TRANSLATE',
      { text: src, sourceLang: cueLanguage || 'en', targetLang: nativeLanguage },
      'background',
    )
      .then((res) => {
        if (cancelled) return;
        const r = res as TranslateResponse;
        if (r?.ok && r.translatedText && r.translatedText.trim() !== src) {
          setTranslatedSentence(r.translatedText);
        }
      })
      .catch(() => {
        /* network errors are non-fatal — the second line just stays empty */
      });
    return () => {
      cancelled = true;
    };
  }, [targetSentence, cueLanguage, nativeLanguage, nativeAltText, translationVisible, cue?.id]);

  const dualCaptionText = nativeAltText ?? translatedSentence;

  // ── Hover / selection plumbing.
  const handleTokenEnter = (key: string, idx: number) => {
    if (wordHoverTimeout.current) clearTimeout(wordHoverTimeout.current);
    wordHoverTimeout.current = null;
    setHoveredKey(key);
    setHoveredIdx(idx);
  };
  const handleTokenLeave = () => {
    if (wordHoverTimeout.current) clearTimeout(wordHoverTimeout.current);
    wordHoverTimeout.current = setTimeout(() => {
      wordHoverTimeout.current = null;
      setHoveredKey(null);
    }, 80);
  };

  useEffect(() => {
    onTokenHoverChange?.(hoveredKey !== null);
  }, [hoveredKey, onTokenHoverChange]);

  const toggleExpandMWE = (key: string) => {
    setExpandedMWEs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setHoveredKey(null);
  };

  const findParentMWE = (wordKey: string): string | null => {
    for (const phrase of effectiveExpanded) {
      if (phrase.split(' ').includes(wordKey.toLowerCase())) return phrase;
    }
    return null;
  };

  const handleSaveToken = (token: string) => {
    if (capturing) return; // one card at a time
    // The frame must contain the video + its subtitle only: close the card
    // and the selection before the shutter fires.
    clearLookup();
    setIsHovered(false);
    void onSaveCard(token, targetSentence).then((result) => {
      if (result?.ok) setSavedTokens((prev) => new Set(prev).add(token.toLowerCase()));
    });
  };

  /**
   * "Know the rest": mark every new word of this line as known. The toast
   * carries Undo with the prototype's rule — only what nobody has touched
   * after the click is reverted, so a later hand mark survives.
   */
  const markRestKnown = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!study || newKeys.length === 0) return;
    const previous = new Map(newKeys.map((key) => [key, study.userStatusOf(key) ?? null]));
    for (const key of newKeys) study.setStatus(key, 'known');
    const n = newKeys.length;
    toast(n === 1 ? t('ovl.knewRestDoneOne') : t('ovl.knewRestDone', { n }), {
      duration: 5000,
      action: {
        label: t('recent.undo'),
        onClick: () => {
          // The binding in THIS closure is the one from the render that
          // painted the button: its `userStatusOf` reads the marks map as it
          // was BEFORE the click, so every word it just marked still looks
          // "not known" and the guard below skips them all — Undo reeled
          // nothing back. Read the LIVE binding instead (the ref below is
          // refreshed on every render).
          const live = studyRef.current;
          if (!live) return;
          for (const [key, status] of previous) {
            if (live.userStatusOf(key) === 'known') live.setStatus(key, status);
          }
        },
      },
    });
  };

  // Ctrl+Shift+S / the page shortcut: save what is pointed at (selection,
  // then the open card, then the line), never guess.
  const lastSaveKeyRef = useRef<number | null>(null);
  useEffect(() => {
    if (saveRequestKey == null) return;
    if (saveRequestKey === lastSaveKeyRef.current) return;
    lastSaveKeyRef.current = saveRequestKey;
    if (capturing) return;
    if (selection && selectionText) {
      handleSaveToken(selectionText);
      return;
    }
    const key = hoveredKeyRef.current;
    if (key) {
      const dictionary = lookupDictionary(key, cueLanguage);
      handleSaveToken(dictionary?.token ?? key);
      return;
    }
    // With a profile there IS something to judge: save the line only when it
    // holds exactly ONE new word (an i+1 line, like the transcript's button).
    // Several or none means the shortcut cannot know what the user meant, so
    // App explains instead of guessing.
    if (study) {
      if (newKeys.length === 1) {
        const tok = tokens.find((tk) => (tk.lemma ?? tk.key) === newKeys[0]);
        const dictionary = tok ? lookupDictionary(tok.key, cueLanguage) : undefined;
        handleSaveToken(dictionary?.token ?? (tok ? tok.key : newKeys[0]));
        return;
      }
      onNothingToSave?.(newKeys.length > 1 ? 'several' : 'none');
      return;
    }
    if (targetSentence.trim()) handleSaveToken(targetSentence);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveRequestKey]);

  const handleMouseEnter = () => {
    if (!hintSeen) markHintSeen();
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    setIsHovered(true);
  };
  const handleMouseLeave = () => {
    hoverTimeout.current = setTimeout(() => setIsHovered(false), 200);
  };

  // ── Sentence actions.
  const handleSpeak = (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (!('speechSynthesis' in window)) return;
      const utter = new SpeechSynthesisUtterance(sourceText);
      utter.lang = cueLanguage || 'en-US';
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    } catch {
      /* no speech synthesis: nothing to do */
    }
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    void copyText(sourceText).then((ok) => {
      if (!ok) {
        // Copy failure is non-fatal, but a silent failure reads as a dead
        // button — the prototype says so out loud.
        setCopied(false);
        toast.error(t('overlay.copyFailed'), { duration: 2400 });
        return;
      }
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!cue || !targetSentence.trim()) {
    // Point 2: with zero cues the caption area is BLANK — exactly the moment
    // the notice must speak. The hooks above have all run, so this early
    // return stays rules-of-hooks-clean.
    if (!noCuesNotice) return null;
    return (
      <div className="absolute inset-0" aria-live="polite">
        <div className="absolute inset-x-0 top-[12%] flex justify-center px-10">
          <NoSubtitlesNotice platform={noticePlatform} />
        </div>
      </div>
    );
  }

  const rgb = hexToRgb(subtitleStyles.backgroundColor);
  const bgOpacity = (subtitleStyles.backgroundOpacity ?? 60) / 100;
  // Hover can only make the plate MORE legible, never less.
  const hoverBgOpacity = Math.max(bgOpacity, (subtitleStyles.hoverOpacity ?? 80) / 100);
  const textShadow = (() => {
    const s = subtitleStyles.textShadow ?? 0;
    if (s <= 0) return 'none';
    const a = (s / 100).toFixed(2);
    const blur = Math.max(2, Math.round(s / 18));
    return `2px 2px ${blur}px rgba(0,0,0,${a}), -1px -1px 0 rgba(0,0,0,${a}), 1px -1px 0 rgba(0,0,0,${a}), -1px 1px 0 rgba(0,0,0,${a}), 1px 1px 0 rgba(0,0,0,${a})`;
  })();
  const verticalPercent =
    subtitleStyles.verticalOffset ??
    (subtitleStyles.position === 'top' ? 15 : subtitleStyles.position === 'middle' ? 50 : 85);
  const textAlign: 'left' | 'center' | 'right' = (() => {
    if (!subtitleStyles.keepNativeAlignment) return 'center';
    const a = cue.align;
    if (a === 'start' || a === 'left') return 'left';
    if (a === 'end' || a === 'right') return 'right';
    return 'center';
  })();

  const learning = !reading && isHovered;
  // Listen-first: while the line plays the text blurs; pausing or hovering reveals it.
  const listenHide = listenFirst && playing && !isHovered && !capturing;
  // Animate into blur; reveal instantly (a half-applied filter would trap the
  // word card in its stacking context while it opens).
  const blurText = (on: boolean): React.CSSProperties =>
    on ? { filter: 'blur(0.3em)', transition: 'filter 200ms ease', userSelect: 'none' } : {};
  const showHint = !hintSeen && !reading && !capturing && !isHovered;
  // The sentence toolbar is only usable while the plate is hovered with no
  // card open; when it is faded out its buttons must leave the tab order.
  const toolbarOpen = isHovered && hoveredKey === null && !reading && !selectionText;
  const fontSize = subtitleStyles.fontSize ?? 24;

  return (
    <div
      ref={layerRef}
      // With a card open the layer rises above the player controls (z-20/30).
      className={`absolute inset-x-0 ${hoveredKey ? 'z-[35]' : 'z-10'} flex flex-col items-center px-8 transition-all duration-300`}
      style={{ top: `${verticalPercent}%`, transform: 'translateY(-50%)' }}
    >
      {noCuesNotice && (
        <div className="absolute inset-x-0 top-[12%] flex justify-center px-10" aria-live="polite">
          <NoSubtitlesNotice platform={noticePlatform} />
        </div>
      )}
      {/* Extension badge + study toggles. Placed OUTSIDE the caption plate:
          the sentence toolbar opens above it and, with a caption that reaches
          the right edge, the top-right corner is inside the text. */}
      <div
        ref={badgesRef}
        className={`absolute z-30 flex items-center gap-1.5 pointer-events-auto ${badgePlacement ? '' : 'top-4 right-4'}`}
        style={badgePlacement ?? undefined}
      >
        {expandedMWEs.size > 0 && !reading && (
          <button
            type="button"
            onClick={rejoinAllMWEs}
            className="h-8 bg-zinc-900/80 backdrop-blur-md text-zinc-200 hover:text-white text-[12px] font-medium px-2.5 rounded-lg ring-1 ring-white/[0.08] shadow-lg flex items-center gap-1.5 hover:bg-zinc-800/90 kvl-press"
            title={t('overlay.rejoinAllTitle')}
            {...(__E2E__ ? { 'data-kivara-badge': 'rejoin' } : {})}
          >
            <Link2 size={14} /> {t('ovl.joinMwe')}
          </button>
        )}
        <button
          type="button"
          onClick={() => setStudy((s) => ({ ...s, listenFirst: !s.listenFirst }))}
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
          onClick={() => setMode(reading ? 'learning' : 'reading')}
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
      </div>

      <div
        ref={subsRef}
        className={`relative flex flex-col items-center ${capturing ? 'pointer-events-none' : 'pointer-events-auto'}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        data-kivara-hover-zone="true"
      >
        {showHint && (
          <div className="absolute -top-14 z-20 flex items-center gap-2.5 bg-zinc-900/90 backdrop-blur-md ring-1 ring-white/[0.08] rounded-xl pl-1.5 pr-3 h-10 shadow-[0_12px_32px_-8px_rgba(0,0,0,.5)] pointer-events-none whitespace-nowrap opacity-0 animate-[kvl-rise_400ms_ease-out_900ms_forwards]">
            <span className="w-7 h-7 rounded-lg bg-indigo-400/[0.14] text-indigo-300 flex items-center justify-center">
              <MousePointerClick size={14} />
            </span>
            <span className="text-[13px] font-medium text-white">{t('ovl.hintTitle')}</span>
            <span className="text-[12px] text-zinc-400">{t('ovl.hintBody')}</span>
          </div>
        )}

        {/* Invisible bridge: crossing the gap never fires mouseleave */}
        <div className="absolute -top-14 w-full h-14 bg-transparent z-0" />

        {/* Free-selection toolbar — replaces the sentence toolbar while a
            Shift+click range is active. */}
        {!reading && selectionText && (
          <div className="absolute -top-12 z-20 flex items-center gap-1 bg-zinc-900/95 backdrop-blur-sm ring-1 ring-indigo-400/40 p-1 rounded-xl shadow-xl transition-all duration-200">
            <span className="text-[12px] font-medium text-zinc-400 px-2">{t('ovl.selectionLabel')}</span>
            <div className="w-px h-3.5 bg-indigo-400/40" />
            <span className="text-[12px] text-zinc-200 px-2 max-w-[280px] truncate" title={selectionText}>"{selectionText}"</span>
            <div className="w-px h-3.5 bg-indigo-400/40" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleSaveToken(selectionText);
              }}
              className="flex items-center gap-1 bg-indigo-500 hover:bg-indigo-400 text-white text-[12px] font-medium px-2.5 h-7 rounded-lg kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/80"
              title={t('overlay.saveSelection')}
            >
              <Quote size={11} /> {t('ovl.saveSelection')}
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setSelection(null); }}
              className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.08] rounded-md kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/80"
              title={t('overlay.clearSelection')}
              aria-label={t('overlay.clearSelection')}
            >
              ✕
            </button>
          </div>
        )}

        {/* Sentence toolbar — utilities only (saving a word lives in its card) */}
        <div
          className={`absolute -top-12 z-10 flex items-center gap-1 bg-zinc-900/95 backdrop-blur-sm ring-1 ring-white/[0.08] p-1 rounded-xl shadow-xl transition-all duration-300 transform ${
            toolbarOpen ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0 pointer-events-none'
          }`}
        >
          <span className="text-[12px] font-medium text-zinc-400 px-2">{t('ovl.phrase')}</span>
          <div className="w-px h-3.5 bg-zinc-700/80" />
          <button
            type="button"
            tabIndex={toolbarOpen ? 0 : -1}
            onClick={handleSpeak}
            className="w-7 h-7 flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/[0.08] rounded-md kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/80"
            title={t('overlay.playSentenceTitle')}
            aria-label={t('overlay.playSentenceTitle')}
          >
            <Volume1 size={14} />
          </button>
          <button
            type="button"
            tabIndex={toolbarOpen ? 0 : -1}
            onClick={handleCopy}
            className="w-7 h-7 flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/[0.08] rounded-md kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/80"
            title={t('overlay.copySentenceTitle')}
            aria-label={t('overlay.copySentenceTitle')}
          >
            {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
          </button>
          {explainReady && onExplain && (
            <button
              type="button"
              tabIndex={toolbarOpen ? 0 : -1}
              onClick={(e) => { e.stopPropagation(); onExplain(); }}
              className="w-7 h-7 flex items-center justify-center text-indigo-300 hover:text-white hover:bg-white/[0.08] rounded-md kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/80"
              title={t('explain.action')}
              aria-label={t('explain.action')}
            >
              <BookOpenCheck size={14} />
            </button>
          )}
          {newKeys.length > 0 && (
            <button
              type="button"
              tabIndex={toolbarOpen ? 0 : -1}
              onClick={markRestKnown}
              className="h-7 px-2 flex items-center gap-1 text-zinc-300 hover:text-white hover:bg-white/[0.08] rounded-md text-[12px] font-medium tabular-nums kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/80"
              title={newKeys.length === 1 ? t('ovl.knowRestOne') : t('ovl.knowRest', { n: newKeys.length })}
              aria-label={newKeys.length === 1 ? t('ovl.knowRestOne') : t('ovl.knowRest', { n: newKeys.length })}
            >
              <ListChecks size={14} /> {newKeys.length}
            </button>
          )}
          <div className="w-px h-3.5 bg-zinc-700/80" />
          <span className="text-[11px] text-zinc-500 px-2 hidden sm:flex items-center gap-1">
            <kbd className={kbd}>{t('ovl.kbdAltScroll')}</kbd>
            <span>{t('ovl.splitExpr')}</span>
            <span className="text-zinc-600">·</span>
            <kbd className={kbd}>{t('ovl.kbdShiftClick')}</kbd>
            <span>{t('ovl.freeSelect')}</span>
          </span>
        </div>

        {/* Subtitle text */}
        <div
          className="rounded-md px-4 py-2 transition-all duration-300 cursor-pointer"
          // Stable hook for the shared overlay geometry (`overlay-geometry.ts`):
          // StudyBar, these corner icons and the E2E map all measure THIS box
          // (the text plate). The hover zone above also wraps the toolbars, so
          // measuring it would push the bar far too high.
          data-kivara-caption-box="true"
          {...markContainerAttrs(newMarks)}
          style={{
            fontSize: `${fontSize}px`,
            color: subtitleStyles.color,
            backgroundColor: `rgba(${rgb}, ${learning ? hoverBgOpacity : bgOpacity})`,
            fontWeight: subtitleStyles.fontWeight,
            textAlign,
            whiteSpace: subtitleStyles.keepNativeLineBreaks ? 'pre-line' : undefined,
            fontFamily: 'var(--kvl-font-sans)',
            textShadow,
            transform: learning ? 'scale(1.05)' : 'scale(1)',
            boxShadow: learning
              ? '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.1)'
              : 'none',
            backdropFilter: learning && subtitleStyles.hoverBlur ? 'blur(2px)' : undefined,
            WebkitBackdropFilter: learning && subtitleStyles.hoverBlur ? 'blur(2px)' : undefined,
          }}
        >
          {reading ? (
            <span style={blurText(listenHide)}>{sourceText}</span>
          ) : (
            <span style={blurText(listenHide)}>
              {tokens.map((tok, i) => {
                // Pure punctuation: plain text, no mark, no card.
                if (tok.kind === 'punct') return <React.Fragment key={`${tok.key}${i}`}>{tok.text}</React.Fragment>;
                const inSelection = !!selection
                  && i >= Math.min(selection.a, selection.b)
                  && i <= Math.max(selection.a, selection.b);
                // Proper nouns the dictionary does not know are text, not
                // vocabulary: no card, no keyboard stop, never saved as a word.
                if (tok.kind === 'ignored') {
                  return (
                    <span
                      key={`${tok.key}${i}`}
                      data-proper
                      className={`rounded px-0.5 ${inSelection ? 'bg-indigo-500/35' : ''}`}
                    >
                      {tok.text}
                    </span>
                  );
                }
                const isTokHovered = hoveredKey === tok.key && hoveredIdx === i;
                // The Anki cache of the profile (F5) adds to the pre-fetched
                // saved words: either way, an Anki word is not saved twice.
                const studyKey = tok.lemma ?? tok.key;
                const isSaved = savedTokens.has(tok.key.toLowerCase()) || !!study?.inAnki(studyKey);
                const mark = markOf(tok, study?.statusOf);
                // The status mark draws the underline; here only hover,
                // selection and the saved/learned accents.
                const stateCls = inSelection
                  ? 'bg-indigo-500/35 ring-1 ring-indigo-300/60'
                  : isTokHovered
                  ? '!text-white bg-indigo-600 shadow-[0_2px_8px_rgba(99,102,241,0.45)]'
                  : 'hover:bg-white/10';
                const savedCls = isSaved ? 'border-b-2 border-emerald-400/70' : '';
                const knownCls = tok.kind === 'mastered'
                  ? 'opacity-50 hover:opacity-100'
                  // The repo keeps a known proper noun interactive with a
                  // quieter affordance than regular vocabulary (the prototype
                  // had no such state; the taxonomy does).
                  : tok.kind === 'proper-noun-known'
                    ? 'underline decoration-violet-300/40 decoration-dotted underline-offset-2'
                    : '';
                const parentForSplit = tok.kind !== 'mwe' ? findParentMWE(tok.key) : null;
                const wheelable = tok.kind === 'mwe' || !!parentForSplit;
                const handleWheel = (e: React.WheelEvent) => {
                  if (!wheelable || !e.altKey) return;
                  e.stopPropagation(); // the page scroll is cancelled natively (subsRef)
                  if (e.deltaY > 0 && (tok.kind === 'mwe' || parentForSplit === altExpandedKey)) {
                    const key = tok.kind === 'mwe' ? tok.key : parentForSplit!;
                    setExpandedMWEs((prev) => {
                      const next = new Set(prev);
                      next.add(key);
                      return next;
                    });
                  } else if (e.deltaY < 0 && parentForSplit) {
                    setExpandedMWEs((prev) => {
                      const next = new Set(prev);
                      next.delete(parentForSplit);
                      return next;
                    });
                    setAltExpandedKey(null);
                    setHoveredKey(null);
                  }
                };
                return (
                  <span
                    key={`${tok.key}${i}`}
                    className="relative inline-block"
                    // Escape inside the card: focus goes back to the word.
                    onKeyDownCapture={(e) => {
                      if (e.key === 'Escape' && !(e.target as HTMLElement).hasAttribute('data-tok-idx')) focusWord(i);
                    }}
                    onBlur={(e) => {
                      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                      if (focusOpenRef.current !== i) return;
                      focusOpenRef.current = null;
                      if (hoveredIdx === i) handleTokenLeave();
                    }}
                  >
                    <span
                      onMouseEnter={() => handleTokenEnter(tok.key, i)}
                      onMouseLeave={handleTokenLeave}
                      onFocus={() => {
                        setRovingIdx(i);
                        focusOpenRef.current = i;
                        handleTokenEnter(tok.key, i);
                      }}
                      onKeyDown={(e) => handleTokenKey(e, i, tok.key)}
                      data-tok-idx={i}
                      tabIndex={!capturing && i === tabStop ? 0 : -1}
                      role="button"
                      aria-haspopup="dialog"
                      aria-expanded={isTokHovered && !selection}
                      onWheel={handleWheel}
                      data-wheelable={wheelable || undefined}
                      data-active={isTokHovered || inSelection || undefined}
                      {...markAttrs(mark)}
                      onMouseDown={(e) => {
                        if (e.shiftKey) e.preventDefault(); // no native text highlight
                      }}
                      onClick={(e) => {
                        if (e.shiftKey) {
                          e.preventDefault();
                          setSelection((prev) => (prev ? { a: prev.a, b: i } : { a: i, b: i }));
                          setHoveredKey(null);
                        } else {
                          setSelection(null);
                        }
                      }}
                      title={wheelable ? t('overlay.altScrollHint') : undefined}
                      className={`kvl-tok rounded px-0.5 transition-all duration-150 cursor-help outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/80 ${stateCls} ${savedCls} ${knownCls}`}
                    >
                      {tok.text}
                      {isSaved && !isTokHovered && (
                        <Check size={9} className="inline-block ml-0.5 -mt-1 text-emerald-300" strokeWidth={3} />
                      )}
                    </span>
                    {isTokHovered && !selection && (
                      <WordPopover
                        cardTheme={cardTheme}
                        visible
                        onMouseEnter={() => handleTokenEnter(tok.key, i)}
                        onMouseLeave={handleTokenLeave}
                        token={tok.text}
                        lookupToken={tok.key}
                        sentence={targetSentence}
                        sourceLang={cueLanguage}
                        includeAi={includeAi}
                        kind={tok.kind}
                        mweKind={tok.mweKind}
                        lemma={tok.lemma}
                        isExpanded={expandedMWEs.has(tok.key)}
                        isSaved={isSaved}
                        parentMWE={parentMWEForToken(tok.kind, tok.key)}
                        onClose={() => {
                          focusWord(i);
                          clearLookup();
                        }}
                        onToggleExpand={() => toggleExpandMWE(tok.key)}
                        onRejoinParent={(parent) => {
                          setExpandedMWEs((prev) => {
                            const next = new Set(prev);
                            next.delete(parent);
                            return next;
                          });
                          setHoveredKey(null);
                        }}
                        onSave={(e, value) => {
                          e.stopPropagation();
                          handleSaveToken(value);
                        }}
                        onSeeInAnki={onSeeInAnki
                          ? (e) => { e.stopPropagation(); onSeeInAnki(tok.key); }
                          : undefined}
                        onAddContext={onAddContext
                          ? (e) => {
                            e.stopPropagation();
                            onAddContext(tok.key, targetSentence, cardKindOf(tok.text));
                          }
                          : undefined}
                        statusSlot={study && tok.kind !== 'proper-noun-known' ? (
                          <WordStatusSelector
                            token={tok.text}
                            status={mark.status ?? 'new'}
                            detail={study.detailOf(studyKey)}
                            isSaved={isSaved}
                            onChange={(status) => study.setStatus(studyKey, status)}
                            onClear={() => study.setStatus(studyKey, null)}
                          />
                        ) : undefined}
                      />
                    )}
                  </span>
                );
              })}
            </span>
          )}

          {/* Translation: visible, blurred until hover, or hidden — the same
              study setting as the transcript. Listen-first also waits for the pause.
              `data-kivara-dual` lets the e2e suite read this line through the
              host's published box map (the root is closed); inert in production. */}
          {translationVisible && dualCaptionText && (
            <div
              data-kivara-dual=""
              className="mt-2 text-[0.65em] transition-all duration-300 overflow-hidden max-h-20 opacity-100"
              style={{
                whiteSpace: subtitleStyles.keepNativeLineBreaks ? 'pre-line' : undefined,
                textAlign,
                ...blurText(listenHide || (translation === 'blur' && !isHovered)),
              }}
            >
              <span className="text-zinc-300">{dualCaptionText}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  function parentMWEForToken(kind: string, key: string): string | null {
    return kind !== 'mwe' ? findParentMWE(key) : null;
  }

  function rejoinAllMWEs() {
    setExpandedMWEs(new Set());
    setHoveredKey(null);
  }
}

/** Clipboard with a legacy fallback; false when nothing could copy. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* permission denied or no focus: try the fallback */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
