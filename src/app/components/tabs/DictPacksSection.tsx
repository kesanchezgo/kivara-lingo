/**
 * Dictionary Packs management section.
 *
 * Lists Yomitan-compatible packs the user has installed (stored in IndexedDB
 * via Dexie), lets them toggle each pack on/off, and offers four import
 * surfaces:
 *
 *   1. **Pack gallery**          — one-click "Instalar" buttons for the
 *                                  curated Wiktionary EN→ES / IPA / Monolingüe
 *                                  packs published by the kaikki-to-yomitan
 *                                  project. The URL is downloaded by the
 *                                  service worker (which carries the
 *                                  extension's host_permissions).
 *   2. **Import from URL**       — same flow as the gallery, but with a
 *                                  user-entered URL — handy for nightly
 *                                  builds and forks.
 *   3. **Import from .zip file** — original local-file picker. Unchanged.
 *   4. **Personal CSV/TSV list** — paste a list of `word, translation, ...`
 *                                  rows that surface in the popover under a
 *                                  synthetic "Mi lista" pack.
 *   5. **StarDict (.zip)**       — accepts StarDict bundles (`.ifo / .idx /
 *                                  .dict.dz`) zipped together. Imported as
 *                                  a regular Yomitan-style pack so it
 *                                  participates in normal lookups.
 *
 * All five paths share the same downstream pipeline (`dict_packs` +
 * `dict_terms` rows in Dexie), so once a pack is in IndexedDB every
 * surface — popover, save-card enrichment, options page — sees it.
 *
 * Local files (3, 4 and 5) never touch IndexedDB from here: this panel runs
 * inside the content script, where `IndexedDB` is the streaming site's
 * database. The file is parsed locally and the rows go to the service worker
 * over `DICT_PACK_IMPORT_*` (see `content/nlp/dict-import-client.ts`), which
 * writes them under the extension's own origin. Same code path when the panel
 * is mounted in the Options page.
 *
 * The visual structure mirrors the prototype's `DictPacksSection`: the section
 * lives inside the parent SettingsTab accordion, so its own header is implicit
 * and it renders compact sub-sections (Catálogo, Instalados, Importar,
 * Cobertura) stacked inside the accordion body. All real wiring (Dexie via the
 * worker, messaging, telemetry, real importers) is preserved unchanged; only
 * the surface is the prototype's, with every user-facing string through `t()`.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Trash2, Upload, Power, PowerOff, Loader2,
  Download, FileText, Library, ChevronDown, CheckCircle2, BarChart3, Sparkles,
  Package, Cloud, Ban, RotateCcw,
} from '../../../ui/icons';
import { t, fmtNumber } from '../../../shared/i18n';
import { InfoHint } from '../InfoHint';
import { Button, Callout, Toggle, Badge, ListGroup, QuickRow } from '../../../ui/primitives/settings-primitives';
import { inputCls } from '../../../ui/primitives/controls';
import type { DictPackRow, PackStatsRow } from '../../../shared/dict-types';
import {
  importCsvTextViaWorker,
  importDictFileViaWorker,
} from '../../../content/nlp/dict-import-client';
import {
  aggregateCoverage,
  BUNDLE_PACK_ID,
  DEFAULT_IDLE_THRESHOLD_MS,
  idlePacks,
  MISS_PACK_ID,
  REMOTE_PACK_ID,
  topPacksByHits,
} from '../../../shared/telemetry-model';
import {
  exportPackStatsViaWorker,
  importPackStatsViaWorker,
  readPackStatsViaWorker,
  resetPackStatsViaWorker,
  type PackStatsFailure,
} from '../../../shared/telemetry-client';
import { useKivaraStore } from '../../../shared/use-kivara-store';
import {
  RECOMMENDED_PACKS,
  GROUP_LABELS,
  type RecommendedPack,
} from '../../../shared/dict-pack-catalog';

interface ImportFeedback {
  kind: 'ok' | 'err';
  message: string;
}

/**
 * Panel copy for a coverage operation that did not complete. A torn-down
 * worker has no message worth showing (Chrome's is an English debug string),
 * so it maps to the shared "worker did not respond" string; a rejection from
 * the worker carries its own explanation (e.g. the snapshot validator).
 */
function failureMessage(failure: PackStatsFailure): string {
  return failure.code === 'worker-unavailable' ? t('dict.swNoResponse') : failure.error;
}

