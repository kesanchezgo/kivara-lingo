import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t, currentLocale } from '../../shared/i18n';
import { createPortal } from 'react-dom';
import { Toaster, toast } from 'sonner';
import { sendMessage } from 'webext-bridge/content-script';
import { SidePanel } from './SidePanel';
import { SubtitleOverlay } from './SubtitleOverlay';
import { CaptureOverlay, type CaptureAudio, type CaptureView } from './CaptureOverlay';
import { applyCleanupCss } from './cleanup-css';
import { playSound } from '../../ui/sounds';
import { Pause } from '../../ui/icons';
import { useKivaraStore } from '../../shared/use-kivara-store';
import { captureFrame, captureBestFrame } from '../capture/frame';
import { comboFromEvent, normalizeCombo, readManifestCombos } from '../../shared/shortcuts';
import { dbgOnce } from '../../shared/debug-log';
import { getShadowRoot, overKivaraZone } from '../shadow-host';
import { PortalContainerProvider } from '../../ui/portal';
import { eventPathIsEditable } from '../utils/keyboard';
import type {
  AnkiBrowseResponse,
  AudioClipResponse,
  CreateCardKind,
  CreateCardRequest,
  CreateCardResponse,
  FieldSource,
} from '../../shared/types';
import type { SubtitleSource } from '../platform-adapters/types';
import { getActiveTrackCues, getTrackByLanguage, onTrack } from '../platform-adapters/intercepted-bus';
import { buildPreviewData } from '../../shared/preview-data';
import { buildCardTags, cardSourceFromMedia, newCardId } from '../../shared/cards';
import { buildExactNoteQuery } from '../../shared/anki-search';
import { recordCardSaved, useWordStudy, type StudyBinding } from './study';
import {
  addSceneToNote, cardKindOf, OPEN_CARDS_EVENT, showCardSaved, showCardSaveError,
  withAudioHint, type SceneMedia,
} from './save-actions';
import { useEpisode } from './useEpisode';
import { cueIndexAt, SLOW_REPLAY_RATE, useStudyPlayback } from './useStudyPlayback';
import { buildCueRequestFields } from './save-request';
import { TranscriptRail, type NativeLineCue } from './TranscriptRail';
import { focusFirstIn } from './column-focus';
import { StudyBar } from './StudyBar';
import { applyColumnsCss, computeColumnLayout, computeColumnVisibility } from './columns-css';
import { railOpenStore, railViewStore } from './ui-state';
import { useChromeLocal } from '../../ui/hooks/useChromeLocal';
import { aiConfigured } from '../../shared/ai-configured';
import { createAiPort } from './ai-port';

/**
 * Find the Anki field name (key in fieldSources) currently mapped to the
 * `frame` source. Used by the Alt+V recapture handler to patch the right
 * field on the existing note.
 */
function findFrameFieldName(
  fieldSources: Record<string, FieldSource>,
): string | undefined {
  return Object.entries(fieldSources ?? {}).find(
    ([, source]) => source === 'frame',
  )?.[0];
}

interface ActiveCue {
  id: string;
  text: string;
  start?: number;
  end?: number;
  language?: string;
}

interface AppProps {
  adapter: SubtitleSource | null;
  videoElement: HTMLVideoElement | null;
  videoOverlayRoot?: HTMLElement | null;
  /**
   * The portal container of the VIDEO shadow root (shadow-host.ts). The
   * overlay subtree is portaled out of the panel's provider scope, so it
   * re-provides this: a portal opened INSIDE the overlay (InfoHint hint,
   * dialog) must land in the video host's root — which rides with the host
   * when fullscreen-overlay-core re-parents it — not in the panel's
   * container.
   */
  videoPortalContainer?: HTMLElement | null;
}

interface SubtitleAudioAnchor {
  videoTimeAtSave?: number;
  videoPausedAtSave?: boolean;
}

async function waitForVideoTime(
  video: HTMLVideoElement,
  targetSeconds: number,
  timeoutMs: number,
): Promise<void> {
  const start = performance.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      if (video.currentTime >= targetSeconds || performance.now() - start >= timeoutMs) {
        resolve();
        return;
      }
      window.setTimeout(tick, 60);
    };
    tick();
  });
}

/**
 * Manifest commands that respect the store's `enabled` toggle.
 *
 * Module-level: the review caught `repeat_phrase` (a legacy alias of
 * `repeat_cue`) left OUT of the gate while its `case` was still in the
 * switch — a `repeat_phrase` message could seek the video with the
 * extension off. To retire the alias means deleting the `case` AND this
 * entry together.
 *
 * `toggle_panel` is intentionally exempt (Alt+K is the same click path a
 * user takes to open preferences), and `show_translation` is gated too
 * even though its case is a no-op today, so a future implementation
 * cannot bypass the toggle.
 */
const RUN_COMMAND_GATE: ReadonlySet<string> = new Set([
  'save_word', 'save_word_alt',
  'toggle_subtitles', 'repeat_cue', 'repeat_phrase',
  'recapture_frame', 'show_translation',
]);

/**
 * Build the initial SET of manifest-command combos that the in-page handler
 * must NOT re-handle (they arrive from the SW as RUN_COMMAND). Called lazily
 * once per App mount. Shares the source of truth with the shortcut editor,
 * which must refuse the same chords — see `readManifestCombos`.
 *
 * Reads BOTH `default` AND `mac` from `suggested_key`: a manifest ships
 * per-platform variants (`{ default: 'Ctrl+Shift+S', mac:
 * 'Command+Shift+S' }`). Only-default left a Mac machine with `Meta+Shift+S`
 * absent from the set during cold-start — a save could double-fire before
 * GET_COMMANDS repopulated it.
 */
function buildManifestCommandSet(): Set<string> {
  return new Set(readManifestCombos());
}

/**
 * Why the video is stopped, on the video itself (prototype parity).
 *
 * Two different pauses, two different shapes: an end-of-cue auto-pause is a
 * BUTTON that continues from the same line (`rail.pausedEnd` names Alt+R as
 * well), while a pause Kivara took to let you read a word is a passive pill —
 * it ends by itself when the lookup ends, so it must not look clickable.
 */
function StudyPausedPill({
  atCueEnd,
  lookupPaused,
  onResume,
}: {
  atCueEnd: boolean;
  lookupPaused: boolean;
  onResume: () => void;
}) {
  if (atCueEnd) {
    return (
      <button
        type="button"
        data-chrome
        onClick={onResume}
        className="pointer-events-auto absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 bg-zinc-900/75 backdrop-blur-md ring-1 ring-white/10 text-white/85 text-[11px] font-medium px-2.5 h-7 rounded-full shadow-lg hover:bg-zinc-800/80 transition-colors kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/80"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" aria-hidden="true" />
        {t('rail.pausedEnd')}
      </button>
    );
  }
  if (lookupPaused) {
    return (
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 bg-zinc-900/75 backdrop-blur-md ring-1 ring-white/10 text-white/85 text-[11px] font-medium px-2.5 h-7 rounded-full shadow-lg pointer-events-none">
        <Pause size={11} weight="fill" className="text-indigo-300" aria-hidden="true" />
        {t('ovl.paused')}
      </div>
    );
  }
  return null;
}

