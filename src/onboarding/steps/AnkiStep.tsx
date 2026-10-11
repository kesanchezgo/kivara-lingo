import React, { useState } from 'react';
import { t } from '../../shared/i18n';
import { CheckCircle2, AlertTriangle, Loader2, Play, PlugZap, Globe, BookText, Plug } from 'lucide-react';
import type { AnkiMapping } from '../../shared/types';
import { StepSection } from './StepSection';
import { ConnNode, ConnLink } from './Conn';

/* ─── AnkiStep ────────────────────────────────────────────────────────────── */

interface AnkiStepProps {
  mapping: AnkiMapping;
  setMapping: (m: AnkiMapping) => void;
  ping: { status: 'idle' | 'pinging' | 'ok' | 'error'; version?: number; error?: string };
  onRunPing: () => void;
}

export function AnkiStep({ mapping, setMapping, ping, onRunPing }: AnkiStepProps) {
  const state = ping.status;
  const isOk = state === 'ok';
  const isErr = state === 'error';
  const isBusy = state === 'pinging';
  const accent = isOk
    ? 'emerald'
    : isErr
      ? 'rose'
      : isBusy
        ? 'indigo'
        : 'zinc';
  const accentClasses: Record<string, { text: string; bg: string; ring: string; line: string }> = {
    emerald: { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10', ring: 'ring-emerald-400/50', line: 'bg-emerald-400' },
    rose:    { text: 'text-rose-600 dark:text-rose-400',       bg: 'bg-rose-50 dark:bg-rose-500/10',       ring: 'ring-rose-400/50',    line: 'bg-rose-400' },
    indigo:  { text: 'text-indigo-600 dark:text-indigo-400',   bg: 'bg-indigo-50 dark:bg-indigo-500/10',   ring: 'ring-indigo-400/50',  line: 'bg-indigo-400' },
    zinc:    { text: 'text-zinc-500 dark:text-zinc-400',       bg: 'bg-zinc-100 dark:bg-zinc-800',         ring: 'ring-zinc-300 dark:ring-zinc-700', line: 'bg-zinc-300 dark:bg-zinc-700' },
  };
  const a = accentClasses[accent];

  return (
    <StepSection
      title={t('onb.ankiConnection')}
      subtitle={t('onb.ankiConnectionDesc')}
    >
      {/* Connection diagram */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <ConnNode icon={<Globe size={20} />} label="Kivara Lingo" sub={t('onb.browserExtension')} tone="indigo" />
          <ConnLink busy={isBusy} ok={isOk} err={isErr} accentLine={a.line} />
          <ConnNode icon={<BookText size={20} />} label="Anki Desktop" sub={t('onb.viaAnkiConnect')} tone="amber" />
        </div>
        <div className="mt-4 flex items-center justify-center gap-2">
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${a.bg}`}>
            {isOk && (
              <span className="relative flex w-2 h-2">
                <span className="absolute inset-0 rounded-full bg-emerald-400/50 animate-ping" style={{ animationDuration: '2s' }} />
                <span className="relative w-2 h-2 rounded-full bg-emerald-500" />
              </span>
            )}
            {isErr && <AlertTriangle size={12} className={a.text} />}
            {isBusy && <Loader2 size={12} className={`${a.text} animate-spin`} />}
            {state === 'idle' && <PlugZap size={12} className={a.text} />}
            <span className={`text-[11px] font-semibold ${a.text}`}>
              {isOk ? t('onb.connectedFmt', { v: ping.version ?? '' })
                : isErr ? (ping.error || t('onb.noResponse'))
                  : isBusy ? t('onb.testingConnection')
                    : t('onb.pendingTest')}
            </span>
          </div>
        </div>
      </div>

      {/* URL + ping action */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-[12px] font-semibold text-zinc-700 dark:text-zinc-300">
            <Plug size={12} className="text-zinc-400" /> {t('onb.ankiUrlLabel')}</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={mapping.ankiUrl}
              onChange={(e) => setMapping({ ...mapping, ankiUrl: e.target.value })}
              className="sl-input sl-lg flex-1 font-mono"
            />
            <button
              onClick={onRunPing}
              disabled={isBusy}
              className="inline-flex items-center gap-2 px-4 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-60 shadow-sm transition-all shrink-0"
            >
              {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              <span style={{ fontSize: 13, fontWeight: 600 }}>{t('onb.probeAction')}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 p-3 flex gap-2.5">
        <AlertTriangle size={13} className="text-zinc-400 mt-0.5 shrink-0" />
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
          {t('onb.ifNoResponse')} <span className="font-medium text-zinc-700 dark:text-zinc-300">Tools → Add-ons → AnkiConnect → Config</span> {t('onb.checkThat')}{' '}
          <span className="font-mono text-[10px] bg-white dark:bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300">webBindAddress</span> {t('onb.isWord')}{' '}
          <span className="font-mono text-[10px] bg-white dark:bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300">127.0.0.1</span>.
        </p>
      </div>
    </StepSection>
  );
}
