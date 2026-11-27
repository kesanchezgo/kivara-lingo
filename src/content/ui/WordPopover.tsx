/**
 * Word card (fused from docs/REDESIGN-V2.md §5.1).
 *
 * The VIEW is the prototype's: header with pronunciation + badges + IPA, a
 * 340px card that flips above/below the token inside the forced boundary, the
 * same chips for synonyms / antonyms / collocations, the VIP block, the AI
 * block and the action row.
 *
 * The LOGIC is the repo's: the card mounts over the real `useResolveWord`,
 * which streams local -> translation -> enrichment -> ai phases over the
 * resolved-word port. The skeleton and the "looking up more..." dot row are
 * driven by those phases, not by timers, and the permission strip keeps the
 * webext-bridge `OPEN_SETTINGS` call and the shadow-root-safe guards.
 *
 * The word-status selector is F5. `statusSlot` is the hook point: F5 passes
 * the selector there and nothing in this file changes.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../shared/i18n';
import { sendMessage } from 'webext-bridge/content-script';
import {
  Volume2, Plus, Check, Search, BookOpen, ChevronsLeftRight, Eye, Link2, Sparkles, KeyRound, Clock,
} from '../../ui/icons';
import type {
  AiEnrichment,
  DictionaryEntry,
  ResolveWordResponse,
  ResolveWordStreamRequest,
} from '../../shared/types';
import type { StatusDetail, WordStatus } from '../../shared/study/wordStatus';
import { WordStatusSelector } from './WordStatusSelector';
import { pickFrequencyWinner } from '../../shared/frequency';
import { computePopoverPlacement } from './popover-geometry';
import { lookupDictionary } from '../nlp/dictionary';
import { openResolveWordStream } from '../resolve-word-stream';
import { FrequencyBadge, useWordRank } from './FrequencyBadge';
import { LanguageMismatchNotice } from './language-mismatch';
type CompactStatus = 'new' | 'learning' | 'known';

export interface WordPopoverProps {
  cardTheme?: 'dark' | 'light' | 'auto';
  visible: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  /** Surface form the user hovered (header + sentence highlight). */
  token: string;
  /** Canonical dictionary/provider key (`looking up` -> `look up`). */
  lookupToken?: string;
  sentence?: string;
  sourceLang?: string;
  /**
   * Point 4: the selected track is in another language than the one being
   * learned. The card shows the mismatch instead of definitions, and the
   * lookup stream is never opened — a Spanish word has no business in an
   * English dictionary.
   */
  languageMismatch?: { track: string; learning: string; platform?: string };
  includeAi?: boolean;
  kind: 'mwe' | 'known' | 'proper-noun-known' | 'unknown' | 'mastered' | 'ignored' | 'punct';
  mweKind?: 'idiom' | 'phrasal';
  lemma?: string;
  isExpanded: boolean;
  isSaved: boolean;
  /** Saved but not yet in Anki (queue arrives in F4). */
  isQueued?: boolean;
  parentMWE: string | null;
  /** Escape, from the card itself. */
  onClose?: () => void;
  onToggleExpand: () => void;
  onRejoinParent: (parent: string) => void;
  onSave: (e: React.MouseEvent, token: string, contextGloss?: string) => void;
  /** Saved token: open the Anki browser on its note (F4). */
  onSeeInAnki?: (e: React.MouseEvent) => void;
  /** Saved token: attach this scene to the existing note (F4). */
  onAddContext?: (e: React.MouseEvent) => void;
  /** F5 hook point: the status selector mounts here (full detail block). */
  statusSlot?: React.ReactNode;
  /** Prototype status block lives in the pinned footer, above the actions. */
  status?: WordStatus;
  statusDetail?: StatusDetail;
  onStatusChange?: (status: WordStatus) => void;
  onStatusClear?: () => void;
  /** Compact status state + setter kept for legacy callers. */
  wordStatus?: CompactStatus;
  onWordStatus?: (status: CompactStatus) => void;
  /**
   * Render the card through a portal into this element (the popover
   * boundary): the plate re-wraps while the card is open and an anchored
   * card would drift with it. Absent, the card renders in place.
   */
  portalContainer?: HTMLElement | null;
  /** Index of the anchor token inside the same shadow root. */
  anchorIndex?: number;
}

/* ── Resolve state (repo engine, unchanged) ─────────────────────────────── */

interface ResolveState {
  /** The LOCAL entry (packs + bundle) — the save's gloss source. */
  localEntry?: DictionaryEntry | null;
  entry: DictionaryEntry | null;
  resolving: boolean;
  enriching: boolean;
  remoteLoading: boolean;
  remoteError: string | null;
  source: string | null;
  ai: AiEnrichment | null;
  aiLoading: boolean;
  aiError: string | null;
  needsAccess: Array<{ source: string; group: string }>;
}

const INITIAL_STATE: ResolveState = {
  entry: null,
  localEntry: null,
  resolving: false,
  enriching: false,
  remoteLoading: false,
  remoteError: null,
  source: null,
  ai: null,
  aiLoading: false,
  aiError: null,
  needsAccess: [],
};

/**
 * Pointer-over-card signal for the Escape ownership test. A ref, not state:
 * the card never owns focus by default (the token does), so the pointer is
 * the reliable "is this Escape mine" signal.
 */
const usePointerOverCard = () => useRef(false);

