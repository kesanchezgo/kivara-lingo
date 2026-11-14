import type { SubtitleSource, SubtitleCue, CueListener } from './types';
import { getYouTubeMediaInfo } from './media-info';
import { useKivaraStore } from '../../shared/use-kivara-store';
import {
  getActiveTrackCues,
  getKnownLanguages,
  getLastTrack,
  getTrackByLanguage,
  onTrack,
  type InterceptedTrack,
} from './intercepted-bus';
import { createMediaPlaybackController } from './playback';
import {
  cueFromRaw,
  cuesFromRawTrack,
  cuesFromTextTracks,
  findCueAt,
  findCueByText,
  pickBestAltCue,
} from './tracks';

/**
 * YouTube adapter.
 *
 * Strategy:
 *  1) Prefer the intercepted track on the bus. The MAIN-world interceptor
 *     already holds the WHOLE `/api/timedtext` track (source and translated)
 *     with the real timings, so the active cue is a pure containment lookup
 *     by `video.currentTime` — no guessing.
 *  2) The HTML5 `<video>.textTracks` API is the second source; the browser's
 *     VTTCue bounds are real too, and `cuechange` is precise.
 *  3) YouTube's caption DOM (`.caption-visual-line`) is the LAST resort, for
 *     live streams and players that render captions without exposing either.
 *     Its text is re-anchored to the bus by NORMALISED text, so the emitted
 *     cue keeps the track's real start/end/id; `[now, now+2000]` survives
 *     only when the bus has no track at all.
 *  4) Inject CSS to permanently hide YouTube's native caption window.
 */
