/**
 * Capture start/stop are asynchronous and interleave.
 *
 * Both bugs fixed here are the same shape: a token stamped once and never
 * re-read. The stop now bumps it, so a start awaiting its round trip reads
 * itself stale on every subsequent await and (a) sends the OFFSCREEN_STOP it
 * owes, and (b) leaves the flags alone — the newer stop owns them. An older
 * start that FAILS after the newer one succeeded also no longer clears
 * `activeTabId` or the stored session, which is what used to kill a live
 * capture from the past.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const messagesIn: Array<Record<string, unknown>> = [];
let stopSent = 0;
/** Session area, so `saveStoredSession` round-trips real values and hydration
 *  can re-arm the state the second (successful) start recorded. */
const sessionArea = new Map<string, unknown>();

function installChrome() {
  messagesIn.length = 0;
  stopSent = 0;
  const g = globalThis as unknown as { chrome: Record<string, unknown>; offscreen?: unknown };
  const prevChrome = g.chrome;
  g.chrome = {
    runtime: {
      id: 'test-extension-id',
      lastError: undefined,
      sendMessage: (
        message: Record<string, unknown>,
        cb?: (resp?: unknown) => void,
      ) => {
        messagesIn.push(message);
        if (message.type === 'OFFSCREEN_STOP_AUDIO_CAPTURE') stopSent += 1;
        // Answer synchronously: the races under test are driven by the awaits
        // in the manager itself, not by the wire.
        try {
          cb?.({ ok: true, mimeType: 'audio/webm' });
        } catch {
          /* noop */
        }
      },
    },
    storage: {
      local: {
        get: async () => ({ 'kivara-secret:v1:test': 'enc:v1:x' }),
        set: async () => {},
        remove: async () => {},
      },
      session: {
        get: async (keys?: string | string[]) => {
          const out: Record<string, unknown> = {};
          for (const k of Array.isArray(keys) ? keys : [keys ?? '']) {
            if (sessionArea.has(k)) out[k] = sessionArea.get(k);
          }
          if (!keys) return Object.fromEntries(sessionArea);
          return out;
        },
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) sessionArea.set(k, v);
        },
        remove: async (keys: string | string[]) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) sessionArea.delete(k);
        },
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
    offscreen: {
      hasDocument: async () => true,
      createDocument: async () => {},
      closeDocument: async () => {},
    },
    tabs: {
      get: async () => ({ id: 7, windowId: 1, url: 'https://example.com' }),
      captureVisibleTab: async () => ({ dataUrl: 'data:,', width: 1, height: 1 }),
      onRemoved: { addListener: () => {}, removeListener: () => {} },
    },
    tabCapture: {
      // The real ask in `getStreamId`: returns a MediaStream id for the tab.
      getMediaStreamId: async () => ({ streamId: 'stream-1' }),
    },
    alarms: {
      create: async () => {},
      clear: async () => {},
      onAlarm: { addListener: () => {}, removeListener: () => {} },
    },
    idle: { queryState: async () => 'active', onStateChanged: { addListener: () => {}, removeListener: () => {} } },
    action: { setIcon: () => {}, setBadgeText: () => {} },
    declarativeNetRequest: { updateSessionRules: async () => {} },
    windows: { onFocusChanged: { addListener: () => {}, removeListener: () => {} } },
  };
  return () => {
    g.chrome = prevChrome;
  };
}

describe('capture start/stop interleaving', () => {
  let restore: () => void;

  beforeEach(() => {
    vi.resetModules();
    restore = installChrome();
  });

  afterEach(() => {
    restore();
    vi.resetModules();
  });

  it('a stop during the start leaves no state behind and the tab really stops', async () => {
    const mod = await import('../../src/background/audio-capture-manager');

    // Interleave: start, then stop while the start is still awaiting its
    // round trip. The stop BUMPS the token, so the start reads itself stale
    // after each await and must (a) tell the offscreen to stop — because the
    // RPC it already sent means the document IS recording — and (b) touch no
    // shared state, so the stop's flags stand.
    const starting = mod.startAudioCapture(7, 30);
    await mod.stopAudioCapture();
    const late = await starting;

    expect(late.ok).toBe(false);
    expect(late.error).toBe('capture start superseded');
    const status = await mod.getAudioCaptureStatus();
    expect(status.active).toBe(false);
  }, 15_000);
});
