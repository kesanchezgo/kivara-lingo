import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { t } from '../../shared/i18n';
import { sendMessage } from 'webext-bridge/content-script';
import { Volume1, Copy, Check, Quote, AudioLines, Camera, Link2, GraduationCap, BookOpenCheck } from 'lucide-react';
import type { SubtitleStyles, Mode, TranslateResponse } from '../../shared/types';
import { tokenizeSentence } from '../nlp/tokenize';
import { lookupDictionary } from '../nlp/dictionary';
import { eventPathIsEditable } from '../utils/keyboard';
import { useKivaraStore } from '../../shared/store';
import { WordPopover } from './WordPopover';

export interface SubtitleOverlayProps {
  subtitleStyles: SubtitleStyles;
  cue: {
    id?: string;
    text: string;
    start?: number;
    end?: number;
    language?: string;
    align?: 'start' | 'center' | 'end' | 'left' | 'right';
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
    align?: 'start' | 'center' | 'end' | 'left' | 'right';
  } | null;
  mode: Mode;
  saveRequestKey?: number | null;
  onSaveCard: (token: string | undefined, sentence: string) => void;
  onTokenHoverChange?: (hovered: boolean) => void;
  /** Words already in the user's Anki deck — pre-fetched at mount so they
   *  show the green "saved" highlight from the first frame. */
  initialSavedWords?: Set<string>;
}

/**
 * Renders the Kivara subtitle layer over a real platform video. The layer is
 * positioned absolutely inside the platform's video container (passed via the
 * Shadow DOM portal in App.tsx).
 */