function useResolveWord(
  token: string,
  sentence: string,
  sourceLang: string,
  includeAi: boolean,
  /** Point 4: never resolve when the track's language is not the learned one. */
  disabled = false,
): ResolveState {
  const [state, setState] = useState<ResolveState>(INITIAL_STATE);

  useEffect(() => {
    if (disabled) {
      setState(INITIAL_STATE);
      return;
    }
    const local = lookupDictionary(token, sourceLang) ?? null;
    const localTr = (local?.translation ?? '').trim();
    const localHasRealTranslation = !!local && localTr !== '' && localTr !== '—';
    setState({
      ...INITIAL_STATE,
      entry: local,
      localEntry: local,
      resolving: !!token.trim() && !localHasRealTranslation,
      enriching: !!token.trim(),
      remoteLoading: !localHasRealTranslation,
      source: localHasRealTranslation ? 'dictionary' : null,
      aiLoading: includeAi,
    });
    if (!token.trim()) return;

    let closed = false;
    let fellBack = false;

    const adoptEntry = (incoming: DictionaryEntry | null, patch: Partial<ResolveState> = {}) => {
      setState((prev) => {
        if (!incoming) return { ...prev, ...patch };
        return { ...prev, entry: incoming, ...patch };
      });
    };
    // E2E-ONLY: a synthetic enrichment that lands in BATCHES on fixed timers,
    // so the stability spec can sample a card that fills while it is open
    // (the fixture marks the page). The card starts from the LOCAL entry —
    // short — and grows twice, the way the real chain grows it. Production
    // compiles the branch out — dist-artifacts forbids the dataset marker.
    if (__E2E__ && document.documentElement.dataset.kivaraE2eBatches === '1') {
      const timers = [
        window.setTimeout(() => {
          if (closed) return;
          adoptEntry({
            ...(local ?? { token, type: 'word' as const, translation: 'marcos' }),
            monolingual: 'A rigid structure that surrounds or holds something; one of the still images a video is built from.',
            examples: ['The frames arrived this morning.', 'The video ships 24 frames per second.'],
            synonyms: ['shell', 'framework', 'border', 'setting'],
            phonetic: 'freɪmz',
            audio: [{ url: 'https://e2e-audio.kivara/framez-us.mp3', accent: 'US', source: 'e2e-audio' }],
            vip: {
              definitions: [
                { source: 'e2e-dict', text: 'A rigid structure that surrounds or holds something.' },
                { source: 'e2e-dict', text: 'One of the still images a video is built from.' },
              ],
            },
          });
        }, 1200),
        window.setTimeout(() => {
          if (closed) return;
          setState((prev) => ({
            ...prev,
            entry: prev.entry
              ? {
                  ...prev.entry,
                  vip: {
                    ...prev.entry.vip,
                    examples: [
                      { source: 'e2e-dict', text: 'The frames arrived this morning.' },
                      { source: 'e2e-dict', text: 'The video ships 24 frames per second.' },
                    ],
                    collocations: undefined,
                  },
                }
              : prev.entry,
          }));
        }, 1900),
        window.setTimeout(() => {
          if (closed) return;
          setState((prev) => ({ ...prev, resolving: false, enriching: false, remoteLoading: false, aiLoading: false }));
        }, 2600),
      ];
      return () => {
        closed = true;
        timers.forEach((t) => window.clearTimeout(t));
      };
    }
    const stream = openResolveWordStream(
      {
        kind: 'resolve-word',
        token,
        sentence,
        sourceLang,
        includeAi,
      } satisfies ResolveWordStreamRequest,
      {
        onMessage: (msg) => {
          if (closed) return;
          switch (msg.phase) {
            case 'local':
              setState((prev) => ({ ...prev, localEntry: msg.entry }));
              adoptEntry(msg.entry, {
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
                needsAccess: msg.needsAccess ?? [],
              }));
              break;
          }
        },
        onDisconnected: () => {
          setState((prev) => ({
            ...prev,
            resolving: false,
            enriching: false,
            remoteLoading: false,
            aiLoading: false,
            remoteError: prev.entry ? null : 'stream disconnected',
          }));
          void fallbackResolve();
        },
      },
    );

    async function fallbackResolve() {
      if (fellBack) return;
      fellBack = true;
      try {
        const resp = (await sendMessage(
          'RESOLVE_WORD',
          { token, sentence, sourceLang, includeAi },
          'background',
        )) as ResolveWordResponse;
        if (closed) return;
        const localWave = resp.waves.find((w) => w.stage === 'local');
        const localEntry = localWave && localWave.stage === 'local' ? localWave.entry : null;
        const aiWave = resp.waves.find((w) => w.stage === 'ai');
        setState((prev) => ({
          ...prev,
          localEntry: localEntry ?? prev.localEntry ?? null,
          entry: localEntry ?? prev.entry,
          resolving: false,
          enriching: false,
          remoteLoading: false,
          aiLoading: false,
          needsAccess: resp.needsAccess ?? [],
          ai: aiWave && aiWave.stage === 'ai' ? aiWave.data : prev.ai,
        }));
      } catch {
        if (closed) return;
        setState((prev) => ({
          ...prev,
          resolving: false,
          enriching: false,
          remoteLoading: false,
          aiLoading: false,
        }));
      }
    }

    return () => {
      closed = true;
      stream.close();
      stopPronunciation();
    };
  }, [token, sentence, sourceLang, includeAi, disabled]);

  return state;
}

/* ── Presentation helpers ───────────────────────────────────────────────── */

/*
 * Card colour semantics (same as overlay and panel):
 *   sky/orange -> word state only (mark sample)   green -> in Anki
 *   amber      -> pending / action needed         red   -> error
 *   indigo     -> interaction                     fuchsia -> enriched (AI/VIP)
 * Metadata (CEFR, type, frequency, synonyms...) stays neutral.
 */
const META_BADGE =
  'text-[11px] font-medium text-zinc-600 dark:text-zinc-300 bg-zinc-900/[0.05] dark:bg-white/[0.07] h-5 inline-flex items-center px-1.5 rounded-md shrink-0';
const META_CHIP = 'text-zinc-600 dark:text-zinc-300 bg-zinc-900/[0.05] dark:bg-white/[0.07]';

const SOURCE_LABEL: Record<string, string> = {
  mymemory: 'MyMemory', lingva: 'Lingva', libretranslate: 'LibreTranslate', deepl: 'DeepL',
  google: 'Google Translate', freeDictionary: 'FreeDict', datamuse: 'Datamuse',
  cambridge: 'Cambridge', oxfordLearners: 'Oxford', longman: 'Longman', collins: 'Dictionary.com',
  merriamWebster: 'Merriam-Webster', ozdic: 'Oxford Coll.', reverso: 'Reverso', linguee: 'Linguee',
  wordReference: 'WordReference', spanishDict: 'SpanishDict', tatoeba: 'Tatoeba', wordfreq: 'wordfreq',
};

/**
 * The SAVE gloss: the LOCAL entry's translation (packs + bundled dictionary —
 * the same source resolveContextGloss tags with), falling back to what the
 * popover displays. Placeholders never travel.
 */
export function saveGloss(
  localEntry: DictionaryEntry | null | undefined,
  displayed: string | undefined,
): string | undefined {
  const local = String(localEntry?.translation ?? '').trim();
  if (local && local !== '—') return local;
  const shown = String(displayed ?? '').trim();
  return shown && shown !== '—' ? shown : undefined;
}

