import type { SubtitleSource, SubtitleCue, CueListener } from './types';
import { useKivaraStore } from '../../shared/store';
import { getKnownLanguages, getTrackByLanguage } from './intercepted-bus';

/**
 * YouTube adapter.
 *
 * Strategy:
 *  1) Prefer the HTML5 `<video>.textTracks` API. YouTube exposes timed-text
 *     tracks once captions are enabled by the user. We switch the active
 *     track to `hidden` to suppress YouTube's own rendering and listen to
 *     `cuechange` for precise cue boundaries.
 *  2) Fall back to polling YouTube's caption DOM (`.captions-text`) so the
 *     adapter still works on live streams or when YouTube renders captions
 *     without exposing a TextTrack.
 *  3) Inject CSS to permanently hide YouTube's native caption window.
 */
export function attachYouTube(): SubtitleSource | null {
  const videoEl = document.querySelector<HTMLVideoElement>('video');
  if (!videoEl) return null;
  const video: HTMLVideoElement = videoEl;

  const listeners: CueListener[] = [];
  let currentActiveCue: SubtitleCue | null = null;

  let activeTrack: TextTrack | null = null;
  let pollHandle: number | null = null;

  const HIDE_STYLE_ID = 'kivara-lingo-yt-hide';

  function emit(cue: SubtitleCue | null) {
    currentActiveCue = cue;
    listeners.forEach((l) => l(cue ? [cue] : []));
  }

  function pushFromText(text: string) {
    const trimmed = text.trim();
    if (!trimmed) {
      if (currentActiveCue) emit(null);
      return;
    }
    if (currentActiveCue && currentActiveCue.text === trimmed) return;
    const now = video.currentTime * 1000;
    emit({
      id: `${now}`,
      start: now,
      end: now + 2000,
      text: trimmed,
      language: activeTrack?.language || 'en',
    });
  }

  function onCueChange() {
    if (!activeTrack) return;
    const cues = activeTrack.activeCues;
    if (!cues || cues.length === 0) {
      if (currentActiveCue) emit(null);
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
      if (currentActiveCue) emit(null);
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
      language: activeTrack.language || 'en',
      align: cueAlign,
    });
  }

  function bindTrack(track: TextTrack) {
    if (activeTrack === track) return;
    if (activeTrack) activeTrack.oncuechange = null;
    activeTrack = track;
    track.mode = 'hidden';
    track.oncuechange = onCueChange;
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
    // When TextTracks are available and have active cues, prefer them.
    if (activeTrack && activeTrack.activeCues && activeTrack.activeCues.length > 0) return;

    // YouTube renders captions in the DOM using .caption-visual-line elements
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

  // Initial attempt + listen for added tracks
  tryAttach();
  if (video.textTracks?.addEventListener) {
    video.textTracks.addEventListener('addtrack', tryAttach);
    video.textTracks.addEventListener('change', tryAttach);
  }
  // The DOM-based fallback always runs as a safety net.
  startPolling();

  function ensureHideStyle() {
    if (document.getElementById(HIDE_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = HIDE_STYLE_ID;
    style.textContent = [
      '.ytp-caption-window-container { opacity: 0 !important; pointer-events: none !important; }',
      '.caption-window { opacity: 0 !important; pointer-events: none !important; }',
      'video::cue { opacity: 0 !important; }',
    ].join('\n');
    document.head.appendChild(style);
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
    seek(timeMs) {
      video.currentTime = timeMs / 1000;
    },
    hideNativeSubtitles() {
      ensureHideStyle();
      if (activeTrack) activeTrack.mode = 'hidden';
    },
    showNativeSubtitles() {
      const style = document.getElementById(HIDE_STYLE_ID);
      if (style) style.remove();
      if (activeTrack) activeTrack.mode = 'showing';
    },
    /**
     * Native-language alternate cue lookup. YouTube does NOT expose the
     * parallel subtitle track via `video.textTracks` (only the active one
     * shows up there), so we read directly from the intercepted-bus, which
     * captures every `/api/timedtext` fetch the player makes — including
     * the auto-translated track the user enables in the gear menu.
     *
     * Pattern mirrors `intercepted-adapter.ts` 1:1 so behaviour matches
     * Netflix / HBO / Disney / Prime.
     */
    getAltCueAt(timeMs: number, lang: string): SubtitleCue | null {
      const altTrack = getTrackByLanguage(lang);
      if (!altTrack) return null;
      const hit = altTrack.cues.find((c) => timeMs >= c.start && timeMs <= c.end);
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
