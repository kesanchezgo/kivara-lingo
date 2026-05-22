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
 *   4. **Personal CSV/TSV list** — paste a list of `word, translation, …`
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
 * The visual structure now mirrors the Figma mock 1:1: the section lives
 * inside the parent SettingsTab accordion, so its own header is implicit;
 * we render compact sub-sections (Catálogo, Instalados, Importar, Cobertura)
 * stacked inside the accordion body. All real wiring (Dexie, service-worker
 * messaging, telemetry, real importers) is preserved unchanged.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Trash2, Upload, Power, PowerOff, Loader2,
  Download, FileText, Library, Trophy, ChevronDown, CheckCircle2, BarChart3, Link2, Sparkles,
  Package, Cloud, Ban,
} from 'lucide-react';
import type { DictPackRow, PackStatsRow } from '../../../shared/db';
import { importYomitanPackFromUrl } from '../../../content/nlp/yomitan';
import { importCsvList } from '../../../content/nlp/csv-importer';
import { autoImportDictFile } from '../../../content/nlp/dict-format-detect';
import {
  aggregateCoverage,
  BUNDLE_PACK_ID,
  DEFAULT_IDLE_THRESHOLD_MS,
  exportCoverage,
  idlePacks,
  importCoverage,
  MISS_PACK_ID,
  readPackStats,
  REMOTE_PACK_ID,
  resetCoverage,
  topPacksByHits,
} from '../../../shared/telemetry';
import { useKivaraStore } from '../../../shared/store';
import {
  RECOMMENDED_PACKS,
  GROUP_LABELS,
  type RecommendedPack,
} from '../../../shared/dict-pack-catalog';
import { InfoHint } from '../InfoHint';

interface ImportFeedback {
  kind: 'ok' | 'err';
  message: string;
}

