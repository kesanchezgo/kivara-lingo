import { useCallback, useEffect, useRef, useState } from 'react';
import { sendMessage } from 'webext-bridge/popup';
import {
  Power, ExternalLink, Mic, MicOff, Settings, RefreshCw,
} from 'lucide-react';
import { useKivaraStore } from '../shared/store';
import { t } from '../shared/i18n';
import { SyncWriteErrorBanner } from '../app/components/SyncWriteErrorBanner';
import type { AnkiPingErrorCode, AnkiPingResponse, AudioCaptureStatus } from '../shared/types';
import { usePingRetry } from './ping-retry';
import type { PingStatus } from './ping-retry';

interface PingState {
  status: PingStatus;
  version?: number;
  error?: string;
  code?: AnkiPingErrorCode;
}

/**
 * Browser-action popup. The visual structure mirrors the design mock 1:1:
 *
 *  • Compact header with icon-only badge (no logo text), name + version,
 *    and a Settings gear that opens the options page.
 *  • Three pill rows: AnkiConnect status, master enable switch, "open
 *    panel in tab", and the audio capture toggle.
 *  • Soft footer with the theme toggle on the left and a small ©Kivara
 *    on the right.
 *
 * All Anki and tab-capture wiring is preserved from the previous build.
 */
export function Popup() {
  const {
    enabled,
    isDarkMode,
    audioCaptureActive,
    ankiMapping,
    setEnabled,
    setPanelOpen,
    setIsDarkMode,
    setAudioCaptureActive,
  } = useKivaraStore();

  const [ping, setPing] = useState<PingState>({ status: 'idle' });
  // Capture errors live OUTSIDE the Anki ping state — mixing them made an
  // audio failure look like a broken AnkiConnect (and the catch swallowed
  // the reason entirely, so the user saw nothing).
  const [captureError, setCaptureError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
  }, [isDarkMode]);

  useEffect(() => {
    let cancelled = false;
    async function syncAudioStatus() {
      try {
        const status = (await sendMessage(
          'AUDIO_CAPTURE_STATUS',
          {},
          'background',
        )) as AudioCaptureStatus;
        if (!cancelled) setAudioCaptureActive(!!status.active);
      } catch (err) {
        console.warn('[Kivara Lingo] AUDIO_CAPTURE_STATUS failed', err);
      }
    }
    void syncAudioStatus();
    return () => {
      cancelled = true;
    };
  }, [setAudioCaptureActive]);


  /**
   * AnkiConnect mount ping, and why its result lives behind three guards
   * rather than one. The e2e of the idle spec produced one where a hang, hit
   * 2/2 pings at the fake server, and still read as "no pill". The cause was
   * two lines above it: a cancellation that also triggered on EVERY
   * `ankiMapping` churn, and the store hydrates AFTER mount (default url →
   * stored url), so the first in-flight answer was discarded on arrival. In a
   * real browser that reads as: the user opens the popup and watches
   * "Comprobando AnkiConnect…" never resolve.
   *  - the seq token: only the LATEST answer may write state;
   *  - in-flight dedup: a churn that repeats the SAME url does not re-issue,
   *    which is what kept the second request from losing its answer.
   */
  const pingSeqRef = useRef(0);
  const mountedRef = useRef(true);
  // A hydration churn can change the url twice in a frame — the sandbox
  // behavior is the lost-ping race observed in the e2e (idle → pinging 8765 →
  // pinging custom ≈ the pill stuck on "Comprobando" while BOTH pings returned
  // ok). The guard makes an in-flight ping for the SAME url survive the churn.
  const inflightUrlRef = useRef<string | null>(null);

  const runPing = useCallback(async (force = false) => {
    const target = `${ankiMapping.ankiUrl ?? ''}|${ankiMapping.apiKey ?? ''}`;
    // The hydration-churn guard (see the sandbox note below). A FORCED ping
    // exists to outrun it: the path that needs one is precisely the message the
    // SW dropped before it had finished waking, whose answer will never clear
    // this ref — so without force the retry would return here forever.
    if (!force && inflightUrlRef.current === target) return;
    inflightUrlRef.current = target;
    const seq = ++pingSeqRef.current;
    setPing({ status: 'pinging' });
    try {
      const result = (await sendMessage(
        'ANKI_PING',
        { url: ankiMapping.ankiUrl, apiKey: ankiMapping.apiKey },
        'background',
      )) as AnkiPingResponse;
      if (inflightUrlRef.current === target) inflightUrlRef.current = null;
      // A newer ping has started, or the page is gone: drop this answer but
      // leave the state alone (the newer one owns it).
      if (!mountedRef.current || seq !== pingSeqRef.current) return;
      if (result.ok) setPing({ status: 'ok', version: result.version });
      else setPing({ status: 'error', error: result.error, code: result.code });
    } catch (err) {
      if (inflightUrlRef.current === target) inflightUrlRef.current = null;
      if (!mountedRef.current || seq !== pingSeqRef.current) return;
      const reason = err instanceof Error ? err.message : 'unknown';
      setPing({ status: 'error', error: reason });
    }
  }, [ankiMapping.ankiUrl, ankiMapping.apiKey]);

  // Ping on mount / whenever the AnkiConnect URL or key changes. Cleanup does
  // NOT abort the in-flight request: it only stops the state setter, because
  // the url change it abides is itself often the store finishing hydrate (see
  // the churn above), and killing the answer there loses the ping entirely.
  useEffect(() => {
    mountedRef.current = true;
    void runPing();
    return () => {
      mountedRef.current = false;
      // Bump so an in-flight answer cannot overwrite the new ping's state.
      pingSeqRef.current += 1;
    };
  }, [runPing]);

  // The whole retry policy — boot re-ping, disconnected poll, the stuck-ping
  // watchdog, and the force flag they share — lives in ping-retry.ts and is
  // used through its hook; the rules and Popup's wiring of them are the same
  // object. The review caught the earlier version testing a copy of those rules
  // while Popup ran its own, so the test drives THIS hook now.
  //
  // TODO(kivara-lingo#27): the underlying "first dispatch after a cold worker"
  // belongs to stream.ts, which owns the port protocol; that commit replaces or
  // removes this patch AND closes #27, its issue.
  usePingRetry({
    status: ping.status,
    // One opening cycle = one url+key. The budget resets when this changes, so
    // switching the AnkiConnect url grants a fresh set of silent re-pings; a
    // manual re-ping after a fail does not, because the budget stays spent
    // until the state returns to idle/ok (it is spent, not restarted).
    key: `${ankiMapping.ankiUrl}|${ankiMapping.apiKey}`,
    // A re-ping from a watchdog or the error poll: forced, because both exist
    // for the message that never got an answer and therefore never clears the
    // in-flight ref above.
    ping: (force?: boolean) => {
      void runPing(force ?? true);
    },
    fail: () => setPing({ status: 'error', error: 'timeout', code: 'TIMEOUT' }),
  });

  // Re-ping the instant focus comes back (alt-tab → Anki → back here).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') void runPing();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [runPing]);

  async function openPanelOnActiveTab() {
    setPanelOpen(true);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_PANEL' });
      }
    } catch {
      /* ignore — no content script on tab */
    }
    window.close();
  }

  async function toggleAudioCapture() {
    const next = !audioCaptureActive;
    setCaptureError(null);
    try {
      if (next) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const result = (await sendMessage(
          'START_AUDIO_CAPTURE',
          { tabId: tab?.id },
          'background',
        )) as { ok: boolean; error?: string };
        setAudioCaptureActive(result.ok);
        if (!result.ok) {
          setCaptureError(result.error || t('popup.capture.failed'));
        }
      } else {
        const result = (await sendMessage('STOP_AUDIO_CAPTURE', {}, 'background')) as {
          ok: boolean;
          error?: string;
        };
        if (!result.ok) {
          setCaptureError(result.error || t('popup.capture.stopped'));
          return; // keep the toggle ON — the capture is still running
        }
        setAudioCaptureActive(false);
      }
    } catch (err) {
      setAudioCaptureActive(false);
      // Surface the reason instead of only logging it — otherwise a failed
      // start/stop is invisible in the popup. A STOP failure (next === false)
      // must show the "detener" text, not the "iniciar" one.
      const fallback = next ? t('popup.capture.failed') : t('popup.capture.stopped');
      setCaptureError(err instanceof Error && err.message ? err.message : fallback);
      console.warn('[Kivara Lingo] toggleAudioCapture failed', err);
    }
  }

  function openOptions() {
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  }

  // Status indicator colour for the AnkiConnect dot. The "pinging" state
  // also re-uses amber so the pulse animation is visible while we wait.
  const statusColor =
    ping.status === 'ok'
      ? '#22c55e'
      : ping.status === 'error'
        ? '#f43f5e'
        : '#f59e0b';

  return (
    <div className={`${isDarkMode ? 'dark' : ''}`} style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}>
      <div className="w-[320px] bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans rounded-2xl shadow-2xl border border-zinc-200/80 dark:border-zinc-800 overflow-hidden">

        {/* Header — icon-only badge, name/version, settings gear */}
        <div className="px-4 pt-3.5 pb-3 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
              enabled ? 'bg-indigo-600 shadow-sm shadow-indigo-500/40' : 'bg-zinc-200 dark:bg-zinc-800'
            }`}>
              <svg
                width={17}
                height={17}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-white dark:text-white"
                aria-label="Kivara Lingo"
              >
                <rect x="3" y="6" width="18" height="13" rx="2.5" />
                <line x1="7" y1="12" x2="13" y2="12" />
                <line x1="7" y1="15.5" x2="11" y2="15.5" />
                <circle cx="17.5" cy="14" r="1.2" fill="currentColor" stroke="none" />
              </svg>
            </div>
            <div>
              <div className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100 leading-tight">
                Kivara <span className="text-indigo-500 dark:text-indigo-400">Lingo</span>
              </div>
              <div className="text-[10px] text-zinc-400 dark:text-zinc-500 leading-tight">
                v{__APP_VERSION__} · {t('popup.phase')}
              </div>
            </div>
          </div>
          <button
            onClick={openOptions}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            title={t('popup.settings')}
          >
            <Settings size={15} />
          </button>
        </div>

        <div className="p-3 space-y-1.5">

          {/* Sync write failure — a quota/disabled-sync failure would
              otherwise leave the user thinking the setting saved. */}
          <SyncWriteErrorBanner />

          {/* AnkiConnect status pill */}
          <div className={`rounded-xl border px-3 py-2.5 ${
            ping.status === 'ok'
              ? 'border-emerald-200 dark:border-emerald-500/25 bg-emerald-50/60 dark:bg-emerald-500/10'
              : ping.status === 'error'
                ? 'border-rose-200 dark:border-rose-500/25 bg-rose-50/60 dark:bg-rose-500/10'
                : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/60'
          }`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="relative flex w-2 h-2 shrink-0">
                  {ping.status === 'ok' && (
                    <span
                      className="absolute inset-0 rounded-full animate-ping"
                      style={{ backgroundColor: `${statusColor}50`, animationDuration: '2.4s' }}
                    />
                  )}
                  <span
                    className="relative inline-flex w-2 h-2 rounded-full"
                    style={{ backgroundColor: statusColor }}
                  />
                </span>
                <span className={`text-[11px] font-medium ${
                  ping.status === 'ok'
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : ping.status === 'error'
                      ? 'text-rose-700 dark:text-rose-400'
                      : 'text-zinc-600 dark:text-zinc-400'
                }`}>
                  {ping.status === 'ok'
                    ? t('popup.anki.active', { v: ping.version ?? '' })
                    : ping.status === 'pinging'
                      ? t('popup.anki.checking')
                      : ping.status === 'error'
                        ? t('popup.anki.down')
                        : '—'}
                </span>
              </div>
              <button
                onClick={() => void runPing()}
                disabled={ping.status === 'pinging'}
                className="p-1 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-40 transition-colors"
                title={t('popup.retry')}
              >
                <RefreshCw size={11} className={ping.status === 'pinging' ? 'animate-spin' : ''} />
              </button>
            </div>
            {ping.status === 'error' && (
              <p className="text-[10px] text-rose-600/80 dark:text-rose-400/80 mt-1.5 leading-snug">
                {ping.code === 'API_KEY'
                  ? t('popup.anki.errApiKey')
                  : ping.code === 'TIMEOUT'
                    ? t('popup.anki.errTimeout')
                    : t('popup.anki.errGeneric')}
              </p>
            )}
          </div>

          {/* Master enable / disable */}
          <button
            onClick={() => setEnabled(!enabled)}
            className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 transition-all ${
              enabled
                ? 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm shadow-indigo-500/25'
                : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800'
            }`}
          >
            <Power size={14} />
            <span className="text-[12px] font-semibold flex-1 text-left">
              {enabled ? t('popup.enable.on') : t('popup.enable.off')}
            </span>
            <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${
              enabled ? 'bg-white/15 text-white' : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500'
            }`}>
              {enabled ? 'ON' : 'OFF'}
            </span>
          </button>

          {/* Open panel in active tab */}
          <button
            onClick={openPanelOnActiveTab}
            className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors"
          >
            <ExternalLink size={13} className="text-zinc-400 shrink-0" />
            <span className="text-[12px] font-medium flex-1 text-left">{t('popup.openPanel')}</span>
          </button>

          {/* Audio capture toggle */}
          <button
            onClick={toggleAudioCapture}
            className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 transition-all ${
              audioCaptureActive
                ? 'bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/25 text-rose-700 dark:text-rose-300'
                : 'bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300'
            }`}
            title={t('popup.capture.title')}
          >
            {audioCaptureActive
              ? <Mic size={13} className="text-rose-500 shrink-0" />
              : <MicOff size={13} className="text-zinc-400 shrink-0" />}
            <span className="text-[12px] font-medium flex-1 text-left">
              {audioCaptureActive ? t('popup.capture.active') : t('popup.capture.off')}
            </span>
            <span className="text-[9px] text-zinc-400 dark:text-zinc-600 font-mono shrink-0">
              tabCapture
            </span>
          </button>
          {captureError && (
            <p className="text-[10px] text-rose-600/80 dark:text-rose-400/80 px-1 leading-snug">
              {captureError}
            </p>
          )}
        </div>

        {/* Footer — theme switch + ©Kivara */}
        <div className="px-4 py-2.5 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="text-[11px] text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          >
            {t('popup.theme', { mode: isDarkMode ? t('popup.theme.light') : t('popup.theme.dark') })}
          </button>
          <span className="text-[10px] text-zinc-200 dark:text-zinc-800">©Kivara 2026</span>
        </div>
      </div>
    </div>
  );
}