const TIER_META: Record<RecommendedPack['tier'], { label: string; tone: 'amber' | 'indigo' | 'fuchsia'; icon: React.ReactNode }> = {
  core:        { label: 'dict.tierCore',        tone: 'amber',   icon: <Sparkles size={14} /> },
  recommended: { label: 'dict.tierRecommended', tone: 'indigo',  icon: null },
  premium:     { label: 'dict.tierPremium',     tone: 'fuchsia', icon: null },
};

export function DictPacksSection() {
  const [packs, setPacks] = useState<DictPackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importingUrl, setImportingUrl] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ImportFeedback | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [csvOpen, setCsvOpen] = useState(false);
  // Empty = default name (applied at import): a translated initial value froze
  // the old language when the user switched locales.
  const [csvTitle, setCsvTitle] = useState('');
  const [csvText, setCsvText] = useState('');
  const [importingCsv, setImportingCsv] = useState(false);
  const [stats, setStats] = useState<PackStatsRow[]>([]);
  const [coverageOpen, setCoverageOpen] = useState(false);
  // Inline delete confirmation (no window.confirm) so the panel keeps its rhythm.
  const [confirmDeleteId, setConfirmDeleteId] = useState<DictPackRow['id'] | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvFileInputRef = useRef<HTMLInputElement>(null);
  const coverageFileInputRef = useRef<HTMLInputElement>(null);

  const telemetry = useKivaraStore((s) => s.telemetry);
  const setTelemetry = useKivaraStore((s) => s.setTelemetry);

  const idlePackIds = useMemo(
    () => new Set(idlePacks(stats).map((r) => r.packId)),
    [stats],
  );
  const installedPackTitles = useMemo(
    () => new Set(packs.map((p) => p.title)),
    [packs],
  );

  const isPackInstalled = useCallback(
    (recommendedTitle: string, recommendedUrl: string): boolean => {
      if (installedPackTitles.has(recommendedTitle)) return true;
      const basename = recommendedUrl.split('/').pop()?.replace(/\.zip$/i, '') ?? '';
      if (basename && installedPackTitles.has(basename)) return true;
      for (const title of installedPackTitles) {
        if (title.toLowerCase().includes(basename.toLowerCase())) return true;
        if (recommendedTitle.toLowerCase().includes(title.toLowerCase())) return true;
      }
      return false;
    },
    [installedPackTitles],
  );

  const refresh = useCallback(async () => {
    try {
      const reply: unknown = await new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage({ type: 'LIST_DICT_PACKS' }, (r) => {
            // chrome.runtime.lastError fires when the service worker is gone
            // (e.g. after the extension was reloaded but the page wasn't).
            // We swallow it so the UI degrades gracefully instead of throwing.
            const err = chrome.runtime.lastError;
            if (err) reject(new Error(err.message));
            else resolve(r);
          });
        } catch (sendErr) {
          reject(sendErr);
        }
      });
      const r = reply as { ok?: boolean; packs?: DictPackRow[] };
      if (r?.ok && Array.isArray(r.packs)) setPacks(r.packs);
      else setPacks([]);
    } catch (err) {
      // "Extension context invalidated" is expected after a hot-reload —
      // the user just needs to refresh the host page. No need to spam the
      // console with a stack trace.
      const msg = err instanceof Error ? err.message : String(err);
      if (!/context invalidated/i.test(msg)) {
        console.warn('[Kivara Lingo] could not list dict packs', err);
      }
      setPacks([]);
    }
    const statsOutcome = await readPackStatsViaWorker();
    if (statsOutcome.ok) {
      setStats(statsOutcome.rows);
    } else if (statsOutcome.code === 'failed') {
      // `worker-unavailable` is the expected shape right after an extension
      // reload; the panel just shows no stats until the page is refreshed.
      console.warn('[Kivara Lingo] could not read telemetry', statsOutcome.error);
    }
  }, []);

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  /* ── Coverage import / export ────────────────────────────────────────── */

  const onResetCoverage = useCallback(async () => {
    setFeedback(null);
    const outcome = await resetPackStatsViaWorker();
    if (!outcome.ok && outcome.code === 'failed') {
      console.warn('[Kivara Lingo] could not reset coverage', outcome.error);
    }
    await refresh();
    setFeedback({ kind: 'ok', message: t('dict.countersCleared') });
  }, [refresh]);

  const onExportCoverage = useCallback(async () => {
    setFeedback(null);
    try {
      const outcome = await exportPackStatsViaWorker('kivara-lingo');
      if (!outcome.ok) throw new Error(failureMessage(outcome));
      const snap = outcome.snapshot;
      const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `kivara-coverage-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setFeedback({ kind: 'ok', message: t('dict.coverageExported', { count: fmtNumber(snap.rows.length) }) });
    } catch (err) {
      setFeedback({ kind: 'err', message: t('dict.coverageImportError', { msg: (err as Error).message }) });
    }
  }, []);

  const onPickCoverageImport = useCallback(
    () => coverageFileInputRef.current?.click(),
    [],
  );

  const onCoverageFileChosen = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      setFeedback(null);
      try {
        const text = await file.text();
        const raw = JSON.parse(text);
        // The snapshot is validated in the worker (parseSnapshot): version,
        // rows array, and every row's field types and ranges.
        const outcome = await importPackStatsViaWorker(raw, 'merge');
        if (!outcome.ok) throw new Error(failureMessage(outcome));
        await refresh();
        setFeedback({
          kind: 'ok',
          message: t('dict.coverageImported', { added: fmtNumber(outcome.added), merged: fmtNumber(outcome.merged) }),
        });
      } catch (err) {
        setFeedback({ kind: 'err', message: t('dict.coverageImportError', { msg: (err as Error).message }) });
      }
    },
    [refresh],
  );

  /* ── Import handlers (real importers, unchanged) ─────────────────────── */

  const onFileAuto = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      setFeedback(null);
      setImporting(true);
      try {
        const buffer = await file.arrayBuffer();
        const result = await importDictFileViaWorker(buffer, file.name);
        if (result.ok) {
          const formatLabel: Record<typeof result.format, string> = {
            yomitan: 'Yomitan',
            stardict: 'StarDict',
            csv: 'CSV',
          };
          const skipNote = result.skipped ? t('dict.skippedNote', { count: result.skipped }) : '';
          setFeedback({
            kind: 'ok',
            message: t('dict.importOkFmt', {
              title: result.pack.title,
              count: fmtNumber(result.termsImported),
              format: formatLabel[result.format],
              skip: skipNote,
            }),
          });
          // No notify here: the worker broadcasts DICT_PACKS_CHANGED itself
          // once the commit lands, which is what makes every tab re-pull its
          // in-memory headword cache.
        } else {
          setFeedback({ kind: 'err', message: result.error });
        }
        await refresh();
      } catch (err) {
        setFeedback({ kind: 'err', message: t('dict.unexpectedError', { msg: (err as Error).message }) });
      } finally {
        setImporting(false);
      }
    },
    [refresh],
  );

  const onImportUrl = useCallback(
    async (url: string) => {
      const trimmed = url.trim();
      if (!trimmed) return;
      setFeedback(null);
      setImportingUrl(trimmed);

      try {
        // Run the entire download + unzip + insert in the service worker
        // so a 700+ MB decompressed payload (Wiktionary EN→EN) doesn't
        // blow up the renderer process. The SW streams the ZIP through
        // fflate's `Unzip`, parses each `term_bank_*.json` one at a time,
        // and inserts into IndexedDB before freeing the buffer.
        const result = await new Promise<
          { ok: true; pack: { title: string }; termsImported: number } |
          { ok: false; error: string }
        >((resolve) => {
          try {
            chrome.runtime.sendMessage(
              { type: 'INSTALL_DICT_PACK_FROM_URL', url: trimmed },
              (response) => {
                // Drain runtime.lastError so it doesn't surface as an
                // unchecked warning when the SW restarts mid-install.
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
          setFeedback({
            kind: 'ok',
            message: t('dict.importedOkFmt', {
              title: result.pack.title,
              count: fmtNumber(result.termsImported),
              skip: '',
            }),
          });
          setUrlInput('');
        } else {
          setFeedback({ kind: 'err', message: result.error });
        }
        await refresh();
      } catch (err) {
        setFeedback({ kind: 'err', message: t('dict.unexpectedError', { msg: (err as Error).message }) });
      } finally {
        setImportingUrl(null);
      }
    },
    [refresh],
  );

  const onImportCsv = useCallback(async () => {
    setFeedback(null);
    setImportingCsv(true);
    try {
      const title = csvTitle.trim() || t('dict.defaultListTitle');
      const result = await importCsvTextViaWorker(csvText, { title });
      if (result.ok) {
        const skipped = result.skipped ?? 0;
        setFeedback({
          kind: 'ok',
          message: t('dict.importedOkFmt', {
            title: result.pack.title,
            count: fmtNumber(result.termsImported),
            skip: skipped > 0 ? t('dict.skippedNote', { count: skipped }) : '',
          }),
        });
        setCsvText('');
        setCsvOpen(false);
      } else {
        setFeedback({ kind: 'err', message: result.error });
      }
      await refresh();
    } catch (err) {
      setFeedback({ kind: 'err', message: t('dict.unexpectedError', { msg: (err as Error).message }) });
    } finally {
      setImportingCsv(false);
    }
  }, [csvText, csvTitle, refresh]);

  const onCsvFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        const text = await file.text();
        // Default the title to the filename minus extension if the user
        // hasn't typed one yet.
        const baseTitle = file.name.replace(/\.[^.]+$/, '');
        if (!csvTitle.trim()) setCsvTitle(baseTitle);
        setCsvText(text);
        setCsvOpen(true);
      } catch (err) {
        setFeedback({ kind: 'err', message: t('dict.readFileError', { msg: (err as Error).message }) });
      }
    },
    [csvTitle],
  );

  const onToggle = useCallback(
    async (pack: DictPackRow) => {
      await new Promise<void>((resolve) => {
        try {
          chrome.runtime.sendMessage(
            { type: 'SET_PACK_ENABLED', id: pack.id, enabled: !pack.enabled },
            () => {
              // Drain chrome.runtime.lastError so it doesn't surface as an
              // "Unchecked runtime.lastError" warning when the worker is gone.
              void chrome.runtime.lastError;
              resolve();
            },
          );
        } catch {
          resolve();
        }
      });
      await refresh();
    },
    [refresh],
  );

  const onDelete = useCallback(
    async (pack: DictPackRow) => {
      setConfirmDeleteId(null);
      await new Promise<void>((resolve) => {
        try {
          chrome.runtime.sendMessage(
            { type: 'DELETE_DICT_PACK', id: pack.id },
            () => {
              void chrome.runtime.lastError;
              resolve();
            },
          );
        } catch {
          resolve();
        }
      });
      await refresh();
    },
    [refresh],
  );

  const totals = aggregateCoverage(stats);
  // Restrict the rendered groups to the ones the curated catalogue uses today
  // (frequency / examples are placeholders for future packs).
  const groups: RecommendedPack['group'][] = ['bilingual', 'monolingual', 'phonetic'];

  return (
    <div className="px-4 pt-3 pb-4 space-y-5">

      {/* ── Catálogo recomendado ─────────────────────────────────────────── */}
      <SubSection icon={<Library size={14} />} title={t('dict.recommendedCatalog')}>
        <div className="space-y-3">
          {groups.map((group) => {
            const cards = RECOMMENDED_PACKS.filter((p) => p.group === group);
            if (cards.length === 0) return null;
            return (
              <div key={group} className="space-y-1.5">
                <div className="text-[12px] font-medium text-zinc-400 dark:text-zinc-500 px-1">
                  {GROUP_LABELS[group]}
                </div>
                <ListGroup>
                  {cards.map((p) => {
                    const installed = isPackInstalled(p.title, p.url);
                    const busy = importingUrl === p.url;
                    const tier = TIER_META[p.tier];
                    return (
                      <div key={p.url} className="kvl-row px-3 py-2.5 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start gap-1.5 min-w-0">
                            <span className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100 leading-[18px] line-clamp-2 [overflow-wrap:anywhere]">{p.title}</span>
                            <span className="mt-px shrink-0"><InfoHint text={`${p.description} — ${p.license}`} /></span>
                          </div>
                          <div className="mt-1 flex items-center gap-1.5 min-w-0">
                            <Badge tone={tier.tone}>{tier.icon}{t(tier.label)}</Badge>
                            <span className="text-[12px] text-zinc-500 dark:text-zinc-400 tabular-nums whitespace-nowrap" title={p.langs}>{p.size}</span>
                          </div>
                        </div>
                        {installed ? (
                          <span className="shrink-0 inline-flex items-center gap-1 text-[12px] font-medium text-emerald-600 dark:text-emerald-400" title={t('dict.installed')}>
                            <CheckCircle2 size={14} />{t('dict.installed')}
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="soft"
                            onClick={() => void onImportUrl(p.url)}
                            disabled={!!importingUrl || importing}
                            icon={busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                          >
                            {busy ? t('dict.downloading') : t('dict.install')}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </ListGroup>
              </div>
            );
          })}
        </div>
      </SubSection>

      {/* ── Instalados ────────────────────────────────────────────────────── */}
      <SubSection
        icon={<CheckCircle2 size={14} />}
        title={t('dict.installedSection')}
        trailing={
          <span className="text-[12px] tabular-nums text-zinc-400 dark:text-zinc-500">
            {loading ? '...' : packs.length}
          </span>
        }
      >
        {loading ? (
          <div className="space-y-1.5" aria-busy="true" aria-label={t('dict.loadingPacks')}>
            {[0, 1].map((k) => (
              <div key={k} className="rounded-xl bg-white dark:bg-white/[0.03] ring-1 ring-zinc-900/[0.06] dark:ring-white/[0.06] px-3 py-3 space-y-2 animate-pulse">
                <div className="h-2.5 w-2/5 rounded bg-zinc-200 dark:bg-zinc-700/70" />
                <div className="h-2 w-3/5 rounded bg-zinc-200/70 dark:bg-zinc-800" />
              </div>
            ))}
            <div className="text-[12px] text-zinc-400 dark:text-zinc-500 px-1 inline-flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" />
              {t('dict.loadingPacks')}
            </div>
          </div>
        ) : packs.length === 0 ? (
          <EmptySub text={t('dict.noneInstalled')} />
        ) : (
          <ListGroup>
            {packs.map((pack) => {
              const idle = idlePackIds.has(String(pack.id));
              if (confirmDeleteId === pack.id) {
                return (
                  <div key={pack.id} className="px-3 py-3 space-y-2.5">
                    <div className="flex items-start gap-2 text-[12px] leading-[17px] text-zinc-600 dark:text-zinc-300">
                      <Trash2 size={14} className="shrink-0 mt-px text-rose-500 dark:text-rose-400" />
                      <span>{t('dict.confirmDeletePack', { title: pack.title, count: fmtNumber(pack.termCount) })}</span>
                    </div>
                    <div className="flex gap-1.5 justify-end">
                      <Button size="sm" variant="secondary" onClick={() => setConfirmDeleteId(null)}>{t('common.cancel')}</Button>
                      <Button size="sm" variant="dangerSolid" icon={<Trash2 size={14} />} onClick={() => void onDelete(pack)}>{t('dict.deleteTitle')}</Button>
                    </div>
                  </div>
                );
              }
              return (
                <div key={pack.id} className="kvl-row px-3 py-2.5 flex items-center gap-1">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100 truncate leading-[18px]">{pack.title}</span>
                      {idle && (
                        <Badge tone="amber" title={t('dict.unusedDisable')}>{t('dictpack.unused30d')}</Badge>
                      )}
                      {!pack.enabled && (
                        <Badge>{t('dict.off')}</Badge>
                      )}
                    </div>
                    <div className="text-[12px] text-zinc-500 dark:text-zinc-400 tabular-nums leading-4 mt-0.5 truncate" title={`${pack.sourceLang} → ${pack.targetLang} · ${fmtNumber(pack.termCount)} ${t('dictpack.termsRev')} ${pack.revision}`}>
                      {t('dict.packTermsCount', { count: fmtNumber(pack.termCount) }).replace(/^\s*·\s*/, '')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onToggle(pack)}
                    className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-zinc-400 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-900/[0.05] dark:hover:bg-white/[0.07] kvl-press shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
                    title={pack.enabled ? t('dict.disable') : t('dict.enable')}
                    aria-label={pack.enabled ? t('dict.disable') : t('dict.enable')}
                  >
                    {pack.enabled ? <Power size={16} /> : <PowerOff size={16} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(pack.id)}
                    className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-zinc-400 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-900/[0.05] dark:hover:bg-white/[0.07] kvl-press shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 hover:!text-rose-500"
                    title={t('dict.deleteTitle')}
                    aria-label={t('dict.deleteTitle')}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}
          </ListGroup>
        )}
      </SubSection>

      {/* ── Importar manualmente ──────────────────────────────────────────── */}
      <SubSection
        icon={<Upload size={14} />}
        title={t('dict.importManual')}
        hint={t('dict.manualImportHint')}
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="block text-[12px] font-medium text-zinc-500 dark:text-zinc-400 px-0.5">
              {t('dictpack.fromUrl')}
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://.../pack.zip"
                className={`${inputCls} font-mono !text-[12px] flex-1 min-w-0`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && urlInput.trim() && !importingUrl) void onImportUrl(urlInput);
                }}
              />
              <Button
                variant="primary"
                onClick={() => void onImportUrl(urlInput)}
                disabled={!urlInput.trim() || !!importingUrl}
                icon={importingUrl && importingUrl === urlInput.trim() ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              >
                {t('dict.download')}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-[12px] font-medium text-zinc-500 dark:text-zinc-400 px-0.5">{t('dict.otherSources')}</label>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                className="flex-1 min-w-0"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                title={t('dict.importFile')}
                icon={importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              >
                <span className="truncate">{t('dict.localFile')}</span>
              </Button>
              <Button
                variant={csvOpen ? 'soft' : 'secondary'}
                className="flex-1 min-w-0"
                onClick={() => setCsvOpen((v) => !v)}
                aria-expanded={csvOpen}
                icon={<FileText size={14} />}
              >
                <span className="truncate">{t('dict.pasteCsv')}</span>
              </Button>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,.csv,.tsv,.txt,application/zip,text/csv,text/tab-separated-values,text/plain"
            onChange={(e) => void onFileAuto(e)}
            className="hidden"
          />
          <input
            ref={csvFileInputRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
            onChange={(e) => void onCsvFile(e)}
            className="hidden"
          />

          {csvOpen && (
            <div className="rounded-xl bg-white dark:bg-white/[0.03] ring-1 ring-zinc-900/[0.06] dark:ring-white/[0.06] p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={csvTitle}
                  onChange={(e) => setCsvTitle(e.target.value)}
                  placeholder={t('dict.listTitle')}
                  aria-label={t('dict.listTitle')}
                  className={`${inputCls} flex-1 min-w-0`}
                />
                <Button
                  variant="secondary"
                  onClick={() => csvFileInputRef.current?.click()}
                  title={t('dict.loadCsv')}
                  icon={<Upload size={14} />}
                >
                  {t('dict.file')}
                </Button>
              </div>
              <textarea
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder={'word, translation, phonetic, definition, example\nhello, hola, /heˈloʊ/, A greeting, Hello world!'}
                rows={4}
                className={`${inputCls} font-mono !text-[12px] w-full !h-auto py-2 leading-[18px] resize-y`}
                title={t('dict.csvSeparatorTitle')}
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  onClick={() => void onImportCsv()}
                  disabled={!csvText.trim() || importingCsv}
                  icon={importingCsv ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                >
                  {t('dict.import')}
                </Button>
                <Button variant="ghost" onClick={() => { setCsvOpen(false); setCsvText(''); }}>
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          )}

          {feedback && (
            <Callout tone={feedback.kind === 'ok' ? 'success' : 'danger'} role={feedback.kind === 'ok' ? 'status' : 'alert'}>
              {feedback.message}
            </Callout>
          )}
        </div>
      </SubSection>

      {/* ── Cobertura local (colapsado) ───────────────────────────────────── */}
      <SubSection
        icon={<BarChart3 size={14} />}
        title={t('dict.localCoverage')}
        collapsible
        open={coverageOpen}
        onToggle={() => setCoverageOpen((v) => !v)}
        hint={t('dictpack.statsHint')}
        trailing={
          <span className="text-[12px] tabular-nums text-zinc-400 dark:text-zinc-500">
            {totals.total > 0 ? t('dict.lookups', { count: fmtNumber(totals.total) }) : t('dict.noData')}
          </span>
        }
      >
        <div className="space-y-3">
          <CoverageStats totals={totals} />
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-full">
              <ListGroup>
                <QuickRow label={t('dictpack.localTelemetry')}>
                  <Toggle on={telemetry.enabled} onChange={(v) => setTelemetry({ enabled: v })} ariaLabel={t('dictpack.localTelemetry')} />
                </QuickRow>
              </ListGroup>
            </div>
            <div className="w-full grid grid-cols-3 gap-2">
              <Button size="sm" variant="secondary" className="min-w-0" icon={<Download size={14} />} onClick={() => void onExportCoverage()} disabled={totals.total === 0} title={t('dict.exportSnapshotTitle')}>
                {t('dict.export')}
              </Button>
              <Button size="sm" variant="secondary" className="min-w-0" icon={<Upload size={14} />} onClick={onPickCoverageImport} title={t('dict.importSnapshotTitle')}>
                {t('dict.importSnapshot')}
              </Button>
              <Button size="sm" variant="danger" className="min-w-0" icon={<RotateCcw size={14} />} onClick={() => void onResetCoverage()} disabled={totals.total === 0} title={t('dict.clearCountersTitle')}>
                {t('dict.reset')}
              </Button>
            </div>
          </div>
          <input
            ref={coverageFileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => void onCoverageFileChosen(e)}
          />
          <TopPacksSection stats={stats} packs={packs} idlePackIds={idlePackIds} />
        </div>
      </SubSection>
    </div>
  );
}

/* ─── SubSection — inline subsection inside the parent Accordion ─────────── */

function SubSection({
  icon, title, children, trailing, hint, collapsible, open, onToggle,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  trailing?: React.ReactNode;
  hint?: React.ReactNode;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  const header = (
    <div className="kvl-row flex items-center gap-1.5 px-1 min-h-[20px]">
      <span className="text-zinc-400 dark:text-zinc-500 inline-flex">{icon}</span>
      <span className="text-[12px] font-medium text-zinc-500 dark:text-zinc-400 truncate">{title}</span>
      {hint && <InfoHint text={hint} size={12} />}
      <span className="ml-auto flex items-center gap-1.5">
        {trailing}
        {collapsible && (
          <ChevronDown size={14} className={`text-zinc-400 dark:text-zinc-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        )}
      </span>
    </div>
  );
  return (
    <div className="space-y-2">
      {collapsible ? (
        <button type="button" onClick={onToggle} aria-expanded={open} className="w-full text-left rounded-md outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40">
          {header}
        </button>
      ) : header}
      {(!collapsible || open) && children}
    </div>
  );
}

