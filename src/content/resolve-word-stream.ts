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

/**
 * Open the stream. `REPLAY_LIMIT = 1` is the whole retry budget: the first
 * disconnect gets one replay; a second disconnect gives up and reports.
 */
const REPLAY_LIMIT = 1;

export function openResolveWordStream(
  request: ResolveWordStreamRequest,
  handlers: ResolveWordStreamHandlers,
): { close: () => void } {
  let port: chrome.runtime.Port | null = null;
  let closed = false;
  let replayUsed = false;
  let finished = false;

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
