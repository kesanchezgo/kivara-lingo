import { useCallback, useEffect, useRef, useState } from 'react';
import { sendMessage } from 'webext-bridge/popup';
import {
  AlertTriangle, Clock, ExternalLink, Mic, MicOff, Power, RefreshCw, Settings,
} from '../ui/icons';
import { useKivaraStore } from '../shared/use-kivara-store';
import { t } from '../shared/i18n';
import { BrandGlyph } from '../ui/BrandGlyph';
import { SyncWriteErrorBanner } from '../app/components/SyncWriteErrorBanner';
import { Button, IconButton, IconTile, Toggle, surface } from '../ui/primitives/settings-primitives';
import { isPending, useRecentCards } from '../app/components/tabs/RecentCards';
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
 * Browser-action popup. The view is the prototype's (header badge, grouped
 * rows, inert body while the extension is off); the wiring is the repo's:
 *
 *  • `usePingRetry` owns the boot re-ping, the disconnected poll and the
 *    stuck-ping watchdog — the rules and the test that drives them are one
 *    object, and this component does not carry a copy.
 *  • Audio capture goes through START/STOP_AUDIO_CAPTURE in the worker; a
 *    failed STOP keeps the toggle ON because the capture really is running.
 *  • Capture errors live outside the Anki ping state so an audio failure
 *    cannot read as a broken AnkiConnect.
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
  const [captureError, setCaptureError] = useState<string | null>(null);
  const pendingCards = useRecentCards().filter(isPending).length;

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
    return () => { cancelled = true; };
  }, [setAudioCaptureActive]);

  /**
   * Three guards on the mount ping, all load-bearing:
   *  • the seq token — only the LATEST answer may write state;
   *  • in-flight dedup — a hydration churn that repeats the SAME url does not
   *    re-issue, which is what kept the second request from losing its answer;
   *  • a force flag, because the message the worker dropped before it woke will
   *    never clear the in-flight ref — the retry has to outrun it.
   */
  const pingSeqRef = useRef(0);
  const mountedRef = useRef(true);
  const inflightUrlRef = useRef<string | null>(null);

  const runPing = useCallback(async (force = false) => {
    const target = `${ankiMapping.ankiUrl ?? ''}|${ankiMapping.apiKey ?? ''}`;
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

  useEffect(() => {
    mountedRef.current = true;
    void runPing();
    return () => {
      mountedRef.current = false;
      // Bump so an in-flight answer cannot overwrite the new ping's state.
      pingSeqRef.current += 1;
    };
  }, [runPing]);

  usePingRetry({
    status: ping.status,
    // One opening cycle = one url+key. The budget resets when this changes, so
    // switching the AnkiConnect url grants a fresh set of silent re-pings.
    key: `${ankiMapping.ankiUrl}|${ankiMapping.apiKey}`,
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
      /* ignore — no content script on this tab */
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
        if (!result.ok) setCaptureError(result.error || t('popup.capture.failed'));
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
      // Surface the reason instead of only logging it; a failed STOP must show
      // the "stop" copy, not the "start" one.
      const fallback = next ? t('popup.capture.failed') : t('popup.capture.stopped');
      setCaptureError(err instanceof Error && err.message ? err.message : fallback);
      console.warn('[Kivara Lingo] toggleAudioCapture failed', err);
    }
  }

  function openOptions() {
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  }

  const statusDot =
    ping.status === 'ok' ? 'bg-emerald-500'
      : ping.status === 'error' ? 'bg-rose-500'
        : 'bg-amber-500';

  return (
    <div className={`${isDarkMode ? 'dark' : ''}`} style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}>
      <div className="kvl-ui w-[320px] bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans rounded-xl shadow-2xl ring-1 ring-zinc-900/[0.08] dark:ring-white/[0.08] overflow-hidden">

        {/* Header — same chrome as the panel header */}
        <div className="h-16 pl-4 pr-3 flex items-center justify-between border-b border-zinc-900/[0.06] dark:border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
              enabled ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'
            }`}>
              <BrandGlyph size={16} className="text-white" label="Kivara Lingo" />
            </div>
            <div>
              <div className="text-[15px] font-semibold tracking-[-0.01em] text-zinc-900 dark:text-zinc-100 leading-5">
                Kivara <span className="text-indigo-500 dark:text-indigo-400">Lingo</span>
              </div>
              <div className="text-[12px] text-zinc-500 dark:text-zinc-400 leading-4">
                v{__APP_VERSION__} · {t('popup.phase')}
              </div>
            </div>
          </div>
          <IconButton onClick={openOptions} disabled={!enabled} aria-label={t('popup.settings')} title={t('popup.settings')}>
            <Settings size={16} />
          </IconButton>
        </div>

        <div className="p-4 space-y-3 bg-zinc-50/80 dark:bg-transparent">
          <SyncWriteErrorBanner />

          <div className={`${surface.group} overflow-hidden divide-y divide-zinc-900/[0.06] dark:divide-white/[0.06]`}>
            {/* Extension on/off */}
            <div className="flex items-center gap-3 px-3.5 min-h-[52px] py-2.5">
              <IconTile className={enabled ? '' : '!bg-zinc-900/[0.05] dark:!bg-white/[0.06] !text-zinc-400'}>
                <Power size={16} />
              </IconTile>
              <span className="flex-1 min-w-0 truncate text-[13px] font-medium text-zinc-800 dark:text-zinc-200">
                {enabled ? t('popup.enable.on') : t('popup.enable.off')}
              </span>
              <Toggle
                on={enabled}
                onChange={(v) => setEnabled(v)}
                ariaLabel={enabled ? t('popup.enable.on') : t('popup.enable.off')}
              />
            </div>

            {/* Everything below the switch is inert while the extension is off */}
            <div
              className={`divide-y divide-zinc-900/[0.06] dark:divide-white/[0.06] transition-opacity ${enabled ? '' : 'opacity-40'}`}
              {...({ inert: enabled ? undefined : '' } as Record<string, string | undefined>)}
            >
              {/* Anki status — one line with a dot, like the Cards tab */}
              <div className="px-3.5 py-2.5">
                <div className="flex items-center gap-3 min-h-[32px]">
                  <span className={`w-7 h-7 rounded-lg shrink-0 flex items-center justify-center ${
                    ping.status === 'ok'
                      ? 'bg-emerald-500/[0.1]'
                      : ping.status === 'error' ? 'bg-rose-500/[0.08]' : 'bg-amber-500/[0.1]'
                  }`}>
                    <span className="relative flex w-2 h-2">
                      {ping.status === 'ok' && (
                        <span className="absolute inset-0 rounded-full bg-emerald-400/40 animate-ping [animation-duration:2.4s]" />
                      )}
                      <span className={`relative inline-flex w-2 h-2 rounded-full ${statusDot}`} />
                    </span>
                  </span>
                  <span className="flex-1 min-w-0 truncate text-[13px] font-medium text-zinc-800 dark:text-zinc-200">
                    {ping.status === 'ok' ? t('popup.anki.active', { v: ping.version ?? '' })
                      : ping.status === 'pinging' ? t('popup.anki.checking')
                        : ping.status === 'error' ? t('popup.anki.down') : '—'}
                  </span>
                  <IconButton
                    onClick={() => void runPing()}
                    aria-label={t('popup.retry')}
                    title={t('popup.retry')}
                    disabled={ping.status === 'pinging'}
                  >
                    <RefreshCw size={14} className={ping.status === 'pinging' ? 'animate-spin' : ''} />
                  </IconButton>
                </div>
                {ping.status === 'error' && (
                  <p className="mt-1.5 ml-10 text-[12px] text-rose-600 dark:text-rose-400/90 leading-snug">
                    {ping.code === 'API_KEY'
                      ? t('popup.anki.errApiKey')
                      : ping.code === 'TIMEOUT'
                        ? t('popup.anki.errTimeout')
                        : t('popup.anki.errGeneric')}
                  </p>
                )}
                {pendingCards > 0 && (
                  <p className="mt-1.5 ml-10 text-[12px] text-amber-700 dark:text-amber-400/90 leading-snug flex items-start gap-1">
                    <Clock size={12} weight="bold" className="shrink-0 mt-[2px]" />
                    {pendingCards === 1 ? t('popup.queuedOne') : t('popup.queued', { n: pendingCards })}
                  </p>
                )}
              </div>

              {/* Audio capture */}
              <div className="px-3.5 py-2.5" title={t('popup.capture.title')}>
                <div className="flex items-center gap-3 min-h-[32px]">
                  {audioCaptureActive
                    ? <IconTile className="!bg-rose-500/[0.08] !text-rose-500"><Mic size={16} /></IconTile>
                    : <IconTile className="!bg-zinc-900/[0.05] dark:!bg-white/[0.06] !text-zinc-400"><MicOff size={16} /></IconTile>}
                  <span className="flex-1 min-w-0 truncate text-[13px] font-medium text-zinc-800 dark:text-zinc-200">
                    {audioCaptureActive ? t('popup.capture.active') : t('popup.capture.off')}
                  </span>
                  <Toggle
                    on={audioCaptureActive}
                    onChange={() => void toggleAudioCapture()}
                    disabled={!enabled}
                    disabledTitle={t('app.extensionOff')}
                    ariaLabel={t('popup.capture.title')}
                  />
                </div>
                {captureError && (
                  <p className="mt-1.5 ml-10 text-[12px] text-rose-600 dark:text-rose-400/90 leading-snug flex items-start gap-1">
                    <AlertTriangle size={12} className="shrink-0 mt-[2px]" />
                    <span>{captureError}</span>
                  </p>
                )}
              </div>
            </div>
          </div>

          <Button
            variant="primary"
            onClick={() => void openPanelOnActiveTab()}
            disabled={!enabled}
            icon={<ExternalLink size={14} />}
            block
            className="!h-9"
          >
            {t('popup.openPanel')}
          </Button>
        </div>

        {/* Footer */}
        <div className="h-11 px-4 border-t border-zinc-900/[0.06] dark:border-white/[0.06] flex items-center justify-between">
          <button
            type="button"
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="text-[12px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded-md kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
          >
            {t('popup.theme', { mode: isDarkMode ? t('popup.theme.light') : t('popup.theme.dark') })}
          </button>
          <span className="text-[12px] text-zinc-400 dark:text-zinc-400">©Kivara 2026</span>
        </div>
      </div>
    </div>
  );
}
