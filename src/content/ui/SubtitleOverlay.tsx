import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { sendMessage } from 'webext-bridge/content-script';
import { Volume1, Copy, Check, Quote, AudioLines, Camera, GraduationCap, BookOpenCheck, Link2 } from 'lucide-react';
import type { SubtitleStyles, Mode, TranslateResponse } from '../../shared/types';
import { tokenizeSentence } from '../nlp/tokenize';
import { lookupDictionary } from '../nlp/dictionary';
import { useKivaraStore } from '../../shared/store';
import { WordPopover } from './WordPopover';

export interface SubtitleOverlayProps {
  subtitleStyles: SubtitleStyles;
  cue: { id?: string; text: string; start?: number; end?: number; language?: string } | null;
  /**
   * Native-language alt cue running in parallel to the source caption — e.g.
   * the platform's official Spanish subtitle track when the source is
   * English. Preferred as the dual-caption source over MT.
   */
  altCue?: { id?: string; text: string; start?: number; end?: number; language?: string } | null;
  mode: Mode;
  saveRequestKey?: number | null;
  onSaveCard: (token: string | undefined, sentence: string) => void;
  onTokenHoverChange?: (hovered: boolean) => void;
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
}: SubtitleOverlayProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [captureState, setCaptureState] = useState<'idle' | 'screenshot' | 'audio'>('idle');
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [expandedMWEs, setExpandedMWEs] = useState<Set<string>>(new Set());
  const [altExpandedKey, setAltExpandedKey] = useState<string | null>(null);
  const [savedTokens, setSavedTokens] = useState<Set<string>>(new Set());
  // Tier 1.1: free-form multi-word selection. Indices into the `tokens`
  // array; the span is inclusive `[start..=end]` and may include
  // whitespace / punctuation tokens which we trim out when saving.
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  // Ref for the in-flight drag anchor (which token mousedown originated on).
  // Kept out of state so we don't trigger re-renders on every mousemove.
  const dragAnchorRef = useRef<number | null>(null);

  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wordHoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoveredKeyRef = useRef<string | null>(null);

  useEffect(() => {
    hoveredKeyRef.current = hoveredKey;
  }, [hoveredKey]);

  // Notify parent (App) so it can pause/resume the underlying <video>. We
  // pause whenever ANY part of the subtitle box is hovered — not just when a
  // dictionary token gets focus — so "hover sobre el subtítulo" pauses the
  // video even on platforms (e.g. YouTube) where most tokens are tagged
  // `unknown` and don't fire `handleTokenEnter`.
  useEffect(() => {
    onTokenHoverChange?.(isHovered || hoveredKey !== null);
  }, [isHovered, hoveredKey, onTokenHoverChange]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key !== 'Alt') return;
      e.preventDefault();
      const hk = hoveredKeyRef.current;
      if (hk && lookupDictionary(hk)?.type === 'phrase') setAltExpandedKey(hk);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== 'Alt' && e.altKey) return;
      if (e.key === 'Alt') e.preventDefault();
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
    if (!showDualSubtitle) {
      setTranslatedSentence(null);
      return;
    }
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
    const t = setTimeout(() => {
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
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [targetSentence, cueLanguage, nativeLanguage, showDualSubtitle, nativeAltText]);

  // Final string shown on the bilingual line.
  const dualCaptionText = nativeAltText ?? translatedSentence;
  // Tag the bilingual line so the user can tell at a glance whether it came
  // from the platform or from MT — useful when debugging quality issues.
  const dualCaptionSource: 'native' | 'mt' | null = nativeAltText
    ? 'native'
    : translatedSentence
      ? 'mt'
      : null;

  const tokens = useMemo(
    () => tokenizeSentence(targetSentence, effectiveExpanded, cueLanguage),
    [targetSentence, effectiveExpanded, cueLanguage],
  );

  // Reset cue-scoped UI state whenever the cue changes.
  useEffect(() => {
    setHoveredKey(null);
    setHoveredIdx(null);
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

  const handleTokenEnter = (key: string, idx: number) => {
    if (wordHoverTimeout.current) clearTimeout(wordHoverTimeout.current);
    setHoveredKey(key);
    setHoveredIdx(idx);
  };
  const handleTokenLeave = () => {
    wordHoverTimeout.current = setTimeout(() => {
      setHoveredKey(null);
      setHoveredIdx(null);
    }, 180);
  };

  /**
   * Tier 1.1: compute the trimmed span text from the current selection. Used
   * both by the floating "Guardar selección" button and by the Ctrl+S
   * handler. Joins raw `text` fields (which preserve original capitalisation
   * + internal spacing) and trims leading/trailing whitespace + punctuation.
   */
  const selectionText = useMemo(() => {
    if (!selection) return null;
    const slice = tokens.slice(selection.start, selection.end + 1);
    const joined = slice.map((t) => t.text).join('').trim();
    if (!joined) return null;
    // Trim trailing punctuation runs (comma, period, semicolon, !, ?) so the
    // saved card uses "thinking about you" not "thinking about you,".
    return joined.replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '');
  }, [selection, tokens]);

  /**
   * Tier 1.1: shift+click / drag selection started on a token. Plain click
   * starts a fresh drag; shift+click extends the existing selection.
   */
  const handleTokenMouseDown = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.shiftKey && selection) {
      const newStart = Math.min(selection.start, idx);
      const newEnd = Math.max(selection.end, idx);
      setSelection({ start: newStart, end: newEnd });
      // Anchor the next drag at the far end so dragging away shrinks the
      // selection the natural way.
      dragAnchorRef.current = idx === newStart ? newEnd : newStart;
      return;
    }
    dragAnchorRef.current = idx;
    // Plain click resets the existing span. The drag below will recreate it
    // if the user actually moves to a different token.
    setSelection(null);
  };

  /**
   * Tier 1.1: while a drag is in flight, hovering a different token expands
   * the selection to cover both anchor + current token.
   */
  const handleTokenDragEnter = (idx: number) => {
    const anchor = dragAnchorRef.current;
    if (anchor == null || anchor === idx) return;
    setSelection({
      start: Math.min(anchor, idx),
      end: Math.max(anchor, idx),
    });
  };

  /**
   * Tier 1.1: clicking on the subtitle background (not a token) clears any
   * active selection so the user has a natural way to "deselect".
   */
  const handleSubtitleMouseDown = (e: React.MouseEvent) => {
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
    setHoveredKey(null);
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

  // Respond to Ctrl+S / external save requests. Priority order:
  //   1. An active multi-word selection (Tier 1.1) — saves the whole span
  //      as one card.
  //   2. The hovered token — single-word card.
  //   3. Fallback: save the entire sentence.
  useEffect(() => {
    if (saveRequestKey == null) return;
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
  }, [saveRequestKey, cueLanguage, handleSaveToken, targetSentence, selectionText]);

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

  const verticalPercent =
    subtitleStyles.verticalOffset ??
    (subtitleStyles.position === 'top' ? 15 : subtitleStyles.position === 'middle' ? 50 : 85);

  const isReading = mode === 'reading';

  return (
    <>
      {/* Extension badge + mode toggle (top-right of video) */}
      <div className="absolute top-4 right-4 z-30 flex items-center gap-1.5 pointer-events-auto">
        {expandedMWEs.size > 0 && !isReading && (
          <button
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setExpandedMWEs(new Set());
              setHoveredKey(null);
              setHoveredIdx(null);
            }}
            className="bg-amber-500/15 backdrop-blur-md text-amber-200 text-[11px] font-medium px-2 py-1 rounded-full shadow-lg flex items-center gap-1 hover:bg-amber-500/25 transition-colors border border-amber-400/30"
            title="Volver a juntar todas las expresiones"
          >
            <Link2 size={11} /> Unir expresiones
          </button>
        )}
        <button
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setMode(isReading ? 'learning' : 'reading')}
          className="group/badge w-7 h-7 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-md ring-1 ring-white/10 hover:ring-white/20 flex items-center justify-center transition-all"
          title={!isReading ? 'Kivara Lingo · Aprendizaje (clic para Lectura)' : 'Kivara Lingo · Lectura (clic para Aprendizaje)'}
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

      <div
        className="absolute inset-x-0 z-10 flex flex-col items-center px-8 transition-all duration-200"
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
        onMouseDown={handleSubtitleMouseDown}
        data-kivara-hover-zone="true"
      >
        <div className="absolute -top-14 w-full h-14 bg-transparent z-0" />

        {/* Tier 1.1: selection toolbar. Takes priority over the phrase
            toolbar whenever a multi-word selection is active. */}
        {!isReading && selectionText && (
          <div className="absolute -top-12 z-20 flex items-center gap-1 bg-indigo-900/95 backdrop-blur-sm border border-indigo-400/60 p-1 rounded-lg shadow-xl transition-all duration-200">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-indigo-200 px-2">
              Selección
            </span>
            <div className="w-px h-3.5 bg-indigo-400/40" />
            <span
              className="text-[11px] text-indigo-100 px-2 max-w-[280px] truncate"
              title={selectionText}
            >
              “{selectionText}”
            </span>
            <div className="w-px h-3.5 bg-indigo-400/40" />
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleSaveToken(selectionText);
                setSelection(null);
              }}
              className="flex items-center gap-1 bg-indigo-500 hover:bg-indigo-400 text-white text-[11px] font-medium px-2 py-1 rounded transition-colors"
              title="Guardar la selección como una sola tarjeta (Ctrl+S)"
            >
              <Quote size={11} /> Guardar selección
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelection(null);
              }}
              className="p-1 text-indigo-200 hover:text-white hover:bg-indigo-700/60 rounded transition-colors"
              title="Limpiar selección"
            >
              ✕
            </button>
          </div>
        )}

        {!isReading && !selectionText && (
          <div
            className={`absolute -top-12 z-10 flex items-center gap-1 bg-zinc-900/95 backdrop-blur-sm border border-zinc-700/60 p-1 rounded-lg shadow-xl transition-all duration-300 transform ${
              isHovered && hoveredKey === null ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0 pointer-events-none'
            }`}
          >
            <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500 px-2">Frase</span>
            <div className="w-px h-3.5 bg-zinc-700/80" />
            <button
              className="p-1.5 text-zinc-300 hover:text-white hover:bg-zinc-700/50 rounded-md transition-colors"
              title="Reproducir audio de la frase"
            >
              <Volume1 size={14} />
            </button>
            <button
              onClick={handleCopy}
              className="p-1.5 text-zinc-300 hover:text-white hover:bg-zinc-700/50 rounded-md transition-colors"
              title="Copiar texto"
            >
              {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            </button>
            <div className="w-px h-3.5 bg-zinc-700/80" />
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleSaveToken(targetSentence);
              }}
              className="flex items-center gap-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-medium px-2 py-1 rounded transition-colors"
              title="Guardar la frase completa como tarjeta"
            >
              <Quote size={11} /> Guardar frase
            </button>
            <div className="w-px h-3.5 bg-zinc-700/80" />
            <span className="text-[9px] text-zinc-500 px-2 hidden sm:flex items-center gap-1">
              <kbd className="font-sans font-semibold text-[9px] text-zinc-400 bg-zinc-800 border border-zinc-700 rounded px-1 py-px">
                Ctrl+Scroll
              </kbd>
              <span>separa expresión</span>
              <span className="text-zinc-600">·</span>
              <kbd className="font-sans font-semibold text-[9px] text-zinc-400 bg-zinc-800 border border-zinc-700 rounded px-1 py-px">
                Shift+Click
              </kbd>
              <span>selección libre</span>
            </span>
          </div>
        )}

        {!isReading && captureState !== 'idle' && (
          <div className="absolute -top-10 right-0 flex items-center gap-1 bg-zinc-900/95 border border-zinc-700/60 rounded-md px-2 py-1 text-[10px] text-zinc-200 shadow-xl">
            {captureState === 'screenshot' ? <Camera size={11} /> : <AudioLines size={11} />}
            <span>{captureState === 'screenshot' ? 'Capturando frame…' : 'Procesando audio…'}</span>
          </div>
        )}

        <div
          className="text-center rounded-md px-4 py-2 transition-all duration-300"
          style={{
            fontSize: `${subtitleStyles.fontSize}px`,
            color: subtitleStyles.color,
            backgroundColor: !isReading && isHovered ? 'rgba(0,0,0,0.8)' : backgroundColorWithOpacity,
            fontWeight: subtitleStyles.fontWeight,
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
          }}
        >
          {isReading ? (
            <span>{targetSentence}</span>
          ) : (
            <span>
              {tokens.map((tok, i) => {
                // Tier 1.1: tokens (punct + word) inside the active selection
                // get a highlight. Punct/whitespace tokens are still allowed
                // in the range so the rendered span looks contiguous.
                const isInSelection =
                  selection != null && i >= selection.start && i <= selection.end;
                if (tok.kind === 'punct') {
                  return (
                    <span
                      key={tok.key + i}
                      className={isInSelection ? 'bg-indigo-500/30' : undefined}
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
                      key={tok.key + i}
                      onMouseDown={(e) => handleTokenMouseDown(i, e)}
                      onMouseEnter={() => handleTokenDragEnter(i)}
                      className={`opacity-90 cursor-text ${
                        isInSelection ? 'bg-indigo-500/30' : ''
                      }`}
                    >
                      {tok.text}
                    </span>
                  );
                }
                const isTokHovered = hoveredIdx === i;
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
                  // Dictionary-recognised proper noun (America, NASA, Microsoft).
                  // Subtler than a regular known so it doesn't compete with
                  // vocab the learner is actually trying to study, but still
                  // interactive so the popover can show cultural context.
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
                // Tier 1.3: scroll-to-split/join now requires a modifier key
                // (Ctrl or Alt) so plain scroll always belongs to the page /
                // video. Without the modifier the wheel event passes through.
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
                    setHoveredKey(null);
                  }
                };

                // Tier 1.3: when the token is wheelable (MWE or part of an
                // expanded MWE) we hint at the gesture via the resize
                // cursor. Otherwise fall back to `cursor-help` for
                // interactive tokens so the hand stays consistent with the
                // popover affordance.
                const cursorClass = wheelable
                  ? 'cursor-ew-resize'
                  : isInteractive
                    ? 'cursor-help'
                    : '';
                // Selection highlight overrides the per-kind background so
                // the user can see exactly what they’ve selected even on
                // saved / proper-noun / phrasal tokens.
                const selectionClass = isInSelection
                  ? 'bg-indigo-500/35 ring-1 ring-indigo-300/60'
                  : '';

                return (
                  <span key={tok.key + i} className="relative inline-block">
                    <span
                      onMouseEnter={() => {
                        if (isInteractive) handleTokenEnter(tok.key, i);
                        handleTokenDragEnter(i);
                      }}
                      onMouseLeave={handleTokenLeave}
                      onMouseDown={(e) => handleTokenMouseDown(i, e)}
                      onWheel={handleWheel}
                      title={
                        wheelable
                          ? 'Ctrl+Scroll para separar / unir esta expresión'
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
                        onMouseEnter={() => handleTokenEnter(tok.key, i)}
                        onMouseLeave={handleTokenLeave}
                        token={tok.text}
                        sentence={targetSentence}
                        sourceLang={cueLanguage}
                        includeAi={includeAi}
                        kind={tok.kind}
                        mweKind={tok.mweKind}
                        lemma={tok.lemma}
                        isExpanded={expandedMWEs.has(tok.key)}
                        isSaved={isSaved}
                        parentMWE={tok.kind !== 'mwe' ? findParentMWE(tok.key) : null}
                        onToggleExpand={() => toggleExpandMWE(tok.key)}
                        onRejoinParent={(parent) => {
                          setExpandedMWEs((prev) => {
                            const n = new Set(prev);
                            n.delete(parent);
                            return n;
                          });
                          setHoveredKey(null);
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
            </span>
          )}

          {/* Dual caption — native-language translation inside the same block,
              visible only on hover (matches the mock design). Prefers the
              platform's own subtitle track over MT. */}
          {showDualSubtitle && dualCaptionText && !isReading && (
            <div
              data-kivara-hover-zone="true"
              className={`mt-2 text-[0.65em] opacity-90 transition-all duration-300 overflow-hidden ${
                isHovered ? 'max-h-20 opacity-100' : 'max-h-0 opacity-0'
              }`}
              title={
                dualCaptionSource === 'native'
                  ? 'Subtítulo nativo de la plataforma'
                  : 'Traducción automática'
              }
            >
              <span className="text-zinc-300">{dualCaptionText}</span>
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
