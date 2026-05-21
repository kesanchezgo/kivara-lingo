import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Toaster, toast } from 'sonner';
import { CheckCircle2 } from 'lucide-react';
import { sendMessage } from 'webext-bridge/content-script';
import { SidePanel } from './SidePanel';
import { SubtitleOverlay } from './SubtitleOverlay';
import { applyCleanupCss } from './cleanup-css';
import { useKivaraStore } from '../../shared/store';
import { captureFrame } from '../capture/frame';
import type {
  CreateCardRequest,
  CreateCardResponse,
  FieldSource,
} from '../../shared/types';
import type { SubtitleSource } from '../platform-adapters/types';

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
    }
  }, [adapter]);

  // Native-language alt cue poll. Runs at 4 Hz — fast enough that the dual
  // caption snaps in within the same frame as the source for most users,
  // cheap enough that even with 8 hour binges it's < 0.01% CPU.
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
      const next = lookup(time, targetLang);
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
    const handle = window.setInterval(tick, 250);
    return () => {
      window.clearInterval(handle);
    };
  }, [adapter, targetLang, activeCue?.id]);

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

  // Bridge runtime messages (from background) → local actions.
  useEffect(() => {
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
              next ? 'Subtítulos visibles' : 'Subtítulos ocultos',
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
          case 'recapture_frame': {
            // Tier 1.2: re-capture the current video frame and patch the
            // most recently saved Anki note. Useful when the auto-captured
            // frame caught a transition / fade / loading spinner.
            const ref = lastSavedNoteRef.current;
            if (!videoElement || !ref) {
              toast.message(
                'No hay tarjeta reciente que actualizar',
                { duration: 1800 },
              );
              break;
            }
            void captureFrame(videoElement).then(async (frameDataUrl) => {
              if (!frameDataUrl) {
                toast.error('No se pudo capturar el frame');
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
            break;
          }
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
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, [activeCue, setPanelOpen, videoElement]);

  const handleSaveCard = async (token: string | undefined, sentence: string) => {
    if (!enabled) return;
    const tokenValue = token?.trim() || sentence.trim();
    if (!tokenValue) return;

    let frameDataUrl: string | null = null;
    if (videoElement) {
      frameDataUrl = await captureFrame(videoElement);
    }

    const request: CreateCardRequest = {
      token: tokenValue,
      sentence,
      frame: frameDataUrl ?? undefined,
      cueStart: activeCue?.start,
      cueEnd: activeCue?.end,
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
        toast.custom(
          (id) => (
            <div className="flex items-center gap-2.5 bg-zinc-900/95 backdrop-blur-xl border border-zinc-700/60 rounded-lg shadow-2xl px-3 py-2.5 min-w-[280px]">
              <div className="w-7 h-7 rounded-md bg-emerald-500/15 ring-1 ring-emerald-500/30 flex items-center justify-center shrink-0">
                <CheckCircle2 size={14} className="text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-white leading-tight">Tarjeta guardada</div>
                <div className="text-[10px] text-zinc-400 leading-tight mt-0.5 truncate">
                  <span className="font-mono text-indigo-300">{tokenValue}</span>
                  <span className="text-zinc-500"> → </span>
                  {ankiMapping.deckName}
                </div>
              </div>
              <button
                onClick={() => toast.dismiss(id)}
                className="text-[10px] font-medium text-zinc-500 hover:text-zinc-300 px-1.5 py-0.5 rounded transition-colors shrink-0"
              >
                OK
              </button>
            </div>
          ),
          { duration: 3200 },
        );
        if (response.warnings?.length) {
          toast.message(response.warnings.join(' · '));
        }
      } else {
        toast.error(response?.error ?? 'Error guardando en Anki');
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'desconocido';
      toast.error(`Error guardando en Anki: ${reason}`);
    }
  };

  const overlayPortal = useMemo(() => {
    if (!videoOverlayRoot || !enabled || !subtitlesVisible) return null;
    return createPortal(
      <div
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
            mockData={{
              // Until Phase 3 wires dictionary/translation lookup to the live
              // cue, the preview falls back to a deterministic placeholder so
              // FRENTE / REVERSO actually render something (instead of an
              // empty dark card). The live cue text still feeds
              // `targetSentence` when present so the user sees their current
              // line in REVERSO.
              targetSentence: activeCue?.text || "These days, Nicola doesn't travel much.",
              nativeSentence: 'Estos días, Nicola no viaja mucho.',
              word: 'these days',
              translation: 'estos días',
              phonetic: '/ðiːz deɪz/',
              bilingual: '(noun) estos días',
              monolingual: 'Used to refer to the present time period.',
            }}
          />
        </div>
      )}
    </div>
  );
}
