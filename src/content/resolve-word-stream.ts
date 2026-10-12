/**
 * The content side of the `kvl-resolve-word` port — moved out of WordPopover
 * by kivara-lingo#27, which also asked for the reconnect this adds.
 *
 * What WordPopover used to do by hand: connect, attach onMessage, post the
 * request, and on disconnect just clear its loading flags. That last part is
 * the gap the review flagged: when the SW is mid-restart (the port dies
 * between phases), the popover silently gave up — the user saw a half-filled
 * card, forever "resolving" without an answer, and only a fresh hover
 * recovered.
 *
 * This client reconnects ONE time on a mid-flight disconnect and replays the
 * request on the new port. One time, not a loop: a worker that is actually
 * down would otherwise reconnect until the hover ends, burning a connect per
 * backoff tick — and the SW's terminal `done` phase already tells the client
 * when nothing more is coming, so a second reconnect would be noise.
 *
 * The disconnect that comes from `close()` is not a failure and never
 * retries: it is the popover unmounting, and reconnecting then would revoke
 * a stream nobody is listening to.
 */
import type { ResolveWordStreamMsg, ResolveWordStreamRequest } from '../shared/types';

export interface ResolveWordStreamHandlers {
  onMessage: (msg: ResolveWordStreamMsg) => void;
  /** Fired when the port dies WITHOUT the stream having finished. */
  onDisconnected: () => void;
}

const REPLAY_LIMIT = 1;

/**
 * Open the stream. `REPLAY_LIMIT = 1` is the whole retry budget: the first
 * disconnect gets one replay; a second disconnect gives up and reports.
 */
export function openResolveWordStream(
  request: ResolveWordStreamRequest,
  handlers: ResolveWordStreamHandlers,
): { close: () => void } {
  let port: chrome.runtime.Port | null = null;
  let closed = false;
  let replayUsed = false;
  let finished = false;
  /** Set right before the replay posts: the re-sent local must not re-skin. */
  let replayed = false;
  /** Any phase other than `local` delivered on this stream. */
  let sawRicherThanLocal = false;

  const attach = () => {
    try {
      port = chrome.runtime.connect({ name: 'kvl-resolve-word' });
    } catch {
      port = null;
    }
    if (!port) {
      // Streaming unavailable (SW asleep on a cold start): the caller's
      // fallback handles it; report once so the caller can swap paths.
      handlers.onDisconnected();
      return;
    }
    const active = port;
    active.onMessage.addListener((raw) => {
      if (closed) return;
      const msg = raw as ResolveWordStreamMsg;
      if (msg.phase === 'done') finished = true;
      // The replay re-sends the FULL request, so a `local` already delivered
      // on the dead port arrives AGAIN. Keep only what actually re-skins: a
      // card holding richer data must not be re-dressed with the poor one.
      // The ONLY phase that re-skins a card already holding richer data is
      // `local`: every other phase is an assignment and idempotent.
      // Translation, enrichment and AI run in PARALLEL (Promise.allSettled)
      // and repeat legitimately, so a rank gate dropped real phases, and
      // `error` (no rank) froze the stream. The replay guard is exactly: a
      // post-replay `local`, once anything richer has landed.
      if (msg.phase === 'local' && replayed && sawRicherThanLocal) return;
      // Only a phase that DELIVERED DATA counts. An `error` (or the closing
      // `done`) used to set this flag too, which meant: an error arrives, the
      // worker dies, the replay re-sends the `local` the popover never saw,
      // and the guard drops it — the card ends up empty for a request whose
      // only outcome was a lookup failure plus a local entry. The guard is
      // about not LOSING richer data, so it must answer to richer data.
      if (msg.phase === 'translation' || msg.phase === 'enrichment' || msg.phase === 'ai') {
        sawRicherThanLocal = true;
      }

      handlers.onMessage(msg);
    });
    active.onDisconnect.addListener(() => {
      if (closed) return;
      if (finished) {
        // The stream completed and the worker closed the port: done is done.
        return;
      }
      if (!replayUsed) {
        // Mid-flight disconnect: the SW restarted between phases. Replay the
        // request once on a fresh port (attach() posts it) before telling the
        // popover anything.
        replayUsed = true;
        replayed = true;
        attach();
        return;
      }
      handlers.onDisconnected();
    });
    try {
      port?.postMessage(request);
    } catch {
      /* port died before first post — its disconnect will handle it */
    }
  };

  attach();

  return {
    close: () => {
      closed = true;
      try {
        port?.disconnect();
      } catch {
        /* ignore */
      }
    },
  };
}