export function App({ adapter, videoElement, videoOverlayRoot, videoPortalContainer }: AppProps) {
  const {
    enabled,
    subtitlesVisible,
    panelOpen,
    isPopupMode,
    isDarkMode,
    mode,
    subtitleStyles,
    ankiMapping,
    cleanup,
    study,
    ai,
    setPanelOpen,
    setIsPopupMode,
    setIsDarkMode,
    setSubtitleStyles,
    setAnkiMapping,
    setSubtitlesVisible,
    setStudy,
  } = useKivaraStore();

  const [activeCue, setActiveCue] = useState<ActiveCue | null>(null);
  // Expressions split by hand (Alt+wheel or the card) — the overlay renders
  // them, App owns the state so it survives a card unmount.
  const [expandedMWEs, setExpandedMWEs] = useState<Set<string>>(new Set());
  // Real playback state, for Listen-first (blur while the line sounds).
  const [playing, setPlaying] = useState(false);
  // The capture layer's view, driven by the real save path below.
  const [captureView, setCaptureView] = useState<CaptureView | null>(null);
  const captureBusyRef = useRef(false);
  const captureClearTimer = useRef<number | null>(null);
  // Words already saved to the user's Anki deck — pre-fetched once per
  // video mount via the ANKI_SAVED_WORDS handler so subtitles show the
  // green "saved" highlight from the first frame (previously the prop
  // was never passed and every word started unsaved). Waits for the
  // persisted store to rehydrate first: reading deckName from a fresh
  // default would query the wrong (empty) deck. Results are cached per
  // deck so remounts on SPA navigation don't refetch 5000 notes.
  const [initialSavedWords, setInitialSavedWords] = useState<Set<string>>(new Set());
  const savedWordsCacheRef = useRef<Map<string, Set<string>>>(new Map());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Wait for zustand-persist rehydration: before it completes the
        // store holds defaults (empty deckName) even when the user has
        // a deck configured.
        try {
          await (useKivaraStore.persist as unknown as { rehydrate?: () => Promise<void> }).rehydrate?.();
        } catch {
          // ignore — fall through with whatever state we have
        }
        const { ankiMapping, translate } = useKivaraStore.getState();
        const activeDeck = ankiMapping.decks?.[translate.sourceLang] ?? ankiMapping.deckName;
        if (!activeDeck) return;
        const cached = savedWordsCacheRef.current.get(activeDeck);
        if (cached) {
          if (!cancelled) setInitialSavedWords(cached);
          return;
        }
        const fieldName = Object.entries(ankiMapping.fieldSources ?? {}).find(
          ([, s]) => s === 'selection',
        )?.[0] ?? 'Front';
        const response = (await sendMessage(
          'ANKI_SAVED_WORDS',
          { deckName: activeDeck, fieldName },
          'background',
        )) as { words?: string[] } | undefined;
        if (!cancelled && Array.isArray(response?.words)) {
          const next = new Set(response.words.map((w) => String(w).toLowerCase()));
          savedWordsCacheRef.current.set(activeDeck, next);
          setInitialSavedWords(next);
        }
      } catch {
        // Anki unreachable — overlay simply starts with no highlights.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [videoElement]);
  // Tier 1.2: tracks the most recently saved Anki note so the
  // `recapture_frame` hotkey can patch its frame field in-place.
  const lastSavedNoteRef = useRef<{
    noteId: number;
    fieldName: string | null;
  } | null>(null);
  // Native-language alt cue (e.g. native Spanish track running parallel to
  // the active English captions). Preferred as the dual-caption source over
  // a remote MT translation — see SubtitleOverlay for the priority chain.
  const [altCue, setAltCue] = useState<ActiveCue | null>(null);
  const [saveTick, setSaveTick] = useState<number | null>(null);
  const cueLanguageRef = useRef('en');
  // Same value as a state: the study profile follows the subtitle language, so
  // it must re-render when the track changes (the ref does not).
  const [cueLanguage, setCueLanguage] = useState('en');
  // Tracks whether we (not the user, not the platform) requested the current
  // pause. We only resume if we ourselves paused — otherwise we'd fight with
  // the platform's own buffer / focus-loss / ad-break pauses.
  const kivaraPausedRef = useRef(false);
  // Most-recent hover-change request. Used by the resume watchdog so we don't
  // resume mid-flight if a new hover starts within a couple of ms.
  const hoverRevRef = useRef(0);
  // True while the cursor is over ANY part of the Kivara overlay (subtitle
  // box, popover, hover bridge). Driven by a global capture-phase
  // `mousemove` listener so we don't depend on React's onMouseLeave chain,
  // which on platforms like HBO Max can lose track when the popover paints
  // outside the parent's bounding box.
  const cursorOverKivaraRef = useRef(false);

  // Word status + level of the profile of the SUBTITLE language (F5): watching
// English captions uses the English profile even while another language is
// configured in Settings. `profileLangOf` folds `en-US` into `en`.
  const wordStudy = useWordStudy(cueLanguage);
  // One stable binding for SubtitleOverlay: the individual resolvers are
  // already memoised, so the overlay's memo does not recompute on every render.
  const studyBinding = useMemo<StudyBinding>(() => ({
    statusOf: wordStudy.statusOf,
    detailOf: wordStudy.detailOf,
    setStatus: wordStudy.setStatus,
    inAnki: wordStudy.inAnki,
    userStatusOf: wordStudy.userStatusOf,
  }), [wordStudy.statusOf, wordStudy.detailOf, wordStudy.setStatus, wordStudy.inAnki, wordStudy.userStatusOf]);

  // ── F6: the episode boundary, the study playback and the rail ────────────
  // The full track comes from the adapter v2 (already seeked to the current
  // platform's semantics); every jump below goes through `episode.controller`.
  const episode = useEpisode(adapter);
  const studyPlayback = useStudyPlayback({
    controller: episode.controller,
    cues: episode.cues,
    video: videoElement,
    pausedByKivara: kivaraPausedRef,
    suspended: captureView !== null,
  });
  const railOpen = useChromeLocal(railOpenStore);
  const railView = useChromeLocal(railViewStore);
  // Latest study playback for the long-lived watchdog and key listeners.
  const studyPlaybackRef = useRef(studyPlayback);
  studyPlaybackRef.current = studyPlayback;
  // AI is wired to the F7 port: the explain action only appears when the user
  // configured a provider + key.
  const aiOn = aiConfigured(ai);
  const aiPort = useMemo(() => createAiPort(), []);
  // The overlay's ✦ opens the same explanation the rail renders. A tick (not
  // an index) lets the rail keep owning the open/close state, exactly as a
  // click on its own row does.
  const [explainTick, setExplainTick] = useState(0);
  const requestExplain = useCallback(() => {
    railViewStore.set('lines');
    railOpenStore.set(true);
    setExplainTick((tick) => tick + 1);
  }, []);
  // Cue under the playhead, for the rail. App re-renders when the adapter
  // publishes a new cue, so this is a cheap read, not a poll.
  const activeCueIndex = cueIndexAt(
    episode.cues,
    adapter?.getCurrentTime?.() ?? (videoElement ? videoElement.currentTime * 1000 : 0),
  );

  // ── The two columns on the right (H11/D1, #38) ──────────────────────────
  // The transcript rail and the docked panel are NEIGHBOURS: both render at
  // once (the panel no longer replaces the transcript) and the player gives up
  // the room for both. `computeColumnVisibility` owns which ones count; the
  // width math lives in columns-css.ts, the same module that injects the
  // stylesheet, so the two can't disagree.
  const columnVisibility = useMemo(
    () => computeColumnVisibility({ enabled, railOpen, panelOpen, isPopupMode }),
    [enabled, railOpen, panelOpen, isPopupMode],
  );
  const railVisible = columnVisibility.rail;
  const panelDocked = columnVisibility.panel;
  // The cap is a fraction of the viewport, so the layout has to follow its
  // width — including into and out of fullscreen (innerWidth changes there).
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === 'undefined' ? 0 : window.innerWidth,
  );
  useEffect(() => {
    const readViewport = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', readViewport);
    document.addEventListener('fullscreenchange', readViewport);
    return () => {
      window.removeEventListener('resize', readViewport);
      document.removeEventListener('fullscreenchange', readViewport);
    };
  }, []);
  const columnLayout = useMemo(
    () => computeColumnLayout(columnVisibility, viewportWidth),
    [columnVisibility, viewportWidth],
  );
  // The two columns are separate subtrees: a button in one hands the keyboard
  // to the other instead of leaving focus on the player.
  const railHostRef = useRef<HTMLDivElement>(null);
  const panelHostRef = useRef<HTMLDivElement>(null);
  const focusRail = useCallback(() => {
    requestAnimationFrame(() => focusFirstIn(railHostRef.current));
  }, []);
  const focusPanel = useCallback(() => {
    requestAnimationFrame(() => focusFirstIn(panelHostRef.current));
  }, []);
  /**
   * Jump and play through the adapter's controller. A platform that refuses
   * the seek (Netflix without its player API yet) leaves playback running
   * instead of breaking the stream — nothing is written to the element.
   */
  const seekAndPlay = useCallback(
    (timeMs: number) => {
      const controller = episode.controller;
      if (!controller) return;
      void controller
        .seek(timeMs)
        .then(() => controller.play())
        .catch(() => {});
    },
    [episode.controller],
  );
  useEffect(() => {
    applyColumnsCss({
      platform: adapter?.platform,
      state: columnVisibility,
      viewportWidth,
    });
    return () => {
      // Cleanup runs before every re-apply and on unmount. It closes both
      // columns, which removes the stylesheet — and on YouTube dispatches the
      // resize the player needs to go back to its own width.
      applyColumnsCss({
        platform: adapter?.platform,
        state: { rail: false, panel: false },
        viewportWidth,
      });
    };
  }, [columnVisibility, adapter?.platform, viewportWidth]);

  // Apply the "Limpieza visual" CSS whenever the toggles change. The CSS is
  // platform-aware (the matching selectors live in cleanup-css.ts) so the
  // same setting can hide YouTube's bottom controls *and* HBO Max's hover
  // gradients without leaking onto pages we don't recognise.
  useEffect(() => {
    if (!enabled) {
      applyCleanupCss({ hideUI: false, hideShadows: false, platform: adapter?.platform });
      return;
    }
    applyCleanupCss({
      hideUI: cleanup.hideUI,
      hideShadows: cleanup.hideShadows,
      platform: adapter?.platform,
    });
    return () => {
      applyCleanupCss({ hideUI: false, hideShadows: false, platform: adapter?.platform });
    };
  }, [cleanup.hideUI, cleanup.hideShadows, adapter?.platform, enabled]);

  // Show/hide native subtitles based on extension state. When the user
  // disables the extension or hides subtitles, restore the platform's own
  // captions so they're not left invisible.
  useEffect(() => {
    if (!adapter) return;
    if (enabled && subtitlesVisible) {
      adapter.hideNativeSubtitles();
    } else {
      adapter.showNativeSubtitles();
    }
    return () => {
      adapter.showNativeSubtitles();
    };
  }, [adapter, enabled, subtitlesVisible]);

  // E2E-ONLY: publish the clickable centers of both closed roots (video
  // overlay and panel) so the Playwright suite can click real controls with
  // the mouse. Compiled out of a production bundle with the constant branch.
  useEffect(() => {
    if (!__E2E__) return;
    let cleanup: (() => void) | undefined;
    void import('./e2e-hitmap').then(({ publishAllRoots }) => {
      cleanup = publishAllRoots();
    });
    return () => cleanup?.();
  }, []);

  // Sync dark mode on hosts + overlay root so theme.css `.dark` selector works.
  useEffect(() => {
    const mainHost = document.getElementById('kivara-lingo-host');
    // `getShadowRoot`, not `mainHost?.shadowRoot`: the root is CLOSED (so the
    // page cannot read it), so the reference is the one our mount keeps.
    const mainRoot = getShadowRoot(mainHost)?.getElementById('kivara-lingo-react-root');
    const videoHost = document.getElementById('kivara-lingo-video-host');
    const videoRoot = getShadowRoot(videoHost)?.getElementById('kivara-lingo-video-react-root');

    const elementsToUpdate = [mainHost, mainRoot, videoHost, videoRoot, videoOverlayRoot].filter(
      Boolean,
    ) as HTMLElement[];

    elementsToUpdate.forEach((el) => {
      if (isDarkMode) {
        el.classList.add('dark');
        if (el.style) el.style.colorScheme = 'dark';
      } else {
        el.classList.remove('dark');
        if (el.style) el.style.colorScheme = 'light';
      }
    });
  }, [isDarkMode, videoOverlayRoot]);

  // Listen to adapter cue changes.
  useEffect(() => {
    if (!adapter) return;
    adapter.onCueChange((cues) => {
      if (cues.length === 0) {
        setActiveCue(null);
        setAltCue(null);
        return;
      }
      const first = cues[0];
      cueLanguageRef.current = first.language || 'en';
      setCueLanguage(cueLanguageRef.current);
      setActiveCue({
        id: first.id,
        text: first.text,
        start: first.start,
        end: first.end,
        language: first.language,
      });
      // Resolve the matching native-language cue synchronously, in the
      // same React batch as the source cue, so both lines paint in the
      // same frame. The adapter's range-aware lookup picks the alt cue
      // with the MAXIMUM temporal overlap with the source range — this
      // is deterministic regardless of how the source / target tracks'
      // timestamps drift relative to each other (a common problem on
      // platforms where each language track is authored independently
      // and can lead or lag by hundreds of milliseconds).
      if (adapter.getAltCueAt) {
        const targetLang =
          useKivaraStore.getState().translate.targetLanguage || 'es';
        const lookupTime = Math.round((first.start + first.end) / 2);
        const alt = adapter.getAltCueAt(lookupTime, targetLang, {
          start: first.start,
          end: first.end,
        });
        setAltCue(
          alt
            ? {
                id: alt.id,
                text: alt.text,
                start: alt.start,
                end: alt.end,
                language: alt.language,
              }
            : null,
        );
      }
    });
    const initialCue = adapter.getActiveCue?.();
    if (initialCue) {
      cueLanguageRef.current = initialCue.language || 'en';
      setCueLanguage(cueLanguageRef.current);
      setActiveCue({
        id: initialCue.id,
        text: initialCue.text,
        start: initialCue.start,
        end: initialCue.end,
        language: initialCue.language,
      });
      if (adapter.getAltCueAt) {
        const targetLang =
          useKivaraStore.getState().translate.targetLanguage || 'es';
        const lookupTime = Math.round((initialCue.start + initialCue.end) / 2);
        const alt = adapter.getAltCueAt(lookupTime, targetLang, {
          start: initialCue.start,
          end: initialCue.end,
        });
        if (alt) {
          setAltCue({
            id: alt.id,
            text: alt.text,
            start: alt.start,
            end: alt.end,
            language: alt.language,
          });
        }
      }
    }
  }, [adapter]);

  // Prefetch translation for upcoming cues — fallback only.
  //
  // When YouTube has the user's target language available as a translated
  // track, the intercepted-bus auto-fetches the entire VTT and the
  // bilingual line resolves instantly via `getAltCueAt`. This effect is
  // a safety net for cases where YouTube does NOT support translation to
  // the user's target language (rare): it pre-translates the next ~6
  // cues via the MT chain so the bilingual line still keeps up.
  //
  // The prefetch is gated on `!getTrackByLanguage(targetLang)` so it
  // doesn't fire when we already have the translated track in memory.
  const showDualSubtitlePref = useKivaraStore((s) => s.study.translation !== 'hidden');
  useEffect(() => {
    if (!showDualSubtitlePref) return;
    if (!activeCue || activeCue.start == null) return;
    const activeStart = activeCue.start;
    const allCues = getActiveTrackCues();
    if (!allCues || allCues.length === 0) return;
    const nativeLang = (useKivaraStore.getState().translate.targetLanguage || 'es').slice(0, 2);
    const sourceLang = (cueLanguageRef.current || activeCue.language || 'en').slice(0, 2);
    if (sourceLang === nativeLang) return;
    // Skip MT prefetch when YouTube's translated track is already loaded —
    // the bilingual line will use it directly via `getAltCueAt`.
    if (getTrackByLanguage(nativeLang)) return;
    let cancelled = false;
    let activeIdx = allCues.findIndex(
      (c) => Math.abs(c.start - activeStart) < 50,
    );
    if (activeIdx < 0) {
      activeIdx = allCues.findIndex((c) => c.start >= activeStart);
      if (activeIdx < 0) return;
    }
    const upcoming = allCues.slice(activeIdx + 1, activeIdx + 7);
    if (upcoming.length === 0) return;
    let i = 0;
    const fireNext = () => {
      if (cancelled) return;
      if (i >= upcoming.length) return;
      const cue = upcoming[i];
      i += 1;
      const text = (cue.text ?? '').trim();
      if (!text) {
        fireNext();
        return;
      }
      sendMessage(
        'TRANSLATE',
        { text, sourceLang, targetLang: nativeLang },
        'background',
      ).finally(() => {
        if (cancelled) return;
        window.setTimeout(fireNext, 60);
      });
    };
    fireNext();
    return () => {
      cancelled = true;
    };
  }, [activeCue?.id, showDualSubtitlePref]);

  // Native-language alt cue poll. Runs at 20 Hz — fast enough that the
  // dual caption snaps in within the same frame as the source for most
  // users, cheap enough that even with 8 hour binges it's < 0.01% CPU.
  // The polling tick is a safety net for the synchronous resolution
  // performed in onCueChange above; it catches:
  //   - the brief window between manifest parse and track download
  //     completing (when the alt track arrives mid-cue)
  //   - users seeking to a position where the source cue boundary was
  //     missed (the polling rebuilds the alt cue from current time)
  const targetLang = useKivaraStore((s) => s.translate.targetLanguage);
  useEffect(() => {
    if (!adapter?.getAltCueAt) {
      setAltCue(null);
      return;
    }
    const lookup = adapter.getAltCueAt.bind(adapter);
    let lastId: string | null = null;
    const tick = () => {
      const time = adapter.getCurrentTime?.() ?? 0;
      // Pass the current source cue's range when available so the
      // adapter can use overlap-based lookup (deterministic across
      // timestamp drift). Falls back to point lookup when no source
      // cue is active (e.g. between cues, after a seek).
      const srcCue = activeCueRef.current;
      const range =
        srcCue?.start != null && srcCue?.end != null
          ? { start: srcCue.start, end: srcCue.end }
          : undefined;
      const next = lookup(time, targetLang, range);
      if ((next?.id ?? null) !== lastId) {
        lastId = next?.id ?? null;
        setAltCue(
          next
            ? {
                id: next.id,
                text: next.text,
                start: next.start,
                end: next.end,
                language: next.language,
              }
            : null,
        );
      }
    };
    tick();
    const handle = window.setInterval(tick, 50);
    // Also re-tick the moment a new translated track arrives in the bus —
    // otherwise the bilingual line waits up to 50 ms for the next poll
    // when the auto-translate / DASH fetch finishes mid-cue.
    const off = onTrack(() => tick());
    return () => {
      window.clearInterval(handle);
      off();
    };
    // Only the adapter and the target language. `activeCue` is read
    // through `activeCueRef` so the 20 Hz interval is CREATED ONCE per
    // mount, not recreated on every cue boundary (the old deps carried
    // `activeCue`, so Netflix/YouTube — one cue per second for the whole
    // movie — tore down and set up the interval a thousand times an
    // episode).
  }, [adapter, targetLang]);

  // The FULL native track, for the translated line under each transcript
  // sentence (F6). The bus already holds it — the same `getTrackByLanguage`
  // lookup the audio-quality fallback uses — so the rail shows every line's
  // translation, not just the active cue's. No track (or a track in the same
  // language as the subtitles) means no second line at all.
  const [nativeLines, setNativeLines] = useState<NativeLineCue[] | null>(null);
  useEffect(() => {
    const read = () => {
      const lang = (targetLang || 'es').slice(0, 2).toLowerCase();
      const source = (cueLanguageRef.current || 'en').slice(0, 2).toLowerCase();
      const track = lang === source ? null : getTrackByLanguage(lang);
      setNativeLines(
        track && track.cues.length > 0
          ? track.cues.map((cue) => ({ start: cue.start, end: cue.end, text: cue.text }))
          : null,
      );
    };
    read();
    return onTrack(read);
  }, [targetLang, cueLanguage]);

  // Pause video while the user is reading a popover; resume on leave.
  //
  // The earlier version relied on `wasPlayingRef` + a single synchronous
  // play()/pause() call, which left the video stuck paused on platforms
  // (HBO Max specifically) where the play() promise occasionally rejects
  // because the platform mutates the video element between our pause and
  // our resume. Two improvements here:
  //
  // 1) We listen to the native `play`/`pause` events on the <video>; if the
  //    user (or platform) hits play themselves we drop ownership so we
  //    never try to override their action later.
  // 2) The resume is retried (up to 3 attempts, 120 ms apart) and logs any
  //    final rejection so the bug is visible in DevTools instead of being
  //    swallowed.
  // Paused because the user is looking a word up. Mirrors what
  // `kivaraPausedRef` knows (a ref cannot drive a render) so the overlay can
  // say why the video stopped instead of reading as a dead player.
  const [lookupPaused, setLookupPaused] = useState(false);
  const handleTokenHoverChange = useCallback(
    (hovered: boolean) => {
      if (!videoElement) return;
      hoverRevRef.current += 1;
      const rev = hoverRevRef.current;
      if (hovered) {
        // "Pause while looking up" is a study preference and has no meaning in
        // Reading mode (there is no card). Any other reason the video was
        // paused stays the platform's / the user's.
        const state = useKivaraStore.getState();
        if (!state.study.pauseOnLookup || state.mode === 'reading') return;
        if (!videoElement.paused) {
          kivaraPausedRef.current = true;
          try {
            videoElement.pause();
            setLookupPaused(true);
          } catch (err) {
            console.warn('[Kivara Lingo] pause() failed', err);
            kivaraPausedRef.current = false;
            setLookupPaused(false);
          }
        }
        return;
      }
      // hovered === false → try to resume, but only if WE paused it.
      if (!kivaraPausedRef.current) return;
      let attempts = 0;
      const tryPlay = () => {
        // Bail if a new hover happened in the meantime — the user is hovering
        // a different token and we'd just yank playback out from under them.
        if (hoverRevRef.current !== rev) return;
        if (!videoElement || videoElement.paused === false) {
          kivaraPausedRef.current = false;
          return;
        }
        attempts += 1;
        const p = videoElement.play();
        if (p && typeof p.then === 'function') {
          p.then(() => {
            kivaraPausedRef.current = false;
          }).catch((err) => {
            if (attempts < 3 && hoverRevRef.current === rev) {
              setTimeout(tryPlay, 120);
            } else {
              console.warn(
                '[Kivara Lingo] could not resume video after hover',
                err,
              );
              kivaraPausedRef.current = false;
            }
          });
        } else {
          kivaraPausedRef.current = false;
        }
      };
      tryPlay();
    },
    [videoElement],
  );

  // The platform resumed on its own (or the user pressed play): the "paused
  // while you look up" pill has to go with it.
  useEffect(() => {
    if (playing) setLookupPaused(false);
  }, [playing]);

  // If the user (or the platform) starts playing the video themselves while
  // we still consider ourselves the pauser, drop ownership so a later hover
  // doesn't pause-resume on top of their action.
  useEffect(() => {
    if (!videoElement) return;
    const onUserPlay = () => {
      kivaraPausedRef.current = false;
    };
    videoElement.addEventListener('play', onUserPlay);
    return () => {
      videoElement.removeEventListener('play', onUserPlay);
    };
  }, [videoElement]);

  // Real playback state for Listen-first: the subtitle blurs while the line
  // sounds and reveals on pause or hover.
  useEffect(() => {
    if (!videoElement) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    setPlaying(!videoElement.paused);
    videoElement.addEventListener('play', onPlay);
    videoElement.addEventListener('pause', onPause);
    return () => {
      videoElement.removeEventListener('play', onPlay);
      videoElement.removeEventListener('pause', onPause);
    };
  }, [videoElement]);

  // Global mousemove watchdog. The React onMouseLeave chain works in 99% of
  // cases but on HBO Max (and any platform where the popover paints above a
  // controls layer that intercepts events) it can drop the leave event
  // entirely — leaving the video stuck paused. This watchdog is a defensive
  // net: it tracks whether the cursor is over any element marked with
  // `data-kivara-hover-zone="true"` (set on the subtitle and on each popover)
  // and, every ~350 ms, resumes the video if we ourselves paused it and the
  // cursor is no longer over any of our zones.
  useEffect(() => {
    if (!videoElement) return;

    // One call, one body: `overKivaraZone` is what production calls with a
    // page-side `document` mousemove. A CLOSED root's raw path stops at the
    // host in Chrome — measured — so the event would report "not over Kivara"
    // while the cursor is on the subtitle and the video would resume under it.
    // The resolver resolves the ONE element under the pointer coordinates
    // instead of asking whether the root contains A zone — a presence check
    // would keep the video parked on a mousemove over the (much larger)
    // overlay area outside any zone.
    const isOverKivara = overKivaraZone;

    const onMove = (e: MouseEvent) => {
      cursorOverKivaraRef.current = isOverKivara(e);
    };
    const onLeaveWindow = () => {
      cursorOverKivaraRef.current = false;
    };
    // Capture-phase mousemove so we see the event even if some descendant
    // calls stopPropagation (HBO's player wrapper sometimes does).
    document.addEventListener('mousemove', onMove, { capture: true });
    document.addEventListener('mouseleave', onLeaveWindow);
    window.addEventListener('blur', onLeaveWindow);

    const tickResume = () => {
      if (!kivaraPausedRef.current) return;
      // An auto-pause at the end of the cue is a study decision, not a stuck
      // hover: the watchdog must not undo it (F6).
      if (studyPlaybackRef.current.autoPausedRef.current) return;
      if (!videoElement) return;
      if (!videoElement.paused) {
        kivaraPausedRef.current = false;
        return;
      }
      if (cursorOverKivaraRef.current) return;
      // Stuck paused with no hover — resume.
      hoverRevRef.current += 1;
      const rev = hoverRevRef.current;
      let attempts = 0;
      const tryPlay = () => {
        if (hoverRevRef.current !== rev) return;
        if (!videoElement || !videoElement.paused) {
          kivaraPausedRef.current = false;
          return;
        }
        attempts += 1;
        const p = videoElement.play();
        if (p && typeof p.then === 'function') {
          p.then(() => {
            kivaraPausedRef.current = false;
          }).catch((err) => {
            if (attempts < 3 && hoverRevRef.current === rev) {
              setTimeout(tryPlay, 120);
            } else {
              console.warn(
                '[Kivara Lingo] watchdog could not resume video',
                err,
              );
              kivaraPausedRef.current = false;
            }
          });
        } else {
          kivaraPausedRef.current = false;
        }
      };
      tryPlay();
    };
    const interval = window.setInterval(tickResume, 350);

    return () => {
      document.removeEventListener('mousemove', onMove, { capture: true });
      document.removeEventListener('mouseleave', onLeaveWindow);
      window.removeEventListener('blur', onLeaveWindow);
      window.clearInterval(interval);
    };
  }, [videoElement]);

  // User-customisable in-page hotkeys. The chrome.commands API can't be
  // re-bound programmatically, so the combos the user edits in SettingsTab
  // live in `store.shortcuts` and are honoured HERE via a capture-phase
  // keydown listener. Manifest commands (Ctrl+Shift+S / Alt+C / Alt+R / Alt+K)
  // still arrive as RUN_COMMAND messages below.
  //
  // Double-fire guard: we compare against the LIVE bindings from
  // `chrome.runtime.getManifest().commands` (cached into
  // `manifestCombosRef` on mount, then refreshed from
  // chrome.commands.getAll() via the SW's GET_COMMANDS). A hardcoded
  // default drift decays: the manifest says `Ctrl+Shift+S`, not `Ctrl+S`,
  // `Command+S` is not a canonical token (the right one is `Meta+S`).
  // Missing `Ctrl+Shift+S` in the initial Set let a save fire twice per
  // press — once from this handler and once via SW `RUN_COMMAND`.
  const activeCueRef = useRef(activeCue);
  activeCueRef.current = activeCue;
  const videoElementRef = useRef(videoElement);
  videoElementRef.current = videoElement;
  // Initialized from the REAL manifest commands rather than a finger-typed
  // list: the text was wrong (`Command+S` is not a canonical form; the real
  // name is `Meta+S`), AND it was missing `Ctrl+Shift+S` (which IS what the
  // manifest actually ships for `save_word`). Until `GET_COMMANDS` fills
  // this — the launch of a cold SW — a stub Set used to allow Ctrl+Shift+S
  // through to the in-page handler, where the SW was ALSO receiving it via
  // `chrome.commands` → `RUN_COMMAND`. Two cards created per save.
  //
  // Read BOTH `default` and `mac`: a manifest ships per-platform variants
  // (`suggested_key: { default: 'Ctrl+Shift+S', mac: 'Command+Shift+S' }`).
  // Only-default left a Mac machine with `Meta+Shift+S` missing from the
  // Set until GET_COMMANDS filled it — a save could double-fire in the
  // cold-start window.
  //
  // Lazy init: the ref is null on first render, so the set is built once
  // and again only if a later refresh arrives empty.
  const manifestCombosRef = useRef<Set<string> | null>(null);
  if (manifestCombosRef.current === null) {
    manifestCombosRef.current = buildManifestCommandSet();
  }
  useEffect(() => {
    let cancelled = false;
    let lastFetch = 0;
    const refresh = () => {
      // focus + visibilitychange fire together — coalesce.
      const now = Date.now();
      if (now - lastFetch < 1000) return;
      lastFetch = now;
      try {
        // `chrome.commands` does NOT exist in a content-script context —
        // proxy through the SW (GET_COMMANDS) or the guard silently reverts
        // to hardcoded defaults and double-fires remapped combos.
        chrome.runtime.sendMessage({ type: 'GET_COMMANDS' }, (res) => {
          void chrome.runtime.lastError;
          if (cancelled) return;
          const cmds = (res as { ok?: boolean; commands?: Array<{ shortcut?: string }> } | undefined)?.commands;
          if (!res?.ok || !Array.isArray(cmds)) return;
          const next = new Set<string>();
          for (const c of cmds) {
            if (c.shortcut) next.add(normalizeCombo(c.shortcut));
          }
          if (next.size) manifestCombosRef.current = next;
        else if (manifestCombosRef.current !== null) manifestCombosRef.current = next;
        });
      } catch {
        // ignore — fall back to the static defaults above
      }
    };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Gated on the master `enabled` toggle from the very first line:
      // the review (#6-2) caught that the previous handler had no such
      // check, so with the extension disabled the user could still
      // trigger `repeat_cue` (seek), save-word (Ctrl+Shift+S), toggle
      // subtitles — EVERYTHING — via a keypress aimed at the page. The
      // chrome.commands path goes through RUN_COMMAND (toggle_subtitles
      // etc), but the in-page handler ALSO handled them and had no gate.
      if (!useKivaraStore.getState().enabled) return;
      // Auto-repeat and IME composition, both of which used to sneak a
      // handler through. `e.repeat` is true for every keydown after the
      // first while the user HOLDS the combo — Chrome fires them every
      // ~33 ms — so a held Ctrl+Shift+S created one card per repeat and
      // Alt+R re-seeked on each one. The manifest path does not have this
      // problem (chrome.commands fires once per press), so this was purely
      // the in-page handler's bug. `isComposing` covers the middle of a
      // dead-key or IME sequence.
      if (e.repeat || e.isComposing) return;
      // composedPath, not `e.target`: inside the panel's shadow root the
      // reported target is the host element, so a tagName check would miss
      // the input the user is typing in and fire shortcuts mid-sentence.
      if (eventPathIsEditable(e)) return;
      const combo = comboFromEvent(e);
      if (!combo) return;
      // A combo currently owned by a manifest command fires via
      // chrome.commands → RUN_COMMAND; handling it here too would double-fire.
      if (manifestCombosRef.current?.has(normalizeCombo(combo))) return;
      const map = useKivaraStore.getState().shortcuts;
      // The map is USER-CUSTOMIZED: a raw 'Ctrl+Shift+S' typed string compares
      // fine, but a user-rebound 'command+s' (mac default) or 'ctrl+ shift+k'
      // stored in the persisted state does NOT match the canonical 'Meta+S'
      // that comboFromEvent produces. Normalize BOTH sides of the check —
      // chrome.commands.getAll() is normalized already below, and the map
      // was previously compared verbatim.
      const normRecap = map.recap ? normalizeCombo(map.recap) : null;
      const normPanel = map.panel ? normalizeCombo(map.panel) : null;
      const normSave = map.save ? normalizeCombo(map.save) : null;
      const normToggle = map.toggle ? normalizeCombo(map.toggle) : null;
      const normReplay = map.replay ? normalizeCombo(map.replay) : null;
      // F6 page shortcuts. Everything below talks to the PlaybackController
      // through `studyPlayback`; no direct `currentTime` write is left in App.
      const normPrev = map.prev ? normalizeCombo(map.prev) : null;
      const normNext = map.next ? normalizeCombo(map.next) : null;
      const normReplaySlow = map.replaySlow ? normalizeCombo(map.replaySlow) : null;
      const normAutoPause = map.autoPause ? normalizeCombo(map.autoPause) : null;
      const normLoop = map.loop ? normalizeCombo(map.loop) : null;
      const normSlower = map.slower ? normalizeCombo(map.slower) : null;
      const normFaster = map.faster ? normalizeCombo(map.faster) : null;
      const normListenFirst = map.listenFirst ? normalizeCombo(map.listenFirst) : null;
      const normRail = map.rail ? normalizeCombo(map.rail) : null;
      const studyControl = studyPlaybackRef.current;
      if (normRecap && combo === normRecap) {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('kivara-recapture-frame'));
      } else if (normPanel && combo === normPanel) {
        e.preventDefault();
        e.stopPropagation();
        setPanelOpen(!useKivaraStore.getState().panelOpen);
      } else if (normSave && combo === normSave) {
        e.preventDefault();
        e.stopPropagation();
        setSaveTick(Date.now());
      } else if (normToggle && combo === normToggle) {
        e.preventDefault();
        e.stopPropagation();
        const next = !useKivaraStore.getState().subtitlesVisible;
        setSubtitlesVisible(next);
      } else if (normReplay && combo === normReplay) {
        e.preventDefault();
        e.stopPropagation();
        studyControl.replay();
      } else if (normPrev && combo === normPrev) {
        e.preventDefault();
        e.stopPropagation();
        studyControl.prev();
      } else if (normNext && combo === normNext) {
        e.preventDefault();
        e.stopPropagation();
        studyControl.next();
      } else if (normReplaySlow && combo === normReplaySlow) {
        e.preventDefault();
        e.stopPropagation();
        studyControl.replaySlow();
        // The slow pass is invisible for a beat: say which rate is playing.
        toast(t('player.slowReplay', { speed: `${SLOW_REPLAY_RATE}×` }), { duration: 1100 });
      } else if (normAutoPause && combo === normAutoPause) {
        e.preventDefault();
        e.stopPropagation();
        const state = useKivaraStore.getState();
        const next = !state.study.autoPauseCue;
        state.setStudy((prev) => ({ ...prev, autoPauseCue: next }));
        toast.message(next ? t('rail.autoPause') : t('player.loopOff'), { duration: 1100 });
      } else if (normLoop && combo === normLoop) {
        e.preventDefault();
        e.stopPropagation();
        const next = !studyControl.loop;
        studyControl.setLoop(next);
        toast.message(next ? t('player.loopOn') : t('player.loopOff'), { duration: 1100 });
      } else if (normSlower && combo === normSlower) {
        e.preventDefault();
        e.stopPropagation();
        toast(t('player.speedNow', { speed: `${studyControl.stepSpeed(-1)}×` }), { duration: 1100 });
      } else if (normFaster && combo === normFaster) {
        e.preventDefault();
        e.stopPropagation();
        toast(t('player.speedNow', { speed: `${studyControl.stepSpeed(1)}×` }), { duration: 1100 });
      } else if (normListenFirst && combo === normListenFirst) {
        e.preventDefault();
        e.stopPropagation();
        const state = useKivaraStore.getState();
        state.setStudy((prev) => ({ ...prev, listenFirst: !prev.listenFirst }));
      } else if (normRail && combo === normRail) {
        e.preventDefault();
        e.stopPropagation();
        railOpenStore.set(!railOpenStore.get());
      } else {
        // This branch is only reached when nothing matched, so it cannot
        // double-report. One ping per genuinely-unmapped keypress — the same
        // guard the service worker uses: still loud in dev, silent in a
        // production build.
        dbgOnce('[Kivara Lingo] unmapped custom combo:', combo);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [setPanelOpen, setSubtitlesVisible]);

  // Bridge runtime messages (from background) → local actions.
  // Also listens for the in-page `kivara-recapture-frame` event fired by
  // the user-shortcut listener above when the user rebound recapture to
  // a non-manifest combo (manifest Alt+V arrives as RUN_COMMAND instead).
  useEffect(() => {
    const doRecaptureFrame = () => {
      // Tier 1.2: re-capture the current video frame and patch the
      // most recently saved Anki note. Useful when the auto-captured
      // frame caught a transition / fade / loading spinner.
      const ref = lastSavedNoteRef.current;
      if (!videoElement || !ref) {
        toast.message(
          t('app.noRecentCard'),
          { duration: 1800 },
        );
        return;
      }
      void captureFrame(videoElement).then(async (frameDataUrl) => {
        if (!frameDataUrl) {
          toast.error(t('app.frameCaptureFailed'));
          return;
        }
        try {
          const response = (await sendMessage(
            'UPDATE_NOTE_FRAME',
            {
              noteId: ref.noteId,
              fieldName: ref.fieldName,
              frame: frameDataUrl,
            },
            'background',
          )) as { ok: boolean; error?: string };
          if (response?.ok) {
            toast.success(t('app.frameUpdated'), { duration: 1600 });
          } else {
            toast.error(response?.error ?? t('app.frameUpdateError'));
          }
        } catch (err) {
          const reason = err instanceof Error ? err.message : t('app.unknownReason');
          toast.error(`${t('app.frameUpdateError')}: ${reason}`);
        }
      });
    };
    const handler = (msg: { type?: string; command?: string }) => {
      // Same gate as the in-page handler (#6-2 from the review): a
      // chrome.commands message from the service worker fires VERBATIM
      // even when the user disabled the extension from Settings, so
      // Alt+R used to seek the video and Ctrl+Shift+S saved a word with the
      // whole extension off. `toggle_panel` is intentionally exempt (it is
      // the same `chrome.action` click path a user takes when opening the
      // preferences) but every other manifest command is gated — see
      // RUN_COMMAND_GATE.
      if (msg?.type === 'RUN_COMMAND' && RUN_COMMAND_GATE.has(msg.command ?? '')) {
        if (!useKivaraStore.getState().enabled) return;
      }
      if (msg?.type === 'TOGGLE_PANEL') {
        setPanelOpen(!useKivaraStore.getState().panelOpen);
      } else if (msg?.type === 'OPEN_PANEL') {
        setPanelOpen(true);
      } else if (msg?.type === 'CLOSE_PANEL') {
        setPanelOpen(false);
      } else if (msg?.type === 'RUN_COMMAND') {
        switch (msg.command) {
          case 'save_word':
          case 'save_word_alt':
            // Tier 1.5: keep two commands wired to the same handler so the
            // user can bind whichever combo (Ctrl+Shift+S or Ctrl+S, etc.)
            // doesn't collide with the host page / browser on their setup.
            setSaveTick(Date.now());
            break;
          case 'toggle_subtitles': {
            // Tier 1.2: actually toggle the subtitle overlay visibility.
            // Distinct from the master `enabled` toggle so the user can
            // briefly peek at unsubtitled content without disabling
            // everything else (audio capture, panel, AnkiConnect retries).
            const next = !useKivaraStore.getState().subtitlesVisible;
            setSubtitlesVisible(next);
            toast.message(
              next ? t('app.subtitlesVisible') : t('app.subtitlesHidden'),
              { duration: 1400 },
            );
            break;
          }
          // Tier 1.2: rename to match manifest.json `repeat_cue` so Alt+R
          // actually rewinds the cue. The legacy `repeat_phrase` is kept as
          // an alias for any external script that may still send it.
          case 'repeat_cue':
          case 'repeat_phrase':
            if (activeCue?.start != null) seekAndPlay(activeCue.start);
            break;
          case 'recapture_frame':
            doRecaptureFrame();
            break;
          case 'toggle_panel':
            // Tier 1.2: Alt+K arrives as a manifest command through the
            // service worker. Without the case the handler fell into the
            // default branch, which logged "unknown command" and dropped
            // it — the shortcut did nothing on any platform, on Mac
            // (where Option is the Alt carrier) it never even reached
            // the listener. The store toggle IS the product behavior.
            setPanelOpen(!useKivaraStore.getState().panelOpen);
            break;
          case 'show_translation':
            // Translation is already shown automatically on hover. Kept here
            // so unknown commands don't fall through to the default warning,
            // but no UI action is needed.
            break;
          default:
            console.warn('[Kivara Lingo] unknown command:', msg.command);
            break;
        }
      }
    };
    const onRecaptureEvent = () => doRecaptureFrame();
    chrome.runtime.onMessage.addListener(handler);
    window.addEventListener('kivara-recapture-frame', onRecaptureEvent);
    // Same bridge for the in-page "Reproducir frase" button on the subtitle
    // overlay: it dispatches this event, which performs the seek the
    // hotkey (Alt+R) also performs, so the button and the hotkey are the
    // SAME action rather than a button that silently swallowed clicks.
    const onRepeatCueEvent = () => {
      // Same gate: with the extension off, the SubtitleOverlay button
      // should not seek the video either. See the review's #6-2 note on
      // the in-page and switch cases.
      if (!useKivaraStore.getState().enabled) return;
      if (activeCue?.start != null) seekAndPlay(activeCue.start);
    };
    window.addEventListener('kivara-repeat-cue', onRepeatCueEvent);
    return () => {
      chrome.runtime.onMessage.removeListener(handler);
      window.removeEventListener('kivara-recapture-frame', onRecaptureEvent);
      window.removeEventListener('kivara-repeat-cue', onRepeatCueEvent);
    };
  }, [activeCue, setPanelOpen, videoElement, seekAndPlay]);

  const ensureSubtitleAudioReady = useCallback(async (): Promise<SubtitleAudioAnchor> => {
    if (!videoElement || !activeCue?.end) {
      return {
        videoTimeAtSave: videoElement ? videoElement.currentTime * 1000 : adapter?.getCurrentTime?.(),
        videoPausedAtSave: videoElement?.paused,
      };
    }

    const currentMs = videoElement.currentTime * 1000;
    const remainingMs = activeCue.end - currentMs;
    if (!videoElement.paused || remainingMs <= 120) {
      return {
        videoTimeAtSave: currentMs,
        videoPausedAtSave: videoElement.paused,
      };
    }

    const originalMs = videoElement.currentTime * 1000;
    const originalKivaraPaused = kivaraPausedRef.current;
    // The rewind after the audio pass goes through the PlaybackController:
    // on Netflix a `currentTime` write interrupts playback (M7375).
    const restore = async () => {
      const controller = episode.controller;
      if (!controller) return;
      try {
        await controller.seek(originalMs);
      } catch (err) {
        console.warn('[Kivara Lingo] could not restore video time after audio capture', err);
      }
    };
    const targetSeconds = activeCue.end / 1000 + 0.25;
    const timeoutMs = Math.min(Math.max(remainingMs + 750, 1_000), 10_000);

    try {
      hoverRevRef.current += 1;
      await videoElement.play();
      await waitForVideoTime(videoElement, targetSeconds, timeoutMs);
      const audioAnchor = videoElement.currentTime * 1000;
      videoElement.pause();
      await restore();
      kivaraPausedRef.current = originalKivaraPaused;
      return {
        videoTimeAtSave: audioAnchor,
        videoPausedAtSave: false,
      };
    } catch (err) {
      try {
        if (!videoElement.paused) videoElement.pause();
      } catch {
        // ignore pause failures
      }
      await restore();
      kivaraPausedRef.current = originalKivaraPaused;
      const reason = err instanceof Error ? err.message : 'no se pudo reproducir temporalmente';
      console.warn('[Kivara Lingo] subtitle audio completion failed; using TTS fallback', reason);
      return {
        videoTimeAtSave: originalMs,
        videoPausedAtSave: true,
      };
    }
  }, [activeCue?.end, adapter, videoElement, episode.controller]);

  /**
   * Scene media for "Add this scene": the same frame sampler and the same
   * audio-completion rule the save path uses, but nothing here blocks the
   * note update. A failed frame or an inactive tab-capture session simply
   * leaves that half missing and `addSceneToNote` reports it as a soft note.
   */
  const captureSceneMedia = useCallback(async (): Promise<SceneMedia> => {
    const scene: SceneMedia = {};
    if (videoElement) {
      try {
        const frame = await captureBestFrame(
          videoElement,
          { start: activeCue?.start, end: activeCue?.end },
          {
            // Netflix never gets a seek (M7375): sample the current frame.
            seek:
              adapter?.platform === 'netflix' || !episode.controller
                ? undefined
                : (timeMs) => episode.controller!.seek(timeMs),
          },
        );
        if (frame) scene.frame = frame;
      } catch {
        // Best-effort: the note is updated without a frame.
      }
    }
    try {
      // Play the line to its end (or record it live) exactly as a save does,
      // then slice the clip the tab-capture buffer now holds.
      const anchor = await ensureSubtitleAudioReady();
      const startMs = activeCue?.start;
      const endMs = anchor.videoTimeAtSave;
      if (startMs != null && endMs != null && endMs > startMs) {
        const clip = (await sendMessage(
          'EXTRACT_AUDIO_CLIP',
          { startMs, endMs },
          'background',
        )) as AudioClipResponse;
        if (clip?.ok && clip.dataUrl) scene.audio = clip.dataUrl;
      }
    } catch {
      // Best-effort: the sentence and tags still go through.
    }
    return scene;
  }, [videoElement, activeCue?.start, activeCue?.end, adapter, episode.controller, ensureSubtitleAudioReady]);

  /**
   * The save shortcut found nothing unambiguous. The prototype's rule: explain
   * instead of guessing — hidden subtitles and Reading mode each have their own
   * instruction, and the combo is named only when the user has one bound.
   */
  const handleNothingToSave = useCallback((reason: 'several' | 'none') => {
    const state = useKivaraStore.getState();
    const combo = state.shortcuts.toggle;
    const message = !state.subtitlesVisible
      ? t('app.saveHintHidden', { combo: combo ? ` (${combo})` : '' })
      : state.mode === 'reading'
        ? t('app.saveHintReading')
        : reason === 'none'
          ? t('app.saveHintNone')
          : t('app.saveHint');
    toast.message(message, { duration: 3000 });
  }, []);

  /**
   * "View queue" on a save that failed: open the panel and land on Cards, the
   * tab that owns the retry queue. The tab is local state in SidePanel, so the
   * event is the seam.
   */
  const handleViewQueue = useCallback(() => {
    setPanelOpen(true);
    window.dispatchEvent(new Event(OPEN_CARDS_EVENT));
  }, [setPanelOpen]);

  const handleSaveCard = useCallback(
    async (token: string | undefined, sentence: string): Promise<CreateCardResponse> => {
      if (!enabled) return { ok: false, error: 'disabled' };
      const tokenValue = token?.trim() || sentence.trim();
      if (!tokenValue) return { ok: false, error: 'no token' };
      // One card at a time: the capture overlay and the audio completion must
      // not run twice for a double-pressed shortcut.
      if (captureBusyRef.current) return { ok: false, error: 'busy' };
      captureBusyRef.current = true;

      const studyNow = useKivaraStore.getState().study;
      const endDetect = useKivaraStore.getState().capture.endDetect;
      if (captureClearTimer.current) {
        window.clearTimeout(captureClearTimer.current);
        captureClearTimer.current = null;
      }
      setCaptureView({ flash: false, audio: null, frame: 'pending', mode: endDetect });

      const saveToastId = toast.loading(t('app.savingCard'), {
        description: t('app.preparingSave'),
      });

      try {
        let frameDataUrl: string | null = null;
        if (videoElement) {
          // Best-frame capture: samples the cue window on a paused video to
          // dodge fades / transitions / spinners. Null when every candidate is
          // a dud, letting the orchestrator fall back to a web image.
          frameDataUrl = await captureBestFrame(
            videoElement,
            { start: activeCue?.start, end: activeCue?.end },
            {
              // Netflix never gets a seek (M7375): sample the current frame.
              seek:
                adapter?.platform === 'netflix' || !episode.controller
                  ? undefined
                  : (timeMs) => episode.controller!.seek(timeMs),
            },
          );
        }
        setCaptureView((v) => (v ? { ...v, flash: true, frame: frameDataUrl ? 'ok' : 'failed' } : v));
        if (studyNow.sounds) playSound('shutter');
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 260);
        });
        setCaptureView((v) => (v ? { ...v, flash: false } : v));

        // Which audio the save will use, computed from the same condition
        // `ensureSubtitleAudioReady` uses: a paused video short of the cue end
        // replays the line; a playing one records it live.
        const remainingMs = videoElement && activeCue?.end != null
          ? activeCue.end - videoElement.currentTime * 1000
          : 0;
        const audio: CaptureAudio = !videoElement
          ? 'off'
          : videoElement.paused
            ? (remainingMs > 120 ? 'replay' : 'off')
            : 'live';
        setCaptureView((v) => (v ? { ...v, audio } : v));

        const audioAnchor = await ensureSubtitleAudioReady();

        const lang = cueLanguageRef.current;
        const activeDeck = ankiMapping.decks?.[lang] ?? ankiMapping.deckName;
        const media = adapter?.getMediaInfo?.();
        const kind = cardKindOf(tokenValue);
        // Neighbouring cues for the `context` field source. The active cue is
        // located by id because the saved sentence may come from a selection
        // inside the line, not from the cue object itself. Pure helper so the
        // mapping is unit-tested without React.
        const { contextLines, cueStart, cueEnd } = buildCueRequestFields(activeCue, episode.cues);
        const request: CreateCardRequest = {
          token: tokenValue,
          sentence,
          cardId: newCardId(),
          kind,
          lang,
          deck: activeDeck,
          media,
          contextLines,
          frame: frameDataUrl ?? undefined,
          cueStart,
          cueEnd,
          videoTimeAtSave: audioAnchor.videoTimeAtSave,
          videoPausedAtSave: audioAnchor.videoPausedAtSave,
          language: lang,
          platform: adapter?.platform,
        };

        try {
          const response = (await sendMessage('CREATE_CARD', request, 'background')) as CreateCardResponse;
          if (response?.ok) {
            // Remember the noteId + frame field so `recapture_frame` (Alt+V)
            // can update this specific note.
            if (response.noteId != null) {
              lastSavedNoteRef.current = {
                noteId: response.noteId,
                fieldName: findFrameFieldName(ankiMapping.fieldSources) ?? null,
              };
            }
            // The saved notice carries the Undo action (delete the note just
            // created) and the save's warnings as amber notes — the card is
            // saved either way, so the toast explains instead of blocking.
            toast.dismiss(saveToastId);
            showCardSaved(
              { noteId: response.noteId, text: tokenValue, deck: activeDeck ?? '' },
              withAudioHint(response.warnings ?? [], {
                audioCaptureActive: useKivaraStore.getState().audioCaptureActive,
                combo: useKivaraStore.getState().shortcuts.save || undefined,
              }),
            );
            if (studyNow.sounds) playSound('saved');
            // F5: the word now has a card. A «known» hand mark gives way to
            // it (the word becomes learning), the interval is cached at 0 and
            // a background refresh reads the real one from Anki.
            recordCardSaved(lang, tokenValue);
            // The success path must RETURN its own envelope: falling through
            // used to report every created card as a failure, so the green
            // "saved" highlight never painted.
            return { ok: true, noteId: response.noteId, warnings: response.warnings };
          }
          showCardSaveError(
            response?.error,
            response?.queued === true,
            saveToastId,
            handleViewQueue,
            response?.errorCode,
          );
          if (studyNow.sounds) playSound('error');
          return response ?? { ok: false, error: 'unknown' };
        } catch (err) {
          const reason = err instanceof Error ? err.message : t('app.unknownReason');
          showCardSaveError(reason, false, saveToastId, handleViewQueue);
          if (studyNow.sounds) playSound('error');
          return { ok: false, error: reason };
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : t('app.unknownReason');
        showCardSaveError(reason, false, saveToastId, handleViewQueue);
        if (studyNow.sounds) playSound('error');
        return { ok: false, error: reason };
      } finally {
        captureBusyRef.current = false;
        captureClearTimer.current = window.setTimeout(() => {
          setCaptureView(null);
          captureClearTimer.current = null;
        }, 700);
      }
    },
    // deps: everything handleSaveCard touches at closure time.
    // SubtitleOverlay's useMemo also lists handleSaveCard — its identity
    // must change when ankiMapping or cue change, which keeps the overlay
    // consistent when deck/adapter/config change.
    [enabled, activeCue, videoElement, adapter, ensureSubtitleAudioReady, ankiMapping, episode.controller, episode.cues, handleViewQueue],
  );

  /**
   * "See in Anki" from the word card: open the user's browser on the note
   * that holds this headword. Built with the same exact-query helper the
   * save path uses, so quotes/asterisks in a token cannot widen the search.
   */
  const handleSeeInAnki = useCallback(async (token: string) => {
    const lang = cueLanguageRef.current;
    const deck = ankiMapping.decks?.[lang] ?? ankiMapping.deckName;
    const fieldName = Object.entries(ankiMapping.fieldSources ?? {}).find(
      ([, source]) => source === 'selection',
    )?.[0] ?? 'Front';
    const query = buildExactNoteQuery({
      deckName: deck,
      modelName: ankiMapping.modelName,
      fieldName,
      value: token,
    });
    if (!query) {
      toast.error(t('wp.openInAnkiFailed'));
      return;
    }
    const res = (await sendMessage('ANKI_BROWSE', { query }, 'background')) as AnkiBrowseResponse;
    if (res?.ok) toast(t('wp.openedInAnki'), { description: token, duration: 2200 });
    else toast.error(t('wp.openInAnkiFailed'), { description: res?.error });
  }, [ankiMapping]);

  /**
   * "Add this scene": attach the current line, its frame and its audio to the
   * note the word already has, instead of creating a duplicate card. `kind`
   * and `token` are the real card flavour and headword, so the tags and the
   * note lookup match the card the user is looking at.
   */
  const handleAddContext = useCallback(async (
    token: string,
    sentence: string,
    kind: CreateCardKind,
  ) => {
    if (!enabled) return;
    // One capture at a time, same lock the save path holds.
    if (captureBusyRef.current) return;
    captureBusyRef.current = true;
    try {
      const lang = cueLanguageRef.current;
      const deck = ankiMapping.decks?.[lang] ?? ankiMapping.deckName;
      const media = adapter?.getMediaInfo?.();
      const fieldName = Object.entries(ankiMapping.fieldSources ?? {}).find(
        ([, source]) => source === 'selection',
      )?.[0] ?? 'Front';
      await addSceneToNote(
        {
          token,
          sentence,
          kind,
          deck,
          fieldName,
          tags: buildCardTags(kind, media, lang),
          origin: cardSourceFromMedia(media),
        },
        captureSceneMedia,
      );
    } finally {
      captureBusyRef.current = false;
    }
  }, [enabled, adapter, ankiMapping, captureSceneMedia]);

  const overlayPortal = useMemo(() => {
    if (!videoOverlayRoot || !enabled || !subtitlesVisible) return null;
    return createPortal(
      // Re-provide the VIDEO host's portal container for this subtree: it
      // lives in a different shadow root than the panel tree, and a portal
      // opened inside it (InfoHint hint, dialog) must follow the video host —
      // which fullscreen-overlay-core keeps inside the player, and the player
      // is what the site fullscreenes.
      <PortalContainerProvider container={videoPortalContainer ?? null}>
        <div
          data-popover-boundary
          className={`absolute inset-0 pointer-events-none ${isDarkMode ? 'dark' : ''}`}
          style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}
        >
          <SubtitleOverlay
            subtitleStyles={subtitleStyles}
            cue={activeCue}
            altCue={altCue}
            mode={mode}
            saveRequestKey={saveTick}
            onSaveCard={handleSaveCard}
            onSeeInAnki={handleSeeInAnki}
            onAddContext={handleAddContext}
            onTokenHoverChange={handleTokenHoverChange}
            onNothingToSave={handleNothingToSave}
            initialSavedWords={initialSavedWords}
            playing={playing}
            expandedMWEs={expandedMWEs}
            setExpandedMWEs={setExpandedMWEs}
            capturing={captureView !== null}
            study={studyBinding}
            // The rail is the only place an explanation renders, and it now
            // lives beside the panel instead of being replaced by it (#38) —
            // `requestExplain` opens the rail, so the action needs no panel
            // gate.
            onExplain={aiOn ? requestExplain : undefined}
          />
          <CaptureOverlay view={captureView} cardTheme={subtitleStyles.cardTheme ?? 'dark'} />
          {/* A capture is its own state: no pause pill over the shutter. */}
          {captureView === null && (
            <StudyPausedPill
              atCueEnd={studyPlayback.autoPaused}
              lookupPaused={lookupPaused}
              onResume={studyPlayback.resume}
            />
          )}
        </div>
      </PortalContainerProvider>,
      videoOverlayRoot,
    );
  }, [
    activeCue,
    altCue,
    // deps kept EXPLICIT and CONTIGUOUS — a fix for the audit's #10:
    // `initialSavedWords`, `ankiMapping`, `handleSaveCard`,
    // `videoElement`, `adapter` and `ensureSubtitleAudioReady` were
    // missing before, which meant: a new fetch resolved but the memo did
    // NOT recompute, so the overlay kept showing the empty green-token
    // state; `handleSaveCard` held on to the PREVIOUS ankiMapping
    // closure and appended to the wrong deck until an unrelated event
    // forced a refresh. handleSaveCard is `useCallback`-wrapped with
    // exactly this deps list AND the functions it closes over, so
    // including it here is a no-op when nothing changes and a refresh
    // when deck or adapter change.
    initialSavedWords,
    ankiMapping,
    handleSaveCard,
    handleSeeInAnki,
    handleAddContext,
    videoElement,
    adapter,
    videoPortalContainer,
    ensureSubtitleAudioReady,
    enabled,
    subtitlesVisible,
    isDarkMode,
    mode,
    saveTick,
    subtitleStyles,
    videoOverlayRoot,
    handleTokenHoverChange,
    playing,
    expandedMWEs,
    captureView,
    studyBinding,
    aiOn,
    requestExplain,
    handleNothingToSave,
    lookupPaused,
    studyPlayback.autoPaused,
    studyPlayback.resume,
  ]);

  return (
    <div
      className={`font-sans text-zinc-900 dark:text-zinc-100 pointer-events-none ${isDarkMode ? 'dark' : ''}`}
      // The panel host is `height: 0` on purpose (it must not swallow page
      // clicks) and `contain: layout` makes it the containing block for this
      // fixed layer — so `inset: 0` resolved to a 0 px-tall box and the rail's
      // `overflow-y-auto` line list clipped every row. Size the layer against
      // the VIEWPORT explicitly; it stays pointer-events-none, so only the
      // rail/panel wrappers that opt in receive clicks.
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100vh',
        zIndex: 2147483646,
        colorScheme: isDarkMode ? 'dark' : 'light',
      }}
    >
      <div className="pointer-events-auto">
        <Toaster position="top-center" theme={isDarkMode ? 'dark' : 'light'} />
      </div>

      {overlayPortal}

      {/* F6: the study bar lives in the player's overlay root, above the
          platform's own controls (D2). Its visibility follows pointer activity
          over the player, like the site's bar. */}
      {enabled && videoOverlayRoot &&
        createPortal(
          // Same re-provision as the overlay portal above: portals opened from
          // the StudyBar must land in the VIDEO host's root, which stays inside
          // the fullscreened player.
          <PortalContainerProvider container={videoPortalContainer ?? null}>
            <div className={`absolute inset-0 pointer-events-none ${isDarkMode ? 'dark' : ''}`}>
              <StudyBar
                enabled={enabled}
                playing={playing}
                onTogglePlay={studyPlayback.togglePlay}
                onPrev={studyPlayback.prev}
                onReplay={studyPlayback.replay}
                onReplaySlow={studyPlayback.replaySlow}
                onNext={studyPlayback.next}
                autoPause={study.autoPauseCue}
                onToggleAutoPause={() => {
                  const next = !useKivaraStore.getState().study.autoPauseCue;
                  setStudy((prev) => ({ ...prev, autoPauseCue: next }));
                }}
                loop={studyPlayback.loop}
                onToggleLoop={() => studyPlayback.setLoop(!studyPlayback.loop)}
                speed={studyPlayback.speed}
                onSpeed={studyPlayback.setSpeed}
                railOpen={railOpen}
                onToggleRail={() => railOpenStore.set(!railOpen)}
                panelOpen={panelOpen}
                onTogglePanel={() => setPanelOpen(!panelOpen)}
              />
            </div>
          </PortalContainerProvider>,
          videoOverlayRoot,
        )}

      {/* F6: the transcript column (D1). It reserves its width on the player
          root through columns-css.ts, so it never covers the picture. With the
          panel docked it sits to the panel's LEFT, and the pair reserves both
          widths — one computation, `columnLayout`, feeds this style and the
          stylesheet. In overlay mode (#38, narrow viewport) nothing is
          reserved and the columns paint over the player. */}
      {railVisible && (
        <div
          ref={railHostRef}
          className="pointer-events-auto"
          style={{
            position: 'absolute',
            top: 0,
            // `right` moves the rail clear of the docked panel. A floating
            // panel reserves nothing, so the rail keeps the edge.
            right: panelDocked ? columnLayout.panelWidth + columnLayout.gap : 0,
            bottom: 0,
            width: columnLayout.railWidth,
          }}
        >
          <TranscriptRail
            cues={episode.cues}
            activeIndex={activeCueIndex}
            lang={cueLanguage}
            study={studyBinding}
            newMarks={study.newMarks}
            savedWords={initialSavedWords}
            media={episode.media}
            view={railView}
            onViewChange={(view) => railViewStore.set(view)}
            onSeek={(index) => studyPlayback.seekCue(index)}
            onReplay={studyPlayback.replay}
            onReplaySlow={studyPlayback.replaySlow}
            capturing={captureView !== null}
            autoPause={study.autoPauseCue}
            onToggleAutoPause={() => {
              const next = !useKivaraStore.getState().study.autoPauseCue;
              setStudy((prev) => ({ ...prev, autoPauseCue: next }));
            }}
            loop={studyPlayback.loop}
            onToggleLoop={() => studyPlayback.setLoop(!studyPlayback.loop)}
            speed={studyPlayback.speed}
            onSpeed={studyPlayback.setSpeed}
            playing={playing}
            pauseOnExplain={study.pauseOnLookup}
            onStudyPause={studyPlayback.pauseForStudy}
            onStudyResume={studyPlayback.resumeIfKivaraPaused}
            ai={aiOn ? aiPort : null}
            explainRequest={explainTick}
            nativeCues={nativeLines}
            translation={study.translation}
            onTranslationChange={(next) => setStudy((prev) => ({ ...prev, translation: next }))}
            listenFirst={study.listenFirst}
            onSaveWord={(word, sentence) => { void handleSaveCard(word, sentence); }}
            onFocusPanel={panelDocked ? focusPanel : undefined}
            uiLang={currentLocale()}
            nativeLang={useKivaraStore.getState().translate.targetLanguage}
            panelOpen={panelOpen}
            onTogglePanel={() => setPanelOpen(!panelOpen)}
            isDarkMode={isDarkMode}
            onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
            onClose={() => railOpenStore.set(false)}
          />
        </div>
      )}

      {enabled && panelOpen && (
        <div
          ref={panelHostRef}
          className="pointer-events-auto"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            // Snap to the bottom of the viewport in dock-to-side mode so the
            // panel docks flush with the platform's UI (no leftover gap of
            // the platform's video peeking through).
            // Popup mode positions itself with `top-24` so this doesn't apply.
            bottom: 0,
            display: 'flex',
            alignItems: 'stretch',
            // Docked: the panel is a column and owns its reserved width, so
            // the rail can sit beside it instead of under it. Floating: the
            // panel is `fixed` and drags itself around; the wrapper stays a
            // zero-width anchor.
            ...(panelDocked ? { width: columnLayout.panelWidth } : null),
          }}
        >
          <SidePanel
            isPopupMode={isPopupMode}
            onClose={() => setPanelOpen(false)}
            togglePopupMode={() => setIsPopupMode(!isPopupMode)}
            onToTranscript={railVisible ? focusRail : undefined}
            isDarkMode={isDarkMode}
            toggleDarkMode={() => setIsDarkMode(!isDarkMode)}
            styles={subtitleStyles}
            setStyles={setSubtitleStyles}
            mapping={ankiMapping}
            setMapping={setAnkiMapping}
            episode={{ cues: episode.cues, lang: cueLanguage }}
            onOpenEpisodeWords={() => {
              railViewStore.set('words');
              railOpenStore.set(true);
            }}
            // Until Phase 3 wires dictionary/translation lookup to the live
            // cue, the preview falls back to a deterministic sample so
            // FRENTE / REVERSO render something. The live cue drives
            // `targetSentence` when present (shared builder — Options.tsx
            // uses the same source with no cue).
            mockData={buildPreviewData(activeCue?.text)}
            episodeLang={cueLanguage}
          />
        </div>
      )}
    </div>
  );
}
