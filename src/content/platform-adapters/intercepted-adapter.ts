/**
 * Generic adapter factory used by all streaming platforms that ship subtitles
 * over network requests (Netflix, Disney+, HBO Max, Prime Video). Each
 * platform supplies its `platform` tag, `language`, video selector and the
 * CSS used to hide the native subtitles. The cue data itself comes from the
 * MAIN-world interceptor via `intercepted-bus`.
 */
import {
  getKnownLanguages,
  getLastTrack,
  getTrackByLanguage,
  onTrack,
  type InterceptedTrack,
} from './intercepted-bus';
import type { CueListener, MediaInfo, SubtitleCue, SubtitleSource } from './types';
import { useKivaraStore } from '../../shared/use-kivara-store';
import { createMediaPlaybackController, createNetflixPlaybackController } from './playback';
import { cuesFromRawTrack, findCueAt, pickBestAltCue } from './tracks';

export interface InterceptedAdapterOptions {
  platform: SubtitleSource['platform'];
  /** CSS to inject in document head to hide the native subtitle layer */
  hideNativeCss?: string;
  /** Optional callback for adapter-specific setup */
  onMount?(): void;
  /** Override to find the active video element */
  getVideo?(): HTMLVideoElement | null;
  /** Best-effort episode metadata for the card tags (F4). */
  getMediaInfo?(): MediaInfo;
  /**
   * F6: which PlaybackController to install. `netflix` routes seeks through
   * the MAIN-world player API (never `currentTime`); everything else uses the
   * HTML5 element (docs/REDESIGN-V2.md §4.5).
   */
  playback?: 'media' | 'netflix';
}

/**
 * Build the hide-native style for a platform. The node is PER-ADAPTER
 * (no id): two adapters running on the same page during a navigation
 * churn would otherwise re-use, and one dying would remove, the OTHER's
 * style node — the native captions came back mid-transition. This is
 * the same pattern as `ownStyle` in youtube.ts; the review explicitly
 * flagged the shared-id variant here.
 */
function buildHideStyle(css: string): HTMLStyleElement | null {
  if (!css) return null;
  const style = document.createElement('style');
  style.textContent = css;
  document.documentElement.appendChild(style);
  return style;
}

