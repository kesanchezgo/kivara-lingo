/**
 * EpisodePort — the playback boundary (docs/REDESIGN-V2.md §4.2, §4.5).
 *
 * Replaces the prototype's `data/transcript.ts` and `lib/playback.ts`. Phase F6
 * replaces the stub factory below with the real adapter v2: the full subtitle
 * track, the active cue and episode metadata from the platform, plus the
 * PlaybackController that owns every seek and rate change.
 */
import type { MediaInfo, PlaybackController, SubtitleCue } from './types';

export interface EpisodePort {
  /** The full subtitle track for the current episode (may grow as it loads). */
  cues(): SubtitleCue[];
  /** Index of the cue under the playhead, or -1 before the first cue. */
  activeIndex(): number;
  /** Subscribe to cue/metadata changes; returns the unsubscribe function. */
  subscribe(cb: () => void): () => void;
  /** Best-effort episode metadata, or null when the platform exposes none. */
  media(): MediaInfo | null;
  /** The single vetted path for seek/rate; null until the adapter provides it. */
  controller: PlaybackController | null;
}

/**
 * Build an EpisodePort from the injected engine. This is a thin F6 stub: it
 * only forwards calls, so the view tree can mount before the real adapter lands.
 *
 * @deprecated Phase F6 replaces this factory with the real adapter v2.
 */
export function createEpisodePort(engine: EpisodePort): EpisodePort {
  return {
    cues: () => engine.cues(),
    activeIndex: () => engine.activeIndex(),
    subscribe: (cb) => engine.subscribe(cb),
    media: () => engine.media(),
    // Live getter: the controller is installed/replaced by the adapter after
    // mount, so a snapshot would freeze the wrong (usually null) reference.
    get controller() {
      return engine.controller;
    },
  };
}
