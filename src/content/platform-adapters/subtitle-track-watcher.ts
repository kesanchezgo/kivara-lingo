/**
 * The watcher that keeps the player's subtitle language in step with what the
 * user is learning.
 *
 * Extracted from `netflix.ts` so its policy is unit-testable without a player:
 * who may act (only with Kivara ON), when to stop asking (the player refused),
 * and when to back off because the user chose otherwise.
 *
 * The watcher never touches the player on its own: every action goes through
 * `switchTo`, which verifies the result. Its job is the *decision*.
 */

export interface SubtitleSwitchOutcome {
  ok: boolean;
  /** `no subtitle API` is the only retryable outcome. */
  reason?: string;
}

export interface SubtitleTrackWatcherDeps {
  /** Master switch. Nothing happens while it is off. */
  isEnabled(): boolean;
  /** The user's own setting: may Kivara change the subtitle track at all? */
  autoEnabled(): boolean;
  /** The language being learned, two-letter. Empty disables the watcher. */
  learningLang(): string;
  /** TRUE when the bus already holds a track for the language. */
  hasTrackFor(lang: string): boolean;
  /** Ask the player; resolves with what actually happened. */
  switchTo(lang: string): Promise<SubtitleSwitchOutcome>;
  /** The player's CURRENT subtitle track (to notice a manual change). */
  currentTrack(): Promise<{ bcp47?: string; isNone?: boolean } | null>;
  /** Subscribe to the platform publishing a subtitle track. */
  onTrack(listener: (language: string) => void): () => void;
  /** Subscribe to store changes (the master switch). */
  subscribeEnabled(listener: () => void): () => void;
  setInterval(handler: () => void, ms: number): number;
  clearInterval(id: number): void;
  log(...args: unknown[]): void;
  maxAttempts?: number;
  intervalMs?: number;
}

export interface SubtitleTrackWatcher {
  start(): void;
  stop(): void;
  /**
   * PR #172: the user picked a track (or "off") BY HAND in Kivara's own menu.
   * The automatic switch stands down for this episode — correcting a human
   * choice is the one thing this loop must never do. A new episode (or `start`)
   * clears it.
   */
  markManualChoice(): void;
}

const DEFAULT_ATTEMPTS = 12;
const DEFAULT_INTERVAL_MS = 2_500;

export function createSubtitleTrackWatcher(deps: SubtitleTrackWatcherDeps): SubtitleTrackWatcher {
  const maxAttempts = deps.maxAttempts ?? DEFAULT_ATTEMPTS;
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  let timer: number | null = null;
  let unsubscribeTrack: (() => void) | null = null;
  let unsubscribeEnabled: (() => void) | null = null;
  let switching = false;
  let attempts = 0;
  let stopped = false;
  /**
   * Set when the player gave a final answer ("kept its track" / "language not
   * offered"). Asking again in the same episode only fights the user or the
   * platform — the notice explains it instead.
   */
  let settled = false;
  /** The language we set — a different one afterwards is the user's choice. */
  let acted: string | null = null;

  const clearLoop = (): void => {
    if (timer !== null) deps.clearInterval(timer);
    timer = null;
    unsubscribeTrack?.();
    unsubscribeTrack = null;
  };

  const attempt = (): void => {
    // The one rule that outranks every other: Kivara does not touch the
    // player while it is switched off — or while the user turned this
    // behaviour off in Preferences.
    if (!deps.isEnabled() || !deps.autoEnabled()) {
      clearLoop();
      return;
    }
    if (settled) return;
    const lang = deps.learningLang();
    if (!lang || switching || deps.hasTrackFor(lang)) return;
    switching = true;
    void deps.switchTo(lang)
      .then((result) => {
        deps.log('[Kivara Lingo] subtitle track', result.ok ? 'switched' : 'kept', result);
        // 'no subtitle API' means the player is not up yet — that one is worth
        // retrying. Any other answer is final for this episode.
        if (result.ok) acted = lang;
        if (!result.ok && result.reason !== 'no subtitle API') {
          settled = true;
          clearLoop();
        }
      })
      .catch(() => {
        /* the notice explains a refusal */
      })
      .finally(() => {
        switching = false;
      });
  };

  const startLoop = (): void => {
    if (stopped || timer !== null) return;
    attempts = 0;
    settled = false;
    unsubscribeTrack = deps.onTrack((language) => {
      const want = deps.learningLang();
      if (language && language !== want) attempt();
    });
    timer = deps.setInterval(() => {
      void (async () => {
        attempts += 1;
        // Check the user's choice FIRST: a manual change must stop the loop
        // before this tick asks the player for anything.
        if (acted) {
          const now = await deps.currentTrack().catch(() => null);
          if (now) {
            const lang = (now.bcp47 ?? '').split(/[-_]/)[0].toLowerCase();
            if (lang !== acted) {
              settled = true;
              deps.log('[Kivara Lingo] the user chose another subtitle track; leaving it', { was: acted, now: lang || 'off' });
              clearLoop();
              return;
            }
          }
        }
        attempt();
        if (attempts >= maxAttempts) clearLoop();
      })();
    }, intervalMs);
    attempt();
  };

  const sync = (): void => {
    if (deps.isEnabled()) startLoop();
    else clearLoop();
  };

  return {
    markManualChoice() {
      settled = true;
      // Stop the tick as well: `settled` only gates the switch attempt, and the
      // loop would keep asking the player every 2.5 s.
      clearLoop();
      deps.log('[Kivara Lingo] subtitle track chosen by hand; the automatic switch stands down', {});
    },
    start() {
      stopped = false;
      unsubscribeEnabled = deps.subscribeEnabled(sync);
      sync();
    },
    stop() {
      stopped = true;
      clearLoop();
      unsubscribeEnabled?.();
      unsubscribeEnabled = null;
    },
  };
}
