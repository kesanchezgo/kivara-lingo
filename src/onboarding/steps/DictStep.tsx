/**
 * Dictionary step — Yomitan packs importer (F8; prototype view, repo flow).
 *
 * The catalogue, the installed-pack detection and the install loop (a message
 * to the service worker, so a multi-hundred-MB decompressed payload cannot
 * OOM-kill the page) are the repo's. The layout and the status copy follow the
 * prototype. Nothing here blocks the wizard: the step is recommended, not
 * required.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, CheckCircle2, AlertTriangle, Loader2, ShieldCheck, BookText, Sparkles, Brain, Download } from '../../ui/icons';
import { t, fmtNumber } from '../../shared/i18n';
import { richText } from '../../shared/i18n/rich';
import { listYomitanPacks } from '../../content/nlp/yomitan';
import {
  CURATED_DICT_PACKS,
  defaultSelection,
  pickPacksToInstall,
} from '../dict-onboarding';
import { Badge, Button } from '../../ui/primitives/settings-primitives';
import { StepSection } from './StepSection';

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
            error: err instanceof Error ? err.message : t('common.unexpectedError'),
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
      icon={<BookText size={20} />}
      title={t('onb.dictsOffline')}
      subtitle={t('onb.recommendedPacks')}
    >
      {/* Coverage: one highlighted line, no box */}
      <p className="text-center text-[13px] leading-[19px] text-zinc-600 dark:text-zinc-300 px-4">
        <ShieldCheck size={15} className="inline-block align-[-3px] mr-1.5 text-indigo-500 dark:text-indigo-400" />
        <span>
          <strong className="font-semibold text-zinc-900 dark:text-white">{t('onb.localCoverage')}</strong> {t('onb.coverageVs')}
          <span className="block mt-1 text-[12px] text-zinc-500 dark:text-zinc-400">
            {t('onb.storedLocalNote', { path: `${t('nav.settings')} › ${t('set.sectionOfflineDicts')}` })}
          </span>
        </span>
      </p>

      {/* Main piece: catalogue + install in one card */}
      <div className="rounded-2xl bg-white dark:bg-white/[0.03] ring-1 ring-zinc-900/[0.06] dark:ring-white/[0.06] shadow-[0_12px_32px_-18px_rgba(16,24,40,.25)] dark:shadow-none overflow-hidden">
        <ul className="divide-y divide-zinc-900/[0.06] dark:divide-white/[0.06]">
          {CURATED_DICT_PACKS.map((pack) => {
            const isInstalled = installedTitles.has(pack.title);
            const status = statuses[pack.url];
            const hasFailed = status?.status === 'error';
            const isDisabled = pack.disabledInOnboarding;
            const checked = !isDisabled && !hasFailed && (selection.has(pack.url) || isInstalled);
            const checkboxDisabled = isInstalled || running || isDisabled || hasFailed;

            const tier = pack.tier;
            const tierMeta = tier === 'core'
              ? { ribbon: 'bg-amber-400', icon: <BookText size={18} />, iconBg: 'bg-indigo-500/[0.08] dark:bg-indigo-400/[0.12] text-indigo-600 dark:text-indigo-300', tag: t('dict.tierCore'), tagTone: 'amber' as const }
              : tier === 'recommended'
                ? { ribbon: 'bg-indigo-400', icon: <Sparkles size={18} />, iconBg: 'bg-indigo-500/[0.08] dark:bg-indigo-400/[0.12] text-indigo-600 dark:text-indigo-300', tag: t('dict.tierRecommended'), tagTone: 'indigo' as const }
                : { ribbon: 'bg-zinc-300 dark:bg-zinc-600', icon: <Brain size={18} />, iconBg: 'bg-zinc-900/[0.04] dark:bg-white/[0.06] text-zinc-500 dark:text-zinc-400', tag: t('dict.tierPremium'), tagTone: 'neutral' as const };

            const rowBg = hasFailed
              ? 'bg-rose-50/40 dark:bg-rose-500/[0.05]'
              : checked && !isDisabled && !isInstalled
                ? 'bg-indigo-50/40 dark:bg-indigo-500/[0.05]'
                : 'hover:bg-zinc-50/70 dark:hover:bg-white/[0.02]';

            return (
              <li key={pack.url} className={`relative transition-colors ${rowBg} ${isDisabled ? 'opacity-60' : ''}`}>
                <span aria-hidden className={`absolute left-0 top-0 bottom-0 w-1 ${tierMeta.ribbon}`} />
                <label
                  htmlFor={`dict-onb-${pack.url}`}
                  className={`block pl-4 pr-4 py-4 ${checkboxDisabled ? 'cursor-default' : 'cursor-pointer'} select-none`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${tierMeta.iconBg}`}>
                      {tierMeta.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100">{pack.title}</span>
                        <Badge tone={tierMeta.tagTone}>{tierMeta.tag}</Badge>
                        <span className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono">{pack.size}</span>
                        <span className="text-[12px] text-zinc-400 dark:text-zinc-500">·</span>
                        <span className="text-[12px] text-zinc-500 dark:text-zinc-400">{pack.benefit}</span>
                      </div>
                      <p className="text-[12px] text-zinc-600 dark:text-zinc-400 leading-snug mt-1">{pack.description}</p>
                      {isDisabled && pack.disabledReason && (
                        <p className="text-[12px] text-zinc-500 dark:text-zinc-500 mt-1.5 leading-snug flex items-start gap-1.5">
                          <AlertTriangle size={12} className="text-amber-500 mt-0.5 shrink-0" />
                          {pack.disabledReason}
                        </p>
                      )}
                      <DictStepRowStatus isInstalled={isInstalled} installedTermCount={installedTermCounts[pack.title]} status={status} />
                    </div>
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
                          className="peer sr-only"
                        />
                      )}
                      {!isInstalled && (
                        <span
                          aria-hidden
                          className={`w-[18px] h-[18px] rounded-md border flex items-center justify-center transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500/40 ${
                            checked
                              ? 'bg-indigo-600 border-indigo-600 text-white'
                              : 'bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700'
                          } ${checkboxDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                          {checked && <Check size={12} weight="bold" />}
                        </span>
                      )}
                    </div>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>

        {/* Card footer: summary + install */}
        <div className="border-t border-zinc-900/[0.06] dark:border-white/[0.06] bg-zinc-50/70 dark:bg-white/[0.02] px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100 leading-tight">
              {running
                ? t('onb.installingSelected')
                : toInstall.length === 0
                  ? allDone ? t('onb.allPacksInstalled') : t('onb.selectPack')
                  : toInstall.length === 1 ? t('onb.packsReadyOne') : t('onb.packsReadyFmt', { n: toInstall.length })}
            </p>
            <p className="text-[12px] text-zinc-500 dark:text-zinc-400 leading-tight mt-0.5">
              {running ? t('onb.sequentialNote') : t('onb.skipPacks')}
            </p>
          </div>
          <Button
            variant="primary"
            onClick={() => void installAll()}
            disabled={running || toInstall.length === 0}
            icon={running ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          >
            {running
              ? t('onb.installing')
              : toInstall.length === 0
                ? allDone ? t('onb.allDoneShort') : t('onb.nothingSelected')
                : t('onb.installFmt', { n: toInstall.length })}
          </Button>
        </div>
      </div>

      {topError && (
        <p className="text-center text-[12px] text-rose-600 dark:text-rose-400 leading-relaxed px-4 inline-flex items-center gap-1.5">
          <AlertTriangle size={13} className="shrink-0" />
          <span>{topError}</span>
        </p>
      )}

      <p className="text-center text-[12px] leading-[18px] text-zinc-500 dark:text-zinc-400 px-6 pt-1">
        {richText(t('onb.compatible'), {
          path: <span className="font-medium text-zinc-700 dark:text-zinc-300">{t('nav.settings')} › {t('set.sectionOfflineDicts')}</span>,
        })}
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
      <p className="text-[12px] text-emerald-600 dark:text-emerald-400 mt-1 inline-flex items-center gap-1">
        <CheckCircle2 size={12} />
        {t('dict.installed')} · {fmtNumber(status.termsImported ?? 0)} {t('onb.termsCount')}
      </p>
    );
  }
  if (status?.status === 'downloading') {
    return (
      <p className="text-[12px] text-indigo-600 dark:text-indigo-400 mt-1 inline-flex items-center gap-1">
        <Loader2 size={12} className="animate-spin" />
        {t('onb.downloadingInstalling')}
      </p>
    );
  }
  if (status?.status === 'queued') {
    return (
      <p className="text-[12px] text-zinc-500 dark:text-zinc-400 mt-1 inline-flex items-center gap-1">
        <Loader2 size={12} className="opacity-50" />
        {t('onb.queued')}
      </p>
    );
  }
  if (status?.status === 'error') {
    return (
      <p className="text-[12px] text-rose-600 dark:text-rose-400 mt-1 inline-flex items-center gap-1">
        <AlertTriangle size={12} />
        {status.error || t('common.unexpectedError')}
      </p>
    );
  }
  if (isInstalled) {
    const count = installedTermCount ? ` · ${fmtNumber(installedTermCount)} ${t('onb.termsCount')}` : '';
    return (
      <p className="text-[12px] text-emerald-600 dark:text-emerald-400 mt-1 inline-flex items-center gap-1">
        <CheckCircle2 size={12} />
        {t('onb.installedDone')}{count}
      </p>
    );
  }
  return null;
}