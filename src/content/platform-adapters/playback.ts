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
import type { PlaybackController, SubtitleSource } from './types';

/** Platform tags the HTML5 controller understands. */
type PlaybackPlatform = SubtitleSource['platform'];
import { rateThroughMainWorld, seekThroughMainWorld } from './netflix-main-bridge';

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

/**
 * HTML5 controller. `getVideo()` is read on every call, never captured.
 *
 * `platform` decides HOW the rate is applied: only YouTube (and Netflix, in
 * its own controller) exposes a speed API worth a MAIN-world round trip. On
 * Disney+, Max, Prime and generic hosts that bridge could never succeed — no
 * player API exists there — so the rate is written straight to the element,
 * with no microtask between the click and the new speed.
 */
export function createMediaPlaybackController(
  getVideo: () => HTMLVideoElement | null,
  opts: { platform?: PlaybackPlatform } = {},
): PlaybackController {
  const useRateBridge = opts.platform === 'youtube';
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
      if (!useRateBridge) {
        try {
          video.playbackRate = next;
        } catch {
          /* the platform may freeze playbackRate; keep the old one */
        }
        return;
      }
      // YouTube: `movie_player.setPlaybackRate` keeps the native speed menu in
      // sync, so the API goes first and the element is the safety net.
      rateThroughMainWorld(next)
        .then(() => {
          try {
            video.playbackRate = next;
          } catch {
            /* the API already did it */
          }
        })
        .catch(() => {
          try {
            video.playbackRate = next;
          } catch {
            /* the platform may freeze playbackRate; keep the old one */
          }
        });
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
      const next = clampRate(rate);
      rateThroughMainWorld(next)
        .then(() => {
          try {
            video.playbackRate = next;
          } catch {
            /* the API already did it */
          }
        })
        .catch(() => {
          try {
            video.playbackRate = next;
          } catch {
            /* frozen playbackRate */
          }
        });
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
 * Point 3: keeps Kivara's speed and the player's real rate in step.
 *
 *  -  — call right before handing  to the controller:
 *    the next  within the echo window is OUR apply echoing back.
 *  - A  that disagrees with what we just applied is a platform
 *    revert: re-apply ONCE, and if it reverts again accept the platform's
 *    rate (no fight) — reported through .
 *  - A  outside the echo window is the user moving the NATIVE
 *    menu: Kivara's speed follows it through .
 */
interface RateSyncHandlers {
  apply(rate: number): void;
  accept(rate: number): void;
  onPlatformRevert?(rate: number): void;
}

export function createRateSync(
  video: HTMLVideoElement,
  handlers: RateSyncHandlers,
  opts: { echoMs?: number; shouldAccept?: (rate: number) => boolean } = {},
): { applied(rate: number): void; detach(): void } {
  const echoMs = opts.echoMs ?? 600;
  let lastApplied: number | null = null;
  let appliedAt = 0;
  let retried = false;
  const onChange = () => {
    const actual = video.playbackRate;
    if (lastApplied !== null && Date.now() - appliedAt < echoMs) {
      if (Math.abs(actual - lastApplied) < 0.01) return; // our own echo
      if (!retried) {
        retried = true;
        appliedAt = Date.now();
        handlers.apply(lastApplied);
        return;
      }
      // It reverted again: the platform wins, no loop.
      lastApplied = null;
      if (opts.shouldAccept?.(actual) ?? true) handlers.accept(actual);
      handlers.onPlatformRevert?.(actual);
      return;
    }
    lastApplied = null;
    if (opts.shouldAccept?.(actual) ?? true) handlers.accept(actual);
  };
  video.addEventListener('ratechange', onChange);
  return {
    applied(rate: number) {
      lastApplied = rate;
      appliedAt = Date.now();
      retried = false;
    },
    detach() {
      video.removeEventListener('ratechange', onChange);
    },
  };
}
