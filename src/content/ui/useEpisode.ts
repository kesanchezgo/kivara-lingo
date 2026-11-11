/**
 * Episode boundary (F6 · docs/REDESIGN-V2.md §4.2 EpisodePort).
 *
 * One hook hands the view the three things it needs from the platform: the
 * full subtitle track (which can grow while the player loads it), the
 * best-effort episode metadata, and the PlaybackController that owns every
 * seek. The rail, the episode words view and the study bar all read from here;
 * nothing in the view touches the adapter directly.
 */
import { useEffect, useMemo, useState } from 'react';
import type { MediaInfo, PlaybackController, SubtitleCue, SubtitleSource } from '../platform-adapters/types';

export interface Episode {
  cues: SubtitleCue[];
  media: MediaInfo | null;
  controller: PlaybackController | null;
}

/** How often to re-read a track the adapter only exposes synchronously. */
const TRACK_POLL_MS = 1500;

export function useEpisode(adapter: SubtitleSource | null): Episode {
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [media, setMedia] = useState<MediaInfo | null>(null);

  useEffect(() => {
    if (!adapter) {
      setCues([]);
      setMedia(null);
      return;
    }
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    const publish = (next: SubtitleCue[]) => {
      if (disposed || next.length === 0) return;
      setCues(next);
      try {
        setMedia(adapter.getMediaInfo?.() ?? null);
      } catch {
        setMedia(null);
      }
    };

    const initial = adapter.getTrackCues?.() ?? [];
    publish(initial);
    if (adapter.onTrackCues) {
      unsubscribe = adapter.onTrackCues(publish);
    }
    // A player that exposes nothing push-based (Max before its first segment
    // arrives, a DASH download finishing late) is polled lightly; the guard
    // skips the state write when the list is unchanged.
    let previous = initial;
    const handle = window.setInterval(() => {
      const next = adapter.getTrackCues?.() ?? [];
      if (next === previous || next.length === previous.length) return;
      previous = next;
      publish(next);
    }, TRACK_POLL_MS);

    return () => {
      disposed = true;
      unsubscribe?.();
      window.clearInterval(handle);
    };
  }, [adapter]);

  return useMemo(
    () => ({ cues, media, controller: adapter?.playback ?? null }),
    [adapter, cues, media],
  );
}
