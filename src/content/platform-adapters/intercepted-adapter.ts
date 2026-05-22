/**
 * Generic adapter factory used by all streaming platforms that ship subtitles
 * over network requests (Netflix, Disney+, HBO Max, Prime Video). Each
 * platform supplies its `platform` tag, `language`, video selector and the
 * CSS used to hide the native subtitles. The cue data itself comes from the
 * MAIN-world interceptor via `intercepted-bus`.
 */
import {
  getKnownLanguages,
  getTrackByLanguage,
  onTrack,
  type InterceptedTrack,
} from './intercepted-bus';
import type { CueListener, SubtitleCue, SubtitleSource } from './types';

export interface InterceptedAdapterOptions {
  platform: SubtitleSource['platform'];
  /** BCP-47 language tag for cues (best-guess; Phase 3: parse from manifest) */
  language: string;
  /** CSS to inject in document head to hide the native subtitle layer */
  hideNativeCss?: string;
  /** Optional callback for adapter-specific setup */
  onMount?(): void;
  /** Override to find the active video element */
  getVideo?(): HTMLVideoElement | null;
}

function injectStyle(id: string, css: string): HTMLStyleElement | null {
  if (!css) return null;
  if (document.getElementById(id)) return document.getElementById(id) as HTMLStyleElement;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = css;
  document.documentElement.appendChild(style);
  return style;
}

/**
 * Find the cue from `track` that best matches the requested time / range.
 *
 * Lookup order:
 *   1. If `sourceRange` is given, find the cue with the MAXIMUM temporal
 *      overlap with `[sourceRange.start, sourceRange.end]`. This is the
 *      deterministic behaviour: for any two tracks with even partial
 *      overlap we always pick the same alt cue, regardless of how the
 *      timestamps drift.
 *   2. Containment of the point: any cue whose window covers `timeMs`.
 *   3. Nearest cue (by midpoint distance) within `NEAREST_TOLERANCE_MS`
 *      of `timeMs`. Catches the edge case where the alt cue starts or
 *      ends a few hundred ms before/after the source cue.
 *
 * Returns `null` when even the nearest cue is too far to be plausible.
 */
function pickBestAltCue(
  cues: ReadonlyArray<{ start: number; end: number; text: string; align?: SubtitleCue['align'] }>,
  timeMs: number,
  sourceRange?: { start: number; end: number },
): { start: number; end: number; text: string; align?: SubtitleCue['align'] } | null {
  if (cues.length === 0) return null;

  // 1. Range-aware overlap pick — most deterministic when we know
  //    the source range.
  if (sourceRange && sourceRange.end > sourceRange.start) {
    let bestOverlap = 0;
    let bestCue: typeof cues[number] | null = null;
    let bestDistance = Infinity;
    for (const c of cues) {
      // Skip cues that can't possibly overlap the source range.
      if (c.end < sourceRange.start) continue;
      if (c.start > sourceRange.end) break; // cues are time-sorted
      const overlapStart = Math.max(c.start, sourceRange.start);
      const overlapEnd = Math.min(c.end, sourceRange.end);
      const overlap = overlapEnd - overlapStart;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestCue = c;
        bestDistance = 0;
      } else if (overlap === bestOverlap && bestCue && overlap > 0) {
        // Tie-break by midpoint proximity to source midpoint.
        const sourceMid = (sourceRange.start + sourceRange.end) / 2;
        const cMid = (c.start + c.end) / 2;
        const dist = Math.abs(cMid - sourceMid);
        if (dist < bestDistance) {
          bestCue = c;
          bestDistance = dist;
        }
      }
    }
    if (bestCue) return bestCue;
  }

  // 2. Strict containment of the requested timestamp.
  const contained = cues.find((c) => timeMs >= c.start && timeMs <= c.end);
  if (contained) return contained;

  // 3. Nearest cue by midpoint distance, with a generous tolerance so
  //    we still resolve when the alt track lags or leads the source by
  //    up to 1.5 s — beyond that we'd risk attaching the wrong line.
  const NEAREST_TOLERANCE_MS = 1500;
  let nearest: typeof cues[number] | null = null;
  let nearestDelta = Infinity;
  for (const c of cues) {
    if (c.end < timeMs - NEAREST_TOLERANCE_MS) continue;
    if (c.start > timeMs + NEAREST_TOLERANCE_MS) break;
    const mid = (c.start + c.end) / 2;
    const delta = Math.abs(mid - timeMs);
    if (delta < nearestDelta) {
      nearestDelta = delta;
      nearest = c;
    }
  }
  return nearest;
}

export function createInterceptedAdapter(opts: InterceptedAdapterOptions): SubtitleSource {
  const listeners: CueListener[] = [];
  let track: InterceptedTrack | null = null;
  let activeCue: SubtitleCue | null = null;
  let lastEmittedId: string | null = null;
  let hideStyle: HTMLStyleElement | null = null;
  let lastVideo: HTMLVideoElement | null = null;
  let pollHandle: number | null = null;

  function getVideo(): HTMLVideoElement | null {
    if (opts.getVideo) return opts.getVideo();
    return document.querySelector<HTMLVideoElement>('video');
  }

  function pickCueAt(timeMs: number): SubtitleCue | null {
    if (!track) return null;
    const hit = track.cues.find((c) => timeMs >= c.start && timeMs <= c.end);
    if (!hit) return null;
    return {
      id: `${opts.platform}-${hit.start}-${hit.end}`,
      start: hit.start,
      end: hit.end,
      text: hit.text,
      language: opts.language,
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

  // Primary language for the adapter (just the two-letter subtag).
  const primaryLang = opts.language.split(/[-_]/)[0].toLowerCase();

  // Subscribe to intercepted tracks (replays last one if already seen).
  // Only adopt a track as the *primary* (source) caption when its detected
  // language matches `opts.language` — or when the language is unknown
  // (legacy interceptors don't tag language). Tracks for other languages
  // (e.g. the native ES dual caption) live on the bus and are pulled via
  // `getAltCueAt(...)` without disturbing the active source caption.
  onTrack((next) => {
    const nextLang = next.language?.split(/[-_]/)[0].toLowerCase() ?? null;
    if (nextLang && nextLang !== primaryLang) {
      // Track for a *different* language — keep the bus copy for the alt
      // cue lookup, but don't replace our source captions. Polling stays
      // alive so when (and if) a matching primary track arrives later we
      // pick it up immediately.
      startPolling();
      return;
    }
    track = next;
    tick();
    startPolling();
  });

  // Start polling regardless — the next track may arrive at any time
  startPolling();

  if (opts.hideNativeCss) {
    hideStyle = injectStyle(`kivara-hide-native-${opts.platform}`, opts.hideNativeCss);
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
    seek(timeMs) {
      const v = getVideo() ?? lastVideo;
      if (v) v.currentTime = timeMs / 1000;
    },
    hideNativeSubtitles() {
      if (opts.hideNativeCss && !hideStyle) {
        hideStyle = injectStyle(`kivara-hide-native-${opts.platform}`, opts.hideNativeCss);
      }
    },
    showNativeSubtitles() {
      if (hideStyle) {
        hideStyle.remove();
        hideStyle = null;
      }
      stopPolling();
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
  };
}