/** Provider attribution. No secret ever reaches this string. */
function formatSource(source: string | null | undefined): string {
  if (!source) return '\u2014';
  if (source.startsWith('pack:')) {
    const title = source.slice(5).trim();
    return title ? `${t('popover.pack')}: ${title}` : t('popover.pack');
  }
  if (source === 'dictionary') return t('popover.offlineDict');
  if (source === 'cache') return t('popover.cache');
  if (source === 'chain') return t('popover.chain');
  if (source === 'offline') return t('popover.offlineDict');
  return SOURCE_LABEL[source] ?? source;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Highlight whole occurrences (plus inflectional suffixes on 3+ letter words). */
function renderSentenceWithHighlight(sentence: string, word: string): React.ReactNode {
  const flat = sentence.replace(/\s*\n\s*/g, ' ');
  if (!word) return flat;
  const core = escapeRegExp(word).replace(/\s+/g, '\\s+');
  const suffix = word.length >= 3 ? '\\p{L}*' : '';
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${core}${suffix})(?![\\p{L}\\p{N}])`, 'giu');
  const parts = flat.split(re);
  return parts.map((p, i) =>
    i % 2 === 1
      ? <span key={i} className="font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-500/15 rounded px-0.5">{p}</span>
      : <React.Fragment key={i}>{p}</React.Fragment>,
  );
}

function SkeletonLine({ width }: { width: string }) {
  return <div className="h-3 rounded bg-zinc-200 dark:bg-zinc-700/60 animate-pulse" style={{ width }} />;
}

function LoadingCard({ hasSentence }: { hasSentence?: boolean }) {
  return (
    <div className="space-y-2 py-0.5" aria-label={t('wp.loading')} role="status">
      <SkeletonLine width="60%" />
      <SkeletonLine width="42%" />
      {hasSentence && (
        <div className="mt-2 border-l-2 border-indigo-500/30 pl-2 py-1 space-y-1.5">
          <SkeletonLine width="92%" />
          <SkeletonLine width="78%" />
        </div>
      )}
      <div className="flex gap-1 pt-1">
        <div className="h-4 w-12 rounded bg-zinc-200 dark:bg-zinc-700/50 animate-pulse" />
        <div className="h-4 w-16 rounded bg-zinc-200 dark:bg-zinc-700/50 animate-pulse" />
        <div className="h-4 w-10 rounded bg-zinc-200 dark:bg-zinc-700/50 animate-pulse" />
      </div>
    </div>
  );
}

function ChipRow({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      <span className="text-[12px] font-medium text-zinc-500 dark:text-zinc-400 mr-1">{label}</span>
      {items.map((s) => (
        <span key={s} className={`inline-flex items-center h-5 text-[11px] font-medium px-1.5 rounded-md normal-case ${META_CHIP}`}>{s}</span>
      ))}
    </div>
  );
}

function PopoverAction({ icon, label, title, href, iconOnly }: { icon: React.ReactNode; label: string; title?: string; href?: string; iconOnly?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        // PR #170: never blur. For a keyboard user that moved the focus to
        // <body>, which closed the card and resumed the video under the
        // press of Enter; the card owns its focus lifecycle instead.
        if (!href) return;
        // The site's page can intercept window.open; the SW has chrome.tabs.
        // sendMessage rejects asynchronously (SW asleep, no receiver yet) — a
        // synchronous try/catch never sees that rejection, so the fallback
        // lives in .catch instead of a sync catch block.
        chrome.runtime
          .sendMessage({ type: 'OPEN_URL', url: href })
          .catch(() => window.open(href, '_blank', 'noopener,noreferrer'));
      }}
      title={title}
      aria-label={label}
      className={`${iconOnly ? 'w-8 shrink-0' : 'flex-1 min-w-0'} h-10 flex items-center justify-center ${iconOnly ? '' : 'gap-1.5 px-2 whitespace-nowrap'} text-[12px] font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-900/[0.04] dark:hover:bg-white/[0.04] transition-colors`}
    >
      {icon}{!iconOnly && label}
    </button>
  );
}

function PopoverDivider() {
  return <div className="w-px my-2.5 bg-zinc-900/[0.08] dark:bg-white/[0.08]" />;
}

/* ── Pronunciation chain (repo logic) ───────────────────────────────────── */

type PronunciationSource = { url: string; source?: string | null };

let activePronunciation: HTMLAudioElement | null = null;
let chainToken = 0;

function stopPronunciation(): void {
  chainToken += 1;
  const audio = activePronunciation;
  activePronunciation = null;
  try {
    audio?.pause();
  } catch {
    /* no-op */
  }
}

export function playPronunciation(ordered: PronunciationSource[], onExhausted: () => void): void {
  if (ordered.length === 0) {
    onExhausted();
    return;
  }
  stopPronunciation();
  const mine = ++chainToken;

  const attempt = (candidates: PronunciationSource[]) => {
    if (candidates.length === 0) {
      if (mine === chainToken) onExhausted();
      return;
    }
    const [head, ...rest] = candidates;
    const audio = new Audio();
    activePronunciation = audio;
    audio.src = head.url;
    // ONE advance per candidate: play()'s rejection AND the element's error
    // event (a URL blocked by the page's CSP media-src, or a dead CDN, fails
    // AFTER play() resolved) both move the chain on; the flag keeps the two
    // from double-firing.
    let advanced = false;
    const giveUp = () => {
      if (advanced || mine !== chainToken) return;
      advanced = true;
      try {
        audio.pause();
      } catch {
        /* no-op */
      }
      attempt(rest);
    };
    audio.onerror = giveUp;
    audio.play().catch(giveUp);
  };
  attempt(ordered);
}

/* ── Component ──────────────────────────────────────────────────────────── */

export function WordPopover({
  visible,
  cardTheme = 'dark',
  onMouseEnter,
  onMouseLeave,
  token,
  lookupToken,
  sentence = '',
  sourceLang = 'en',
  languageMismatch,
  includeAi = false,
  kind,
  mweKind,
  lemma,
  isExpanded,
  isSaved,
  isQueued = false,
  parentMWE,
  onClose,
  onToggleExpand,
  onRejoinParent,
  onSave,
  onSeeInAnki,
  onAddContext,
  statusSlot,
  status,
  statusDetail,
  onStatusChange,
  onStatusClear,
  portalContainer = null,
  anchorIndex,
}: WordPopoverProps) {
  const canonicalToken = lookupToken ?? token;
  const resolved = useResolveWord(canonicalToken, sentence, sourceLang, includeAi, !!languageMismatch);
  const rank = useWordRank(canonicalToken, sourceLang);
  // The card's height is capped, but the header GROWS when the badges and the
  // phonetic arrive — the body's scroll area absorbs that growth so the
  // action row stays inside the card, visible and clickable. Without this the
  // enrichment pushed the actions below the card's clip and the save click
  // landed on nothing (C2). Runs after every content batch too: the body's
  // box does not change when only its content grows, so a box observer would
  // never fire.
  const fitBodyToCap = useCallback(() => {
    const el = ref.current;
    const body = bodyRef.current;
    if (!el || !body) return;
    const cap = parseFloat(el.style.maxHeight || '') || el.offsetHeight;
    const inner = body.parentElement;
    if (!inner) return;
    // The card's scrollable bodyRef is only PART of the card's content: the
    // VIP/AI sections render between it and the action row, and they grow
    // with the enrichment too. The cap must be reduced by the CHROME — header
    // plus action bar — measured live, or the action row ends up below the
    // card's clip and the save click lands on nothing.
    //
    // The previous formula used `body.offsetTop + body.offsetHeight`, which
    // includes the body's own height: each enrichment batch re-squeezed the
    // box by another body-height and the card bounced (that bounce is why the
    // E2E `dy` assertion was deleted). The measurement below is idempotent.
    const header = inner.firstElementChild as HTMLElement | null;
    const actions = inner.lastElementChild as HTMLElement | null;
    const actionsH = actions && actions !== body ? actions.offsetHeight : 0;
    const chromeNow = (header && header !== body ? header.offsetHeight : 0) + actionsH;
    const wanted = Math.max(40, cap - chromeNow);
    if (Math.abs((parseFloat(body.style.maxHeight || '0') || 0) - wanted) > 1) {
      body.style.maxHeight = `${wanted}px`;
    }
  }, []);
  useEffect(() => {
    if (!visible) return;
    fitBodyToCap();
  }, [visible, resolved.entry, resolved.resolving, resolved.enriching, resolved.remoteLoading, resolved.aiLoading, fitBodyToCap]);




  const ref = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pointerOverCard = usePointerOverCard();
  const [placement, setPlacement] = useState<'top' | 'bottom'>('top');
  // The one decision, measured at open: chrome stays frozen for the card's
  // whole life so the reservation never depends on what has arrived.
  const geometryRef = useRef<{ chrome: number } | null>(null);
  // The hover bridge that spans the word↔card gap: hovering it counts as
  // being inside the card for the close timer.
  const bridgeRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<'top' | 'bottom'>('top');
  // The entry animation runs ONCE at mount and then the class goes away: a
  // content batch that re-rendered the card used to re-run it, and the scale
  // flash moved the header while the card was open (C2).
  const [entryAnim, setEntryAnim] = useState(true);

  // The position is decided ONCE at open, from the frame alone, and never
  // recomputed from the content: the card reserves the max height of its side
  // from the first paint, so the enrichment filling in cannot move the header
  // (C2's real cause). The card is mid-entry (scale .95) when measured, so
  // width comes from `offsetWidth`, not rects.
  useLayoutEffect(() => {
    if (!visible) {
      geometryRef.current = null;
      return;
    }
    const el = ref.current;
    if (!el) return;
    // The anchor is the token span when the card renders through the portal.
    const anchor = anchorIndex != null
      ? (el.getRootNode() as ShadowRoot | null)?.querySelector<HTMLElement>(`[data-tok-idx="${anchorIndex}"]`) ?? null
      : el.parentElement;
    const parent = anchor ?? el.parentElement;
    if (!el || !parent) return;
    const boundary = portalContainer ?? (el.closest('[data-popover-boundary]') as HTMLElement | null);
    if (!boundary) return;

    const place = () => {
      const pad = 8;
      // The word↔card gap the owner asked for: at most 8 px, bridged. Use
      // 7 so sub-pixel token drift during enrichment still measures <= 8.
      const gap = 7;
      const pr = parent.getBoundingClientRect();
      const b = boundary.getBoundingClientRect();
      // Ancestor scale (the subtitle plate can be scaled): rects are screen
      // units, offsetHeight is layout units.
      const scale = parent.offsetHeight > 0 && pr.height > 0 ? pr.height / parent.offsetHeight : 1;
      const body = bodyRef.current;
      if (!body) return;

      // The chrome (header + footer) is measured once at open; the reservation
      // then comes from the pure frame calculation, never from the content.
      if (!geometryRef.current) {
        geometryRef.current = { chrome: el.offsetHeight - body.offsetHeight };
      }
      const placement = computePopoverPlacement({
        parent: {
          top: pr.top,
          bottom: pr.bottom,
          left: pr.left,
          width: pr.width,
          height: pr.height,
          offsetHeight: parent.offsetHeight,
        },
        boundary: { top: b.top, bottom: b.bottom, left: b.left, right: b.right },
        cardWidth: el.offsetWidth || 340,
        chrome: geometryRef.current.chrome,
        scale,
        pad,
        gap,
        cardCap: 380,
      });

      // PIN the card in the boundary's own coordinate space: explicit top and
      // left (the boundary is unscaled, so screen px are local px), the CSS
      // anchor classes overridden. Whatever re-wraps in the plate from now on
      // cannot move the card.
      if (__E2E__) console.log('[kvl-e2e] place', JSON.stringify({
        pr: { l: Math.round(pr.left), t: Math.round(pr.top), w: Math.round(pr.width) },
        b: { l: Math.round(b.left), t: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) },
        cw: el.offsetWidth,
        chrome: geometryRef.current.chrome,
        left: Math.round(placement.leftEdge),
        top: Math.round(placement.topOffset),
        bodyMax: Math.round(placement.bodyMaxHeight),
      }));
      // PIN the card in the boundary's own coordinate space by its WORD-NEAR
      // edge. For a top-side card the word is below, so the BOTTOM edge is the
      // one that must never move (the action row lives there); growth/shrink
      // happens on the far/top edge. For a bottom-side card the TOP edge is
      // the near edge and stays pinned via topOffset.
      if (placement.side === 'top' && placement.bottomOffset !== undefined) {
        el.style.bottom = `${placement.bottomOffset}px`;
        el.style.top = 'auto';
      } else {
        el.style.top = `${placement.topOffset}px`;
        el.style.bottom = 'auto';
      }
      el.style.left = `${placement.leftEdge}px`;
      el.style.right = 'auto';
      el.style.transform = 'none';
      // Tailwind v4 moves translate-x utilities to the standalone 'translate'
      // property — neutralise it too or the card stays shifted half its width
      // (the owner's measured "right edge at the word's x").
      el.style.translate = 'none';
      el.style.marginLeft = '0px';
      // The card's height FOLLOWS its content up to the reservation decided at
      // open: a low-content word gets a short card, the enrichment grows it
      // inside the cap, and when the stream is done and the content is smaller
      // the card shrinks back. Crucially the WORD-NEAR edge stays pinned by
      // place() (bottom for a top-side card, top for a bottom-side card), so
      // the action row on that edge never moves — only the far edge does.
      el.style.height = 'auto';
      el.style.maxHeight = `${geometryRef.current.chrome + placement.bodyMaxHeight}px`;
      body.style.maxHeight = `${placement.bodyMaxHeight}px`;
      if (bridgeRef.current) {
        if (placement.side === 'top') {
          bridgeRef.current.style.top = '100%';
          bridgeRef.current.style.bottom = 'auto';
        } else {
          bridgeRef.current.style.bottom = '100%';
          bridgeRef.current.style.top = 'auto';
        }
        bridgeRef.current.style.left = `${placement.bridgeLeft}px`;
        bridgeRef.current.style.width = `${placement.bridgeWidth}px`;
        bridgeRef.current.style.height = `${placement.gapPx + 12}px`;
      }
      if (sideRef.current !== placement.side) {
        sideRef.current = placement.side;
        setPlacement(placement.side);
      }
    };

    place();
    let ro: ResizeObserver | null = null;
    // The card's height is capped, but the header GROWS when the badges and
    // the phonetic arrive — the body's scroll area absorbs that growth so the
    // action row stays inside the card, visible and clickable. Without this
    // the enrichment pushed the actions below the card's clip and the save
    // click landed on nothing (C2).
    const fitBody = () => {
      const body = bodyRef.current;
      const inner = body?.parentElement;
      if (!body || !inner) return;
      const cap = parseFloat(el.style.maxHeight || '') || el.offsetHeight;
      const header = inner.firstElementChild as HTMLElement | null;
      const actions = inner.lastElementChild as HTMLElement | null;
      const actionsH = actions && actions !== body ? actions.offsetHeight : 0;
      const chromeNow = (header?.offsetHeight ?? 0) + actionsH;
      const wanted = Math.max(40, cap - chromeNow);
      if (Math.abs((parseFloat(body.style.maxHeight || '0') || 0) - wanted) > 1) {
        body.style.maxHeight = `${wanted}px`;
      }
    };
    fitBody();
    let bodyRo: ResizeObserver | null = null;
    if (typeof ResizeObserver === 'function' && bodyRef.current) {
      bodyRo = new ResizeObserver(fitBody);
      const inner = bodyRef.current.parentElement;
      const header = inner?.firstElementChild;
      const actions = inner?.lastElementChild;
      if (header && header !== bodyRef.current) bodyRo.observe(header);
      if (actions && actions !== bodyRef.current) bodyRo.observe(actions);
      bodyRo.observe(bodyRef.current);
    }
    if (typeof ResizeObserver === 'function') {
      // The BOUNDARY may resize (the player changed size) — that re-clamps.
      // The card's own content growth must NOT re-place it: the observer on
      // `el` is what made the header jump while the enrichment filled in.
      ro = new ResizeObserver(place);
      ro.observe(boundary);
    }
    window.addEventListener('resize', place);
    return () => {
      ro?.disconnect();
      bodyRo?.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [visible, token, canonicalToken, anchorIndex, portalContainer]);

  // Escape in the card closes it; the overlay returns focus to the token.
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (!pointerOverCard.current) return;
      if (event.defaultPrevented) return;
      event.stopPropagation();
      event.preventDefault();
      (onClose ?? onMouseLeave)();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      pointerOverCard.current = false;
    };
  }, [visible, onClose, onMouseLeave, pointerOverCard]);

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
  const hasEntry = !!resolved.entry;
  const noDict = kind === 'unknown' && !hasEntry;
  const resolvedLemma = lemma ?? meta.lemmaOf;
  const showLemma = !!resolvedLemma && resolvedLemma !== token.toLowerCase();
  const showSentence = !!sentence.trim() && sentence.trim().toLowerCase() !== token.trim().toLowerCase();
  const source = resolved.source ?? meta.source ?? null;
  const freqWinner = meta.vip?.frequencyEvidence?.length
    ? pickFrequencyWinner(meta.vip.frequencyEvidence)
    : undefined;
  const isResolving = resolved.resolving;
  const ai = resolved.ai;

  const cleanHeadword = (resolved.entry?.token || canonicalToken).replace(/["'‘’“”...]/g, '').trim();
  const headword = token.trim();
  const defineUrl =
    sourceLang.startsWith('en')
      ? `https://dictionary.cambridge.org/dictionary/english-spanish/${encodeURIComponent(cleanHeadword)}`
      : `https://www.wordreference.com/${encodeURIComponent(sourceLang.slice(0, 2))}es/${encodeURIComponent(cleanHeadword)}`;
  const searchQuery = sentence ? `${headword} "${sentence.slice(0, 60)}"` : headword;
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;

  const handleSpeak = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    // PR #170: no blur here either — with the pointer parked away from the
    // word, Enter on this button used to send the focus to <body>, and the
    // card closed (resuming the video) mid-listen.
    const audioSources = meta.audio ?? [];
    if (audioSources.length > 0) {
      const ordered = [
        ...audioSources.filter((a) => a.source !== 'googleTtsFallback'),
        ...audioSources.filter((a) => a.source === 'googleTtsFallback'),
      ];
      playPronunciation(ordered, () => speakSynthesized(cleanHeadword, sourceLang));
      return;
    }
    speakSynthesized(cleanHeadword, sourceLang);
  };

  const card = (
    <div
      ref={ref}
      // The card is a Kivara hover zone: `overKivaraZone` resolves the pointer
      // through the root, so without this attribute a pointer resting on the
      // card read "not over Kivara" and App's resume watchdog played the video
      // in the middle of a lookup.
      data-kivara-hover-zone="true"
      onMouseEnter={() => {
        pointerOverCard.current = true;
        onMouseEnter();
      }}
      onMouseLeave={() => {
        pointerOverCard.current = false;
        onMouseLeave();
      }}
      // A keyboard user reaches the card with Tab, and that arrives as FOCUS,
      // not as a pointer: the session must start (and stay) alive exactly as it
      // does for a hand.
      onFocusCapture={() => {
        pointerOverCard.current = true;
        onMouseEnter();
      }}
      // ...and it only ends when focus leaves the card AND the word it belongs
      // to: the card is portaled NEXT TO the word's wrapper, not inside it, so
      // a single `contains` cannot answer that.
      onBlur={(e) => {
        const root = e.currentTarget.getRootNode() as ParentNode;
        // Who holds the focus NOW: `relatedTarget` is the answer in Chromium,
        // but a focusout can arrive without it (focus sent to <body>), so ask
        // the document as well instead of guessing that the user left.
        const related = (e.relatedTarget as Node | null)
          ?? (root as Document).activeElement
          ?? null;
        if (related && e.currentTarget.contains(related)) return;
        const anchor = anchorIndex != null
          ? root.querySelector?.(`[data-tok-idx="${anchorIndex}"]`) ?? null
          : null;
        if (related && anchor && (anchor === related || anchor.contains(related))) return;
        pointerOverCard.current = false;
        onMouseLeave();
      }}
      role="dialog"
      onAnimationEnd={(e) => { if (e.target === e.currentTarget) setEntryAnim(false); }}
      aria-modal="false"
      aria-label={`${t('popover.dictionaryLabel')} — ${token}`}
      className={`kvl-ui ${entryAnim ? 'kvl-fade-in ' : ''}${cardTheme === 'auto' ? '' : cardTheme + ' '}pointer-events-auto absolute left-1/2 -translate-x-1/2 w-[340px] z-[40] ${
        // Only the OUTER placement mirrors. The 7px word↔card gap is pinned
        // imperatively by place() (measured against the token, bridged), so
        // the mock's mt-3/mb-3 margin would double it.
        placement === 'top' ? 'bottom-full slide-in-from-bottom-1' : 'top-full slide-in-from-top-1'
      }`}
      style={{
        pointerEvents: 'auto',
        textShadow: 'none',
        fontSize: '13px',
        fontWeight: 400,
        letterSpacing: 'normal',
        lineHeight: 1.4,
        whiteSpace: 'normal',
      }}
    >
      <div className="flex flex-col bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl ring-1 ring-zinc-900/[0.08] dark:ring-white/[0.08] rounded-xl shadow-[0_12px_32px_-8px_rgba(0,0,0,.5)] overflow-hidden text-left text-zinc-900 dark:text-white">
        {/* Header — text only. Every clickable control lives in the pinned
            edge action bar below/above so nothing here drifts as content lands. */}
        <div className="flex items-start justify-between gap-3 px-3.5 pt-3 pb-2.5 border-b border-zinc-900/[0.06] dark:border-white/[0.06]">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={handleSpeak}
              title={t('popover.playPronunciation')}
              aria-label={t('popover.playPronunciation')}
              className="w-7 h-7 rounded-lg bg-indigo-400/[0.12] hover:bg-indigo-400/[0.2] text-indigo-700 dark:text-indigo-300 flex items-center justify-center shrink-0 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
            >
              <Volume2 size={14} />
            </button>
          <div className="flex items-baseline gap-1.5 min-w-0 flex-wrap">
              <span className="text-zinc-900 dark:text-white font-semibold text-[15px] tracking-[-0.01em] leading-tight normal-case">{headword}</span>
              {isPhrasal && <span className={META_BADGE}>{t('popover.phrasal')}</span>}
              {isMWE && !isPhrasal && <span className={META_BADGE}>{t('popover.mwe')}</span>}
              {noDict && <span className={META_BADGE}>{t('popover.noDict')}</span>}
              {showLemma && (
                <span
                  className="text-[11px] text-zinc-500 dark:text-zinc-400 normal-case"
                  title={t('popover.lemmaTitle', { lemma: resolvedLemma })}
                >
                  → {resolvedLemma}
                </span>
              )}
              {meta.level && (
                <span className={META_BADGE} title={t('wp.cefrLevel', { level: meta.level })}>
                  {meta.level.toUpperCase()}
                </span>
              )}
              {isSaved && (
                <span className="flex items-center gap-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 h-5 inline-flex items-center px-1.5 rounded-md shrink-0">
                  <Check size={9} weight="bold" /> {t('wp.inYourDeck')}
                </span>
              )}
              {isQueued && (
                <span className="flex items-center gap-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300 bg-amber-500/10 h-5 inline-flex items-center px-1.5 rounded-md shrink-0">
                  <Clock size={9} weight="bold" /> {t('queue.inQueue')}
                </span>
              )}
          </div>
          </div>
          {meta.phonetic && (
            <span className="font-mono text-[11px] text-zinc-600 dark:text-zinc-300 bg-zinc-900/[0.06] dark:bg-white/[0.06] ring-1 ring-zinc-900/[0.08] dark:ring-white/[0.08] h-5 inline-flex items-center px-1.5 rounded-md shrink-0 leading-tight normal-case">
              {meta.phonetic}
            </span>
          )}
        </div>

        {/* Body */}
        <div ref={bodyRef} data-kvl-card-body className="flex-1 min-h-0 px-3.5 py-2.5 space-y-1.5 overflow-y-auto kvl-scroll max-h-[420px]">
          {languageMismatch ? (
            <LanguageMismatchNotice
              track={languageMismatch.track}
              learning={languageMismatch.learning}
              platform={languageMismatch.platform}
            />
          ) : isResolving ? (
            <LoadingCard hasSentence={showSentence} />
          ) : (
            <>
              <div className="text-[13px] text-zinc-900 dark:text-white leading-snug normal-case">{meta.translation || '—'}</div>
              {meta.bilingual && meta.bilingual !== meta.translation && (
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug normal-case">{meta.bilingual}</div>
              )}
              {meta.monolingual && (
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400 italic leading-snug border-l-2 border-zinc-200 dark:border-zinc-700 pl-2 mt-1.5 normal-case">
                  {meta.monolingual}
                </div>
              )}

              {showSentence && (
                <div className="mt-2 text-[11px] text-zinc-700 dark:text-zinc-200 border-l-2 border-indigo-500/50 pl-2 bg-indigo-500/5 py-1 rounded-r normal-case">
                  {renderSentenceWithHighlight(sentence, headword)}
                </div>
              )}

              {meta.examples && meta.examples.length > 0 && (
                <div className="mt-1.5">
                  <div className="text-[12px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">{t('wp.examples')}</div>
                  <div className="space-y-1">
                    {meta.examples.slice(0, 2).map((ex, i) => (
                      <div key={i} className="text-[11px] text-zinc-600 dark:text-zinc-300/90 leading-snug border-l-2 border-zinc-900/[0.12] dark:border-white/[0.14] pl-2 normal-case">
                        {renderSentenceWithHighlight(ex, headword)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {meta.synonyms && meta.synonyms.length > 0 && (
                <ChipRow label={t('cards.synonyms')} items={meta.synonyms.slice(0, 8)} />
              )}
              {meta.antonyms && meta.antonyms.length > 0 && (
                <ChipRow label={t('cards.antonyms')} items={meta.antonyms.slice(0, 6)} />
              )}
              {meta.collocations && meta.collocations.length > 0 && (
                <ChipRow label={t('popover.combinations')} items={meta.collocations.slice(0, 8)} />
              )}

              <FrequencyBadge
                rank={rank}
                fallback={freqWinner}
                fallbackTitle={freqWinner ? `${formatSource(freqWinner.source)} · ${freqWinner.corpus ?? freqWinner.scale}` : undefined}
              />

              {meta.vip?.examples && meta.vip.examples.length > 0 && (
                <div className="mt-1.5">
                  <div className="text-[12px] font-medium text-fuchsia-700 dark:text-fuchsia-300/90 mb-1">{t('wp.vipExamples')}</div>
                  <div className="space-y-1">
                    {meta.vip.examples.slice(0, 3).map((ex, i) => (
                      <div key={i} className="border-l-2 border-fuchsia-300/50 dark:border-fuchsia-700/50 pl-2 normal-case">
                        <div className="text-[11px] text-zinc-700 dark:text-zinc-200">{renderSentenceWithHighlight(ex.text, headword)}</div>
                        {ex.translation && <div className="text-[11px] text-zinc-500 dark:text-zinc-400 italic">{ex.translation}</div>}
                        <div className="text-[11px] text-zinc-500 mt-0.5">{formatSource(ex.source)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {meta.vip?.etymology && (
                <div className="mt-1.5 text-[11px] text-zinc-600 dark:text-zinc-300 italic border-l-2 border-zinc-900/[0.12] dark:border-white/[0.14] pl-2 normal-case">
                  <span className="text-[12px] font-medium not-italic text-zinc-500 dark:text-zinc-400 mr-1">{t('cards.etymology')}</span>{meta.vip.etymology}
                </div>
              )}
              {meta.vip?.mnemonic && (
                <div className="mt-1.5 text-[11px] text-zinc-600 dark:text-zinc-300 italic border-l-2 border-zinc-900/[0.12] dark:border-white/[0.14] pl-2 normal-case">
                  <span className="text-[12px] font-medium not-italic text-zinc-500 dark:text-zinc-400 mr-1">{t('cards.mnemonic')}</span>{meta.vip.mnemonic}
                </div>
              )}

              {meta.vip?.imageUrl && (
                <img
                  src={meta.vip.imageUrl}
                  alt={headword}
                  className="mt-2 w-full h-24 object-cover rounded-md ring-1 ring-zinc-200 dark:ring-zinc-700/40"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
              )}

              {resolved.remoteError && !meta.translation && (
                <div className="text-[11px] text-rose-700 dark:text-rose-300/80 normal-case">
                  {t('wp.translateFailed')}: {resolved.remoteError}
                </div>
              )}

              {source && source !== 'dictionary' && (
                <div className="text-[11px] text-zinc-500 normal-case pt-0.5">
                  <span className="text-zinc-400 dark:text-zinc-600">{t('popover.viaPrefix')}</span>{formatSource(source)}
                </div>
              )}

              {/* Slower extras are still streaming: a subtle footer, never a
                  second skeleton over the already-painted essentials. */}
              {resolved.enriching && (
                <div className="flex items-center gap-1.5 pt-1 text-[11px] text-zinc-500 normal-case">
                  <span className="inline-flex gap-0.5" aria-hidden="true">
                    {[0, 150, 300].map((d) => (
                      <span key={d} className="w-1 h-1 rounded-full bg-indigo-400/70 animate-pulse" style={{ animationDelay: `${d}ms` }} />
                    ))}
                  </span>
                  <span>{t('popover.loadingMore')}</span>
                </div>
              )}
            </>
          )}


        {/* AI block (wave 3). Full-bleed: the negative margin cancels the
            body's padding so the border-t reaches the card edges while the
            content stays aligned with the rest of the body. */}
        {!isResolving && includeAi && (resolved.aiLoading || ai || resolved.aiError) && (
          <div data-kvl-ai-block className="-mx-3.5 px-3.5 pb-2.5 pt-2 border-t border-zinc-900/[0.06] dark:border-white/[0.06] space-y-1">
            <div className="flex items-center gap-1.5 text-[12px] font-medium text-fuchsia-700 dark:text-fuchsia-300/90">
              <Sparkles size={9} /> {t('popover.ai')}
              {ai?.cached && <span className="normal-case tracking-normal font-normal text-zinc-500">{t('popover.cacheTag')}</span>}
            </div>
            {resolved.aiLoading && !ai ? (
              <div className="space-y-1 py-0.5">
                <SkeletonLine width="90%" />
                <SkeletonLine width="60%" />
              </div>
            ) : (
              <>
                {ai?.synonyms && ai.synonyms.length > 0 && (
                  <div className="text-[11px] text-zinc-600 dark:text-zinc-300 normal-case">
                    <span className="text-zinc-500">{t('popover.synonymsPrefix')}</span>{ai.synonyms.join(', ')}
                  </div>
                )}
                {ai?.collocations && ai.collocations.length > 0 && (
                  <div className="text-[11px] text-zinc-600 dark:text-zinc-300 normal-case">
                    <span className="text-zinc-500">{t('wp.collocations')}: </span>{ai.collocations.join(', ')}
                  </div>
                )}
                {ai?.nuancedTranslation && (
                  <div className="text-[11px] text-zinc-600 dark:text-zinc-300 normal-case">
                    <span className="text-zinc-500">{t('wp.nuance')}: </span>{ai.nuancedTranslation}
                  </div>
                )}
                {ai?.register && (
                  <div className="text-[11px] text-zinc-600 dark:text-zinc-300 normal-case">
                    <span className="text-zinc-500">{t('wp.register')}: </span>{ai.register}
                  </div>
                )}
                {resolved.aiError && !ai && (
                  <div className="text-[11px] text-rose-700 dark:text-rose-300/80 normal-case">{t('popover.aiFailed')}{resolved.aiError}</div>
                )}
              </>
            )}
          </div>
        )}

        {/* Sources held back for a missing host permission: the ONE action
            that can fix them is opening the right Settings section. */}
        {resolved.needsAccess.length > 0 && (
          <button
            type="button"
            data-testid="kivara-needs-access"
            onClick={(e) => {
              e.stopPropagation();
              // PR #170: the focus stays in the card (see PopoverAction).
              void sendMessage('OPEN_SETTINGS', { section: 'perm' }, 'background').catch(() => {});
            }}
            title={resolved.needsAccess.map((n) => n.source).join(', ')}
            className="-mx-3.5 w-[calc(100%+1.75rem)] flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-200 bg-amber-500/15 hover:bg-amber-500/20 border-t border-amber-500/25 transition-colors normal-case"
          >
            <KeyRound size={10} />
            {t('popover.needsAccess')} ({resolved.needsAccess.length})
          </button>
        )}

        {/* MWE drill-down */}
        {isMWE && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
            aria-label={isExpanded ? t('popover.joinPhrase') : t('popover.splitWords')}
            className="-mx-3.5 w-[calc(100%+1.75rem)] flex items-center justify-between gap-2 px-3 py-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-indigo-700 dark:hover:text-indigo-300 bg-white/60 dark:bg-zinc-900/60 border-t border-zinc-900/[0.06] dark:border-white/[0.06] transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <ChevronsLeftRight size={10} />
              <span className="normal-case">{isExpanded ? t('popover.joinPhrase') : t('popover.splitWords')}</span>
            </span>
            <span aria-hidden="true" className="flex items-center gap-1 text-[11px] text-zinc-500 normal-case">
              <span>{t('popover.or')}</span>
              <kbd className="inline-flex items-center h-5 px-1.5 rounded-md font-sans text-[11px] font-medium leading-none text-zinc-600 dark:text-zinc-300 bg-zinc-900/[0.06] dark:bg-white/[0.06] ring-1 ring-zinc-900/[0.08] dark:ring-white/[0.08]">{t('ovl.kbdAltScroll')}</kbd>
            </span>
          </button>
        )}

        {/* Rejoin the split expression this word belongs to */}
        {parentMWE && !isMWE && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRejoinParent(parentMWE); }}
            className="-mx-3.5 w-[calc(100%+1.75rem)] flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-indigo-700 dark:hover:text-indigo-300 bg-white/60 dark:bg-zinc-900/60 border-t border-zinc-900/[0.06] dark:border-white/[0.06] transition-colors"
          >
            <Link2 size={10} />
            <span className="normal-case">{t('popover.joinWith', { phrase: parentMWE })}</span>
          </button>
        )}

        {/* The full status detail block (source/reason caption) lives in the
            scroll body; the three tappable status buttons are in the pinned
            edge bar above. */}
        {statusSlot}

        </div>

        {/* Edge action bar. MOCK FIDELITY: the internal order NEVER inverts —
            Header → Body → extra blocks → Estado → Definir | Buscar | Guardar,
            top to bottom, in BOTH placements. Only the outer positioning, the
            arrow and the hover bridge mirror when the card opens downward. */}
        <div
          data-kvl-card-actions
          className="flex flex-col overflow-hidden border-t border-zinc-900/[0.06] dark:border-white/[0.06] bg-white/40 dark:bg-zinc-900/40"
        >
          {status && onStatusChange && (
            <WordStatusSelector
              token={canonicalToken}
              status={status}
              detail={statusDetail}
              isSaved={isSaved}
              onChange={onStatusChange}
              onClear={onStatusClear ?? (() => {})}
              onAddContext={isSaved && onAddContext
                ? () => onAddContext(new MouseEvent('click') as unknown as React.MouseEvent)
                : undefined}
            />
          )}
          <div className="flex items-stretch border-t border-zinc-900/[0.06] dark:border-white/[0.06]">
            <PopoverAction
              icon={<BookOpen size={13} />}
              label={t('wp.define')}
              title={t('wp.openInDictionary')}
              href={defineUrl}
            />
            <PopoverDivider />
            <PopoverAction
              icon={<Search size={13} />}
              label={t('wp.search')}
              title={t('popover.searchGoogleTitle')}
              href={searchUrl}
            />
            <PopoverDivider />
            {isSaved ? (
              <button
                type="button"
                onClick={onSeeInAnki ?? ((e) => e.stopPropagation())}
                className="flex-1 min-w-0 flex items-center justify-center gap-1.5 px-2 h-10 text-[12px] font-semibold whitespace-nowrap text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/15 transition-colors normal-case"
                title={t('popover.alreadySaved')}
              >
                <Eye size={12} /> {t('wp.seeInAnki')}
              </button>
            ) : isQueued ? (
              <button
                type="button"
                aria-disabled="true"
                onClick={(e) => e.stopPropagation()}
                className="flex-1 min-w-0 flex items-center justify-center gap-1.5 px-2 h-10 text-[12px] font-semibold whitespace-nowrap text-amber-700 dark:text-amber-300 bg-amber-500/10 cursor-default normal-case"
                title={t('queue.alreadyQueued')}
              >
                <Clock size={12} /> {t('queue.inQueue')}
              </button>
            ) : (
              <button
                type="button"
                aria-label={t('wp.save')}
                onClick={(e) => onSave(e, canonicalToken, saveGloss(resolved.localEntry, meta.translation))}
                className="flex-1 min-w-0 flex items-center justify-center gap-1.5 px-2 h-10 text-[12px] font-semibold whitespace-nowrap text-white bg-indigo-500 hover:bg-indigo-400 transition-colors normal-case"
              >
                <Plus size={12} /> {t('wp.save')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Arrow anchored to the token even when the card is clamped */}
      <div
        ref={arrowRef}
        data-kivara-hover-zone="true"
        aria-hidden="true"
        className={`absolute left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-white dark:bg-zinc-900 border-zinc-900/[0.08] dark:border-white/[0.08] ${
          placement === 'top' ? '-bottom-1.5 border-r border-b' : '-top-1.5 border-l border-t'
        }`}
      />
      {/* The word↔card hover bridge: spanning this gap counts as being
          inside the card for the close timer, so a hand that leaves the word
          towards the card never lets it close. The geometry is written
          imperatively in place() (no render race with the card's shrink). */}
      <div ref={bridgeRef} data-kivara-hover-zone="true" aria-hidden="true" style={{ position: 'absolute', pointerEvents: 'none' }} />
      {/* Invisible bridge over the 12px gap so crossing it never closes the card */}
      <div data-kivara-hover-zone="true" className={`absolute left-0 right-0 h-3 ${placement === 'top' ? 'top-full' : 'bottom-full'}`} aria-hidden="true" />
    </div>
  );
  // Through the portal the card is a child of the popover boundary: its
  // position is pinned in the boundary's own space and nothing that re-wraps
  // in the plate (dual caption, badges, marks) can move it.
  return portalContainer ? createPortal(card, portalContainer) : card;
}

export function speakSynthesized(text: string, lang: string): void {
  try {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      // An engine with ZERO voices (headless embedders, stripped Linux
      // setups) silently plays nothing: fall straight to the background TTS
      // instead of pretending to speak.
      if (window.speechSynthesis.getVoices().length === 0) {
        void sendMessage('TTS_SPEAK', { text, lang: lang || 'en' }, 'background').catch(() => {});
        return;
      }
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = lang || 'en-US';
      utter.rate = 0.95;
      // An utterance that errors mid-flight (engine crash, forbidden lang)
      // must still be heard: one fallback, guarded against double-send.
      let fellBack = false;
      utter.onerror = () => {
        if (fellBack) return;
        fellBack = true;
        void sendMessage('TTS_SPEAK', { text, lang: lang || 'en' }, 'background').catch(() => {});
      };
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
      return;
    }
  } catch {
    /* fall through */
  }
  void sendMessage('TTS_SPEAK', { text, lang: lang || 'en' }, 'background').catch(() => {});
}