export function attachYouTube(): SubtitleSource | null {
  const videoEl = document.querySelector<HTMLVideoElement>('video');
  if (!videoEl) return null;
  const video: HTMLVideoElement = videoEl;

  const listeners: CueListener[] = [];
  let currentActiveCue: SubtitleCue | null = null;

  let activeTrack: TextTrack | null = null;
  let pollHandle: number | null = null;

  // Per-adapter OWNED style node. Previously the id was shared
  // (`kivara-lingo-yt-hide`), and showNativeSubtitles/destroy looked it
  // up by ID and removed it, which would nuke the node of a SIBLING
  // adapter on the same <video>. That is exactly what the review's #3
  // catches: an adapter that DIES (including init's new bail-out path)
  // was removing the hide-style the surviving adapter was still using,
  // and native captions came back. Now every adapter has its own.
  let ownStyle: HTMLStyleElement | null = null;

  /** F6: subscribers of the full track (the transcript rail and episode words). */
  const trackCueListeners: Array<(cues: SubtitleCue[]) => void> = [];
  let busUnsub: (() => void) | null = null;

  function emit(cue: SubtitleCue | null) {
    currentActiveCue = cue;
    listeners.forEach((l) => l(cue ? [cue] : []));
  }

  /** Emit only when the active cue actually changed (the poll runs at 120 ms). */
  function emitActive(cue: SubtitleCue | null) {
    if (cue === null) {
      if (currentActiveCue) emit(null);
      return;
    }
    const current = currentActiveCue;
    if (
      current &&
      current.id === cue.id &&
      current.start === cue.start &&
      current.end === cue.end &&
      current.text === cue.text
    ) {
      return;
    }
    emit(cue);
  }

  function sourceLanguage(): string {
    return useKivaraStore.getState().translate.sourceLang || 'en';
  }

  /**
   * The source-language track on the intercepted bus. Falls back to the last
   * track of any language (legacy interceptors don't tag language), exactly
   * like `intercepted-adapter.ts` and `fullTrack()`.
   */
  function sourceTrack(): InterceptedTrack | null {
    return getTrackByLanguage(sourceLanguage()) ?? getLastTrack();
  }

  /** The bus cue containing `timeMs`, with the track's real id/start/end. */
  function busCueAt(timeMs: number): SubtitleCue | null {
    const track = sourceTrack();
    if (!track || track.cues.length === 0) return null;
    const hit = findCueAt(track.cues, timeMs);
    if (!hit) return null;
    return cueFromRaw(hit, track.language || sourceLanguage(), 'youtube');
  }

  /** The bus cue matching a piece of DOM caption text, by normalised text. */
  function busCueByText(text: string): SubtitleCue | null {
    const track = sourceTrack();
    if (!track || track.cues.length === 0) return null;
    const hit = findCueByText(track.cues, text);
    if (!hit) return null;
    return cueFromRaw(hit, track.language || sourceLanguage(), 'youtube');
  }

  /**
   * Last-resort path: the caption text came from the DOM. Re-anchor it to the
   * bus by normalised text so the cue keeps the track's real timings. Only
   * when the bus has NO track do we fall back to `[now, now+2000]` — invented
   * bounds are worse than none, because they become the saved card's
   * `cueStart` / `cueEnd`.
   */
  function pushFromText(text: string) {
    const trimmed = text.trim();
    if (!trimmed) {
      emitActive(null);
      return;
    }
    const track = sourceTrack();
    if (track && track.cues.length > 0) {
      emitActive(busCueByText(trimmed));
      return;
    }
    if (currentActiveCue && currentActiveCue.text === trimmed) return;
    const now = video.currentTime * 1000;
    emit({
      id: `${now}`,
      start: now,
      end: now + 2000,
      text: trimmed,
      language: activeTrack?.language || sourceLanguage(),
    });
  }

  function onCueChange() {
    if (!activeTrack) return;
    const cues = activeTrack.activeCues;
    if (!cues || cues.length === 0) {
      // A `textTracks` cue ending does not mean the line ended: the bus may
      // still hold it (and the DOM may still show it). The poll decides.
      return;
    }

    // The intercepted track is authoritative: the playhead alone answers
    // which line is active, with the file's own timings.
    const fromBus = busCueAt(video.currentTime * 1000);
    if (fromBus) {
      emitActive(fromBus);
      return;
    }

    // Build the text. YouTube delivers multi-line subtitles in different ways:
    //   a) Multiple active VTTCues (one per line)
    //   b) A single VTTCue with \n inside the text
    //   c) A single VTTCue without \n but the DOM shows multiple .captions-text
    // We handle all three by first joining cues with \n, then checking the DOM
    // for the actual line structure if the text doesn't already contain \n.
    let text = Array.from(cues)
      .map((c) => (c as VTTCue).text || '')
      .join('\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .trim();

    // If the text has no newlines but the DOM shows multiple caption segments,
    // use the DOM structure to insert line breaks.
    if (!text.includes('\n')) {
      const segments = document.querySelectorAll(
        '.captions-text .ytp-caption-segment, .captions-text',
      );
      if (segments.length > 1) {
        const domText = Array.from(segments)
          .map((el) => (el.textContent || '').trim())
          .filter(Boolean)
          .join('\n');
        if (domText) text = domText;
      }
    }

    if (!text) {
      emitActive(null);
      return;
    }
    // The bus holds a track but the playhead is in a gap (drift / a cue the
    // element has not switched yet): re-anchor by text, never by guess.
    const track = sourceTrack();
    if (track && track.cues.length > 0) {
      emitActive(busCueByText(text));
      return;
    }
    const first = cues[0] as VTTCue;
    const last = cues[cues.length - 1] as VTTCue;
    const align = (first as VTTCue).align;
    const cueAlign: SubtitleCue['align'] =
      align === 'start' || align === 'left' ? 'start'
      : align === 'end' || align === 'right' ? 'end'
      : align === 'center' ? 'center'
      : undefined;
    emit({
      id: first.id || `${first.startTime}`,
      start: first.startTime * 1000,
      end: last.endTime * 1000,
      text,
      language: activeTrack.language || sourceLanguage(),
      align: cueAlign,
    });
  }

  function bindTrack(track: TextTrack) {
    if (activeTrack === track) return;
    // Remove OUR OWN handler only — never hold the `oncuechange` slot
    // hostage. Two adapters on the same <video> (a pending navigation
    // re-attaching while the previous is shutting down) both want to
    // attach and the LAST one wins; if destroy() nulls the slot without
    // checking WHOSE it is, the surviving adapter loses the callback and
    // cues freeze silently. addEventListener/removeEventListener with
    // OUR OWN reference keeps that from happening.
    if (activeTrack) {
      activeTrack.removeEventListener('cuechange', onCueChange);
    }
    activeTrack = track;
    track.mode = 'hidden';
    track.addEventListener('cuechange', onCueChange);
    // The full cue list arrives with the track's `load`; re-read it then so
    // the transcript does not wait for the 1.5 s fallback poll.
    track.addEventListener('load', notifyTrackListeners);
    onCueChange();
  }

  function pickTextTrack(): TextTrack | null {
    const tracks = Array.from(video.textTracks ?? []);
    const subtitleTracks = tracks.filter(
      (t) => t.kind === 'subtitles' || t.kind === 'captions',
    );
    if (subtitleTracks.length === 0) return null;

    // Prefer the track matching the user's configured source language
    // (the language they're learning). If found, activate it.
    const sourceLang = useKivaraStore.getState().translate.sourceLang || 'en';
    const langMatch = subtitleTracks.find(
      (t) => t.language && (
        t.language.startsWith(sourceLang) ||
        t.language === sourceLang
      ),
    );
    if (langMatch) {
      // Activate this track if it's not already showing/hidden
      if (langMatch.mode === 'disabled') {
        langMatch.mode = 'hidden';
      }
      return langMatch;
    }

    // Fall back to the currently showing track
    const showing = subtitleTracks.find((t) => t.mode === 'showing');
    if (showing) return showing;

    // Fall back to any non-disabled track
    const active = subtitleTracks.find((t) => t.mode !== 'disabled');
    if (active) return active;

    // Last resort: activate the first available
    if (subtitleTracks[0]) {
      subtitleTracks[0].mode = 'hidden';
      return subtitleTracks[0];
    }
    return null;
  }

  function pollDom() {
    // 1. The intercepted track holds the whole subtitle file with real
    //    timings: the playhead alone answers which line is active. This is
    //    the primary source (and the only one that works when the player
    //    renders `/api/timedtext` without a `<video>.textTracks` entry).
    const fromBus = busCueAt(video.currentTime * 1000);
    if (fromBus) {
      emitActive(fromBus);
      return;
    }

    // When TextTracks are available and have active cues, prefer them.
    if (activeTrack && activeTrack.activeCues && activeTrack.activeCues.length > 0) return;

    // 2. Last resort: YouTube renders captions in the DOM using
    //    .caption-visual-line elements
    // (one per line). Fall back to .captions-text if the newer structure isn't
    // found. Each .caption-visual-line is a separate line of the subtitle.
    const lines = document.querySelectorAll('.caption-visual-line');
    if (lines.length > 0) {
      const text = Array.from(lines)
        .map((el) => (el.textContent || '').trim())
        .filter(Boolean)
        .join('\n');
      pushFromText(text);
      return;
    }

    // Legacy fallback: older YouTube builds use .captions-text directly
    const segments = document.querySelectorAll('.captions-text');
    if (!segments.length) {
      if (currentActiveCue) emit(null);
      return;
    }
    const text = Array.from(segments)
      .map((el) => (el.textContent || '').trim())
      .filter(Boolean)
      .join('\n');
    pushFromText(text);
  }

  function startPolling() {
    if (pollHandle != null) return;
    pollHandle = window.setInterval(pollDom, 120);
  }

  function tryAttach() {
    const track = pickTextTrack();
    if (track) bindTrack(track);
  }

  /**
   * Full track (F6). YouTube exposes the whole cue list on the `<track>` once
   * captions are on; when the player renders captions from `/api/timedtext`
   * without a TextTrack, the MAIN-world interceptor has the parsed track on
   * the bus instead. Bus first (it also carries the translated track), then
   * the element.
   */
  function fullTrack(): SubtitleCue[] {
    const sourceLang = useKivaraStore.getState().translate.sourceLang || 'en';
    const raw =
      getTrackByLanguage(sourceLang)?.cues ?? getLastTrack()?.cues ?? getActiveTrackCues();
    if (raw && raw.length > 0) {
      return cuesFromRawTrack(raw, sourceLang, 'youtube');
    }
    return cuesFromTextTracks(video, sourceLang, 'youtube');
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

  // Initial attempt + listen for added tracks
  tryAttach();
  if (video.textTracks?.addEventListener) {
    video.textTracks.addEventListener('addtrack', tryAttach);
    video.textTracks.addEventListener('change', tryAttach);
    video.textTracks.addEventListener('addtrack', notifyTrackListeners);
    video.textTracks.addEventListener('change', notifyTrackListeners);
  }
  // The DOM-based fallback always runs as a safety net.
  startPolling();

  function ensureHideStyle() {
    if (ownStyle) return;
    const style = document.createElement('style');
    style.textContent = [
      '.ytp-caption-window-container { opacity: 0 !important; pointer-events: none !important; }',
      '.caption-window { opacity: 0 !important; pointer-events: none !important; }',
      'video::cue { opacity: 0 !important; }',
    ].join('\n');
    document.head.appendChild(style);
    ownStyle = style;
  }

  return {
    platform: 'youtube',
    onCueChange(listener) {
      listeners.push(listener);
      if (currentActiveCue) listener([currentActiveCue]);
    },
    getCurrentTime() {
      return video.currentTime * 1000;
    },
    getActiveCue() {
      return currentActiveCue;
    },
    hideNativeSubtitles() {
      ensureHideStyle();
      if (activeTrack) activeTrack.mode = 'hidden';
    },
    showNativeSubtitles() {
      if (ownStyle) {
        ownStyle.remove();
        ownStyle = null;
      }
      if (activeTrack) activeTrack.mode = 'showing';
    },
    getMediaInfo() {
      return getYouTubeMediaInfo();
    },
    getTrackCues() {
      return fullTrack();
    },
    onTrackCues(cb) {
      trackCueListeners.push(cb);
      // The interceptor may publish a /api/timedtext track after mount (and
      // the translated one later still): re-emit on every bus update.
      if (!busUnsub) {
        busUnsub = onTrack((track) => {
          if (!track.cues?.length) return;
          notifyTrackListeners();
          // The track (or its translated sibling) may arrive mid-cue, after
          // the last poll tick — resolve the active line right away instead
          // of waiting for the next 120 ms tick.
          const fromBus = busCueAt(video.currentTime * 1000);
          if (fromBus) emitActive(fromBus);
        });
      }
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
        if (trackCueListeners.length === 0 && busUnsub) {
          busUnsub();
          busUnsub = null;
        }
      };
    },
    playback: createMediaPlaybackController(() => video, { platform: 'youtube' }),
    destroy() {
      // A YouTube SPA navigation reuses the SAME <video>, so without this the
      // old adapter's 120 ms poll and its textTracks listeners keep running
      // against the next video — and the previous video's captions keep
      // answering as if they were current. See SubtitleSource.destroy.
      if (pollHandle != null) {
        window.clearInterval(pollHandle);
        pollHandle = null;
      }
      if (activeTrack) {
        // removeEventListener with OUR OWN reference — never a blunt
        // "oncuechange = null" (that could nuke a sibling adapter's
        // handler on the same shared <video>).
        activeTrack.removeEventListener('cuechange', onCueChange);
        activeTrack.removeEventListener('load', notifyTrackListeners);
        activeTrack = null;
      }
      if (video.textTracks?.removeEventListener) {
        video.textTracks.removeEventListener('addtrack', tryAttach);
        video.textTracks.removeEventListener('change', tryAttach);
        video.textTracks.removeEventListener('addtrack', notifyTrackListeners);
        video.textTracks.removeEventListener('change', notifyTrackListeners);
      }
      busUnsub?.();
      busUnsub = null;
      trackCueListeners.length = 0;
      // Only OUR OWN style node — not a lookup by shared ID, which is
      // what the review's #3 flagged: a sibling adapter on the same
      // <video> still has its hide-style inserted, and looking it up by
      // ID-and-killing-it would let native captions reappear.
      if (ownStyle) {
        ownStyle.remove();
        ownStyle = null;
      }
      listeners.length = 0;
      currentActiveCue = null;
    },
    /**
     * Native-language alternate cue lookup. YouTube does NOT expose the
     * parallel subtitle track via `video.textTracks` (only the active one
     * shows up there), so we read directly from the intercepted-bus, which
     * captures every `/api/timedtext` fetch the player makes — including
     * the auto-translated track the user enables in the gear menu.
     *
     * Uses the same overlap-aware lookup as `intercepted-adapter.ts`: when
     * a `sourceRange` is provided we pick the alt cue with the maximum
     * temporal overlap with the source range, deterministic regardless of
     * timestamp drift between the two tracks.
     */
    getAltCueAt(
      timeMs: number,
      lang: string,
      sourceRange?: { start: number; end: number },
    ): SubtitleCue | null {
      const altTrack = getTrackByLanguage(lang);
      if (!altTrack) return null;
      const hit = pickBestAltCue(altTrack.cues, timeMs, sourceRange);
      if (!hit) return null;
      return {
        id: `youtube-alt-${lang}-${hit.start}-${hit.end}`,
        start: hit.start,
        end: hit.end,
        text: hit.text,
        language: altTrack.language ?? lang,
        align: hit.align,
      };
    },
    getAvailableAltLanguages(): string[] {
      return getKnownLanguages();
    },
  };
}