const TIER_META: Record<RecommendedPack['tier'], { label: string; pill: string; icon: React.ReactNode }> = {
  core:        { label: 'Esencial',    pill: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',     icon: <Sparkles size={9} /> },
  recommended: { label: 'Recomendado', pill: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300', icon: null },
  premium:     { label: 'Avanzado',    pill: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300', icon: null },
};

export function DictPacksSection() {
  const [packs, setPacks] = useState<DictPackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importingUrl, setImportingUrl] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ImportFeedback | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvTitle, setCsvTitle] = useState('Mi lista');
  const [csvText, setCsvText] = useState('');
  const [importingCsv, setImportingCsv] = useState(false);
  const [stats, setStats] = useState<PackStatsRow[]>([]);
  const [coverageOpen, setCoverageOpen] = useState(false);

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
    try {
      const rows = await readPackStats();
      setStats(rows);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/context invalidated/i.test(msg)) {
        console.warn('[Kivara Lingo] could not read telemetry', err);
      }
    }
  }, []);

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  /* ── Coverage import / export ────────────────────────────────────────── */

  const onResetCoverage = useCallback(async () => {
    await resetCoverage();
    await refresh();
  }, [refresh]);

  const onExportCoverage = useCallback(async () => {
    setFeedback(null);
    try {
      const snap = await exportCoverage('kivara-lingo');
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
      setFeedback({
        kind: 'ok',
        message: `Cobertura exportada (${snap.rows.length} filas).`,
      });
    } catch (err) {
      setFeedback({
        kind: 'err',
        message: `No se pudo exportar la cobertura: ${(err as Error).message}`,
      });
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
        const result = await importCoverage(raw, 'merge');
        await refresh();
        setFeedback({
          kind: 'ok',
          message: `Cobertura importada: ${result.added} filas nuevas, ${result.merged} fusionadas.`,
        });
      } catch (err) {
        setFeedback({
          kind: 'err',
          message: `No se pudo importar: ${(err as Error).message}`,
        });
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
        const result = await autoImportDictFile(buffer, file.name);
        if (result.ok) {
          const formatLabel: Record<typeof result.format, string> = {
            yomitan: 'Yomitan',
            stardict: 'StarDict',
            csv: 'CSV',
          };
          const skipNote = result.skipped ? ` (${result.skipped} saltados)` : '';
          setFeedback({
            kind: 'ok',
            message: `${result.pack.title} · ${result.termsImported.toLocaleString()} términos (${formatLabel[result.format]})${skipNote}`,
          });
        } else {
          setFeedback({ kind: 'err', message: result.error });
        }
        await refresh();
      } catch (err) {
        setFeedback({
          kind: 'err',
          message: `Error inesperado: ${(err as Error).message}`,
        });
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
        const result = await importYomitanPackFromUrl(trimmed);
        if (result.ok) {
          setFeedback({
            kind: 'ok',
            message: `${result.pack.title} · ${result.termsImported.toLocaleString()} términos importados`,
          });
          setUrlInput('');
        } else {
          setFeedback({ kind: 'err', message: result.error });
        }
        await refresh();
      } catch (err) {
        setFeedback({
          kind: 'err',
          message: `Error inesperado: ${(err as Error).message}`,
        });
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
      const result = await importCsvList(csvText, { title: csvTitle.trim() || 'Mi lista' });
      if (result.ok) {
        setFeedback({
          kind: 'ok',
          message: `${result.pack.title} · ${result.termsImported.toLocaleString()} términos importados${
            result.skipped > 0 ? ` (${result.skipped} saltados)` : ''
          }`,
        });
        setCsvText('');
        setCsvOpen(false);
      } else {
        setFeedback({ kind: 'err', message: result.error });
      }
      await refresh();
    } catch (err) {
      setFeedback({
        kind: 'err',
        message: `Error inesperado: ${(err as Error).message}`,
      });
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
        // hasn't typed one yet (or left the placeholder).
        const baseTitle = file.name.replace(/\.[^.]+$/, '');
        if (!csvTitle.trim() || csvTitle === 'Mi lista') {
          setCsvTitle(baseTitle);
        }
        setCsvText(text);
        setCsvOpen(true);
      } catch (err) {
        setFeedback({
          kind: 'err',
          message: `No se pudo leer el archivo: ${(err as Error).message}`,
        });
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
      if (
        !window.confirm(`¿Eliminar "${pack.title}" y sus ${pack.termCount.toLocaleString()} términos?`)
      ) {
        return;
      }
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
    <div className="p-2.5 space-y-3">

      {/* ── Catálogo recomendado ─────────────────────────────────────────── */}
      <SubSection icon={<Library size={10} />} title="Catálogo recomendado">
        <div className="space-y-2">
          {groups.map((group) => {
            const cards = RECOMMENDED_PACKS.filter((p) => p.group === group);
            if (cards.length === 0) return null;
            return (
              <div key={group} className="space-y-1">
                <div className="text-[9px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500 px-1">
                  {GROUP_LABELS[group]}
                </div>
                <div className="space-y-1">
                  {cards.map((p) => {
                    const installed = isPackInstalled(p.title, p.url);
                    const loading = importingUrl === p.url;
                    const tier = TIER_META[p.tier];
                    return (
                      <div
                        key={p.url}
                        className="rounded-md bg-zinc-50/70 dark:bg-zinc-800/30 border border-zinc-200/60 dark:border-zinc-800/70 px-2 py-1.5 flex items-center gap-2"
                        title={`${p.description} — ${p.license}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11.5px] font-medium text-zinc-800 dark:text-zinc-200 truncate leading-tight">{p.title}</span>
                            <span className={`shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded inline-flex items-center gap-0.5 ${tier.pill}`}>
                              {tier.icon}{tier.label}
                            </span>
                          </div>
                          <div className="text-[9.5px] text-zinc-500 tabular-nums leading-tight font-mono mt-0.5">
                            {p.langs} · {p.size}
                          </div>
                        </div>
                        {installed ? (
                          <span className="shrink-0 text-[10px] font-medium px-1.5 py-1 rounded inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200/70 dark:border-emerald-500/20">
                            <CheckCircle2 size={10} />
                            Instalado
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void onImportUrl(p.url)}
                            disabled={loading || importing}
                            className="shrink-0 text-[10px] font-semibold px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1 transition-colors"
                          >
                            {loading ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
                            {loading ? 'Descargando' : 'Instalar'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </SubSection>

      {/* ── Instalados ────────────────────────────────────────────────────── */}
      <SubSection
        icon={<CheckCircle2 size={10} />}
        title="Instalados"
        trailing={
          <span className="text-[10px] font-mono tabular-nums text-zinc-400 dark:text-zinc-500">
            {loading ? '…' : packs.length}
          </span>
        }
      >
        {loading ? (
          <div className="text-[10.5px] text-zinc-500 italic px-1">Cargando packs…</div>
        ) : packs.length === 0 ? (
          <EmptySub text="Aún no has instalado packs. Elige uno del catálogo de arriba." />
        ) : (
          <div className="space-y-1">
            {packs.map((pack) => {
              const idle = idlePackIds.has(String(pack.id));
              return (
                <div
                  key={pack.id}
                  className="rounded-md bg-zinc-50/70 dark:bg-zinc-800/30 border border-zinc-200/60 dark:border-zinc-800/70 px-2 py-1.5 flex items-center gap-1.5"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11.5px] font-medium text-zinc-800 dark:text-zinc-200 truncate leading-tight">{pack.title}</span>
                      {idle && (
                        <span
                          title="Sin uso en los últimos 30 días — considera deshabilitarlo"
                          className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                        >
                          30d+ sin usar
                        </span>
                      )}
                      {!pack.enabled && (
                        <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400">
                          off
                        </span>
                      )}
                    </div>
                    <div className="text-[9.5px] text-zinc-500 tabular-nums font-mono leading-tight mt-0.5">
                      {pack.sourceLang} → {pack.targetLang} · {pack.termCount.toLocaleString()} términos · rev. {pack.revision}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onToggle(pack)}
                    className="p-1 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 transition-colors"
                    title={pack.enabled ? 'Deshabilitar' : 'Habilitar'}
                  >
                    {pack.enabled ? <Power size={12} /> : <PowerOff size={12} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDelete(pack)}
                    className="p-1 rounded text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                    title="Eliminar"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </SubSection>

      {/* ── Importar manualmente ──────────────────────────────────────────── */}
      <SubSection
        icon={<Upload size={10} />}
        title="Importar manualmente"
        hint="ZIP de Yomitan/StarDict desde URL, archivo local o lista CSV/TSV. Todo se guarda en IndexedDB del navegador."
      >
        <div className="space-y-2">
          <div className="space-y-1">
            <label className="flex items-center gap-1 text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
              <Link2 size={10} className="text-zinc-400" />
              Desde URL
            </label>
            <div className="flex gap-1.5">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://…/pack.zip"
                className="sl-input sl-mono flex-1 min-w-0"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && urlInput.trim() && !importingUrl) {
                    void onImportUrl(urlInput);
                  }
                }}
              />
              <button
                type="button"
                onClick={() => void onImportUrl(urlInput)}
                disabled={!urlInput.trim() || !!importingUrl}
                className="text-[10px] font-semibold px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1 transition-colors"
              >
                {importingUrl === urlInput.trim() ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
                Descargar
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">Otras fuentes</label>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="flex-1 text-[11px] font-medium px-2 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:border-indigo-300 dark:hover:border-indigo-500/50 hover:text-indigo-700 dark:hover:text-indigo-300 hover:bg-indigo-50/40 dark:hover:bg-indigo-500/10 inline-flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Importar archivo local (Yomitan .zip, StarDict .zip o CSV/TSV)"
              >
                {importing ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                Archivo local
              </button>
              <button
                type="button"
                onClick={() => setCsvOpen((v) => !v)}
                className={`flex-1 text-[11px] font-medium px-2 py-1.5 rounded-md border inline-flex items-center justify-center gap-1.5 transition-colors ${
                  csvOpen
                    ? 'border-indigo-300 dark:border-indigo-500/50 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                    : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:border-indigo-300 dark:hover:border-indigo-500/50 hover:text-indigo-700 dark:hover:text-indigo-300 hover:bg-indigo-50/40 dark:hover:bg-indigo-500/10'
                }`}
              >
                <FileText size={11} />
                Pegar CSV/TSV
              </button>
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
            <div className="rounded-md bg-zinc-50/70 dark:bg-zinc-800/30 border border-zinc-200/60 dark:border-zinc-800/70 p-2 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={csvTitle}
                  onChange={(e) => setCsvTitle(e.target.value)}
                  placeholder="Título de la lista"
                  className="sl-input flex-1 min-w-0"
                />
                <button
                  type="button"
                  onClick={() => csvFileInputRef.current?.click()}
                  className="text-[10px] px-1.5 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 inline-flex items-center gap-1"
                  title="Cargar archivo CSV/TSV"
                >
                  <Upload size={10} />
                  Archivo
                </button>
              </div>
              <textarea
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder={'word, translation, phonetic, definition, example\nhello, hola, /heˈloʊ/, A greeting, Hello world!'}
                rows={4}
                className="sl-input sl-mono w-full"
                title="Coma o tabulador como separador. Cabecera opcional."
              />
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void onImportCsv()}
                  disabled={!csvText.trim() || importingCsv}
                  className="text-[10px] font-semibold px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1 transition-colors"
                >
                  {importingCsv ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
                  Importar
                </button>
                <button
                  type="button"
                  onClick={() => { setCsvOpen(false); setCsvText(''); }}
                  className="text-[10px] font-medium px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {feedback && (
            <div className={`rounded-md text-[10.5px] leading-snug px-2 py-1 border ${
              feedback.kind === 'ok'
                ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200/70 dark:border-emerald-500/20'
                : 'text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border-rose-200/70 dark:border-rose-500/20'
            }`}>
              {feedback.message}
            </div>
          )}
        </div>
      </SubSection>

      {/* ── Cobertura local (colapsable) ──────────────────────────────────── */}
      <SubSection
        icon={<BarChart3 size={10} />}
        title="Cobertura local"
        collapsible
        open={coverageOpen}
        onToggle={() => setCoverageOpen((v) => !v)}
        hint={
          <>
            Estadística <strong>100% local</strong> (no sale del navegador) de cómo se resuelven tus búsquedas: cuántas vinieron del <em>bundle</em> incluido, de un <em>pack</em> instalado, del traductor <em>remoto</em>, o no tuvieron resultado (<em>miss</em>). Útil para decidir qué packs instalar o desactivar. Puedes apagar la telemetría o exportar/borrar los datos en cualquier momento.
          </>
        }
        trailing={
          <span className="text-[10px] font-mono tabular-nums text-zinc-400 dark:text-zinc-500">
            {totals.total > 0 ? `${totals.total.toLocaleString()} lookups` : 'sin datos'}
          </span>
        }
      >
        <div className="space-y-2">
          <CoverageStats totals={totals} />
          <div className="flex items-center gap-1.5 flex-wrap">
            <label className="text-[10px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1 cursor-pointer mr-auto">
              <input
                type="checkbox"
                checked={telemetry.enabled}
                onChange={(e) => setTelemetry({ enabled: e.target.checked })}
                className="accent-indigo-500"
              />
              Telemetría local
            </label>
            <button
              type="button"
              onClick={() => void onExportCoverage()}
              disabled={totals.total === 0}
              className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Descargar un JSON con el snapshot actual."
            >
              Exportar
            </button>
            <button
              type="button"
              onClick={onPickCoverageImport}
              className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              title="Cargar un snapshot exportado antes (se fusiona)."
            >
              Importar
            </button>
            <button
              type="button"
              onClick={() => void onResetCoverage()}
              disabled={totals.total === 0}
              className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Borrar todos los contadores."
            >
              Reiniciar
            </button>
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
    <div className="flex items-center gap-1.5 px-0.5">
      <span className="text-zinc-500 dark:text-zinc-400 inline-flex">{icon}</span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{title}</span>
      {hint && <InfoHint text={hint} />}
      <span className="ml-auto flex items-center gap-1.5">
        {trailing}
        {collapsible && (
          <ChevronDown size={11} className={`text-zinc-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        )}
      </span>
    </div>
  );
  return (
    <div className="space-y-1.5">
      {collapsible ? (
        <button type="button" onClick={onToggle} className="w-full text-left">
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
  {
    key: 'bundle' as const,
    label: 'Bundle',
    icon: <Package size={9} />,
    bar: 'bg-sky-400 dark:bg-sky-500',
    swatch: 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-500/10',
    desc: 'Diccionario incluido (~4 100 entradas CEFR).',
  },
  {
    key: 'packs' as const,
    label: 'Packs',
    icon: <Library size={9} />,
    bar: 'bg-indigo-400 dark:bg-indigo-500',
    swatch: 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10',
    desc: 'Resuelto por un pack instalado.',
  },
  {
    key: 'remote' as const,
    label: 'Remoto',
    icon: <Cloud size={9} />,
    bar: 'bg-amber-400 dark:bg-amber-500',
    swatch: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10',
    desc: 'Resuelto por traductor remoto.',
  },
  {
    key: 'miss' as const,
    label: 'Miss',
    icon: <Ban size={9} />,
    bar: 'bg-rose-400 dark:bg-rose-500',
    swatch: 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10',
    desc: 'Sin definición encontrada.',
  },
];

function CoverageStats({ totals }: { totals: CoverageTotals }) {
  const values: Record<'bundle' | 'packs' | 'remote' | 'miss', number> = {
    bundle: totals.bundleHits,
    packs: totals.packHits,
    remote: totals.remoteHits,
    miss: totals.misses,
  };
  const hasData = totals.total > 0;
  const localPct = Math.round(totals.localCoverage * 100);

  return (
    <div className="rounded-md bg-zinc-50/70 dark:bg-zinc-800/30 border border-zinc-200/60 dark:border-zinc-800/70 p-2 space-y-2">
      {/* Stacked bar — visual share */}
      <div className="space-y-1">
        <div className="flex h-1.5 rounded-full overflow-hidden bg-zinc-200/70 dark:bg-zinc-800">
          {hasData
            ? COVERAGE_META.map((m) => {
                const pct = (values[m.key] / totals.total) * 100;
                if (pct === 0) return null;
                return <div key={m.key} className={m.bar} style={{ width: `${pct}%` }} title={`${m.label} · ${Math.round(pct)}%`} />;
              })
            : <div className="w-full bg-zinc-200/40 dark:bg-zinc-800/40" />}
        </div>
        <div className="flex items-center justify-between text-[9.5px] text-zinc-500 dark:text-zinc-500">
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 size={9} className="text-emerald-500" />
            <span className="tabular-nums">{hasData ? `${localPct}% local` : '— local'}</span>
          </span>
          <span className="font-mono tabular-nums">{hasData ? totals.total.toLocaleString() : '0'} lookups</span>
        </div>
      </div>

      {/* Per-source rows */}
      <ul className="grid grid-cols-2 gap-1">
        {COVERAGE_META.map((m) => {
          const value = values[m.key];
          const pct = hasData ? Math.round((value / totals.total) * 100) : 0;
          return (
            <li
              key={m.key}
              className="flex items-center gap-1.5 rounded bg-white dark:bg-zinc-900/40 border border-zinc-200/60 dark:border-zinc-800/60 px-1.5 py-1 cursor-help"
              title={m.desc}
            >
              <span className={`inline-flex items-center justify-center w-4 h-4 rounded ${m.swatch}`}>
                {m.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1">
                  <span className="text-[10px] font-medium text-zinc-700 dark:text-zinc-300 leading-none">{m.label}</span>
                  <span className="text-[9px] text-zinc-400 dark:text-zinc-500 tabular-nums ml-auto">{hasData ? `${pct}%` : '—'}</span>
                </div>
                <div className="text-[10.5px] font-mono tabular-nums text-zinc-800 dark:text-zinc-200 leading-tight">
                  {value.toLocaleString()}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {!hasData && (
        <div className="text-[9.5px] text-zinc-500 dark:text-zinc-500 italic leading-snug text-center pt-0.5">
          Aún sin datos. Empieza a buscar palabras y verás de dónde salen tus definiciones.
        </div>
      )}
    </div>
  );
}

function EmptySub({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-zinc-300 dark:border-zinc-700 px-2 py-3 text-center text-[10.5px] text-zinc-500 dark:text-zinc-400 leading-snug">
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
 * `topPacksByHits`. The section auto-hides when there's nothing real to show
 * yet (fresh install).
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
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 px-0.5">
        <Trophy size={10} className="text-amber-500" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 flex-1">Top packs</span>
        <span className="text-[10px] font-mono tabular-nums text-zinc-400 dark:text-zinc-500">{totalHits.toLocaleString()} hits</span>
      </div>
      <ol className="space-y-1">
        {ranking.map((row, idx) => {
          const pack = packById.get(row.packId);
          const title = pack?.title ?? row.packId;
          const langs = pack ? `${pack.sourceLang} → ${pack.targetLang}` : null;
          const share = totalHits > 0 ? Math.round((row.hits / totalHits) * 100) : 0;
          const isIdle = idlePackIds.has(row.packId);
          return (
            <li
              key={row.packId}
              className="rounded-md bg-zinc-50/70 dark:bg-zinc-800/30 border border-zinc-200/60 dark:border-zinc-800/70 px-2 py-1 flex items-center gap-2"
            >
              <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 w-4 shrink-0 text-right tabular-nums">{idx + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className="text-[11px] font-medium text-zinc-800 dark:text-zinc-200 truncate">{title}</span>
                  {langs && <span className="text-[9px] text-zinc-500 shrink-0 font-mono">{langs}</span>}
                  {isIdle && (
                    <span
                      title="Sin uso en los últimos 30 días"
                      className="text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 shrink-0"
                    >
                      30d+
                    </span>
                  )}
                </div>
                <div className="text-[9px] text-zinc-500 dark:text-zinc-500 tabular-nums">
                  {row.hits.toLocaleString()} hits · {share}%
                  {pack ? ` · ${pack.termCount.toLocaleString()} términos` : ' · pack borrado'}
                </div>
              </div>
              <div className="w-16 h-1 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden shrink-0">
                <div className="h-full bg-amber-400 dark:bg-amber-500" style={{ width: `${share}%` }} />
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