export function createInterceptedAdapter(opts: InterceptedAdapterOptions): SubtitleSource {
  const listeners: CueListener[] = [];
  let track: InterceptedTrack | null = null;
  let activeCue: SubtitleCue | null = null;
  let lastEmittedId: string | null = null;
  let hideStyle: HTMLStyleElement | null = null;
  let lastVideo: HTMLVideoElement | null = null;
  let pollHandle: number | null = null;
  /** F6: subscribers of the full track. */
  const trackCueListeners: Array<(cues: SubtitleCue[]) => void> = [];

  function getVideo(): HTMLVideoElement | null {
    if (opts.getVideo) return opts.getVideo();
    return document.querySelector<HTMLVideoElement>('video');
  }

  function pickCueAt(timeMs: number): SubtitleCue | null {
    if (!track) return null;
    const hit = findCueAt(track.cues, timeMs);
    if (!hit) return null;
    return {
      id: `${opts.platform}-${hit.start}-${hit.end}`,
      start: hit.start,
      end: hit.end,
      text: hit.text,
      // The TRACK's language, never the learning language: stamping
      // `sourceLang` here made a Spanish track look English, so the
      // disagreement notice never fired and lookups went to the wrong
      // dictionary.
      language: track.language ?? '',
      align: hit.align,
    };
  }

  function tick() {
    const video = getVideo();
    if (video) lastVideo = video;
    if (!video || !track) {
      if (activeCue !== null) {
        activeCue = null;
        lastEmittedId = null;
        listeners.forEach((l) => l([]));
      }
      return;
    }
    const cue = pickCueAt(video.currentTime * 1000);
    if (cue?.id !== lastEmittedId) {
      activeCue = cue;
      lastEmittedId = cue?.id ?? null;
      listeners.forEach((l) => l(cue ? [cue] : []));
    }
  }

  function startPolling() {
    if (pollHandle != null) return;
    // 50 ms is fast enough that the source caption lights up within one
    // animation frame of the underlying video reaching that timestamp.
    // Cheap too — `pickCueAt` is just an array find.
    pollHandle = window.setInterval(tick, 50);
  }

  function stopPolling() {
    if (pollHandle != null) {
      window.clearInterval(pollHandle);
      pollHandle = null;
    }
  }

  /**
   * The source-track language, resolved the same way youtube.ts resolves
   * it: the user's configured `translate.sourceLang` (the language they
   * are LEARNING) wins; `'en'` only covers the bootstrap window before the
   * store hydrates. Read live — never once at mount — so a panel language
   * change takes effect without waiting for a page reload. This is what
   * keeps the adapter's adoption key in step with the DASH loader, which
   * downloads the source track under the very same `translate.sourceLang`.
   */
  function sourceLanguage(): string {
    return useKivaraStore.getState().translate.sourceLang || 'en';
  }

  /** Primary language for adoption/lookup (just the primary subtag). */
  function primaryLang(): string {
    return sourceLanguage().split(/[-_]/)[0].toLowerCase();
  }

  /** F6: the whole cue list of the active (or last known) track. */
  function fullTrack(): SubtitleCue[] {
    const source = track ?? getTrackByLanguage(primaryLang()) ?? getLastTrack();
    if (!source || source.cues.length === 0) return [];
    return cuesFromRawTrack(source.cues, source.language ?? '', opts.platform);
  }

  function notifyTrackListeners() {
    const cues = fullTrack();
    if (cues.length === 0) return;
    trackCueListeners.forEach((listener) => {
      try {
        listener(cues);
      } catch (err) {
        console.warn('[Kivara Lingo] track listener threw', err);
      }
    });
  }

  // Subscribe to intercepted tracks (replays last one if already seen).
  // Only adopt a track as the *primary* (source) caption when its detected
  // language matches the user's configured source language — or when the
  // language is unknown (legacy interceptors don't tag language). Tracks
  // for other languages (e.g. the native ES dual caption) live on the bus
  // and are pulled via `getAltCueAt(...)` without disturbing the active
  // source caption.
  const offTrack = onTrack((next) => {
    const nextLang = next.language?.split(/[-_]/)[0].toLowerCase() ?? null;
    if (nextLang && nextLang !== primaryLang()) {
      // A track in another language. It stays on the bus for the alt-cue
      // lookup, and it is used as the caption ONLY while no source-language
      // track exists: dropping it left the overlay blank with no explanation
      // (QA: a Spanish TTML with xml:lang="es" and a learner on English showed
      // nothing at all). App reads the cue's language and explains the
      // mismatch.
      if (!track) {
        track = next;
        // Two tracks can share cue timings (same subtitle, different
        // language). The cue id is built from start/end, so without this a
        // track swap kept the OLD text on screen until the next boundary.
        lastEmittedId = null;
        tick();
        startPolling();
        notifyTrackListeners();
      } else {
        startPolling();
      }
      return;
    }
    track = next;
    lastEmittedId = null;
    tick();
    startPolling();
    // F6: a fresh (or translated) track is a new full cue list for the rail.
    notifyTrackListeners();
  });

  // Start polling regardless — the next track may arrive at any time
  startPolling();

  if (opts.hideNativeCss) {
    hideStyle = buildHideStyle(opts.hideNativeCss);
  }

  try {
    opts.onMount?.();
  } catch (err) {
    console.warn('[Kivara Lingo] adapter onMount threw', err);
  }

  return {
    platform: opts.platform,
    onCueChange(listener) {
      listeners.push(listener);
    },
    getCurrentTime() {
      const v = getVideo() ?? lastVideo;
      return (v?.currentTime ?? 0) * 1000;
    },
    getActiveCue() {
      return activeCue;
    },
    hideNativeSubtitles() {
      if (opts.hideNativeCss && !hideStyle) {
        hideStyle = buildHideStyle(opts.hideNativeCss);
      }
    },
    showNativeSubtitles() {
      // Remove the injected <style> only — the poll CONTINUES. show/hide is
      // a visibility state, not an end of cue flow: App.tsx hides native
      // captions while the overlay is on, shows them while the overlay is
      // off, and the poll must stay alive across every toggle. If a `hide`
      // → `show` cycle after a poll-killing `show` left `pollHandle === null`,
      // no further cues would ever emit — the overlay would freeze on its
      // first subtitle while the video kept playing, which was the
      // regression.
      if (hideStyle) {
        hideStyle.remove();
        hideStyle = null;
      }
      startPolling();
    },
    getAltCueAt(timeMs, lang, sourceRange) {
      const altTrack = getTrackByLanguage(lang);
      if (!altTrack) return null;
      // Skip when the alt track *is* the active track (same URL) — that
      // would just mirror the source caption back, defeating the purpose.
      if (track && altTrack.url === track.url) return null;
      const hit = pickBestAltCue(altTrack.cues, timeMs, sourceRange);
      if (!hit) return null;
      return {
        id: `${opts.platform}-alt-${lang}-${hit.start}-${hit.end}`,
        start: hit.start,
        end: hit.end,
        text: hit.text,
        language: altTrack.language ?? lang,
        align: hit.align,
      };
    },
    getAvailableAltLanguages() {
      return getKnownLanguages();
    },
    getTrackCues() {
      return fullTrack();
    },
    onTrackCues(cb) {
      trackCueListeners.push(cb);
      const initial = fullTrack();
      if (initial.length > 0) {
        try {
          cb(initial);
        } catch {
          /* keep the subscription */
        }
      }
      return () => {
        const index = trackCueListeners.indexOf(cb);
        if (index !== -1) trackCueListeners.splice(index, 1);
      };
    },
    playback: opts.playback === 'netflix'
      ? createNetflixPlaybackController(() => getVideo() ?? lastVideo)
      : createMediaPlaybackController(() => getVideo() ?? lastVideo, { platform: opts.platform }),
    ...(opts.getMediaInfo ? { getMediaInfo: opts.getMediaInfo } : {}),
    destroy() {
      // Everything this context started, undone. Anything left running would
      // survive a SPA navigation — see SubtitleSource.destroy.
      stopPolling();
      offTrack();
      listeners.length = 0;
      trackCueListeners.length = 0;
      if (hideStyle) {
        hideStyle.remove();
        hideStyle = null;
      }
      track = null;
      activeCue = null;
    },
  };
}
