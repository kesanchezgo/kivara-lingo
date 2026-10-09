import { SubtitleSource, SubtitleCue, CueListener } from './types';

export function attachGenericHtml5(video: HTMLVideoElement): SubtitleSource {
  const listeners: CueListener[] = [];
  let currentActiveCue: SubtitleCue | null = null;
  let activeTrack: TextTrack | null = null;

  const handleCueChange = () => {
    if (!activeTrack) return;
    const activeCues = activeTrack.activeCues;
    if (activeCues && activeCues.length > 0) {
      const nativeCue = activeCues[0] as VTTCue;
      // `align` on a VTTCue is one of 'start' | 'center' | 'end' | 'left'
      // | 'right'. We pass it through verbatim; the overlay decides whether
      // to honor it (settings → "Mantener alineación nativa").
      const rawAlign = (nativeCue as VTTCue).align as
        | 'start'
        | 'center'
        | 'end'
        | 'left'
        | 'right'
        | undefined;
      currentActiveCue = {
        id: nativeCue.id || Math.random().toString(),
        start: nativeCue.startTime * 1000,
        end: nativeCue.endTime * 1000,
        // Sometimes VTTCue text has HTML tags like <i>, let's clean them, but for MVP keep raw:
        text: nativeCue.text,
        language: activeTrack.language || 'en',
        align: rawAlign,
      };
      listeners.forEach(l => l([currentActiveCue!]));
    } else {
      currentActiveCue = null;
      listeners.forEach(l => l([]));
    }
  };

  const bindTrack = (track: TextTrack) => {
    if (activeTrack) {
      activeTrack.oncuechange = null;
    }
    activeTrack = track;
    track.mode = 'hidden'; // Hide the native one
    track.oncuechange = handleCueChange;
    // Trigger immediately in case there's already an active cue
    handleCueChange();
  };

  // Try to find existing
  const existingTrack = Array.from(video.textTracks).find(t => t.kind === 'subtitles' || t.kind === 'captions');
  if (existingTrack) {
    bindTrack(existingTrack);
  }

  // Listen for added tracks
  const onAddTrack = (e: Event) => {
    const track = (e as { track?: TextTrack }).track;
    if (track && (track.kind === 'subtitles' || track.kind === 'captions')) {
      bindTrack(track);
    }
  };
  video.textTracks.addEventListener('addtrack', onAddTrack);

  return {
    platform: 'generic',
    onCueChange(listener) {
      listeners.push(listener);
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
      if (activeTrack) activeTrack.mode = 'hidden';
    },
    showNativeSubtitles() {
      if (activeTrack) activeTrack.mode = 'showing';
    },
    destroy() {
      // The generic adapter is used on any page with a <video>, and SPA
      // navigation there replaces the element. Unbinding the track and
      // dropping the addtrack listener stops the previous one from pushing
      // cues into a React tree that no longer exists.
      video.textTracks.removeEventListener('addtrack', onAddTrack);
      if (activeTrack) {
        activeTrack.oncuechange = null;
        activeTrack = null;
      }
      listeners.length = 0;
      currentActiveCue = null;
    }
  };
}
