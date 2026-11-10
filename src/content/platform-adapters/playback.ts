/**
 * PlaybackController implementations (docs/REDESIGN-V2.md §4.5, §3 H2).
 *
 * Two shapes:
 *  - `createMediaPlaybackController`: the HTML5 path. YouTube, Max, Prime,
 *    Disney+ and the generic adapter tolerate `video.currentTime` assignments
 *    for a seek (verified only against a local HTML5 player — see the F6
 *    report); rate, pause and play also live on the element.
 *  - `createNetflixPlaybackController`: seeks cross into the MAIN world and
 *    call `netflix.appContext.state.playerApp.getAPI().videoPlayer`. Writing
 *    `currentTime` on Netflix interrupts playback (error M7375), so this
 *    controller NEVER touches it: an unavailable player API makes `seek`
 *    reject, and the UI reports the line as not seekable instead of breaking
 *    the stream.
 *
 * Both take a getter instead of the element: streaming players replace their
 * `<video>` on SPA navigation, and a captured element would go stale.
 */
import type { PlaybackController } from './types';
import { seekThroughMainWorld } from './netflix-main-bridge';

/** Study speeds. The same list backs the transcript and the study bar. */
export const PLAYBACK_SPEEDS: readonly number[] = [0.75, 1, 1.25];
/** One pass of the active cue at this rate; the general speed is untouched. */
export const SLOW_REPLAY_RATE = 0.75;
const MIN_RATE = 0.25;
const MAX_RATE = 4;
const SEEK_TIMEOUT_MS = 1200;

export const clampRate = (rate: number): number => {
  if (!Number.isFinite(rate)) return 1;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
};

/** Resolve once the element reports `seeked`, or after a short timeout for
 *  players that move the playhead without emitting it (some MSE builds). */
function seekElement(video: HTMLVideoElement, seconds: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', finish);
      resolve();
    };
    video.addEventListener('seeked', finish, { once: true });
    try {
      video.currentTime = seconds;
    } catch {
      finish();
      return;
    }
    window.setTimeout(finish, SEEK_TIMEOUT_MS);
  });
}

/** HTML5 controller. `getVideo()` is read on every call, never captured. */
export function createMediaPlaybackController(
  getVideo: () => HTMLVideoElement | null,
): PlaybackController {
  return {
    async seek(timeMs) {
      const video = getVideo();
      if (!video) throw new Error('no video element');
      const seconds = Math.max(0, timeMs) / 1000;
      await seekElement(video, seconds);
    },
    async play() {
      const video = getVideo();
      if (!video) return;
      await video.play();
    },
    pause() {
      const video = getVideo();
      if (!video) return;
      try {
        video.pause();
      } catch {
        /* a detached element throws; nothing to pause */
      }
    },
    getRate() {
      return getVideo()?.playbackRate ?? 1;
    },
    setRate(rate) {
      const video = getVideo();
      if (!video) return;
      const next = clampRate(rate);
      try {
        video.playbackRate = next;
      } catch {
        /* the platform may freeze playbackRate; keep the old one */
      }
    },
    isPaused() {
      return getVideo()?.paused ?? true;
    },
    currentTimeMs() {
      return (getVideo()?.currentTime ?? 0) * 1000;
    },
  };
}

/**
 * Netflix controller. Play/pause and rate stay on the element (Netflix does
 * not fail on those); the seek is the fatal one, so it goes through the
 * player API in MAIN and is never emulated with `currentTime`.
 */
export function createNetflixPlaybackController(
  getVideo: () => HTMLVideoElement | null,
): PlaybackController {
  return {
    async seek(timeMs) {
      await seekThroughMainWorld(Math.max(0, timeMs));
    },
    async play() {
      const video = getVideo();
      if (!video) return;
      await video.play();
    },
    pause() {
      const video = getVideo();
      if (!video) return;
      try {
        video.pause();
      } catch {
        /* detached element */
      }
    },
    getRate() {
      return getVideo()?.playbackRate ?? 1;
    },
    setRate(rate) {
      const video = getVideo();
      if (!video) return;
      try {
        video.playbackRate = clampRate(rate);
      } catch {
        /* frozen playbackRate */
      }
    },
    isPaused() {
      return getVideo()?.paused ?? true;
    },
    currentTimeMs() {
      return (getVideo()?.currentTime ?? 0) * 1000;
    },
  };
}