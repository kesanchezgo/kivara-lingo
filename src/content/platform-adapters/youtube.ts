import type { SubtitleSource, SubtitleCue, CueListener } from './types';
import { useKivaraStore } from '../../shared/store';

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
    const text = Array.from(cues)
      .map((c) => (c as VTTCue).text || '')
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .trim();
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
    const sourceLang = useKivaraStore.getState().translate.sourceLang || 'en';
    const langMatch = subtitleTracks.find(
      (t) => t.language && t.language.startsWith(sourceLang),
    );
    if (langMatch) return langMatch;
    // Fall back to the currently showing track, then any available
    return (
      subtitleTracks.find((t) => t.mode === 'showing') ??
      subtitleTracks[0]
    );
  }

  function pollDom() {
    if (activeTrack && activeTrack.activeCues && activeTrack.activeCues.length > 0) return;
    const segments = document.querySelectorAll('.captions-text');
    if (!segments.length) {
      if (currentActiveCue) emit(null);
      return;
    }
    const text = Array.from(segments)
      .map((el) => el.textContent || '')
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
  };
}
