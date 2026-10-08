import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../shared/i18n';
import { createPortal } from 'react-dom';
import { Toaster, toast } from 'sonner';
import { sendMessage } from 'webext-bridge/content-script';
import { SidePanel } from './SidePanel';
import { SubtitleOverlay } from './SubtitleOverlay';
import { applyCleanupCss } from './cleanup-css';
import { useKivaraStore } from '../../shared/store';
import { captureFrame, captureBestFrame } from '../capture/frame';
import { comboFromEvent, normalizeCombo } from '../../shared/shortcuts';
import type {
  CreateCardRequest,
  CreateCardResponse,
  FieldSource,
} from '../../shared/types';
import type { SubtitleSource } from '../platform-adapters/types';
import { getActiveTrackCues, getTrackByLanguage, onTrack } from '../platform-adapters/intercepted-bus';
import { buildPreviewData } from '../../shared/preview-data';

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

export function App({ adapter, videoElement, videoOverlayRoot }: AppProps) {
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
    setPanelOpen,
    setIsPopupMode,
    setIsDarkMode,
    setSubtitleStyles,
    setAnkiMapping,
    setSubtitlesVisible,
  } = useKivaraStore();

  const [activeCue, setActiveCue] = useState<ActiveCue | null>(null);
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
        const { ankiMapping } = useKivaraStore.getState();
        if (!ankiMapping.deckName) return;
        const cached = savedWordsCacheRef.current.get(ankiMapping.deckName);
        if (cached) {
          if (!cancelled) setInitialSavedWords(cached);
          return;
        }
        const fieldName = Object.entries(ankiMapping.fieldSources ?? {}).find(
          ([, s]) => s === 'selection',
        )?.[0] ?? 'Front';
        const response = (await sendMessage(
          'ANKI_SAVED_WORDS',
          { deckName: ankiMapping.deckName, fieldName },
          'background',
        )) as { words?: string[] } | undefined;
        if (!cancelled && Array.isArray(response?.words)) {
          const next = new Set(response.words.map((w) => String(w).toLowerCase()));
          savedWordsCacheRef.current.set(ankiMapping.deckName, next);
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

  // Sync dark mode on hosts + overlay root so theme.css `.dark` selector works.
  useEffect(() => {
    const mainHost = document.getElementById('kivara-lingo-host');
    const mainRoot = mainHost?.shadowRoot?.getElementById('kivara-lingo-react-root');
    const videoHost = document.getElementById('kivara-lingo-video-host');
    const videoRoot = videoHost?.shadowRoot?.getElementById('kivara-lingo-video-react-root');

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
  const showDualSubtitlePref = useKivaraStore((s) => s.translate.showDualSubtitle);
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
      const srcCue = activeCue;
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
  }, [adapter, targetLang, activeCue]);

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
  const handleTokenHoverChange = useCallback(
    (hovered: boolean) => {
      if (!videoElement) return;
      hoverRevRef.current += 1;
      const rev = hoverRevRef.current;
      if (hovered) {
        if (!videoElement.paused) {
          kivaraPausedRef.current = true;
          try {
            videoElement.pause();
          } catch (err) {
            console.warn('[Kivara Lingo] pause() failed', err);
            kivaraPausedRef.current = false;
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

    const isOverKivara = (e: MouseEvent): boolean => {
      const path = (e.composedPath?.() ?? []) as EventTarget[];
      for (const node of path) {
        if (
          node instanceof HTMLElement &&
          node.dataset?.kivaraHoverZone === 'true'
        ) {
          return true;
        }
      }
      return false;
    };

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
  // keydown listener. Manifest commands (Ctrl+S / Alt+C / Alt+R / Alt+K)
  // still arrive as RUN_COMMAND messages below.
  //
  // Double-fire guard: we compare against the LIVE bindings from
  // chrome.commands.getAll() (cached, refreshed on focus/visibilitychange),
  // not a hardcoded default list — otherwise a user who remaps a manifest
  // command in chrome://extensions to the same combo as their custom action
  // gets both actions at once, and Mac Command+S vs Ctrl+S drift breaks the
  // skip. The listener effect itself is registered ONCE (empty deps):
  // activeCue/videoElement flow through refs so rebinding on every cue
  // change can't stack duplicate listeners.
  const activeCueRef = useRef(activeCue);
  activeCueRef.current = activeCue;
  const videoElementRef = useRef(videoElement);
  videoElementRef.current = videoElement;
  const manifestCombosRef = useRef<Set<string>>(new Set(['Ctrl+S', 'Command+S', 'Alt+C', 'Alt+R', 'Alt+K']));
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
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const combo = comboFromEvent(e);
      if (!combo) return;
      // A combo currently owned by a manifest command fires via
      // chrome.commands → RUN_COMMAND; handling it here too would double-fire.
      if (manifestCombosRef.current.has(normalizeCombo(combo))) return;
      const map = useKivaraStore.getState().shortcuts;
      const video = videoElementRef.current;
      const cue = activeCueRef.current;
      if (map.recap && combo === map.recap) {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('kivara-recapture-frame'));
      } else if (map.panel && combo === map.panel) {
        e.preventDefault();
        e.stopPropagation();
        setPanelOpen(!useKivaraStore.getState().panelOpen);
      } else if (map.save && combo === map.save) {
        e.preventDefault();
        e.stopPropagation();
        setSaveTick(Date.now());
      } else if (map.toggle && combo === map.toggle) {
        e.preventDefault();
        e.stopPropagation();
        const next = !useKivaraStore.getState().subtitlesVisible;
        setSubtitlesVisible(next);
      } else if (map.replay && combo === map.replay) {
        e.preventDefault();
        e.stopPropagation();
        if (video && cue?.start != null) {
          video.currentTime = cue.start / 1000;
          void video.play().catch(() => {});
        }
      } else if (combo && !Object.values(map).includes(combo)) {
        // Custom combo that matches NO configured action (e.g. it equals
        // another action's default the user moved away from): ignore loudly
        // in dev instead of silently swallowing the keypress.
        console.debug('[Kivara Lingo] unmapped custom combo:', combo);
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
            toast.success('Frame actualizado', { duration: 1600 });
          } else {
            toast.error(response?.error ?? 'Error actualizando frame');
          }
        } catch (err) {
          const reason = err instanceof Error ? err.message : 'desconocido';
          toast.error(`Error actualizando frame: ${reason}`);
        }
      });
    };
    const handler = (msg: { type?: string; command?: string }) => {
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
            // user can bind whichever combo (Ctrl+S or Ctrl+Shift+S, etc.)
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
            if (videoElement && activeCue?.start != null) {
              videoElement.currentTime = activeCue.start / 1000;
              void videoElement.play().catch(() => {});
            }
            break;
          case 'recapture_frame':
            doRecaptureFrame();
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
    return () => {
      chrome.runtime.onMessage.removeListener(handler);
      window.removeEventListener('kivara-recapture-frame', onRecaptureEvent);
    };
  }, [activeCue, setPanelOpen, videoElement]);

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

    const originalTime = videoElement.currentTime;
    const originalKivaraPaused = kivaraPausedRef.current;
    const targetSeconds = activeCue.end / 1000 + 0.25;
    const timeoutMs = Math.min(Math.max(remainingMs + 750, 1_000), 10_000);

    try {
      hoverRevRef.current += 1;
      await videoElement.play();
      await waitForVideoTime(videoElement, targetSeconds, timeoutMs);
      const audioAnchor = videoElement.currentTime * 1000;
      videoElement.pause();
      try {
        videoElement.currentTime = originalTime;
      } catch (err) {
        console.warn('[Kivara Lingo] could not restore video time after audio capture', err);
      }
      kivaraPausedRef.current = originalKivaraPaused;
      return {
        videoTimeAtSave: audioAnchor,
        videoPausedAtSave: false,
      };
    } catch (err) {
      try {
        if (!videoElement.paused) videoElement.pause();
        videoElement.currentTime = originalTime;
      } catch {
        // ignore restore failures
      }
      kivaraPausedRef.current = originalKivaraPaused;
      const reason = err instanceof Error ? err.message : 'no se pudo reproducir temporalmente';
      console.warn('[Kivara Lingo] subtitle audio completion failed; using TTS fallback', reason);
      return {
        videoTimeAtSave: originalTime * 1000,
        videoPausedAtSave: true,
      };
    }
  }, [activeCue?.end, adapter, videoElement]);

  const handleSaveCard = async (token: string | undefined, sentence: string) => {
    if (!enabled) return;
    const tokenValue = token?.trim() || sentence.trim();
    if (!tokenValue) return;

    const saveToastId = toast.loading('Guardando tarjeta…', {
      description: t('app.preparingSave'),
    });

    let frameDataUrl: string | null = null;
    if (videoElement) {
      // Best-frame capture: samples the cue window on a paused video to dodge
      // fades / transitions / spinners. Returns null when every candidate is a
      // dud, letting the orchestrator fall back to a web image.
      frameDataUrl = await captureBestFrame(videoElement, {
        start: activeCue?.start,
        end: activeCue?.end,
      });
    }

    const audioAnchor = await ensureSubtitleAudioReady();

    const request: CreateCardRequest = {
      token: tokenValue,
      sentence,
      frame: frameDataUrl ?? undefined,
      cueStart: activeCue?.start,
      cueEnd: activeCue?.end,
      videoTimeAtSave: audioAnchor.videoTimeAtSave,
      videoPausedAtSave: audioAnchor.videoPausedAtSave,
      language: cueLanguageRef.current,
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
        const warningSuffix = response.warnings?.length
          ? ` · ${response.warnings.join(' · ')}`
          : '';
        toast.success('Tarjeta guardada', {
          id: saveToastId,
          description: `${tokenValue} → ${ankiMapping.deckName}${warningSuffix}`,
          duration: 3200,
        });
      } else {
        toast.error(response?.error ?? 'Error guardando en Anki', { id: saveToastId });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'desconocido';
      toast.error(`Error guardando en Anki: ${reason}`, { id: saveToastId });
    }
  };

  const overlayPortal = useMemo(() => {
    if (!videoOverlayRoot || !enabled || !subtitlesVisible) return null;
    return createPortal(
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
          onTokenHoverChange={handleTokenHoverChange}
          initialSavedWords={initialSavedWords}
        />
      </div>,
      videoOverlayRoot,
    );
  }, [
    activeCue,
    altCue,
    enabled,
    subtitlesVisible,
    isDarkMode,
    mode,
    saveTick,
    subtitleStyles,
    videoOverlayRoot,
    handleTokenHoverChange,
  ]);

  return (
    <div
      className={`font-sans text-zinc-900 dark:text-zinc-100 pointer-events-none ${isDarkMode ? 'dark' : ''}`}
      style={{ position: 'fixed', inset: 0, zIndex: 2147483646, colorScheme: isDarkMode ? 'dark' : 'light' }}
    >
      <div className="pointer-events-auto">
        <Toaster position="top-center" theme={isDarkMode ? 'dark' : 'light'} />
      </div>

      {overlayPortal}

      {enabled && panelOpen && (
        <div
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
          }}
        >
          <SidePanel
            isPopupMode={isPopupMode}
            onClose={() => setPanelOpen(false)}
            togglePopupMode={() => setIsPopupMode(!isPopupMode)}
            isDarkMode={isDarkMode}
            toggleDarkMode={() => setIsDarkMode(!isDarkMode)}
            styles={subtitleStyles}
            setStyles={setSubtitleStyles}
            mapping={ankiMapping}
            setMapping={setAnkiMapping}
            // Until Phase 3 wires dictionary/translation lookup to the live
            // cue, the preview falls back to a deterministic sample so
            // FRENTE / REVERSO render something. The live cue drives
            // `targetSentence` when present (shared builder — Options.tsx
            // uses the same source with no cue).
            mockData={buildPreviewData(activeCue?.text)}
          />
        </div>
      )}
    </div>
  );
}
