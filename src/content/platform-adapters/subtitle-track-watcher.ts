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
  /** The language being learned, two-letter. Empty disables the watcher. */
  learningLang(): string;
  /** TRUE when the bus already holds a track for the language. */
  hasTrackFor(lang: string): boolean;
  /** Ask the player; resolves with what actually happened. */
  switchTo(lang: string): Promise<SubtitleSwitchOutcome>;
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

  const clearLoop = (): void => {
    if (timer !== null) deps.clearInterval(timer);
    timer = null;
    unsubscribeTrack?.();
    unsubscribeTrack = null;
  };

  const attempt = (): void => {
    // The one rule that outranks every other: Kivara does not touch the
    // player while it is switched off.
    if (!deps.isEnabled()) {
      clearLoop();
      return;
    }
    const lang = deps.learningLang();
    if (!lang || switching || deps.hasTrackFor(lang)) return;
    switching = true;
    void deps.switchTo(lang)
      .then((result) => {
        deps.log('[Kivara Lingo] subtitle track', result.ok ? 'switched' : 'kept', result);
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
    unsubscribeTrack = deps.onTrack((language) => {
      const want = deps.learningLang();
      if (language && language !== want) attempt();
    });
    timer = deps.setInterval(() => {
      attempts += 1;
      attempt();
      if (attempts >= maxAttempts) clearLoop();
    }, intervalMs);
    attempt();
  };

  const sync = (): void => {
    if (deps.isEnabled()) startLoop();
    else clearLoop();
  };

  return {
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
