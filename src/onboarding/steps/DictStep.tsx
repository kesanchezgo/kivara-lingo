/* DictStep — the Yomitan dictionary importer step. Moved verbatim from the wizard root. */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { t } from '../../shared/i18n';
import { Download, CheckCircle2, AlertTriangle, Loader2, ShieldCheck, Cpu, BookText, Sparkles, Brain } from 'lucide-react';
import { listYomitanPacks } from '../../content/nlp/yomitan';
import {
  CURATED_DICT_PACKS,
  defaultSelection,
  pickPacksToInstall,
  type OnboardingDictPack,
} from '../dict-onboarding';
import { StepSection } from './StepSection';
import { ToggleRow } from './StepSection';

/* ─── DictStep — real Yomitan importer wired to the curated catalogue ────── */

type InstallStatus = 'idle' | 'queued' | 'downloading' | 'installed' | 'error';

export interface InstallState {
  status: InstallStatus;
  /** Populated on `error` so the user can see why a pack failed. */
  error?: string;
  /** Populated on `installed` so we can surface the term count next to the title. */
  termsImported?: number;
}

export function DictStep() {
  const [installedTitles, setInstalledTitles] = useState<Set<string>>(new Set());
  const [installedTermCounts, setInstalledTermCounts] = useState<Record<string, number>>({});
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Record<string, InstallState>>({});
  const [running, setRunning] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  // Hydrate the "already installed" set on mount so re-runs of the wizard
  // don't re-download packs the user already has.
  useEffect(() => {
    void (async () => {
      try {
        const rows = await listYomitanPacks();
        const titles = new Set(rows.map((r) => r.title));
        const counts: Record<string, number> = {};
        for (const r of rows) counts[r.title] = r.termCount;
        setInstalledTitles(titles);
        setInstalledTermCounts(counts);
        setSelection(defaultSelection(CURATED_DICT_PACKS, titles));
      } catch (err) {
        // Dexie not available — degrade gracefully and let the user proceed.
        console.warn('[Kivara Lingo] could not list packs in onboarding', err);
        setSelection(defaultSelection(CURATED_DICT_PACKS, new Set()));
      }
    })();
  }, []);

  const toggle = useCallback((url: string) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }, []);

  const toInstall = useMemo(
    () => pickPacksToInstall(CURATED_DICT_PACKS, installedTitles, selection),
    [installedTitles, selection],
  );

  const installAll = useCallback(async () => {
    if (toInstall.length === 0) return;
    setRunning(true);
    setTopError(null);
    setStatuses((prev) => {
      const next = { ...prev };
      for (const p of toInstall) next[p.url] = { status: 'queued' };
      return next;
    });
    for (const pack of toInstall) {
      setStatuses((prev) => ({ ...prev, [pack.url]: { status: 'downloading' } }));
      try {
        // Run download + unzip + DB insert in the service worker so a
        // multi-hundred-MB decompressed payload can't OOM-kill the
        // onboarding page. The SW uses fflate's streaming `Unzip`, so
        // peak memory is bounded by the largest single term_bank file.
        const result = await new Promise<
          | { ok: true; pack: { title: string; termCount: number }; termsImported: number }
          | { ok: false; error: string }
        >((resolve) => {
          try {
            chrome.runtime.sendMessage(
              { type: 'INSTALL_DICT_PACK_FROM_URL', url: pack.url },
              (response) => {
                const err = chrome.runtime.lastError;
                if (err) {
                  resolve({ ok: false, error: err.message ?? t('dict.swNoResponse') });
                  return;
                }
                resolve(response);
              },
            );
          } catch (err) {
            resolve({ ok: false, error: (err as Error).message });
          }
        });
        if (result.ok) {
          setStatuses((prev) => ({
            ...prev,
            [pack.url]: { status: 'installed', termsImported: result.termsImported },
          }));
          setInstalledTitles((prev) => new Set(prev).add(result.pack.title));
          setInstalledTermCounts((prev) => ({ ...prev, [result.pack.title]: result.pack.termCount }));
        } else {
          setStatuses((prev) => ({
            ...prev,
            [pack.url]: { status: 'error', error: result.error },
          }));
        }
      } catch (err) {
        setStatuses((prev) => ({
          ...prev,
          [pack.url]: {
            status: 'error',
            error: err instanceof Error ? err.message : 'unknown error',
          },
        }));
      }
    }
    setRunning(false);
  }, [toInstall]);

  const allDone = useMemo(
    () =>
      toInstall.length === 0 &&
      Array.from(selection).every((url) => {
        const pack = CURATED_DICT_PACKS.find((p) => p.url === url);
        return pack ? installedTitles.has(pack.title) : true;
      }),
    [toInstall.length, selection, installedTitles],
  );

  return (
    <StepSection
      title="Diccionarios offline"
      subtitle={t('onb.recommendedPacks')}
    >
      <div className="rounded-xl border border-indigo-200 dark:border-indigo-500/25 bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-500/10 dark:to-zinc-900 p-4 flex gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-500/15 ring-1 ring-indigo-500/25 text-indigo-600 dark:text-indigo-300 flex items-center justify-center shrink-0">
          <ShieldCheck size={18} />
        </div>
        <div className="text-[12px] text-indigo-900 dark:text-indigo-100 leading-relaxed space-y-1 min-w-0">
          <p className="text-[12.5px]">
            <strong className="font-semibold">Cobertura local ~98%</strong> {t('onb.coverageVs')}</p>
          <p className="text-[11.5px] text-indigo-700/80 dark:text-indigo-200/70">
            {t('onb.storedLocalNote')}</p>
        </div>
      </div>

      <ul className="space-y-2.5">
        {CURATED_DICT_PACKS.map((pack) => {
          const isInstalled = installedTitles.has(pack.title);
          const status = statuses[pack.url];
          const hasFailed = status?.status === 'error';
          const isDisabled = pack.disabledInOnboarding;
          const checked = !isDisabled && !hasFailed && (selection.has(pack.url) || isInstalled);
          const checkboxDisabled = isInstalled || running || isDisabled || hasFailed;

          // Tier visuals
          const tier = pack.tier;
          const tierMeta = tier === 'core'
            ? { ribbon: 'bg-amber-400', icon: <BookText size={18} />, iconBg: 'bg-amber-500/10 ring-amber-500/25 text-amber-600 dark:text-amber-300', tag: 'Core', tagBg: 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300' }
            : tier === 'recommended'
              ? { ribbon: 'bg-indigo-400', icon: <Sparkles size={18} />, iconBg: 'bg-indigo-500/10 ring-indigo-500/25 text-indigo-600 dark:text-indigo-300', tag: 'Recomendado', tagBg: 'bg-indigo-100 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300' }
              : { ribbon: 'bg-zinc-300 dark:bg-zinc-600', icon: <Brain size={18} />, iconBg: 'bg-zinc-500/10 ring-zinc-500/25 text-zinc-500 dark:text-zinc-400', tag: 'Premium', tagBg: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400' };

          // Card state ring
          const ringClass = isInstalled
            ? 'border-transparent ring-2 ring-emerald-400/60 bg-emerald-50/40 dark:bg-emerald-500/5'
            : hasFailed
              ? 'border-transparent ring-2 ring-rose-400/60 bg-rose-50/30 dark:bg-rose-500/5'
              : checked && !isDisabled
                ? 'border-transparent ring-2 ring-indigo-400/60 bg-indigo-50/30 dark:bg-indigo-500/5'
                : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900';

          return (
            <li
              key={pack.url}
              className={`relative rounded-xl border ${ringClass} overflow-hidden transition-all ${isDisabled ? 'opacity-60' : ''}`}
            >
              {/* Tier ribbon */}
              <div className={`absolute left-0 top-0 bottom-0 w-1 ${tierMeta.ribbon}`} aria-hidden />
              <label
                htmlFor={`dict-onb-${pack.url}`}
                className={`block pl-4 pr-4 py-3 ${checkboxDisabled ? 'cursor-default' : 'cursor-pointer'} select-none`}
              >
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div className={`w-10 h-10 rounded-xl ring-1 flex items-center justify-center shrink-0 ${tierMeta.iconBg}`}>
                    {tierMeta.icon}
                  </div>
                  {/* Body */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-[13.5px] font-semibold text-zinc-800 dark:text-zinc-100">{pack.title}</span>
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${tierMeta.tagBg}`}>
                        {tierMeta.tag}
                      </span>
                      <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono">{pack.size}</span>
                      <span className="text-[10px] text-zinc-400 dark:text-zinc-500">·</span>
                      <span className="text-[10px] text-zinc-500 dark:text-zinc-400 italic">{pack.benefit}</span>
                    </div>
                    <p className="text-[11.5px] text-zinc-600 dark:text-zinc-400 leading-snug mt-1">{pack.description}</p>
                    {isDisabled && pack.disabledReason && (
                      <p className="text-[10.5px] text-zinc-500 dark:text-zinc-500 mt-1.5 leading-snug flex items-start gap-1.5">
                        <AlertTriangle size={11} className="text-amber-500 mt-0.5 shrink-0" />
                        {pack.disabledReason}
                      </p>
                    )}
                    <DictStepRowStatus isInstalled={isInstalled} installedTermCount={installedTermCounts[pack.title]} status={status} />
                  </div>
                  {/* Checkbox / state */}
                  <div className="shrink-0 flex items-center justify-center w-6 h-6 mt-0.5">
                    {isInstalled ? (
                      <CheckCircle2 size={18} className="text-emerald-500" />
                    ) : (
                      <input
                        type="checkbox"
                        id={`dict-onb-${pack.url}`}
                        checked={checked}
                        disabled={checkboxDisabled}
                        onChange={() => toggle(pack.url)}
                        className="w-4 h-4 accent-indigo-600 cursor-pointer disabled:cursor-not-allowed"
                      />
                    )}
                  </div>
                </div>
              </label>
            </li>
          );
        })}
      </ul>

      {/* Install summary bar */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 flex items-center gap-3 flex-wrap">
        <div className="w-9 h-9 rounded-lg bg-indigo-500/10 ring-1 ring-indigo-500/20 text-indigo-600 dark:text-indigo-300 flex items-center justify-center shrink-0">
          <Download size={15} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[12.5px] font-semibold text-zinc-800 dark:text-zinc-100 leading-tight">
            {running
              ? 'Instalando packs seleccionados…'
              : toInstall.length === 0
                ? allDone ? t('onb.allPacksInstalled') : t('onb.selectPack')
                : `${toInstall.length} ${toInstall.length === 1 ? 'pack listo' : 'packs listos'} para instalar`}
          </p>
          <p className="text-[10.5px] text-zinc-500 dark:text-zinc-400 leading-tight mt-0.5">
            {running ? t('onb.sequentialNote') : t('onb.skipPacks')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void installAll()}
          disabled={running || toInstall.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm hover:shadow-md hover:shadow-indigo-500/20 transition-all shrink-0"
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          <span className="text-[12px] font-semibold">
            {running
              ? 'Instalando…'
              : toInstall.length === 0
                ? allDone ? 'Todo listo' : 'Nada seleccionado'
                : `Instalar ${toInstall.length}`}
          </span>
        </button>
      </div>

      {topError && (
        <div className="rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/25 px-4 py-3 text-[12px] text-rose-700 dark:text-rose-400 flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>{topError}</span>
        </div>
      )}

      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed px-0.5">
        {t('onb.compatiblePre')}{' '}
        <span className="font-medium text-zinc-600 dark:text-zinc-300">Settings → Diccionarios offline</span>.
      </p>
    </StepSection>
  );
}
export interface DictStepRowStatusProps {
  isInstalled: boolean;
  installedTermCount?: number;
  status: InstallState | undefined;
}

export function DictStepRowStatus({ isInstalled, installedTermCount, status }: DictStepRowStatusProps) {
  if (status?.status === 'installed') {
    return (
      <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 inline-flex items-center gap-1">
        <CheckCircle2 size={12} />
        Instalado · {(status.termsImported ?? 0).toLocaleString()} {t('onb.termsCount')}</p>
    );
  }
  if (status?.status === 'downloading') {
    return (
      <p className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-1 inline-flex items-center gap-1">
        <Loader2 size={12} className="animate-spin" />
        Descargando e instalando…
      </p>
    );
  }
  if (status?.status === 'queued') {
    return (
      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1 inline-flex items-center gap-1">
        <Loader2 size={12} className="opacity-50" />
        En cola
      </p>
    );
  }
  if (status?.status === 'error') {
    return (
      <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1 inline-flex items-center gap-1">
        <AlertTriangle size={12} />
        {status.error || t('common.unexpectedError')}
      </p>
    );
  }
  if (isInstalled) {
    const count = installedTermCount ? t('dict.packTermsCount', { count: installedTermCount.toLocaleString() }) : '';
    return (
      <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 inline-flex items-center gap-1">
        <CheckCircle2 size={12} />
        {t('onb.installedDone')}{count}
      </p>
    );
  }
  return null;
}
