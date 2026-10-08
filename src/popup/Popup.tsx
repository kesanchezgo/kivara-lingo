import { useCallback, useEffect, useRef, useState } from 'react';
import { sendMessage } from 'webext-bridge/popup';
import {
  Power, ExternalLink, Mic, MicOff, Settings, RefreshCw,
} from 'lucide-react';
import { useKivaraStore } from '../shared/store';
import type { AnkiPingErrorCode, AnkiPingResponse, AudioCaptureStatus } from '../shared/types';

type PingStatus = 'idle' | 'pinging' | 'ok' | 'error';

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
  const cancelledRef = useRef(false);

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


  const runPing = useCallback(async () => {
    setPing({ status: 'pinging' });
    try {
      const result = (await sendMessage(
        'ANKI_PING',
        { url: ankiMapping.ankiUrl, apiKey: ankiMapping.apiKey },
        'background',
      )) as AnkiPingResponse;
      if (cancelledRef.current) return;
      if (result.ok) setPing({ status: 'ok', version: result.version });
      else setPing({ status: 'error', error: result.error, code: result.code });
    } catch (err) {
      if (cancelledRef.current) return;
      const reason = err instanceof Error ? err.message : 'unknown';
      setPing({ status: 'error', error: reason });
    }
  }, [ankiMapping.ankiUrl, ankiMapping.apiKey]);

  // Ping on mount / whenever the AnkiConnect URL or key changes.
  useEffect(() => {
    cancelledRef.current = false;
    void runPing();
    return () => {
      cancelledRef.current = true;
    };
  }, [runPing]);

  // Auto-retry every 4s while disconnected — the popup recovers as soon as
  // the user opens Anki, no manual click needed.
  useEffect(() => {
    if (ping.status !== 'error') return;
    const interval = window.setInterval(() => {
      void runPing();
    }, 4000);
    return () => window.clearInterval(interval);
  }, [ping.status, runPing]);

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
          setPing((p) => ({ ...p, error: result.error || 'No se pudo iniciar la captura.' }));
        }
      } else {
        await sendMessage('STOP_AUDIO_CAPTURE', {}, 'background');
        setAudioCaptureActive(false);
      }
    } catch (err) {
      setAudioCaptureActive(false);
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
                v{__APP_VERSION__} · Fase 2
              </div>
            </div>
          </div>
          <button
            onClick={openOptions}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            title="Configuración"
          >
            <Settings size={15} />
          </button>
        </div>

        <div className="p-3 space-y-1.5">

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
                    ? `AnkiConnect v${ping.version} · activo`
                    : ping.status === 'pinging'
                      ? 'Comprobando AnkiConnect…'
                      : ping.status === 'error'
                        ? 'AnkiConnect no responde'
                        : '—'}
                </span>
              </div>
              <button
                onClick={() => void runPing()}
                disabled={ping.status === 'pinging'}
                className="p-1 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-40 transition-colors"
                title="Reintentar"
              >
                <RefreshCw size={11} className={ping.status === 'pinging' ? 'animate-spin' : ''} />
              </button>
            </div>
            {ping.status === 'error' && (
              <p className="text-[10px] text-rose-600/80 dark:text-rose-400/80 mt-1.5 leading-snug">
                {ping.code === 'API_KEY'
                  ? 'AnkiConnect requiere API key — configúrala en Cards → Conexión.'
                  : ping.code === 'TIMEOUT'
                    ? 'AnkiConnect tardó demasiado en responder. Verifica que Anki esté activo.'
                    : 'Abre Anki y verifica que AnkiConnect esté instalado. Los subtítulos siguen funcionando sin conexión.'}
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
              {enabled ? 'Extensión activada' : 'Extensión desactivada'}
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
            <span className="text-[12px] font-medium flex-1 text-left">Abrir panel en la pestaña</span>
          </button>

          {/* Audio capture toggle */}
          <button
            onClick={toggleAudioCapture}
            className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 transition-all ${
              audioCaptureActive
                ? 'bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/25 text-rose-700 dark:text-rose-300'
                : 'bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300'
            }`}
            title="Captura el audio de la pestaña para anexar a las tarjetas Anki"
          >
            {audioCaptureActive
              ? <Mic size={13} className="text-rose-500 shrink-0" />
              : <MicOff size={13} className="text-zinc-400 shrink-0" />}
            <span className="text-[12px] font-medium flex-1 text-left">
              {audioCaptureActive ? 'Captura de audio activa' : 'Activar captura de audio'}
            </span>
            <span className="text-[9px] text-zinc-400 dark:text-zinc-600 font-mono shrink-0">
              tabCapture
            </span>
          </button>
        </div>

        {/* Footer — theme switch + ©Kivara */}
        <div className="px-4 py-2.5 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="text-[11px] text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          >
            Tema {isDarkMode ? 'claro' : 'oscuro'}
          </button>
          <span className="text-[10px] text-zinc-200 dark:text-zinc-800">©Kivara 2026</span>
        </div>
      </div>
    </div>
  );
}