export function SubtitleOverlay({
  subtitleStyles,
  cue,
  altCue,
  mode,
  saveRequestKey,
  onSaveCard,
  onTokenHoverChange,
  initialSavedWords,
}: SubtitleOverlayProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [captureState, setCaptureState] = useState<'idle' | 'screenshot' | 'audio'>('idle');
  // Identifier of the currently hovered token. Encoded as `${lineIdx}:${tokIdx}`
  // so two occurrences of the same word in a single cue ("how's this, how's
  // that") light up independently — previously the overlay tracked the
  // token's dictionary key, which collides when the same word appears twice.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [expandedMWEs, setExpandedMWEs] = useState<Set<string>>(new Set());
  const [altExpandedKey, setAltExpandedKey] = useState<string | null>(null);
  const [savedTokens, setSavedTokens] = useState<Set<string>>(
    () => initialSavedWords ?? new Set(),
  );
  // Multi-word selection — shift+click extends, plain drag creates a new
  // span. Indices are composite `${lineIdx}:${tokenIdx}` strings so the
  // selection works across multi-line cues without collisions.
  const [selection, setSelection] = useState<{ start: string; end: string } | null>(null);
  const dragAnchorRef = useRef<string | null>(null);

  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wordHoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the *dictionary key* of the currently hovered token so the Alt /
  // Ctrl+S handlers can act on the actual word/MWE. Kept in sync with
  // hoveredId, but never used to drive React render — the index is the only
  // identity for highlighting.
  const hoveredKeyRef = useRef<string | null>(null);

  // Notify parent (App) so it can pause/resume the underlying <video>. We
  // pause whenever ANY part of the subtitle box is hovered — not just when a
  // dictionary token gets focus — so t('overlay.hoverHint') pauses the
  // video even on platforms (e.g. YouTube) where most tokens are tagged
  // `unknown` and don't fire `handleTokenEnter`.
  useEffect(() => {
    onTokenHoverChange?.(isHovered || hoveredId !== null);
  }, [isHovered, hoveredId, onTokenHoverChange]);

  useEffect(() => {
    // We only handle the Alt key when it would do something useful — i.e.,
    // the user is currently hovering a phrase-MWE token and wants to expand
    // it. In every other case we let Alt pass through so the platform
    // (Alt+Tab, browser menu activation, Alt+arrow seek shortcuts, etc.)
    // keeps working. Previously we blanket-prevented every Alt keypress.
    const down = (e: KeyboardEvent) => {
      // Typing inside the panel (a shadow root, so `e.target` is the host)
      // must never expand an MWE on Alt.
      if (eventPathIsEditable(e)) return;
      if (e.key !== 'Alt') return;
      const hk = hoveredKeyRef.current;
      if (!hk) return;
      // Check if the hovered token is a phrase/MWE — either directly from
      // the dictionary or because it's in the expandedMWEs set (meaning it
      // was previously expanded and the user is hovering one of its parts).
      const entry = lookupDictionary(hk);
      const isPhrase = entry?.type === 'phrase';
      const isPartOfExpanded = !isPhrase && Array.from(expandedMWEs).some(
        (phrase) => phrase.split(' ').includes(hk.toLowerCase()),
      );
      if (!isPhrase && !isPartOfExpanded) return;
      e.preventDefault();
      if (isPhrase) {
        setAltExpandedKey(hk);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== 'Alt') return;
      setAltExpandedKey((prev) => {
        if (prev !== null) {
          e.preventDefault();
          // Re-set the hover to the MWE key so the next Alt press finds it
          hoveredKeyRef.current = prev;
        }
        return null;
      });
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
  }, []);

  const effectiveExpanded = useMemo(() => {
    if (!altExpandedKey) return expandedMWEs;
    const next = new Set(expandedMWEs);
    next.add(altExpandedKey);
    return next;
  }, [expandedMWEs, altExpandedKey]);

  const targetSentence = cue?.text ?? '';
  const cueLanguage = cue?.language ?? 'en';
  const includeAi = useKivaraStore(
    (s) => s.ai.provider !== 'disabled' && !!s.ai.apiKey && s.ai.enrichOnHover,
  );
  const showDualSubtitle = useKivaraStore((s) => s.translate.showDualSubtitle);
  const nativeLanguage = useKivaraStore((s) => s.translate.targetLanguage || 'es');
  const setMode = useKivaraStore((s) => s.setMode);

  // Dual caption priority chain:
  //   1. Native-language alt cue from the platform's own subtitle track
  //      (`altCue` prop, supplied by App.tsx polling the adapter). This is
  //      the highest quality source — zero latency, free, human-quality
  //      translation, already timed to the source cue.
  //   2. Remote MT (DeepL / Google / MyMemory / Lingva / offline chain) of
  //      the whole source sentence, cached in IndexedDB so re-displaying
  //      the same cue is instant after the first call.
  //   3. Nothing — source language already equals target, or both options
  //      returned empty.
  const nativeAltText = altCue?.text?.trim() || null;
  const [translatedSentence, setTranslatedSentence] = useState<string | null>(null);
  useEffect(() => {
    // Mock parity: the dual line is also visible on hover even when the
    // user has the persistent toggle OFF, so we keep the translation
    // pre-fetched regardless of `showDualSubtitle`. The toggle still
    // controls visibility of the line — see the dual-caption JSX below.
    const src = targetSentence.trim();
    if (!src) {
      setTranslatedSentence(null);
      return;
    }
    // Skip if source language equals target language (no-op).
    if ((cueLanguage || 'en').slice(0, 2) === nativeLanguage.slice(0, 2)) {
      setTranslatedSentence(null);
      return;
    }
    // The platform already shipped a native translation — use it directly
    // and skip the round-trip to the MT provider.
    if (nativeAltText) {
      setTranslatedSentence(null);
      return;
    }
    let cancelled = false;
    setTranslatedSentence(null);
    // No debounce — the cue id already changes only when the platform
    // emits a new caption, so the previous cleanup cancels any in-flight
    // request. Removing the 120 ms wait makes the dual line catch up to
    // the source line as fast as the MT provider responds (instant when
    // it's a cache hit).
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
        /* network errors are non-fatal — just hide the second line */
      });
    return () => {
      cancelled = true;
    };
  }, [targetSentence, cueLanguage, nativeLanguage, nativeAltText, cue?.id]);

  // Final string shown on the bilingual line.
  const dualCaptionText = nativeAltText ?? translatedSentence;
  // Tag the bilingual line so the user can tell at a glance whether it came
  // from the platform or from MT — useful when debugging quality issues.
  const dualCaptionSource: 'native' | 'mt' | null = nativeAltText
    ? 'native'
    : translatedSentence
      ? 'mt'
      : null;

  // Split the cue into rendered lines. When the user opts into "mantener
  // saltos de línea nativos" we honour every `\n` in the cue text; otherwise
  // we collapse them so the overlay's own word-wrap stays in charge.
  const lines = useMemo(() => {
    const src = targetSentence;
    if (subtitleStyles.keepNativeLineBreaks) {
      const parts = src.split(/\r?\n/);
      // Drop trailing empty line if the cue ends with `\n`.
      while (parts.length > 1 && parts[parts.length - 1].trim() === '') {
        parts.pop();
      }
      return parts.length > 0 ? parts : [src];
    }
    return [src.replace(/\r?\n+/g, ' ').replace(/\s{2,}/g, ' ')];
  }, [targetSentence, subtitleStyles.keepNativeLineBreaks]);

  const lineTokens = useMemo(
    () => lines.map((line) => tokenizeSentence(line, effectiveExpanded, cueLanguage)),
    [lines, effectiveExpanded, cueLanguage],
  );

  /**
   * Resolved text of the current multi-word selection. Joins the raw `text`
   * fields of every token in the range (including punct/whitespace) and
   * trims leading/trailing whitespace + punctuation runs.
   */
  const selectionText = useMemo<string | null>(() => {
    if (!selection) return null;
    const [sl, st] = selection.start.split(':').map(Number);
    const [el, et] = selection.end.split(':').map(Number);
    const parts: string[] = [];
    for (let li = sl; li <= el; li += 1) {
      const tokens = lineTokens[li] ?? [];
      const startIdx = li === sl ? st : 0;
      const endIdx = li === el ? et : tokens.length - 1;
      for (let ti = startIdx; ti <= endIdx; ti += 1) {
        if (tokens[ti]) parts.push(tokens[ti].text);
      }
      if (li < el) parts.push(' ');
    }
    const joined = parts.join('').trim();
    if (!joined) return null;
    return joined.replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '');
  }, [selection, lineTokens]);

  // Reset cue-scoped UI state whenever the cue changes.
  useEffect(() => {
    setHoveredId(null);
    hoveredKeyRef.current = null;
    setAltExpandedKey(null);
    setSelection(null);
    dragAnchorRef.current = null;
  }, [cue?.id]);

  // Tier 1.1: track mouseup globally so dragging off the subtitle still
  // terminates the selection drag without leaving a stale anchor.
  useEffect(() => {
    const up = () => {
      dragAnchorRef.current = null;
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const handleTokenEnter = (id: string, key: string) => {
    if (wordHoverTimeout.current) clearTimeout(wordHoverTimeout.current);
    setHoveredId(id);
    hoveredKeyRef.current = key;
  };
  const handleTokenLeave = () => {
    // 80 ms is enough to absorb cursor microjitter — the popover's
    // invisible bridge already keeps the mouse "inside" while crossing
    // the 12 px gap from token to popover plate, so we don't need a
    // longer timeout. Mirrors the mock.
    wordHoverTimeout.current = setTimeout(() => {
      setHoveredId(null);
      hoveredKeyRef.current = null;
    }, 80);
  };

  /**
   * Multi-word selection: shift+click extends, plain mousedown anchors.
   * IDs are composite `${lineIdx}:${tokenIdx}` strings so the comparison
   * works across multi-line cues. We compare lexicographically with a
   * helper because the strings encode (li, ti) and we need numeric order.
   */
  const compareIds = (a: string, b: string): number => {
    const [al, at] = a.split(':').map(Number);
    const [bl, bt] = b.split(':').map(Number);
    if (al !== bl) return al - bl;
    return at - bt;
  };

  const orderRange = (a: string, b: string): { start: string; end: string } => {
    return compareIds(a, b) <= 0 ? { start: a, end: b } : { start: b, end: a };
  };

  const isInRange = (id: string, range: { start: string; end: string }): boolean => {
    return compareIds(id, range.start) >= 0 && compareIds(id, range.end) <= 0;
  };

  const handleTokenMouseDown = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.shiftKey && selection) {
      const range =
        compareIds(id, selection.start) < 0
          ? { start: id, end: selection.end }
          : compareIds(id, selection.end) > 0
            ? { start: selection.start, end: id }
            : selection;
      setSelection(range);
      dragAnchorRef.current = id === range.start ? range.end : range.start;
      return;
    }
    dragAnchorRef.current = id;
    setSelection(null);
  };

  const handleTokenDragEnter = (id: string) => {
    const anchor = dragAnchorRef.current;
    if (anchor == null || anchor === id) return;
    setSelection(orderRange(anchor, id));
  };

  const handleSubtitleMouseDownClearSelection = (e: React.MouseEvent) => {
    if (e.shiftKey) return;
    setSelection(null);
  };

  const toggleExpandMWE = (key: string) => {
    setExpandedMWEs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setHoveredId(null);
    hoveredKeyRef.current = null;
  };

  const findParentMWE = (wordKey: string): string | null => {
    for (const phrase of expandedMWEs) {
      if (phrase.split(' ').includes(wordKey.toLowerCase())) return phrase;
    }
    return null;
  };

  const handleSaveToken = useCallback(
    (token: string) => {
      setCaptureState('screenshot');
      window.setTimeout(() => {
        setCaptureState('audio');
        window.setTimeout(() => setCaptureState('idle'), 900);
      }, 220);
      onSaveCard(token, targetSentence);
      setSavedTokens((prev) => new Set(prev).add(token.toLowerCase()));
    },
    [onSaveCard, targetSentence],
  );

  // Respond to Ctrl+S / external save requests. We only fire when the
  // `saveRequestKey` value actually CHANGES (not when other deps like
  // `handleSaveToken` or `targetSentence` get recreated on re-render).
  const lastSaveKeyRef = useRef<number | null>(null);
  useEffect(() => {
    if (saveRequestKey == null) return;
    if (saveRequestKey === lastSaveKeyRef.current) return;
    lastSaveKeyRef.current = saveRequestKey;
    if (selectionText) {
      handleSaveToken(selectionText);
      setSelection(null);
      return;
    }
    const key = hoveredKeyRef.current;
    if (key) {
      const dictionary = lookupDictionary(key, cueLanguage);
      const tokenText = dictionary?.token ?? key;
      handleSaveToken(tokenText);
    } else if (targetSentence) {
      handleSaveToken(targetSentence);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveRequestKey]);

  const handleMouseEnter = () => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    setIsHovered(true);
  };
  const handleMouseLeave = () => {
    hoverTimeout.current = setTimeout(() => setIsHovered(false), 200);
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(targetSentence).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!cue || !targetSentence.trim()) return null;

  const bgOpacity = subtitleStyles.backgroundOpacity / 100;
  const bgColor = subtitleStyles.backgroundColor;

  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
      : '0,0,0';
  };
  const backgroundColorWithOpacity = `rgba(${hexToRgb(bgColor)}, ${bgOpacity})`;
  // En hover (modo aprendizaje) usamos la opacidad configurada por el
  // usuario (Subtitles tab → "Opacidad en hover"), nunca menor que la
  // opacidad base — así el plate puede volverse MÁS legible al hover, nunca
  // menos. Mismo cálculo que el mock.
  const hoverBgOpacity = Math.max(bgOpacity, (subtitleStyles.hoverOpacity ?? 80) / 100);
  const backgroundColorOnHover = `rgba(${hexToRgb(bgColor)}, ${hoverBgOpacity})`;

  const verticalPercent =
    subtitleStyles.verticalOffset ??
    (subtitleStyles.position === 'top' ? 15 : subtitleStyles.position === 'middle' ? 50 : 85);

  const isReading = mode === 'reading';

  const rejoinAllMWEs = () => {
    setExpandedMWEs(new Set());
    setHoveredId(null);
    hoveredKeyRef.current = null;
  };

  // Honor the cue's `align` setting only when the user opted in. Otherwise
  // (and when the adapter couldn't extract an align hint) we keep the
  // overlay's default centered layout, which is what most viewers expect on
  // any platform.
  const textAlignment: 'left' | 'center' | 'right' = (() => {
    if (!subtitleStyles.keepNativeAlignment) return 'center';
    const a = cue?.align;
    if (a === 'start' || a === 'left') return 'left';
    if (a === 'end' || a === 'right') return 'right';
    return 'center';
  })();
  const flexJustify: 'flex-start' | 'center' | 'flex-end' =
    textAlignment === 'left' ? 'flex-start' : textAlignment === 'right' ? 'flex-end' : 'center';

  return (
    <>
      {/* Extension badge + mode toggle (top-right of video) */}
      <div className="absolute top-4 right-4 z-30 flex items-center gap-1.5 pointer-events-auto">
        {expandedMWEs.size > 0 && !isReading && (
          <button
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={rejoinAllMWEs}
            className="bg-amber-500/15 backdrop-blur-md text-amber-200 text-[11px] font-medium px-2 py-1 rounded-full shadow-lg flex items-center gap-1 hover:bg-amber-500/25 transition-colors border border-amber-400/30"
            title={t('overlay.rejoinAllTitle')}
          >
            <Link2 size={11} /> Unir expresiones
          </button>
        )}
        <button
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setMode(isReading ? 'learning' : 'reading')}
          className="group/badge w-7 h-7 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-md ring-1 ring-white/10 hover:ring-white/20 flex items-center justify-center transition-all"
          title={!isReading ? t('subs.modeLearning') : t('subs.modeReading')}
        >
          {!isReading ? (
            <span className="relative flex items-center justify-center">
              <span className="absolute w-1.5 h-1.5 rounded-full bg-emerald-400/40 animate-ping" style={{ animationDuration: '2.4s' }} />
              <GraduationCap size={13} className="text-indigo-300/90 group-hover/badge:text-indigo-200" strokeWidth={2} />
            </span>
          ) : (
            <BookOpenCheck size={13} className="text-zinc-400 group-hover/badge:text-zinc-200" strokeWidth={2} />
          )}
        </button>
      </div>

      {/* Onboarding hint — invitation banner shown when no popover/capture is
          active. Mock parity. Floats at the top of the video so the user
          knows the subtitle is interactive (otherwise on a static cue it
          looks like plain text). */}
      {!isReading && !isHovered && captureState === 'idle' && (
        <div
          className="absolute top-8 left-1/2 -translate-x-1/2 bg-zinc-900/70 backdrop-blur-md border border-white/10 text-white/85 text-xs px-3 py-1.5 rounded-full pointer-events-none shadow-lg animate-in fade-in slide-in-from-top-2 duration-500 z-30"
          style={{ fontFamily: 'var(--kvl-font-sans)' }}
        >
          {t('ovl.hoverToInteract')}</div>
      )}

      {/* Capture overlay — covers the full video area */}
      {!isReading && captureState !== 'idle' && (
        <div
          className="absolute inset-0 z-40 pointer-events-none transition-all duration-500 ease-out"
          style={{
            background:
              captureState === 'screenshot'
                ? 'radial-gradient(circle at center, rgba(99,102,241,0.25), rgba(0,0,0,0.35))'
                : 'rgba(9, 9, 11, 0.55)',
            backdropFilter: captureState === 'audio' ? 'blur(4px)' : 'blur(0px)',
          }}
        />
      )}

      {captureState === 'audio' && (
        <div className="absolute inset-0 z-50 flex items-end justify-center pb-8 pointer-events-none">
          <div className="bg-zinc-900/90 backdrop-blur-xl border border-zinc-700/60 rounded-xl px-4 py-3 flex items-center gap-3 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="w-9 h-9 rounded-lg bg-indigo-500/15 ring-1 ring-indigo-400/30 flex items-center justify-center shrink-0">
              <AudioLines size={18} className="text-indigo-300" />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-white text-xs font-semibold">Capturando audio</span>
                <span className="text-[9px] uppercase tracking-wider font-bold text-indigo-300 bg-indigo-500/20 px-1.5 py-0.5 rounded">VAD</span>
              </div>
              <div className="flex gap-[3px] items-end h-3">
                {[0.5, 1, 0.7, 0.4, 0.85, 0.6, 0.9, 0.5].map((h, i) => (
                  <span
                    key={i}
                    className="w-[2px] bg-indigo-400 rounded-full animate-pulse"
                    style={{
                      height: `${h * 12}px`,
                      animationDuration: `${0.9 + (i % 3) * 0.15}s`,
                      animationDelay: `${i * 60}ms`,
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-zinc-400 ml-1 pl-3 border-l border-zinc-700/60">
              <Camera size={11} className="text-emerald-400" />
              <span>Frame ✓</span>
            </div>
          </div>
        </div>
      )}

      {/* Subtitles Overlay */}
      <div
        className="absolute inset-x-0 z-10 flex flex-col items-center px-8 transition-all duration-300"
        style={{
          top: `${verticalPercent}%`,
          transform: 'translateY(-50%)',
          pointerEvents: 'none',
        }}
      >
      <div
        className="relative flex flex-col items-center pointer-events-auto select-text"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        // Block the default focus side-effect of a click on the subtitle
        // plate. Without this, clicking on a token (or anywhere inside the
        // plate) makes that element document.activeElement and HBO Max /
        // Netflix / Disney+ stop seeing keyboard shortcuts. We only need
        // mousedown — we DON'T preventDefault on mouseup or click, so
        // selecting text and the per-token onClick handlers keep working.
        onMouseDown={(e) => {
          // Allow text selection: only block focus stealing when the
          // target is a button, span with role, or interactive token.
          const target = e.target as HTMLElement;
          if (target.closest('input, textarea, [contenteditable="true"]')) return;
          e.preventDefault();
          // Clear active multi-word selection on plate background click
          // (but preserve it on shift+click which extends).
          handleSubtitleMouseDownClearSelection(e);
        }}
        data-kivara-hover-zone="true"
      >
        <div className="absolute -top-14 w-full h-14 bg-transparent z-0" />

        {/* Selection toolbar — takes priority over the phrase toolbar
            whenever a multi-word selection is active. */}
        {!isReading && selectionText && (
          <div className="absolute -top-12 z-20 flex items-center gap-1 bg-indigo-900/95 backdrop-blur-sm border border-indigo-400/60 p-1 rounded-lg shadow-xl transition-all duration-200">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-indigo-200 px-2">
              {t('ovl.selectionLabel')}</span>
            <div className="w-px h-3.5 bg-indigo-400/40" />
            <span
              className="text-[11px] text-indigo-100 px-2 max-w-[280px] truncate"
              title={selectionText}
            >
              "{selectionText}"
            </span>
            <div className="w-px h-3.5 bg-indigo-400/40" />
            <button
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                handleSaveToken(selectionText);
                setSelection(null);
              }}
              className="flex items-center gap-1 bg-indigo-500 hover:bg-indigo-400 text-white text-[11px] font-medium px-2 py-1 rounded transition-colors"
              title={t('overlay.saveSelection')}
            >
              <Quote size={11} /> {t('ovl.saveSelection')}</button>
            <button
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                setSelection(null);
              }}
              className="p-1 text-indigo-200 hover:text-white hover:bg-indigo-700/60 rounded transition-colors"
              title={t('overlay.clearSelection')}
            >
              ✕
            </button>
          </div>
        )}

        {!isReading && !selectionText && (
          <div
            className={`absolute -top-12 z-10 flex items-center gap-1 bg-zinc-900/95 backdrop-blur-sm border border-zinc-700/60 p-1 rounded-lg shadow-xl transition-all duration-300 transform ${
              isHovered && hoveredId === null ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0 pointer-events-none'
            }`}
          >
            <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500 px-2">Frase</span>
            <div className="w-px h-3.5 bg-zinc-700/80" />
            <button
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              className="p-1.5 text-zinc-300 hover:text-white hover:bg-zinc-700/50 rounded-md transition-colors"
              title={t('overlay.playSentenceTitle')}
            >
              <Volume1 size={14} />
            </button>
            <button
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleCopy}
              className="p-1.5 text-zinc-300 hover:text-white hover:bg-zinc-700/50 rounded-md transition-colors"
              title="Copiar texto"
            >
              {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            </button>
            <div className="w-px h-3.5 bg-zinc-700/80" />
            <button
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                handleSaveToken(targetSentence);
              }}
              className="flex items-center gap-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-medium px-2 py-1 rounded transition-colors"
              title={t('overlay.saveSentenceTitle')}
            >
              <Quote size={11} /> Guardar frase
            </button>
            <div className="w-px h-3.5 bg-zinc-700/80" />
            <span className="text-[9px] text-zinc-500 px-2 hidden sm:flex items-center gap-1">
              <kbd className="font-sans font-semibold text-[9px] text-zinc-400 bg-zinc-800 border border-zinc-700 rounded px-1 py-px">
                Alt+Scroll
              </kbd>
              <span>{t('ovl.splitExpr')}</span>
              <span className="text-zinc-600">·</span>
              <kbd className="font-sans font-semibold text-[9px] text-zinc-400 bg-zinc-800 border border-zinc-700 rounded px-1 py-px">
                Shift+Click
              </kbd>
              <span>{t('ovl.freeSelect')}</span>
            </span>
          </div>
        )}

        <div
          className="rounded-md px-4 py-2 transition-all duration-300 cursor-pointer"
          style={{
            textAlign: textAlignment,
            fontSize: `${subtitleStyles.fontSize}px`,
            color: subtitleStyles.color,
            backgroundColor: !isReading && isHovered ? backgroundColorOnHover : backgroundColorWithOpacity,
            fontWeight: subtitleStyles.fontWeight,
            // Pin the font family so the subtitle text always renders in
            // our stack — never the host page's font (YouTube/Netflix etc.
            // each use their own brand font that would otherwise leak in).
            fontFamily: 'var(--kvl-font-sans)',
            textShadow: (() => {
              const s = subtitleStyles.textShadow;
              if (s <= 0) return 'none';
              const a = (s / 100).toFixed(2);
              const blur = Math.max(2, Math.round(s / 18));
              return `2px 2px ${blur}px rgba(0,0,0,${a}), -1px -1px 0 rgba(0,0,0,${a}), 1px -1px 0 rgba(0,0,0,${a}), -1px 1px 0 rgba(0,0,0,${a}), 1px 1px 0 rgba(0,0,0,${a})`;
            })(),
            transform: !isReading && isHovered ? 'scale(1.05)' : 'scale(1)',
            boxShadow:
              !isReading && isHovered
                ? '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.1)'
                : 'none',
            // "Difuminar fondo en hover" toggle (SubtitlesTab) — applies
            // a 2px backdrop-blur behind the plate during hover so busy
            // scenes don't bleed through the popover. Mock parity.
            backdropFilter:
              !isReading && isHovered && subtitleStyles.hoverBlur ? 'blur(2px)' : undefined,
            WebkitBackdropFilter:
              !isReading && isHovered && subtitleStyles.hoverBlur ? 'blur(2px)' : undefined,
          }}
        >
          {isReading ? (
            // Reading mode: no popovers, but still respect the
            // "keepNativeLineBreaks" toggle so the visible layout matches
            // interactive mode.
            <div className="flex flex-col" style={{ alignItems: flexJustify }}>
              {lines.map((line, li) => (
                <span key={li}>{line}</span>
              ))}
            </div>
          ) : (
            <div className="flex flex-col" style={{ alignItems: flexJustify }}>
              {lineTokens.map((tokens, li) => (
                <div key={li} className="block">
                  {tokens.map((tok, i) => {
                    const id = `${li}:${i}`;
                    const isInSel = selection != null && isInRange(id, selection);
                    if (tok.kind === 'punct') {
                      return (
                        <span
                          key={`${li}:${i}:${tok.key}`}
                          className={isInSel ? 'bg-indigo-500/30' : undefined}
                        >
                          {tok.text}
                        </span>
                      );
                    }
                    // `ignored` tokens render exactly like punct text — no
                    // affordance, no popover, no hover state. This is how the
                    // tokenizer hides auto-classified proper nouns. They can
                    // still participate in a span selection so the user can
                    // capture "Mr Anderson" as one card if they want.
                    if (tok.kind === 'ignored') {
                      return (
                        <span
                          key={`${li}:${i}:${tok.key}`}
                          onMouseDown={(e) => handleTokenMouseDown(id, e)}
                          onMouseEnter={() => handleTokenDragEnter(id)}
                          className={`opacity-90 cursor-text ${isInSel ? 'bg-indigo-500/30' : ''}`}
                        >
                          {tok.text}
                        </span>
                      );
                    }
                    // `id` is the per-occurrence hover identity. Composite of
                    // line index + token index so two instances of the same
                    // word in a single cue ("how's this, how's that") keep
                    // independent hover/popover state — previously the
                    // overlay keyed off `tok.key` (the lowercased text) and
                    // both occurrences lit up together.
                    const isTokHovered = hoveredId === id;
                    const isSaved = savedTokens.has(tok.key.toLowerCase());
                    // After the Phase 2 audit we make `unknown` interactive too —
                    // hovering triggers the remote translation chain inside
                    // WordPopover. The visual affordance is much subtler than
                    // known/mwe so it doesn't compete for attention.
                    const isInteractive =
                      tok.kind === 'mwe' ||
                      tok.kind === 'known' ||
                      tok.kind === 'proper-noun-known' ||
                      tok.kind === 'unknown' ||
                      tok.kind === 'mastered';

                    let colorClass: string;
                    if (isTokHovered) {
                      colorClass =
                        'text-white bg-indigo-600 shadow-[0_2px_8px_rgba(99,102,241,0.45)]';
                    } else if (isSaved) {
                      colorClass =
                        'text-emerald-300 border-b-2 border-emerald-400/70 hover:bg-emerald-400/10';
                    } else if (tok.kind === 'mwe' && tok.mweKind === 'phrasal') {
                      // Phrasal verbs use a solid azul underline (distinct from
                      // idiomatic MWEs) to signal they're grammatical units.
                      colorClass =
                        'text-sky-300 border-b-2 border-sky-400 hover:bg-sky-400/15';
                    } else if (tok.kind === 'mwe') {
                      colorClass =
                        'text-amber-300 border-b-2 border-amber-400 border-dotted hover:bg-amber-400/15';
                    } else if (tok.kind === 'known') {
                      colorClass =
                        'border-b border-zinc-300/40 border-dashed hover:text-white hover:bg-white/10';
                    } else if (tok.kind === 'proper-noun-known') {
                      colorClass =
                        'text-violet-300/90 border-b border-violet-400/40 border-dotted hover:text-white hover:bg-violet-400/10';
                    } else if (tok.kind === 'mastered') {
                      colorClass = 'opacity-50 hover:opacity-100 hover:bg-white/5';
                    } else {
                      // unknown — interactive but with the most subtle affordance.
                      colorClass =
                        'opacity-80 hover:opacity-100 hover:bg-white/10 hover:underline hover:decoration-dotted hover:decoration-zinc-400/70 hover:underline-offset-2';
                    }

                    const parentForSplit = tok.kind !== 'mwe' ? findParentMWE(tok.key) : null;
                    const wheelable = tok.kind === 'mwe' || !!parentForSplit;
                    const handleWheel = (e: React.WheelEvent) => {
                      if (!wheelable) return;
                      if (!(e.ctrlKey || e.altKey || e.metaKey)) return;
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.deltaY > 0 && tok.kind === 'mwe') {
                        setExpandedMWEs((prev) => {
                          const n = new Set(prev);
                          n.add(tok.key);
                          return n;
                        });
                      } else if (e.deltaY < 0 && parentForSplit) {
                        setExpandedMWEs((prev) => {
                          const n = new Set(prev);
                          n.delete(parentForSplit);
                          return n;
                        });
                        setHoveredId(null);
                        hoveredKeyRef.current = null;
                      }
                    };

                    const isInSelection = selection != null && isInRange(id, selection);
                    const cursorClass = wheelable
                      ? 'cursor-ew-resize'
                      : isInteractive
                        ? 'cursor-help'
                        : '';
                    const selectionClass = isInSelection
                      ? 'bg-indigo-500/35 ring-1 ring-indigo-300/60'
                      : '';

                    return (
                      <span key={`${li}:${i}:${tok.key}`} className="relative inline-block">
                        <span
                          onMouseEnter={() => {
                            if (isInteractive) handleTokenEnter(id, tok.key);
                            handleTokenDragEnter(id);
                          }}
                          onMouseLeave={handleTokenLeave}
                          onMouseDown={(e) => handleTokenMouseDown(id, e)}
                          onWheel={handleWheel}
                          title={
                            wheelable
                              ? t('overlay.altScrollHint')
                              : undefined
                          }
                          className={`relative rounded px-0.5 transition-all duration-150 ${cursorClass} ${colorClass} ${selectionClass}`}
                        >
                          {tok.text}
                          {isSaved && !isTokHovered && (
                            <Check size={9} className="inline-block ml-0.5 -mt-1 text-emerald-400" strokeWidth={3} />
                          )}
                        </span>
                        {isTokHovered && isInteractive && (
                          <WordPopover
                            visible={true}
                            onMouseEnter={() => handleTokenEnter(id, tok.key)}
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
                            parentMWE={tok.kind !== 'mwe' ? findParentMWE(tok.key) : null}
                            onClose={() => {
                              // Escape: the keyboard way out. Dragging the
                              // hovered id to null makes the card unmount.
                              setHoveredId(null);
                              (document.activeElement as HTMLElement | null)?.blur?.();
                            }}
                            onToggleExpand={() => toggleExpandMWE(tok.key)}
                            onRejoinParent={(parent) => {
                              setExpandedMWEs((prev) => {
                                const n = new Set(prev);
                                n.delete(parent);
                                return n;
                              });
                              setHoveredId(null);
                              hoveredKeyRef.current = null;
                            }}
                            onSave={(e, token) => {
                              e.stopPropagation();
                              handleSaveToken(token);
                            }}
                          />
                        )}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {/* Dual caption — native-language full sentence under the
              source. 1:1 with the mock VideoPlayer:
                - Wrapper always renders while `showDualSubtitle ||
                  (!isReading && isHovered)` so it doesn't flash in
                  AFTER the MT round-trip resolves (which would re-run
                  the height transition mid-cue and look out of sync).
                - Inner expand/collapse driven by `showDualSubtitle || isHovered`.
                - The `<span>` itself only appears once `dualCaptionText`
                  resolves, so the user never sees an empty grey line.
                - `mt-2` constant, `transition-all duration-300`. */}
          {(showDualSubtitle || (!isReading && isHovered)) && (
            <div
              data-kivara-hover-zone="true"
              className={`mt-2 text-[0.65em] transition-all duration-300 overflow-hidden ${
                showDualSubtitle || isHovered ? 'max-h-20 opacity-100' : 'max-h-0 opacity-0'
              }`}
              style={{
                whiteSpace: subtitleStyles.keepNativeLineBreaks ? 'pre-line' : undefined,
                textAlign: subtitleStyles.keepNativeAlignment ? 'left' : 'center',
              }}
            >
              {dualCaptionText && (
                <span className="text-zinc-300">{dualCaptionText}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
