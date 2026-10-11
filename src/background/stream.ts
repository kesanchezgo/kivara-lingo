/**
 * The streaming transport between content script and worker, MOVED OUT of
 * service-worker.ts by kivara-lingo#27.
 *
 * The content script opens a Port named `kvl-resolve-word`, posts a single
 * ResolveWordStreamRequest, and receives ResolveWordStreamMsg phases as
 * they're produced — so the essential fields paint in <1 s while the slower
 * extras stream in.
 *
 * It is a module of its own now for one reason: onConnect plus the
 * cancel/disconnect handling are the whole protocol, and they were sitting
 * in the service worker's listener list next to eleven other listeners, with
 * the reviewer's note open that this file owns the port protocol. Any change
 * to the handshake (phases, request shape, the fallback, a second
 * retry policy) needs a place to live that is not a 700-line SW entry.
 *
 * No imports from the orchestrator: streaming takes an async produce
 * function as an argument (wired at install time by the service worker),
 * so this module holds no dependency back into the enrichment chain.
 */
import type { ResolveWordStreamMsg, ResolveWordStreamRequest } from '../shared/types';

/**
 * Attach the resolve-word port to the worker. `produce` maps a request
 * (already normalized) to an `onEmit` callback emitting phases; on first
 * message it resolves to a final `done` phase, or errors out.
 *
 * Cancellation: the listener stops emitting the moment the port
 * disconnects or the next postMessage throws (popover dismissed mid-stream
 * is the common case), which is the only clean escape for a long tail of
 * emits.
 */
export type ResolveWordStreamFn = (
  params: {
    token: string;
    sentence: string;
    sourceLang: string;
    includeAi: boolean;
    purpose: 'popover' | 'card';
  },
  onEmit: (msg: ResolveWordStreamMsg) => void,
) => Promise<void>;

export function installResolveWordPort(
  resolveWordStreaming: ResolveWordStreamFn,
): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'kvl-resolve-word') return;
    let cancelled = false;
    port.onDisconnect.addListener(() => {
      cancelled = true;
    });
    port.onMessage.addListener((raw) => {
      const msg = raw as ResolveWordStreamRequest;
      if (!msg || msg.kind !== 'resolve-word') return;
      void resolveWordStreaming(
        {
          token: msg.token ?? '',
          sentence: msg.sentence ?? '',
          sourceLang: msg.sourceLang || 'en',
          includeAi: !!msg.includeAi,
          purpose: msg.purpose ?? 'popover',
        },
        (out: ResolveWordStreamMsg) => {
          if (cancelled) return;
        try {
          port.postMessage(out);
        } catch {
          // Port closed mid-stream (popover dismissed) — stop emitting.
          cancelled = true;
        }
      }).catch((err) => {
        if (cancelled) return;
        try {
          port.postMessage({
            phase: 'error',
            scope: 'enrichment',
            message: err instanceof Error ? err.message : 'resolve threw',
          } satisfies ResolveWordStreamMsg);
          port.postMessage({ phase: 'done' } satisfies ResolveWordStreamMsg);
        } catch {
          /* ignore */
        }
      });
    });
  });
}