interface CoverageTotals {
  bundleHits: number;
  packHits: number;
  remoteHits: number;
  misses: number;
  total: number;
  localCoverage: number;
}

const COVERAGE_META = [
  { key: 'bundle', label: 'dict.covBundle', icon: <Package size={14} />,
    bar: 'bg-sky-400 dark:bg-sky-500',
    swatch: 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-500/10',
    desc: 'dict.covBundleDesc' },
  { key: 'packs', label: 'dict.covPacks', icon: <Library size={14} />,
    bar: 'bg-indigo-400 dark:bg-indigo-500',
    swatch: 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10',
    desc: 'dict.resolvedByPack' },
  { key: 'remote', label: 'dict.covRemote', icon: <Cloud size={14} />,
    bar: 'bg-amber-400 dark:bg-amber-500',
    swatch: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10',
    desc: 'dict.resolvedByRemote' },
  { key: 'miss', label: 'dict.covMiss', icon: <Ban size={14} />,
    bar: 'bg-rose-400 dark:bg-rose-500',
    swatch: 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10',
    desc: 'dict.noDefinition' },
] as const;

function CoverageStats({ totals }: { totals: CoverageTotals }) {
  const values: Record<string, number> = {
    bundle: totals.bundleHits,
    packs: totals.packHits,
    remote: totals.remoteHits,
    miss: totals.misses,
  };
  const hasData = totals.total > 0;
  const localPct = Math.round(totals.localCoverage * 100);

  return (
    <div className="rounded-xl bg-white dark:bg-white/[0.03] ring-1 ring-zinc-900/[0.06] dark:ring-white/[0.06] p-3 space-y-3">
      <div className="space-y-1.5">
        <div className="flex h-1.5 rounded-full overflow-hidden bg-zinc-900/[0.06] dark:bg-white/[0.06]">
          {hasData
            ? COVERAGE_META.map((m) => {
                const pct = (values[m.key] / totals.total) * 100;
                if (pct === 0) return null;
                return <div key={m.key} className={m.bar} style={{ width: `${pct}%` }} title={`${t(m.label)} · ${Math.round(pct)}%`} />;
              })
            : <div className="w-full bg-zinc-200/40 dark:bg-zinc-800/40" />}
        </div>
        <div className="flex items-center justify-between text-[12px] text-zinc-500 dark:text-zinc-400">
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 size={12} className="text-emerald-500" />
            <span className="tabular-nums">{hasData ? t('dict.localPct', { pct: localPct }) : t('dict.localPctNone')}</span>
          </span>
          <span className="tabular-nums">{t('dict.lookups', { count: hasData ? fmtNumber(totals.total) : '0' })}</span>
        </div>
      </div>

      <ul className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        {COVERAGE_META.map((m) => {
          const value = values[m.key];
          const pct = hasData ? Math.round((value / totals.total) * 100) : 0;
          return (
            <li key={m.key} className="flex items-center gap-2 cursor-help min-w-0" title={t(m.desc)}>
              <span className={`w-2 h-2 rounded-full shrink-0 ${m.bar}`} aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1">
                  <span className="text-[12px] text-zinc-500 dark:text-zinc-400 truncate">{t(m.label)}</span>
                  <span className="text-[12px] text-zinc-400 dark:text-zinc-500 tabular-nums ml-auto">{hasData ? `${pct}%` : '—'}</span>
                </div>
                <div className="text-[13px] font-medium tabular-nums text-zinc-800 dark:text-zinc-100 leading-[18px]">
                  {fmtNumber(value)}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {!hasData && (
        <div className="text-[12px] text-zinc-500 dark:text-zinc-400 leading-[17px] text-center">
          {t('dictpack.noDataYet')}
        </div>
      )}
    </div>
  );
}

function EmptySub({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-900/[0.12] dark:border-white/[0.1] px-3 py-4 text-center text-[12px] text-zinc-500 dark:text-zinc-400 leading-[17px]">
      {text}
    </div>
  );
}

interface TopPacksSectionProps {
  stats: PackStatsRow[];
  packs: DictPackRow[];
  idlePackIds: ReadonlySet<string>;
}

/**
 * "Top packs" ranking. Synthetic buckets (`bundle`, `remote`, `miss`) are
 * already covered by `CoverageStats` above so they're filtered out via
 * `topPacksByHits`.
 */
function TopPacksSection({ stats, packs, idlePackIds }: TopPacksSectionProps) {
  const ranking = useMemo(() => topPacksByHits(stats, 10), [stats]);
  const packById = useMemo(() => {
    const m = new Map<string, DictPackRow>();
    for (const p of packs) m.set(String(p.id), p);
    return m;
  }, [packs]);

  if (ranking.length === 0) return null;

  const totalHits = ranking.reduce((acc, r) => acc + r.hits, 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 px-1">
        <span className="text-[12px] font-medium text-zinc-500 dark:text-zinc-400 flex-1">{t('dictpack.topPacks')}</span>
        <span className="text-[12px] tabular-nums text-zinc-400 dark:text-zinc-500">{t('dict.hits', { count: fmtNumber(totalHits) })}</span>
      </div>
      <ol className="rounded-xl bg-white dark:bg-white/[0.03] ring-1 ring-zinc-900/[0.06] dark:ring-white/[0.06] divide-y divide-zinc-900/[0.06] dark:divide-white/[0.06] overflow-hidden">
        {ranking.map((row, idx) => {
          const pack = packById.get(row.packId);
          const title = pack?.title ?? row.packId;
          const langs = pack ? `${pack.sourceLang} → ${pack.targetLang}` : null;
          const share = totalHits > 0 ? Math.round((row.hits / totalHits) * 100) : 0;
          const isIdle = idlePackIds.has(row.packId);
          return (
            <li key={row.packId} className="px-3 py-2.5 flex items-center gap-3">
              <span className="text-[12px] font-medium text-zinc-400 dark:text-zinc-500 w-3 shrink-0 text-right tabular-nums">{idx + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100 truncate">{title}</span>
                  {isIdle && (
                    <Badge tone="amber" title={t('dict.unused30')}>{t('dictpack.unused30d')}</Badge>
                  )}
                </div>
                <div className="text-[12px] text-zinc-500 dark:text-zinc-400 tabular-nums truncate mt-0.5">
                  {langs && <>{langs} · </>}{t('dict.hits', { count: fmtNumber(row.hits) })} · {share}%
                  {pack ? t('dict.packTermsCount', { count: fmtNumber(pack.termCount) }) : t('dict.packDeleted')}
                </div>
              </div>
              <div className="w-14 h-1 rounded-full bg-zinc-900/[0.06] dark:bg-white/[0.06] overflow-hidden shrink-0">
                <div className="h-full bg-indigo-500" style={{ width: `${share}%` }} />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// Re-export the pseudo-ids so callers can correlate stats rows with packs.
export { BUNDLE_PACK_ID, MISS_PACK_ID, REMOTE_PACK_ID, DEFAULT_IDLE_THRESHOLD_MS };
