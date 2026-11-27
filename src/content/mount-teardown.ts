/**
 * PR #170 — one place that takes a mount apart, in an order that works.
 *
 * Extracted from `index.tsx` so the ORDER is testable: the site's own subtitles
 * must come back BEFORE the adapter is destroyed (the adapter is who knows how
 * to stop the track watcher, and `restoreNativeSubtitles` in the enable-sync
 * deps reads the mount — which the caller nulls at the end), and the adapter's
 * `destroy()` must stop any residual poll with the hide-style already gone.
 */
import type { SubtitleSource } from './platform-adapters/types';

export interface TeardownMount {
  reactRoot: { unmount: () => void };
  videoReactRoot?: { unmount: () => void };
  adapter: SubtitleSource | null;
  hostElement: HTMLElement;
  videoHostElement?: HTMLElement;
  /** The container whose `position: relative` mountFor() forced. */
  forcedRelative?: HTMLElement;
}

/**
 * Order: React trees → the site's subtitles → adapter destroy → our DOM →
 * every injected sheet → the forced position. Idempotent per mount (the caller
 * drops its reference afterwards).
 */
export function teardownMount(mount: TeardownMount): void {
  try {
    mount.reactRoot.unmount();
  } catch {
    // A root that already unmounted is not an error.
  }
  try {
    mount.videoReactRoot?.unmount();
  } catch {
    // same
  }
  // BEFORE destroy(): the hide-style is the adapter's, and the watcher it stops
  // is the one that kept the site's captions hidden. Doing this the other way
  // round left `mount?.adapter` already gone (the caller nulls it) and the
  // restore silently did nothing.
  try {
    mount.adapter?.showNativeSubtitles?.();
  } catch (err) {
    console.warn('[Kivara Lingo] subtitle restore failed', err);
  }
  try {
    mount.adapter?.destroy?.();
  } catch (err) {
    console.warn('[Kivara Lingo] adapter destroy failed', err);
  }
  mount.hostElement.remove();
  mount.videoHostElement?.remove();
  // The injected sheets (cleanup, owned bar, columns) and the forced position
  // outlive React: a page left with them is not "the site as it was".
  for (const style of Array.from(document.querySelectorAll('style[id^="kivara-"]'))) {
    style.remove();
  }
  const forced = mount.forcedRelative;
  if (forced) forced.style.position = '';
}
