import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../../shared/i18n';
import { sendMessage } from 'webext-bridge/content-script';
import {
  Volume2, ChevronsLeftRight, Link2, Search, Plus, Eye, BookOpen, Check, Sparkles,
} from 'lucide-react';
import type {
  AiEnrichment,
  DictionaryEntry,
  ResolveWordResponse,
  ResolveWordStreamMsg,
  ResolveWordStreamRequest,
} from '../../shared/types';
import { formatFrequencyBand, pickFrequencyWinner } from '../../shared/frequency';
import { lookupDictionary } from '../nlp/dictionary';

interface WordPopoverProps {
  visible: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  token: string;
  /** Canonical dictionary/provider lookup key. This differs from `token`
   * for inflected forms such as `ran → run` or `looking up → look up`. */
  lookupToken?: string;
  /** The full subtitle/sentence around the token — used by AI enrichment. */
  sentence?: string;
  /** BCP-47 language tag of the source caption, defaults to "en". */
  sourceLang?: string;
  /** Whether to ask the background to invoke the AI provider on this hover. */
  includeAi?: boolean;
  kind: 'mwe' | 'known' | 'proper-noun-known' | 'unknown' | 'mastered' | 'ignored' | 'punct';
  /** Sub-type for MWE tokens (idiom vs phrasal verb). */
  mweKind?: 'idiom' | 'phrasal';
  /** Resolved lemma if the dictionary hit came from the lemmatizer. */
  lemma?: string;
  isExpanded: boolean;
  isSaved: boolean;
  parentMWE: string | null;
  /** Called when the user dismisses the card (Escape). The parent hides it. */
  onClose?: () => void;
  onToggleExpand: () => void;
  onRejoinParent: (parent: string) => void;
  onSave: (e: React.MouseEvent, token: string) => void;
}

interface ResolveState {
  /** Best-known dictionary entry for the token (local + remote merged). */
  entry: DictionaryEntry | null;
  /**
   * True from the moment we open the resolve stream until the ESSENTIAL
   * fold (translation / definition / IPA) is ready — i.e. the `local` or
   * `translation` phase with a real translation. Drives the unified body
   * skeleton; once false the card's top fold paints.
   */
  resolving: boolean;
  /**
   * True while the slower EXTRAS (synonyms / antonyms / collocations /
   * examples / etymology / VIP) are still streaming in after the essential
   * fold already painted. Drives a subtle inline "loading more" affordance
   * at the bottom of the card instead of blocking the whole popover.
   */
  enriching: boolean;
  /** True while waiting on the remote translator (entry comes from neither cache nor dict). */
  remoteLoading: boolean;
  remoteError: string | null;
  /**
   * Source / provider attribution for the translation currently shown.
   *  - 'dictionary' — came from the bundled offline JSON.
   *  - One of the TranslateProvider strings (mymemory / lingva / deepl / …)
   *    — came from a remote provider.
   *  - 'cache' — remote-sourced but served from the IndexedDB cache.
   */
  source: string | null;
  ai: AiEnrichment | null;
  /** True while waiting on the AI enrichment wave. */
  aiLoading: boolean;
  aiError: string | null;
}

const INITIAL_STATE: ResolveState = {
  entry: null,
  resolving: false,
  enriching: false,
  remoteLoading: false,
  remoteError: null,
  source: null,
  ai: null,
  aiLoading: false,
  aiError: null,
};

