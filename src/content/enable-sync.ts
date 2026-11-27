/**
 * PR #170 · 2 — turning the extension OFF must put the site back in 0 ms.
 *
 * Before this module the popup only wrote `chrome.storage.sync`; the tab learned
 * about it through `store.ts`'s 250 ms-debounced rehydrate, the hosts stayed
 * mounted, the study playback kept looping/auto-pausing at a non-1× rate and
 * the native subtitles stayed hidden. Disabling looked like "the panel
 * disappeared", not like "the extension is off".
 *
 * Two paths, one effect:
 *   • the popup broadcasts `SET_ENABLED` to every tab, so the tab reacts in the
 *     SAME tick (this is the "0 ms" half);
 *   • the store subscription catches everything else (another window, the
 *     service worker, a manual storage edit) after the rehydrate.
 *
 * The effect itself is `createEnableSync`, kept free of chrome/React so it can
 * be driven directly: it is the order and the idempotency that matter.
 */
import { useKivaraStore } from '../shared/use-kivara-store';
import { SET_ENABLED_MESSAGE } from '../shared/enable-broadcast';

export interface EnableSyncDeps {
  /** Is a mount alive right now? */
  isMounted: () => boolean;
  /** Mount on the CURRENT video, without a reload. */
  mount: () => void;
  /** Full teardown: roots, hosts, injected styles, adapter. */
  unmount: () => void;
  /**
   * Leave the MEDIA as the platform had it (rate 1×, our pause released).
   * Runs BEFORE `unmount`, while the adapter that knows how to talk to the
   * platform is still alive.
   */
  releasePlayback: () => void;
  /** Give the site its own subtitles back. */
  restoreNativeSubtitles: () => void;
}

export interface EnableSync {
  /** Apply one enable state. Idempotent: repeating a state does nothing. */
  apply: (enabled: boolean) => void;
}

export function createEnableSync(deps: EnableSyncDeps): EnableSync {
  let last: boolean | null = null;
  return {
    apply(enabled: boolean) {
      if (last === enabled) return;
      last = enabled;
      if (enabled) {
        // Coming back: mount over the video that is already playing.
        if (!deps.isMounted()) deps.mount();
        return;
      }
      // Going off, in this order and in this tick: the platform first (while we
      // still have the adapter that can reach it), then our DOM, then the
      // site's own subtitles.
      deps.releasePlayback();
      if (deps.isMounted()) deps.unmount();
      deps.restoreNativeSubtitles();
    },
  };
}

/**
 * Wire both paths. Called once from the content entry point.
 *
 * The listener is the fast path: `chrome.runtime.onMessage` is delivered to the
 * tab as soon as the popup sends it, which is what makes "off" instant instead
 * of "off after the storage debounce".
 */
export function installEnableSync(deps: EnableSyncDeps): EnableSync {
  const sync = createEnableSync(deps);

  chrome.runtime.onMessage.addListener((message: { type?: string; enabled?: unknown } | undefined) => {
    if (message?.type !== SET_ENABLED_MESSAGE) return;
    const enabled = Boolean(message.enabled);
    useKivaraStore.getState().setEnabled(enabled);
    sync.apply(enabled);
  });

  useKivaraStore.subscribe((state, previous) => {
    if (state.enabled === previous.enabled) return;
    sync.apply(state.enabled);
  });

  return sync;
}
