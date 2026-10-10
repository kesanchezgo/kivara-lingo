/**
 * The core of the fullscreen overlay move, split out of content/index.tsx so
 * it can be driven without a browser: happy-dom has no fullscreen
 * implementations and the content script carries import-time guards, so the
 * orchestrator below takes its surroundings as parameters instead of reading
 * them off the global document.
 *
 * What it guarantees, in order:
 *  - ONE restore state per session, and a restore of exactly what the entry
 *    changed (the `position` it wrote), before the host moves home;
 *  - the focus hand-back happens ONCE, on a real exit, to whatever the user
 *    had before — the step that previously never ran, because the state was
 *    nulled out before it was read. An A→B move restores the position but
 *    deliberately does NOT move the focus: focus was already handed to the new
 *    player and yanking it back to the page mid-fullscreen loses the click the
 *    user just made;
 *  - a leave AND an entry in one event (A→B without exiting) loses neither the
 *    old host's restore nor the new one's override.
 */
export interface Mount {
  hostElement: HTMLElement;
}

export interface RestoreState {
  /** The node we forced `position: relative` on, when it was `static`. */
  positionHost: HTMLElement | null;
  /** Its `position` before we wrote ours. */
  positionWas: string;
  /** Element that held focus before the move. */
  previousFocus: HTMLElement | null;
}

export interface FullscreenDeps {
  mount: Mount;
  /** `document.fullscreenElement` — null on exit. */
  getFullscreenElement: () => HTMLElement | null;
  /** Computed `position` of the entry target. */
  getPosition: (el: HTMLElement) => string;
  /** Where the host lands when there is no fullscreen. */
  getFallbackParent: () => HTMLElement;
  /** The focus trail: what the user had before the move. */
  getPreviousFocus: () => HTMLElement | null;
}

export function updateOverlayParent(deps: FullscreenDeps, state: { restore: RestoreState | null }): void {
  const fullscreen = deps.getFullscreenElement();
  const movingToNewElement =
    fullscreen !== null &&
    state.restore !== null &&
    state.restore.positionHost !== fullscreen;
  const entering = fullscreen !== null && (state.restore === null || movingToNewElement);
  const leaving = fullscreen === null || movingToNewElement;

  // State worth restoring off this event, captured BEFORE the clear: reading
  // it after is the bug that made the focus hand-back dead code.
  let restoring: RestoreState | null = null;
  if (leaving) {
    restoring = state.restore;
    state.restore = null;
    if (restoring?.positionHost?.isConnected) {
      restoring.positionHost.style.position = restoring.positionWas;
    }
  }

  const target = fullscreen ?? deps.getFallbackParent();
  // The focus hand-back belongs to a REAL exit only: on an A→B move the player
  // already owns focus and pulling it back to the page would break the click
  // the user just made. Position is restored either way.
  if (leaving && fullscreen === null && restoring?.previousFocus?.isConnected) {
    try {
      restoring.previousFocus.focus();
    } catch {
      /* a detached target throws in some engines */
    }
  }
  if (deps.mount.hostElement.parentElement === target && !entering) return;
  try {
    if (entering) {
      const host = fullscreen as HTMLElement;
      // Written once per session: a second toggle inside the same one must not
      // overwrite the original value.
      state.restore = {
        positionHost: deps.getPosition(host) === 'static' ? host : null,
        positionWas: host.style.position,
        previousFocus: deps.getPreviousFocus(),
      };
    }
    target.appendChild(deps.mount.hostElement);
    if (state.restore?.positionHost) state.restore.positionHost.style.position = 'relative';
  } catch (err) {
    // The host just stays on <body>: subtitles keep working, the panel does not
    // overlay the player. Logged at debug because a site that mutates its own
    // DOM mid-fullscreen is the usual cause and not actionable by the user.
    console.debug('[Kivara Lingo] could not re-parent the overlay for fullscreen', err);
  }
}