function useResolveWord(
  token: string,
  sentence: string,
  sourceLang: string,
  includeAi: boolean,
): ResolveState {
  const [state, setState] = useState<ResolveState>(INITIAL_STATE);

  useEffect(() => {
    // 1) Synchronous local-dict pass — gives the header its word / level /
    //    phonetic instantly. The streaming phases below then progressively
    //    fill the essential fold and the slower extras.
    const local = lookupDictionary(token, sourceLang) ?? null;
    const localTr = (local?.translation ?? '').trim();
    const localHasRealTranslation = !!local && localTr !== '' && localTr !== '—';
    setState({
      ...INITIAL_STATE,
      entry: local,
      // `resolving` drives the unified body skeleton until the essential
      // fold (translation) is known. Words already covered by the bundle
      // skip straight past it.
      resolving: !!token.trim() && !localHasRealTranslation,
      // `enriching` drives the subtle "loading more" footer while the
      // slower extras stream in after the essential fold paints.
      enriching: !!token.trim(),
      remoteLoading: !localHasRealTranslation,
      source: localHasRealTranslation ? 'dictionary' : null,
      aiLoading: includeAi,
    });
    if (!token.trim()) return;

    // 2) Open the streaming port. The SW emits phases (local → translation
    //    → enrichment → ai → done) as each is ready, so the essential
    //    fields paint in <1 s while the extras stream in without blocking.
    let port: chrome.runtime.Port | null = null;
    let closed = false;

    const adoptEntry = (
      incoming: DictionaryEntry | null,
      patch: Partial<ResolveState> = {},
    ) => {
      setState((prev) => {
        if (!incoming) return { ...prev, ...patch };
        // Always adopt the latest merged entry — each phase carries the
        // best-known entry so far (superset of the previous).
        return { ...prev, entry: incoming, ...patch };
      });
    };

    try {
      port = chrome.runtime.connect({ name: 'kvl-resolve-word' });
    } catch {
      port = null;
    }

    if (!port) {
      // Streaming unavailable (e.g. SW asleep on a cold start in some
      // builds) — fall back to the legacy one-shot message so the popover
      // still resolves.
      void (async () => {
        try {
          const resp = (await sendMessage(
            'RESOLVE_WORD',
            { token, sentence, sourceLang, includeAi },
            'background',
          )) as ResolveWordResponse;
          if (closed) return;
          const localWave = resp.waves.find((w) => w.stage === 'local');
          const aiWave = resp.waves.find((w) => w.stage === 'ai');
          setState((prev) => ({
            ...prev,
            entry: (localWave && localWave.stage === 'local' ? localWave.entry : null) ?? prev.entry,
            resolving: false,
            enriching: false,
            remoteLoading: false,
            aiLoading: false,
            ai: aiWave && aiWave.stage === 'ai' ? aiWave.data : prev.ai,
          }));
        } catch (err) {
          if (closed) return;
          setState((prev) => ({
            ...prev,
            resolving: false,
            enriching: false,
            remoteLoading: false,
            aiLoading: false,
            remoteError: prev.entry ? null : err instanceof Error ? err.message : 'unknown',
          }));
        }
      })();
      return () => {
        closed = true;
      };
    }

    port.onMessage.addListener((raw) => {
      if (closed) return;
      const msg = raw as ResolveWordStreamMsg;
      switch (msg.phase) {
        case 'local':
          adoptEntry(msg.entry, {
            // If the local entry already has a real translation, drop the
            // essential-fold skeleton immediately.
            resolving:
              !!(msg.entry && (msg.entry.translation ?? '').trim() &&
              (msg.entry.translation ?? '').trim() !== '—')
                ? false
                : true,
          });
          break;
        case 'translation':
          adoptEntry(msg.entry, {
            resolving: false,
            remoteLoading: false,
            remoteError: null,
            source: msg.cached ? 'cache' : msg.provider,
          });
          break;
        case 'enrichment':
          // Extras arrived — adopt the richer entry. Keep `enriching` true
          // until `done` (AI may still patch etymology/mnemonic).
          adoptEntry(msg.entry, { resolving: false, remoteLoading: false });
          break;
        case 'ai':
          setState((prev) => ({ ...prev, ai: msg.data, aiLoading: false, aiError: null }));
          break;
        case 'error':
          setState((prev) =>
            msg.scope === 'ai'
              ? { ...prev, aiLoading: false, aiError: msg.message }
              : {
                  ...prev,
                  remoteLoading: false,
                  // Only surface a translate error when we have nothing.
                  remoteError: prev.entry ? prev.remoteError : msg.message,
                },
          );
          break;
        case 'done':
          setState((prev) => ({
            ...prev,
            resolving: false,
            enriching: false,
            remoteLoading: false,
            aiLoading: false,
          }));
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      if (closed) return;
      setState((prev) => ({
        ...prev,
        resolving: false,
        enriching: false,
        remoteLoading: false,
        aiLoading: false,
      }));
    });

    try {
      port.postMessage({
        kind: 'resolve-word',
        token,
        sentence,
        sourceLang,
        includeAi,
      } satisfies ResolveWordStreamRequest);
    } catch {
      /* port died before first post — onDisconnect will clear flags */
    }

    return () => {
      closed = true;
      try {
        port?.disconnect();
      } catch {
        /* ignore */
      }
    };
  }, [token, sentence, sourceLang, includeAi]);

  return state;
}

export function WordPopover({
  visible,
  onMouseEnter,
  onMouseLeave,
  token,
  lookupToken,
  sentence = '',
  sourceLang = 'en',
  includeAi = false,
  kind,
  mweKind,
  lemma,
  isExpanded,
  isSaved,
  parentMWE,
  onClose,
  onToggleExpand,
  onRejoinParent,
  onSave,
}: WordPopoverProps) {
  // Keep the subtitle's surface form for the header and sentence highlight,
  // but resolve dictionaries/providers through the canonical key emitted by
  // the tokenizer. Without this, an MWE recognised as `looking up → look up`
  // was sent to every provider as `looking up`, losing its bundled entry and
  // most remote coverage.
  const canonicalToken = lookupToken ?? token;
  const resolved = useResolveWord(canonicalToken, sentence, sourceLang, includeAi);

  // Refs for layout-effect clamping. The popover is absolutely positioned
  // and centered on its anchor (the token) via `left-1/2 -translate-x-1/2`,
  // but on cues whose hovered token sits very close to the left/right edge
  // of the video, that center can put the popover off-screen. We clamp
  // it back inside the nearest `[data-popover-boundary]` container (the
  // video overlay root) and shift the bottom-arrow back so it still points
  // at the token center — same trick the Figma mock uses.
  const rootRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  // Max height for the scrollable body, computed from the space available
  // above the hovered token inside the video boundary. Long cards (VIP +
  // image + etymology) then scroll instead of overflowing off the top.
  const [bodyMaxHeight, setBodyMaxHeight] = useState<number>(420);

  useLayoutEffect(() => {
    if (!visible) return;
    const el = rootRef.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const boundary = el.closest('[data-popover-boundary]') as HTMLElement | null;
    if (!boundary) return;

    const place = () => {
      const pad = 8;
      const halfW = el.offsetWidth / 2 || 170; // width 340 / 2
      const pr = parent.getBoundingClientRect();
      const b = boundary.getBoundingClientRect();
      const centerX = pr.left + pr.width / 2;
      const popoverLeft = centerX - halfW;
      const popoverRight = centerX + halfW;
      let dx = 0;
      if (popoverRight > b.right - pad) dx = b.right - pad - popoverRight;
      else if (popoverLeft < b.left + pad) dx = b.left + pad - popoverLeft;
      el.style.marginLeft = `${dx}px`;
      if (arrowRef.current) arrowRef.current.style.marginLeft = `${-dx}px`;

      // Vertical: the popover is anchored `bottom-full` (grows upward from
      // the token). Cap the scrollable body to the room available between
      // the boundary top and the token, minus the header/footer chrome and
      // the 12px arrow gap, so a tall card scrolls instead of being clipped
      // off the top of the video.
      const spaceAbove = pr.top - b.top - pad - 12;
      // Reserve ~150px for the fixed header + action row + arrow so only the
      // middle body scrolls. Clamp to a sane min so it never collapses.
      const chrome = 150;
      const avail = Math.max(120, Math.floor(spaceAbove - chrome));
      // Never grow taller than a comfortable reading height.
      setBodyMaxHeight(Math.min(avail, 460));
    };

    place();
    // Re-place when the card's own content changes size (an image arriving,
    // a definition expanding) or when the window does — `place()` only ran on
    // mount, so a late image used to push the popover off-screen until the
    // next hover, and a window resize never re-clamped it at all.
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(() => place());
      ro.observe(el);
      ro.observe(parent);
      if (el.firstElementChild) ro.observe(el.firstElementChild as HTMLElement);
    }
    window.addEventListener('resize', place);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [visible, token, canonicalToken]);

  /**
   * Accessibility: Escape closes, Tab stays inside.
   *
   * The popover is hover-driven, so the handler on the card alone never saw a
   * key: focus sits on the page behind it, and the event did not reach this
   * tree at all. Escape is therefore also watched at `window` level while the
   * card is visible — the keyboard exit the card simply did not have — and the
   * Tab trap only engages for focus that is actually INSIDE the card (a
   * keyboard/click pointer to the card), instead of pressing on every Tab the
   * user makes anywhere on the page.
   */
  useEffect(() => {
    if (!visible) return;
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose?.();
    };
    window.addEventListener('keydown', onWindowKeyDown, true);
    return () => window.removeEventListener('keydown', onWindowKeyDown, true);
  }, [visible, onClose]);

  const handlePopoverKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Tab') return;
      const root = rootRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !root.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  if (!visible) return null;

  const meta: DictionaryEntry = resolved.entry
    ? { ...resolved.entry, token }
    : {
        token,
        type: token.includes(' ') ? 'phrase' : 'word',
        translation: resolved.remoteLoading ? '' : '—',
      };
  const isMWE = kind === 'mwe';
  const isPhrasal = isMWE && mweKind === 'phrasal';
  const isUnknown = kind === 'unknown';
  const isMastered = kind === 'mastered';

  // The card body shows the unified loading skeleton only until the
  // ESSENTIAL fold (translation / definition / IPA) is known — typically
  // <1 s, or instant for bundled words. After that the essential fields
  // paint and the slower extras (synonyms / antonyms / collocations /
  // examples / etymology) stream in under a subtle t('popover.loadingMore') footer
  // (driven by `resolved.enriching`) instead of blocking the whole card.
  const isResolving = resolved.resolving;

  // CEFR level → colour. Mirrors the Common European Framework convention
  // used by Migaku/Trancy popovers (A1 = beginner green, climbing through
  // blue / indigo / violet to C2 = rose / advanced).
  const levelClasses = (level: string | undefined): string => {
    if (!level) return '';
    switch (level.toUpperCase()) {
      case 'A1': return 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/25';
      case 'A2': return 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/25';
      case 'B1': return 'text-sky-300 bg-sky-500/10 ring-sky-500/25';
      case 'B2': return 'text-sky-300 bg-sky-500/10 ring-sky-500/25';
      case 'C1': return 'text-amber-300 bg-amber-500/10 ring-amber-500/25';
      case 'C2': return 'text-amber-300 bg-amber-500/10 ring-amber-500/25';
      default:   return 'text-zinc-300 bg-zinc-500/10 ring-zinc-500/25';
    }
  };

  // External-dictionary actions for the Definir / Buscar buttons. These used
  // to be inert placeholders; now they open useful references in a new tab.
  const headword = token.trim();
  const lookupHeadword = (resolved.entry?.token || canonicalToken).trim();
  const cleanHeadword = lookupHeadword.replace(/["'‘’“”…]/g, '');
  const defineUrl =
    sourceLang && sourceLang.startsWith('en')
      ? `https://dictionary.cambridge.org/dictionary/english-spanish/${encodeURIComponent(cleanHeadword)}`
      : `https://www.wordreference.com/${encodeURIComponent((sourceLang || 'en').slice(0, 2))}es/${encodeURIComponent(cleanHeadword)}`;
  const searchQuery = sentence
    ? `${headword} "${sentence.slice(0, 60)}"`
    : headword;
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;

  // Suppress the default focus behaviour of every popover button. By
  // default a `mousedown` on a `<button>` makes it the focused element;
  // once Kivara owns focus the streaming platforms (HBO Max, Netflix…)
  // stop seeing keyboard shortcuts. Calling `preventDefault()` on the
  // mousedown phase keeps focus exactly where it was (the page body or
  // the platform's own player root), so Space, F, K, arrows, etc. keep
  // working without any extra plumbing.
  const blockFocusSteal = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  // Release focus back to the page after any popover button click. Without
  // this the button keeps focus, and player keyboard shortcuts (Space to
  // pause, F to fullscreen, arrows to seek) get consumed by the button
  // (Space activates focused buttons by default) instead of being forwarded
  // to the underlying <video>. Calling blur() returns focus to <body>, which
  // is exactly what every streaming platform expects.
  const releaseFocus = (e: React.MouseEvent) => {
    const el = e.currentTarget as Element & { blur?: () => void };
    if (typeof el.blur === 'function') {
      try {
        el.blur();
      } catch {
        /* no-op — element may have been removed by the click handler */
      }
    }
  };

  const handleSpeak = (e: React.MouseEvent) => {
    e.stopPropagation();
    releaseFocus(e);
    // Priority chain for headword pronunciation:
    //   1. Audio URLs collected by the multi-source enrichment chain
    //      (Cambridge MP3, Oxford MP3, Forvo, Lingua Libre, Free
    //      Dictionary / Wikimedia, Google TTS fallback).
    //      Within those, prefer human-recorded sources over synthetic.
    //   2. SpeechSynthesis API (offline, browser-bundled).
    //   3. Background TTS proxy (chrome.tts).
    const audioSources = meta.audio ?? [];
    if (audioSources.length > 0) {
      // Rank: human recordings (everything except google-tts) win over
      // synthetic fallback. Inside each tier, the first entry wins.
      const ordered = [
        ...audioSources.filter((a) => a.source !== 'googleTtsFallback'),
        ...audioSources.filter((a) => a.source === 'googleTtsFallback'),
      ];
      // Pick the first URL we can play; on failure, fall through to TTS.
      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audio.src = ordered[0].url;
      audio.play().catch(() => {
        // Audio fetch / decode failed (CORS, 404, expired CDN). Drop
        // through to the speech synthesizer so the user still hears
        // something.
        try {
          if ('speechSynthesis' in window) {
            const utter = new SpeechSynthesisUtterance(cleanHeadword);
            utter.lang = sourceLang || 'en-US';
            utter.rate = 0.95;
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(utter);
          }
        } catch {
          /* swallow */
        }
      });
      return;
    }
    // First try the SpeechSynthesis API directly — it works offline and
    // doesn't need extension permissions. Fall back to the background's
    // chrome.tts fallback if the user has it disabled.
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        const utter = new SpeechSynthesisUtterance(cleanHeadword);
        utter.lang = sourceLang || 'en-US';
        utter.rate = 0.95;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utter);
        return;
      }
    } catch {
      /* fall through */
    }
    void sendMessage(
      'TTS_SPEAK',
      { text: cleanHeadword, lang: sourceLang || 'en' },
      'background',
    ).catch(() => {});
  };

  return (
    <div
      ref={rootRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onKeyDown={handlePopoverKeyDown}
      data-kivara-hover-zone="true"
      // Accessibility (audit item): the popover is a modal-ish surface that
      // steals hover for a card, so expose it as a dialog, give Escape a
      // documented way out, and trap Tab inside until it closes.
      role="dialog"
      aria-label={`${t('popover.dictionary')} — ${token}`}
      aria-modal="false"
      className="absolute left-1/2 -translate-x-1/2 bottom-full mb-3 z-30 kvl-pop-in"
      style={{
        pointerEvents: 'auto',
        textShadow: 'none',
        fontSize: '13px',
        fontWeight: 400,
        letterSpacing: 'normal',
        lineHeight: 1.4,
        color: '#ffffff',
        // Match the :host baseline font stack so the popover never falls
        // back to the host page's font (YouTube uses Roboto). Inheritance
        // is unreliable through the subtitle overlay's flex/inline-block
        // chain, so we pin it explicitly here.
        fontFamily: 'var(--kvl-font-sans)',
        textAlign: 'left',
        width: '340px',
        maxWidth: 'calc(100vw - 32px)',
        zIndex: 2147483646,
      }}
    >
      <div
        className="rounded-xl overflow-hidden text-left border"
        style={{
          backgroundColor: 'rgba(24, 24, 27, 0.95)',
          borderColor: 'rgba(82, 82, 91, 0.6)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          boxShadow:
            '0 20px 25px -5px rgba(0, 0, 0, 0.6), 0 10px 10px -5px rgba(0, 0, 0, 0.3)',
        }}
      >
        <div className="flex items-start justify-between gap-3 px-3 pt-2.5 pb-2 border-b border-zinc-800/60">
          <div className="flex items-center gap-2 min-w-0">
            <button
              tabIndex={-1}
              onMouseDown={blockFocusSteal}
              onClick={handleSpeak}
              className="w-6 h-6 rounded-full bg-indigo-500/15 hover:bg-indigo-500/25 ring-1 ring-indigo-400/30 text-indigo-300 flex items-center justify-center shrink-0 transition-colors"
              title={t('popover.playPronunciation')}
            >
              <Volume2 size={11} />
            </button>
            <div className="flex items-baseline gap-1.5 min-w-0 flex-wrap">
              <span className="text-white font-semibold text-sm leading-tight normal-case">{headword}</span>
              {isPhrasal && (
                <span className="text-[9px] font-bold uppercase tracking-wider text-sky-300 bg-sky-500/10 ring-1 ring-sky-500/25 px-1 py-px rounded shrink-0">
                  Phrasal
                </span>
              )}
              {isMWE && !isPhrasal && (
                <span className="text-[9px] font-bold uppercase tracking-wider text-amber-300 bg-amber-500/10 ring-1 ring-amber-500/25 px-1 py-px rounded shrink-0">
                  MWE
                </span>
              )}
              {isUnknown && !resolved.entry && (
                <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 bg-zinc-700/40 ring-1 ring-zinc-600/40 px-1 py-px rounded shrink-0">
                  {t('popover.noDict')}</span>
              )}
              {isMastered && (
                <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 bg-zinc-700/40 ring-1 ring-zinc-600/40 px-1 py-px rounded shrink-0">
                  Dominada
                </span>
              )}
              {lemma && lemma !== token.toLowerCase() && (
                <span className="text-[10px] text-zinc-400 normal-case" title={`Forma base: ${lemma}`}>
                  → {lemma}
                </span>
              )}
              {meta.level && (
                <span
                  className={`text-[9px] font-bold uppercase tracking-wider ring-1 px-1 py-px rounded shrink-0 ${levelClasses(meta.level)}`}
                  title={`Nivel CEFR ${meta.level.toUpperCase()}`}
                >
                  {meta.level.toUpperCase()}
                </span>
              )}
              {isSaved && (
                <span className="flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300 bg-emerald-500/10 ring-1 ring-emerald-500/25 px-1 py-px rounded shrink-0">
                  <Check size={9} strokeWidth={3} /> En tu mazo
                </span>
              )}
            </div>
          </div>
          {meta.phonetic && (
            <span className="font-mono text-[11px] text-zinc-300 bg-zinc-800/70 px-1.5 py-0.5 rounded shrink-0 leading-tight normal-case">
              {meta.phonetic}
            </span>
          )}
        </div>

        <div
          className="px-3 py-2 space-y-1.5 overflow-y-auto kvl-popover-scroll"
          style={{ maxHeight: bodyMaxHeight }}
        >
          {isResolving ? (
            /* Unified loading state — mimics the final card layout so the
               content doesn't pop in field-by-field. Mirrors the mock's
               visual language (zinc skeleton bars, same paddings). */
            <LoadingCard hasSentence={!!(sentence && sentence.trim() && sentence.trim().toLowerCase() !== headword.toLowerCase())} />
          ) : (
          <>
          {/* Wave 1+2 — translation. */}
          <div className="text-[13px] text-white leading-snug normal-case">
            {meta.translation || '—'}
          </div>
          {meta.bilingual && meta.bilingual !== meta.translation && (
            <div className="text-[11px] text-zinc-400 leading-snug normal-case">{meta.bilingual}</div>
          )}
          {meta.monolingual && (
            <div className="text-[11px] text-zinc-400 italic leading-snug border-l-2 border-zinc-700 pl-2 mt-1.5 normal-case">
              {meta.monolingual}
            </div>
          )}
          {/* Frase actual del subtítulo, con la palabra resaltada al
              estilo Inglés.com / Trancy / Language Reactor. Muestra al
              usuario en qué contexto exacto aparece la palabra para que
              la entienda en uso, no solo como entrada de diccionario.
              Solo se renderiza cuando hay una `sentence` distinta del
              propio token (cuando el usuario hover una sola palabra). */}
          {sentence && sentence.trim() && sentence.trim().toLowerCase() !== headword.toLowerCase() && (
            <div className="mt-2 text-[11px] text-zinc-200 leading-snug normal-case border-l-2 border-indigo-500/50 pl-2 bg-indigo-500/5 py-1 rounded-r">
              {renderSentenceWithHighlight(sentence, headword)}
            </div>
          )}
          {meta.examples && meta.examples.length > 0 && (
            <div className="mt-1.5 space-y-1">
              <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold">
                Ejemplos
              </div>
              {meta.examples.slice(0, 2).map((ex, i) => (
                <div
                  key={i}
                  className="text-[11px] text-zinc-300/90 leading-snug normal-case border-l-2 border-amber-700/40 pl-2"
                >
                  {renderSentenceWithHighlight(ex, headword)}
                </div>
              ))}
            </div>
          )}
          {/* Synonyms / antonyms / collocations — populated by the
              multi-source enrichment chain (Datamuse, WordNet pack,
              Cambridge / Oxford / Longman / Collins scrapes). Each
              row only renders when the corresponding field has data,
              so the popover stays compact for words with no extras. */}
          {meta.synonyms && meta.synonyms.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-baseline gap-1">
              <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold mr-1">
                {t('cards.synonyms')}</span>
              {meta.synonyms.slice(0, 8).map((s) => (
                <span
                  key={s}
                  className="text-[10.5px] text-emerald-300/90 bg-emerald-500/10 ring-1 ring-emerald-500/20 px-1.5 py-0.5 rounded normal-case"
                >
                  {s}
                </span>
              ))}
            </div>
          )}
          {meta.antonyms && meta.antonyms.length > 0 && (
            <div className="mt-1 flex flex-wrap items-baseline gap-1">
              <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold mr-1">
                {t('cards.antonyms')}</span>
              {meta.antonyms.slice(0, 6).map((s) => (
                <span
                  key={s}
                  className="text-[10.5px] text-rose-300/90 bg-rose-500/10 ring-1 ring-rose-500/20 px-1.5 py-0.5 rounded normal-case"
                >
                  {s}
                </span>
              ))}
            </div>
          )}
          {meta.collocations && meta.collocations.length > 0 && (
            <div className="mt-1 flex flex-wrap items-baseline gap-1">
              <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold mr-1">
                Combinaciones
              </span>
              {meta.collocations.slice(0, 8).map((s) => (
                <span
                  key={s}
                  className="text-[10.5px] text-indigo-300/90 bg-indigo-500/10 ring-1 ring-indigo-500/20 px-1.5 py-0.5 rounded normal-case"
                >
                  {s}
                </span>
              ))}
            </div>
          )}
          {meta.vip?.frequencyEvidence && meta.vip.frequencyEvidence.length > 0 && (() => {
            // One learner-facing band wins: spoken Longman > written
            // Longman > books-band. Same single-band contract as the Anki
            // writer — three chips with three scales teach nothing.
            const winner = pickFrequencyWinner(meta.vip.frequencyEvidence);
            if (!winner) return null;
            return (
              <div className="mt-1 flex flex-wrap items-baseline gap-1">
                <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold mr-1">
                  Frecuencia
                </span>
                <span
                  key={`${winner.source}:${winner.scale}:${winner.value}`}
                  title={`${formatSource(winner.source)} · ${winner.corpus ?? winner.scale}`}
                  className="text-[10.5px] text-sky-300/90 bg-sky-500/10 ring-1 ring-sky-500/20 px-1.5 py-0.5 rounded normal-case"
                >
                  {formatFrequencyBand(winner.scale, winner.value)}
                </span>
              </div>
            );
          })()}
          {/* VIP block — multi-source attributed extras shown only when
              the user has VIP enabled and at least one VIP source
              actually returned data. Examples carry their original
              translation pair (Reverso / Linguee / WordReference /
              SpanishDict) which is the killer feature for context
              learning. */}
          {meta.vip?.examples && meta.vip.examples.length > 0 && (
            <div className="mt-2 space-y-1">
              <div className="text-[9px] uppercase tracking-wider text-fuchsia-300/90 font-semibold">
                Ejemplos VIP
              </div>
              {meta.vip.examples.slice(0, 3).map((ex, i) => (
                <div
                  key={i}
                  className="text-[11px] text-zinc-300/90 leading-snug normal-case border-l-2 border-fuchsia-700/50 pl-2"
                >
                  <div>{renderSentenceWithHighlight(ex.text, headword)}</div>
                  {ex.translation && (
                    <div className="text-zinc-400 italic">{ex.translation}</div>
                  )}
                  <div className="text-[8.5px] text-zinc-500 uppercase tracking-wider mt-0.5">
                    {formatSource(ex.source)}
                  </div>
                </div>
              ))}
            </div>
          )}
          {meta.vip?.etymology && (
            <div className="mt-2 text-[10.5px] text-zinc-400 italic leading-snug normal-case border-l-2 border-amber-700/40 pl-2">
              <span className="text-[9px] uppercase tracking-wider text-amber-300/80 font-semibold not-italic mr-1">
                {t('cards.etymology')}</span>
              {meta.vip.etymology}
            </div>
          )}
          {meta.vip?.mnemonic && (
            <div className="mt-2 text-[10.5px] text-violet-200/90 italic leading-snug normal-case border-l-2 border-violet-700/40 pl-2 bg-violet-500/5 py-1 rounded-r">
              <span className="text-[9px] uppercase tracking-wider text-violet-300/90 font-semibold not-italic mr-1">
                {t('cards.mnemonic')}</span>
              {meta.vip.mnemonic}
            </div>
          )}
          {meta.vip?.imageUrl && (
            <img
              src={meta.vip.imageUrl}
              alt={cleanHeadword}
              className="mt-2 w-full h-24 object-cover rounded ring-1 ring-zinc-700/40"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
          {resolved.remoteError && !meta.translation && (
            <div className="text-[10px] text-rose-300/80 normal-case">
              No se pudo traducir: {resolved.remoteError}
            </div>
          )}
          {/* Provider attribution — same pattern Trancy/Language Reactor use.
              Helps the user understand whether they're seeing a dictionary
              entry, a free-tier API response, or a premium one. The local
              offline dictionary is the silent default — only call out
              non-trivial sources (remote providers / caches / packs). */}
          {(() => {
            const src = resolved.source ?? meta.source ?? null;
            if (!src || src === 'dictionary') return null;
            return (
              <div className="text-[9px] uppercase tracking-wider text-zinc-500 normal-case pt-0.5">
                <span className="text-zinc-600">via </span>
                {formatSource(src)}
              </div>
            );
          })()}
          {/* Streaming affordance — once the essential fold is painted but
              the slower extras (synonyms / antonyms / collocations /
              examples / etymology) are still arriving, show a subtle
              inline t('popover.loadingMoreShort') row instead of blocking the card. */}
          {resolved.enriching && (
            <div className="flex items-center gap-1.5 pt-1 text-[10px] text-zinc-500 normal-case">
              <span className="inline-flex gap-0.5" aria-hidden="true">
                <span className="w-1 h-1 rounded-full bg-indigo-400/70 animate-pulse" style={{ animationDelay: '0ms' }} />
                <span className="w-1 h-1 rounded-full bg-indigo-400/70 animate-pulse" style={{ animationDelay: '150ms' }} />
                <span className="w-1 h-1 rounded-full bg-indigo-400/70 animate-pulse" style={{ animationDelay: '300ms' }} />
              </span>
              <span>{t('popover.loadingMore')}</span>
            </div>
          )}
          </>
          )}
        </div>

        {/* Wave 3 — AI enrichment (synonyms / collocations / register). */}
        {(includeAi && (resolved.aiLoading || resolved.ai || resolved.aiError)) && (
          <div className="px-3 pb-2 pt-1 border-t border-zinc-800/60 space-y-1">
            <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-fuchsia-300/90 font-semibold">
              <Sparkles size={9} /> IA
              {resolved.ai?.cached && (
                <span className="text-[9px] text-zinc-500 normal-case">{t('popover.cacheTag')}</span>
              )}
            </div>
            {resolved.aiLoading && !resolved.ai && (
              <>
                <SkeletonLine width="90%" />
                <SkeletonLine width="60%" />
              </>
            )}
            {resolved.ai && (
              <div className="space-y-1 text-[11px] text-zinc-300 normal-case">
                {resolved.ai.synonyms.length > 0 && (
                  <div>
                    <span className="text-zinc-500">{t('popover.synonymsPrefix')}</span>
                    {resolved.ai.synonyms.join(', ')}
                  </div>
                )}
                {resolved.ai.collocations.length > 0 && (
                  <div>
                    <span className="text-zinc-500">Colocaciones: </span>
                    {resolved.ai.collocations.join(', ')}
                  </div>
                )}
                {resolved.ai.nuancedTranslation && (
                  <div>
                    <span className="text-zinc-500">Matiz: </span>
                    {resolved.ai.nuancedTranslation}
                  </div>
                )}
                {resolved.ai.register && (
                  <div>
                    <span className="text-zinc-500">Registro: </span>
                    {resolved.ai.register}
                  </div>
                )}
              </div>
            )}
            {resolved.aiError && !resolved.ai && (
              <div className="text-[10px] text-rose-300/80 normal-case">
                {t('popover.aiFailed')}{resolved.aiError}
              </div>
            )}
          </div>
        )}

        {isMWE && (
          <button
            tabIndex={-1}
            onMouseDown={blockFocusSteal}
            onClick={(e) => { e.stopPropagation(); releaseFocus(e); onToggleExpand(); }}
            className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-[10px] font-medium text-zinc-400 hover:text-indigo-300 bg-zinc-900/60 border-t border-zinc-800/60 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <ChevronsLeftRight size={10} />
              <span className="normal-case">{isExpanded ? t('popover.joinPhrase') : t('popover.splitWords')}</span>
            </span>
            <span className="flex items-center gap-1 text-[9px] text-zinc-500 normal-case">
              <span>o</span>
              <kbd className="font-sans font-semibold text-[9px] text-zinc-400 bg-zinc-800/80 border border-zinc-700 rounded px-1 py-px">scroll</kbd>
            </span>
          </button>
        )}

        {parentMWE && !isMWE && (
          <button
            tabIndex={-1}
            onMouseDown={blockFocusSteal}
            onClick={(e) => { e.stopPropagation(); releaseFocus(e); onRejoinParent(parentMWE); }}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/15 border-t border-amber-500/20 transition-colors"
          >
            <Link2 size={10} />
            <span className="normal-case">{t('popover.joinWithPre')}{parentMWE}"</span>
          </button>
        )}

        <div className="flex items-stretch border-t border-zinc-800/60 bg-zinc-900/40">
          <PopoverAction
            icon={<BookOpen size={11} />}
            label="Definir"
            href={defineUrl}
            title="Abrir en Cambridge / WordReference"
          />
          <PopoverDivider />
          <PopoverAction
            icon={<Search size={11} />}
            label="Buscar"
            href={searchUrl}
            title={t('popover.searchGoogleTitle')}
          />
          <PopoverDivider />
          {isSaved ? (
            <button
              tabIndex={-1}
              onMouseDown={blockFocusSteal}
              onClick={(e) => { e.stopPropagation(); releaseFocus(e); }}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-2 text-[11px] font-semibold text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/15 transition-colors normal-case"
              title={t('popover.alreadySaved')}
            >
              <Eye size={12} /> Ver en Anki
            </button>
          ) : (
            <button
              tabIndex={-1}
              onMouseDown={blockFocusSteal}
              onClick={(e) => { releaseFocus(e); onSave(e, canonicalToken); }}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-2 text-[11px] font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors normal-case"
            >
              <Plus size={12} /> Guardar
            </button>
          )}
        </div>
      </div>
      <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-3 h-3 rotate-45 bg-zinc-900/95 border-r border-b border-zinc-700/60" ref={arrowRef} />
      {/* Invisible bridge — fills the 12px mb-3 gap between popover and token
          so mouseleave/enter don't fire while the cursor crosses the gap.
          Events bubble up to this wrapper's onMouseEnter/Leave, keeping the
          popover open without needing a timeout. Critical for multi-line
          cues: without it, hovering a 2nd-line word puts the popover above
          the cursor's path, and crossing the gap fires mouseenter on
          1st-line tokens that physically sit underneath. */}
      <div className="absolute left-0 right-0 top-full h-3" aria-hidden="true" />
    </div>
  );
}

function SkeletonLine({ width }: { width: string }) {
  return (
    <div
      className="h-3 rounded bg-zinc-700/60 animate-pulse"
      style={{ width }}
    />
  );
}

/**
 * Unified loading skeleton for the popover body. Mirrors the final card's
 * layout (translation line, sentence block, a couple of chip rows) so the
 * content reveals all at once instead of popping in field-by-field. Uses
 * the same zinc skeleton bars as the mock's loading affordance.
 */
function LoadingCard({ hasSentence }: { hasSentence: boolean }) {
  return (
    <div className="space-y-2.5 py-0.5" aria-busy="true" aria-label="Cargando">
      {/* translation line */}
      <SkeletonLine width="60%" />
      {/* bilingual / pos line */}
      <SkeletonLine width="42%" />
      {/* sentence context block */}
      {hasSentence && (
        <div className="mt-1.5 border-l-2 border-indigo-500/30 pl-2 space-y-1.5 py-0.5">
          <SkeletonLine width="92%" />
          <SkeletonLine width="78%" />
        </div>
      )}
      {/* a chip row (synonyms/collocations placeholder) */}
      <div className="flex gap-1 pt-0.5">
        <div className="h-4 w-12 rounded bg-zinc-700/50 animate-pulse" />
        <div className="h-4 w-16 rounded bg-zinc-700/50 animate-pulse" />
        <div className="h-4 w-10 rounded bg-zinc-700/50 animate-pulse" />
      </div>
    </div>
  );
}

function PopoverAction({
  icon,
  label,
  href,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  href?: string;
  title?: string;
}) {
  const handle = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    // Drop focus immediately so player keys (Space, F, arrows…) keep
    // working when the user returns to the tab.
    try {
      e.currentTarget.blur();
    } catch {
      /* ignore */
    }
    if (href) {
      // Use chrome.runtime.sendMessage to ask the service worker to open
      // a new tab. This avoids window.open which YouTube/HBO intercept
      // and navigate in-page (breaking playback). The SW has chrome.tabs
      // access. If that fails (e.g. in dev mode without SW) fall back to
      // window.open with _blank.
      try {
        chrome.runtime.sendMessage({ type: 'OPEN_URL', url: href });
      } catch {
        window.open(href, '_blank', 'noopener,noreferrer');
      }
    }
  };
  return (
    <button
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={handle}
      title={title}
      className="flex-1 flex items-center justify-center gap-1 px-2 py-2 text-[10px] font-medium uppercase tracking-wider text-zinc-400 hover:text-indigo-300 hover:bg-zinc-800/50 transition-colors"
    >
      {icon}{label}
    </button>
  );
}

