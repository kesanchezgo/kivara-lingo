import { SubtitleSource, SubtitleCue, CueListener } from './types';

export function attachGenericHtml5(video: HTMLVideoElement): SubtitleSource {
  const listeners: CueListener[] = [];
  let currentActiveCue: SubtitleCue | null = null;
  let activeTrack: TextTrack | null = null;

  const handleCueChange = () => {
    if (!activeTrack) return;
    const activeCues = activeTrack.activeCues;
    if (activeCues && activeCues.length > 0) {
      // Merge EVERY active cue, the way YouTube does. A player that splits a
      // line across two VTTCues used to render only `activeCues[0]`, so half
      // of each bilingual line silently disappeared.
      const texts: string[] = [];
      let firstStart = Infinity;
      let lastEnd = 0;
      let rawAlign: VTTCue['align'] | undefined;
      for (let i = 0; i < activeCues.length; i += 1) {
        const nativeCue = activeCues[i] as VTTCue;
        if (typeof nativeCue.text === 'string' && nativeCue.text) texts.push(nativeCue.text);
        firstStart = Math.min(firstStart, nativeCue.startTime * 1000);
        lastEnd = Math.max(lastEnd, nativeCue.endTime * 1000);
        if (!rawAlign && nativeCue.align) rawAlign = nativeCue.align;
      }
      if (texts.length === 0 || !Number.isFinite(firstStart)) {
        currentActiveCue = null;
        listeners.forEach(l => l([]));
        return;
      }
      currentActiveCue = {
        // STABLE id: derived from the cue window, never `Math.random()`. A
        // per-change random id made every cue a NEW object to the overlay —
        // hover state reset and the translation was re-requested for a line
        // that had not changed at all.
        id: `${firstStart}-${lastEnd}`,
        start: firstStart,
        end: lastEnd,
        text: texts.join('\n'),
        language: activeTrack.language || 'en',
        align: rawAlign as SubtitleCue['align'],
      };
      listeners.forEach(l => l([currentActiveCue!]));
    } else {
      currentActiveCue = null;
      listeners.forEach(l => l([]));
    }
  };

  const bindTrack = (track: TextTrack) => {
    if (activeTrack) {
      // Removes OUR OWN handler only. The old `oncuechange = null` could
      // clear a DIFFERENT adapter's callback on the same shared <video>
      // — SPA navigations that re-use one player and the "previous
      // adapter is still shutting down" window (see mountFor in
      // index.tsx) run two adapters on the same TextTrack for a moment.
      activeTrack.removeEventListener('cuechange', handleCueChange);
    }
    activeTrack = track;
    track.mode = 'hidden'; // Hide the native one
    track.addEventListener('cuechange', handleCueChange);
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
        activeTrack.removeEventListener('cuechange', handleCueChange);
        activeTrack = null;
      }
      listeners.length = 0;
      currentActiveCue = null;
    }
  };
}