function PopoverDivider() {
  return <div className="w-px bg-zinc-800/80" />;
}

/**
 * Render a sentence with one or more occurrences of `term` highlighted in
 * indigo (matches the popover's accent palette). Case-insensitive,
 * whole-word so "tonight" doesn't also match the "ton" inside another word.
 *
 * The match is anchored on the lowercased token; the original casing of the
 * sentence is preserved in the rendered output. Multi-word terms (MWE like
 * "these days") are handled by escaping spaces in the regex.
 */
function renderSentenceWithHighlight(sentence: string, term: string): React.ReactNode {
  const cleanTerm = term.trim();
  if (!cleanTerm) return sentence;
  // Escape any regex metacharacters in the term itself.
  const escaped = cleanTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // For a multi-word MWE we accept any whitespace between the words.
  const pattern = escaped.replace(/\s+/g, '\\s+');
  let splitter: RegExp;
  let matcher: RegExp;
  try {
    splitter = new RegExp(`(${pattern})`, 'gi');
    matcher = new RegExp(`^${pattern}$`, 'i');
  } catch {
    // Defensive — shouldn't happen with the escaping above, but if the
    // regex engine ever rejects we fall back to plain text.
    return sentence;
  }
  const parts = sentence.split(splitter);
  if (parts.length === 1) return sentence;
  return parts.map((part, i) =>
    matcher.test(part) ? (
      <span
        key={i}
        className="font-semibold text-indigo-300 bg-indigo-500/15 rounded px-0.5"
      >
        {part}
      </span>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    ),
  );
}

/**
 * Human-readable provider label for the popover footer.
 * Keeps marketing-y names short so they fit on one line.
 */

function formatSource(source: string | null): string {
  if (!source) return '\u2014';
  // Yomitan packs come in as "pack:<title>" so we can show the pack name
  // without colliding with the named providers.
  if (source.startsWith('pack:')) {
    const title = source.slice(5).trim();
    return title ? `Pack: ${title}` : 'Pack';
  }
  switch (source) {
    case 'dictionary':
      return 'Diccionario offline';
    case 'cache':
      return t('popover.cache');
    case 'mymemory':
      return 'MyMemory (free)';
    case 'lingva':
      return 'Lingva (free)';
    case 'libretranslate':
      return 'LibreTranslate';
    case 'deepl':
      return 'DeepL';
    case 'google':
      return 'Google Translate';
    case 'chain':
      return 'Cadena';
    case 'offline':
      return 'Offline';
    /* Multi-source enrichment chain (Standard + VIP) */
    case 'freeDictionary':
      return 'FreeDict';
    case 'datamuse':
      return 'Datamuse';
    case 'cambridge':
      return 'Cambridge';
    case 'oxfordLearners':
      return 'Oxford';
    case 'longman':
      return 'Longman';
    case 'collins':
      return 'Collins';
    case 'merriamWebster':
      return 'Merriam-Webster';
    case 'ozdic':
      return 'Oxford Coll.';
    case 'reverso':
      return 'Reverso';
    case 'linguee':
      return 'Linguee';
    case 'wordReference':
      return 'WordReference';
    case 'spanishDict':
      return 'SpanishDict';
    case 'tatoeba':
      return 'Tatoeba';
    case 'forvo':
      return 'Forvo';
    case 'linguaLibre':
      return 'Lingua Libre';
    case 'googleTtsFallback':
      return 'Google TTS';
    case 'unsplash':
      return 'Unsplash';
    case 'pixabay':
      return 'Pixabay';
    case 'bingImages':
      return 'Bing';
    case 'openverse':
      return 'Openverse';
    case 'wikimediaCommons':
      return 'Wikimedia';
    case 'duckduckgoImages':
      return 'DuckDuckGo';
    case 'youglish':
      return 'YouGlish';
    case 'etymonline':
      return 'Etymology';
    default:
      return source;
  }
}
