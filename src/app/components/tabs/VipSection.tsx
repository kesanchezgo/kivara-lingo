import React, { useCallback, useEffect, useRef, useState } from 'react';
import { sendMessage } from 'webext-bridge/content-script';
import { t, fmtNumber } from '../../../shared/i18n';
import { richText } from '../../../shared/i18n/rich';
import { normalizeTtlDays } from '../../../shared/cache-ttl';
import { classifyEnrichError, ENRICH_ERROR_KEYS } from '../../../shared/enrich-health';
import { useKivaraStore } from '../../../shared/use-kivara-store';
import { SecretKeyInput } from '../SecretKeyInput';
import type { EnrichSourceHealthMap, VipSettings } from '../../../shared/types';
import {
  AlertTriangle, Database, KeyRound, Loader2, RefreshCw, Trash2,
} from '../../../ui/icons';
import {
  Button, Callout, ListGroup, QuickRow, Row, SubLabel, Toggle,
} from '../../../ui/primitives/settings-primitives';
import { inputCls } from '../../../ui/primitives/controls';

/**
 * VIP enrichment settings.
 *
 * The view is the prototype's (health dots, group counters, per-source rows);
 * the data is the repo's: `VipSettings` is FLAT here — one boolean per source,
 * not a `sources` map — so the rows read and write the flat keys instead.
 * Health comes from the service worker (`ENRICH_SOURCE_HEALTH`, memory only),
 * and the cache panel still calls GET_CACHE_STATS / CLEAR_CACHE.
 */

interface SourceMeta {
  key: keyof VipSettings;
  /** Proper name (Cambridge, Wiktionary...) shown as-is. */
  label: string;
  /** Translatable generic name ("Bundled dictionary"): wins over `label`. */
  labelKey?: string;
  hintKey: string;
}

const sourceName = (s: SourceMeta) => (s.labelKey ? t(s.labelKey) : s.label);

const STD_DICT_SOURCES: SourceMeta[] = [
  { key: 'bundled', label: 'Bundled', labelKey: 'vip.srcBundled', hintKey: 'vip.wordnetDesc' },
  { key: 'wordnet', label: 'WordNet (OEWN 2025)', hintKey: 'vip.wordnetLocalDesc' },
  { key: 'yomitanPacks', label: 'Yomitan', labelKey: 'vip.srcYomitan', hintKey: 'vip.ktyPacksDesc' },
  { key: 'wiktionary', label: 'Wiktionary REST', hintKey: 'vip.wiktionaryRestDesc' },
  { key: 'wiktionaryHtml', label: 'Wiktionary HTML', hintKey: 'vip.wiktionaryHtmlDesc' },
  { key: 'wiktionaryApi', label: 'WiktionaryAPI', hintKey: 'vip.freeDictApiDesc' },
  { key: 'wiktApi', label: 'WiktApi / Kaikki', hintKey: 'vip.wiktApiDesc' },
  { key: 'mobyThesaurus', label: 'Moby Thesaurus', hintKey: 'vip.mobyDesc' },
  { key: 'thesaurusCom', label: 'Thesaurus.com', hintKey: 'vip.thesaurusAntonymsDesc' },
  { key: 'wordHippo', label: 'WordHippo', hintKey: 'vip.wordhippoDesc' },
  { key: 'theIdioms', label: 'TheIdioms', hintKey: 'vip.theIdiomsDesc' },
  { key: 'freeDictionary', label: 'Free Dictionary API', hintKey: 'vip.freeDictionaryDesc' },
  { key: 'datamuse', label: 'Datamuse', hintKey: 'vip.datamuseDesc' },
];
const STD_BILINGUAL_SOURCES: SourceMeta[] = [
  { key: 'tatoeba', label: 'Tatoeba', hintKey: 'vip.tatoebaDesc' },
];
const STD_AUDIO_SOURCES: SourceMeta[] = [
  { key: 'linguaLibre', label: 'Lingua Libre', hintKey: 'vip.linguaLibreDesc' },
  { key: 'googleTtsFallback', label: 'Google TTS fallback', hintKey: 'vip.ttsSynthDesc' },
];
const STD_IMAGE_SOURCES: SourceMeta[] = [
  { key: 'bingImages', label: 'Bing Images', hintKey: 'vip.bingImagesDesc' },
  { key: 'openverse', label: 'Openverse', hintKey: 'vip.openverseDesc' },
  { key: 'wikimediaCommons', label: 'Wikimedia Commons', hintKey: 'vip.commonsDesc' },
  { key: 'duckduckgoImages', label: 'DuckDuckGo Images', hintKey: 'vip.ddgImagesDesc' },
];
const STD_ETY_VIDEO: SourceMeta[] = [
  { key: 'etymonline', label: 'Etymonline', hintKey: 'vip.etymonlineDesc' },
  { key: 'youglish', label: 'YouGlish', hintKey: 'vip.youglishDesc' },
];

const VIP_DICT_SOURCES: SourceMeta[] = [
  { key: 'britannicaDictionary', label: 'Britannica Dictionary', hintKey: 'vip.britannicaDictDesc' },
  { key: 'cambridge', label: 'Cambridge', hintKey: 'vip.cambridgeDictDesc' },
  { key: 'oxfordLearners', label: 'Oxford Learner’s', hintKey: 'vip.oxfordLearnersDesc' },
  { key: 'longman', label: 'Longman LDOCE', hintKey: 'vip.longmanDesc' },
  { key: 'collins', label: 'Dictionary.com', hintKey: 'vip.collinsDesc' },
  { key: 'merriamWebster', label: 'Merriam-Webster', hintKey: 'vip.merriamDesc' },
  { key: 'merriamWebsterThesaurus', label: 'M-W Thesaurus', hintKey: 'vip.editorialThesaurusDesc' },
  { key: 'ozdic', label: 'Oxford Collocations', hintKey: 'vip.ozdicDesc' },
];
const VIP_BILINGUAL_SOURCES: SourceMeta[] = [
  { key: 'pons', label: 'PONS', hintKey: 'vip.ponsDesc' },
  { key: 'babla', label: 'bab.la', hintKey: 'vip.dictionaryEnEsDesc' },
  { key: 'dictCc', label: 'dict.cc', hintKey: 'vip.dictCcDesc' },
  { key: 'reverso', label: 'Reverso Context', hintKey: 'vip.bilingualCorpusDesc' },
  { key: 'linguee', label: 'Linguee', hintKey: 'vip.lingueeDesc' },
  { key: 'promtContext', label: 'PROMT.One Contexts', hintKey: 'vip.promtDesc' },
  { key: 'wordReference', label: 'WordReference', hintKey: 'vip.wordReferenceDesc' },
  { key: 'spanishDict', label: 'SpanishDict', hintKey: 'vip.conjugationDesc' },
];
const VIP_AUDIO_SOURCES: SourceMeta[] = [
  { key: 'cambridgeAudio', label: 'Cambridge audio', hintKey: 'vip.cambridgeAudioDesc' },
  { key: 'oxfordAudio', label: 'Oxford audio', hintKey: 'vip.oxfordAudioDesc' },
  { key: 'forvo', label: 'Forvo', hintKey: 'vip.forvoDesc' },
];
const VIP_IMAGE_SOURCES: SourceMeta[] = [
  { key: 'unsplash', label: 'Unsplash (BYOK)', hintKey: 'vip.unsplashByokDesc' },
  { key: 'pixabay', label: 'Pixabay', hintKey: 'vip.unsplashDesc' },
];

const STD_ALL = [
  ...STD_DICT_SOURCES, ...STD_BILINGUAL_SOURCES, ...STD_AUDIO_SOURCES,
  ...STD_IMAGE_SOURCES, ...STD_ETY_VIDEO,
];
const VIP_ALL = [...VIP_DICT_SOURCES, ...VIP_BILINGUAL_SOURCES, ...VIP_AUDIO_SOURCES, ...VIP_IMAGE_SOURCES];

const DOT: Record<string, string> = {
  ok: 'bg-emerald-500',
  slow: 'bg-amber-500',
  error: 'bg-rose-500',
  untested: 'bg-zinc-300 dark:bg-zinc-600',
};

function timeAgo(at?: number): string {
  if (!at) return t('vipx.never');
  const min = Math.round((Date.now() - at) / 60000);
  return min < 1 ? t('vipx.justNow') : t('vipx.minAgo', { n: min });
}

export function VipSection() {
  const vip = useKivaraStore((s) => s.vip);
  const setVip = useKivaraStore((s) => s.setVip);

  const setSource = (key: keyof VipSettings, value: boolean) =>
    setVip((prev) => ({ ...prev, [key]: value }));

  // The TTL box holds a local STRING while it is typed, so typing `30` digit
  // by digit never writes 3, then 30 — and clearing it parks no intermediate
  // value. The store only sees the committed, clamped number.
  const [ttlText, setTtlText] = useState(String(vip.cacheTtlDays));
  const lastCommittedTtl = useRef(vip.cacheTtlDays);
  const commitTtl = () => {
    const next = normalizeTtlDays(Number(ttlText));
    lastCommittedTtl.current = next;
    setTtlText(String(next));
    if (next !== vip.cacheTtlDays) setVip((prev) => ({ ...prev, cacheTtlDays: next }));
  };
  useEffect(() => {
    if (vip.cacheTtlDays !== lastCommittedTtl.current) {
      lastCommittedTtl.current = vip.cacheTtlDays;
      setTtlText(String(vip.cacheTtlDays));
    }
  }, [vip.cacheTtlDays]);

  // Timeout uses the same draft + commit pattern: `Number(v) || 4000` snapped
  // back to 4000 as soon as the field was cleared and never clamped.
  const [timeoutText, setTimeoutText] = useState(String(vip.perSourceTimeoutMs));
  useEffect(() => { setTimeoutText(String(vip.perSourceTimeoutMs)); }, [vip.perSourceTimeoutMs]);
  const commitTimeout = () => {
    const n = Math.round(Number(timeoutText) / 100) * 100;
    const next = Number.isFinite(n) && timeoutText.trim() !== ''
      ? Math.min(20000, Math.max(500, n))
      : vip.perSourceTimeoutMs;
    setTimeoutText(String(next));
    if (next !== vip.perSourceTimeoutMs) setVip((prev) => ({ ...prev, perSourceTimeoutMs: next }));
  };

  // ── Source health ──────────────────────────────────────────────────────
  const [health, setHealth] = useState<EnrichSourceHealthMap>({});
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const refreshHealth = useCallback(async () => {
    setChecking(true);
    try {
      const res = (await sendMessage('ENRICH_SOURCE_HEALTH', {}, 'background')) as unknown;
      if (res && typeof res === 'object' && !('ok' in res && (res as { ok?: boolean }).ok === false)) {
        setHealth(res as EnrichSourceHealthMap);
      }
      setLastChecked(Date.now());
    } catch {
      // Worker asleep or bridge unavailable: leave the previous snapshot.
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => { void refreshHealth(); }, [refreshHealth]);

  const healthOf = (key: keyof VipSettings) => health[key as string] ?? null;
  const enabledCount = (list: SourceMeta[]) =>
    list.filter((x) => vip[x.key] === true).length;

  const tested = [...STD_ALL, ...(vip.enabled ? VIP_ALL : [])]
    .map((x) => healthOf(x.key))
    .filter((h): h is NonNullable<typeof h> => h != null);
  const errN = tested.filter((h) => h.state === 'error').length;
  const slowN = tested.filter((h) => h.state === 'slow').length;

  const group = (titleKey: string, hintKey: string, sources: SourceMeta[]) => (
    <div className="space-y-2">
      <SubLabel
        hint={t(hintKey)}
        right={
          <span className="flex items-center gap-2 tabular-nums">
            <span>{enabledCount(sources)}/{sources.length}</span>
          </span>
        }
      >
        {t(titleKey)}
      </SubLabel>
      <ListGroup>
        {sources.map((s) => {
          const h = healthOf(s.key);
          const state = checking ? 'untested' : h?.state ?? 'untested';
          const statusKey = state === 'slow' ? 'vipx.status_degraded' : `vipx.status_${state}`;
          const tip = `${t(statusKey)}${h ? ` · ${timeAgo(h.at)}` : ''}${h?.latencyMs ? ` · ${h.latencyMs} ms` : ''}`;
          // Old worker snapshots predate `code`, so re-classify here; the panel
          // and the orchestrator must read the same family from the same text.
          const code = h?.state === 'error' ? (h.code ?? classifyEnrichError(h.lastError)) : null;
          const msgKey = code ? ENRICH_ERROR_KEYS[code] : null;
          const errorMsg = code && msgKey
            ? t(msgKey, code === 'timeout' ? { s: Math.round(vip.perSourceTimeoutMs / 1000) || 4 } : undefined)
            : null;
          const errorFix = code && code !== 'unknown' && msgKey ? t(`${msgKey}Fix`) : null;
          return (
            <div key={s.key} className="kvl-row px-3 py-3">
              <div className="flex items-center gap-2.5">
                <span
                  title={tip}
                  aria-label={tip}
                  className={`shrink-0 w-1.5 h-1.5 rounded-full ${DOT[state]} ${checking ? 'animate-pulse' : ''}`}
                />
                <span className="flex-1 min-w-0 truncate text-[13px] font-medium text-zinc-800 dark:text-zinc-100">
                  {sourceName(s)}
                </span>
                <Toggle
                  on={vip[s.key] === true}
                  onChange={(v) => setSource(s.key, v)}
                  ariaLabel={sourceName(s)}
                />
              </div>
              {h && (h.state === 'error' || h.state === 'slow') && (
                <div className={`mt-1 pl-4 flex items-center gap-1.5 text-[12px] leading-4 ${h.state === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  <span className="flex-1 min-w-0 truncate" title={errorFix ? `${errorMsg ?? h.lastError ?? tip} — ${errorFix}` : (errorMsg ?? h.lastError ?? tip)}>
                    {h.state === 'error' ? (errorMsg ?? h.lastError ?? t('vipx.status_error')) : t('vipx.slow', { s: fmtNumber(Math.round((h.latencyMs ?? 0) / 100) / 10) })}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </ListGroup>
    </div>
  );

  return (
    <div className="px-4 pt-3 pb-4 space-y-5">
      <ListGroup>
        <QuickRow
          label={t('vip.localDataTitle')}
          info={[
            t('vip.bundledDesc'), t('vip.bundledLineCurated'), t('vip.bundledLineOxford'),
            t('vip.phrasalAcademicNote'), t('vip.bundledLineAcl'), t('vip.fernaldLine'),
          ].join(' · ')}
        >
          <span className="inline-flex items-center gap-1.5 text-[12px] text-zinc-400 dark:text-zinc-400">
            <Database size={14} /> {t('vip.offlineBadge')}
          </span>
        </QuickRow>
        <QuickRow label={t('vipx.healthTitle')} info={t('vipx.lastChecked', { when: timeAgo(lastChecked ?? undefined) })}>
          <span className="flex items-center gap-2">
            {!checking && (
              <span className="flex items-center gap-2 text-[12px] tabular-nums text-zinc-500 dark:text-zinc-400">
                <span className="inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {tested.length - errN - slowN}
                </span>
                {slowN > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />{slowN}
                  </span>
                )}
                {errN > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />{errN}
                  </span>
                )}
              </span>
            )}
            <button
              type="button"
              onClick={() => void refreshHealth()}
              disabled={checking}
              title={t('vipx.testSources')}
              aria-label={t('vipx.testSources')}
              className="w-7 h-7 -mr-1.5 inline-flex items-center justify-center rounded-lg text-zinc-400 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-900/[0.05] dark:hover:bg-white/[0.07] disabled:opacity-40 kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
            >
              <RefreshCw size={14} className={checking ? 'animate-spin' : ''} />
            </button>
          </span>
        </QuickRow>
      </ListGroup>

      {/* Standard tier — always on (subject to its own toggles) */}
      <div className="space-y-4">
        <SubLabel
          hint={t('vip.standardDesc')}
          right={<span className="tabular-nums">{enabledCount(STD_ALL)}/{STD_ALL.length}</span>}
        >
          {t('vip.standardTitle')}
        </SubLabel>
        {group('vip.stdDictTitle', 'vip.apisJson', STD_DICT_SOURCES)}
        {group('vip.stdBilingualTitle', 'vip.tatoebaHint', STD_BILINGUAL_SOURCES)}
        {group('vip.stdAudioTitle', 'vip.pronunciation', STD_AUDIO_SOURCES)}
        {group('vip.standardImagesLabel', 'vip.standardImagesHint', STD_IMAGE_SOURCES)}
        {group('vip.standardEtymVideoLabel', 'vip.etymVideoHint', STD_ETY_VIDEO)}
      </div>

      {/* VIP tier — opt-in */}
      <ListGroup>
        <QuickRow label={t('vip.enableTitle')} info={t('vip.providerListNote')}>
          <span className="flex items-center gap-3">
            {vip.enabled && (
              <span className="text-[12px] tabular-nums text-zinc-400 dark:text-zinc-400">
                {enabledCount(VIP_ALL)}/{VIP_ALL.length}
              </span>
            )}
            <Toggle
              on={vip.enabled}
              onChange={(v) => setVip((prev) => ({ ...prev, enabled: v }))}
              ariaLabel={t('vip.enableTitle')}
            />
          </span>
        </QuickRow>
      </ListGroup>

      {!vip.enabled && (
        <p className="text-[12px] text-zinc-500 dark:text-zinc-400 leading-[17px] px-1 -mt-3">
          {t('vip.disabledNote', { n: STD_ALL.length })}
        </p>
      )}

      {vip.enabled && (
        <div className="space-y-4">
          {group('vip.vipDictTitle', 'vip.commercialDictHint', VIP_DICT_SOURCES)}
          {group('vip.vipBilingualTitle', 'vip.vipBilingualHint', VIP_BILINGUAL_SOURCES)}
          {group('vip.vipAudioTitle', 'vip.vipAudioHint', VIP_AUDIO_SOURCES)}
          {group('vip.vipImagesLabel', 'vip.vipImagesHint', VIP_IMAGE_SOURCES)}

          <SubLabel hint={t('vip.imagesFreeTierNote')}>{t('vip.optionalKeysTitle')}</SubLabel>
          <div className="space-y-3 -mt-2">
            <div id="kivara-vip-unsplash-key">
              <Row
                label={
                  <span className="flex items-center gap-2">
                    {t('vip.unsplashKey')}
                    <a href="https://unsplash.com/developers" target="_blank" rel="noopener noreferrer" className="text-[12px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                      {t('vip.getLink')}
                    </a>
                  </span>
                }
              >
                <SecretKeyInput
                  stored={vip.unsplashAccessKey}
                  onChange={(v) => setVip((prev) => ({ ...prev, unsplashAccessKey: v }))}
                  placeholder={t('vip.optional')}
                  section="vip"
                  field="unsplashAccessKey"
                />
              </Row>
            </div>
            <div id="kivara-vip-pixabay-key">
              <Row
                label={
                  <span className="flex items-center gap-2">
                    {t('vip.pixabayKey')}
                    <a href="https://pixabay.com/api/docs/" target="_blank" rel="noopener noreferrer" className="text-[12px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                      {t('vip.getLink')}
                    </a>
                  </span>
                }
              >
                <SecretKeyInput
                  stored={vip.pixabayApiKey}
                  onChange={(v) => setVip((prev) => ({ ...prev, pixabayApiKey: v }))}
                  placeholder={t('vip.pixabayPlaceholder')}
                  section="vip"
                  field="pixabayApiKey"
                />
              </Row>
            </div>
          </div>

          <SubLabel>{t('vip.networkTitle')}</SubLabel>
          <ListGroup>
            <QuickRow label={t('vip.timeoutTitle')} info={t('vip.timeoutHint')}>
              <span className="flex items-center gap-2">
                <input
                  type="number"
                  min={500}
                  max={20000}
                  step={500}
                  value={timeoutText}
                  onChange={(e) => setTimeoutText(e.target.value)}
                  onBlur={commitTimeout}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  aria-label={t('vip.timeoutTitle')}
                  className={`${inputCls} !w-[76px] text-right tabular-nums`}
                />
                <span className="text-[12px] text-zinc-400 dark:text-zinc-400 w-8">ms</span>
              </span>
            </QuickRow>
            <QuickRow label={t('set.cache')} info={t('vip.cacheTtlHint')}>
              <span className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={ttlText}
                  onChange={(e) => setTtlText(e.target.value)}
                  onBlur={commitTtl}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  aria-label={t('set.cache')}
                  className={`${inputCls} !w-[76px] text-right tabular-nums`}
                />
                <span className="text-[12px] text-zinc-400 dark:text-zinc-400 w-8">{t('vip.days')}</span>
              </span>
            </QuickRow>
          </ListGroup>
        </div>
      )}

      <CacheManager />
    </div>
  );
}

/* ── Cache administration (real: GET_CACHE_STATS / CLEAR_CACHE) ───────── */

interface CacheBucket {
  id: 'enrichment' | 'translation' | 'ai' | 'explain' | 'media';
  label: string;
  count: number;
  bytes: number;
}

/**
 * One label per bucket, the same four the prototype lists (plus `explain`,
 * which the repo added later). Panel-side so the copy follows the UI locale
 * even when the worker answered with a stale label.
 */
const BUCKET_LABEL_KEYS: Record<CacheBucket['id'], string> = {
  enrichment: 'vip.bucketEnrichment',
  translation: 'vip.bucketTranslation',
  ai: 'vip.bucketAi',
  explain: 'vip.bucketExplain',
  media: 'vip.bucketMedia',
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${fmtNumber(Math.round(bytes / 1024))} KB`;
  return `${fmtNumber(Math.round((bytes / 1024 / 1024) * 10) / 10)} MB`;
}

function CacheManager() {
  const [buckets, setBuckets] = useState<CacheBucket[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const refresh = useCallback(() => {
    try {
      chrome.runtime.sendMessage({ type: 'GET_CACHE_STATS' }, (res: { ok?: boolean; stats?: { buckets?: CacheBucket[] } }) => {
        if (chrome.runtime.lastError) return;
        if (res?.ok && res.stats?.buckets) setBuckets(res.stats.buckets);
      });
    } catch {
      // chrome.runtime is unavailable outside the extension (tests/storybook).
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const clearAll = () => {
    setBusy(true);
    try {
      chrome.runtime.sendMessage({ type: 'CLEAR_CACHE', which: 'all' }, (res: { ok?: boolean }) => {
        setBusy(false);
        setConfirming(false);
        if (chrome.runtime.lastError) return;
        if (res?.ok) refresh();
      });
    } catch {
      setBusy(false);
      setConfirming(false);
    }
  };

  const total = buckets?.reduce((a, b) => a + b.count, 0) ?? 0;
  const totalBytes = buckets?.reduce((a, b) => a + b.bytes, 0) ?? 0;

  return (
    <div className="space-y-2">
      <SubLabel
        hint={t('vip.cacheDesc')}
        right={!confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy || total === 0}
            title={t('vip.clearCacheBtn')}
            aria-label={t('vip.clearCacheBtn')}
            className="w-6 h-6 -my-1 inline-flex items-center justify-center rounded-md text-zinc-400 dark:text-zinc-400 hover:text-rose-500 hover:bg-zinc-900/[0.05] dark:hover:bg-white/[0.07] disabled:opacity-40 disabled:pointer-events-none kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
          >
            <Trash2 size={14} />
          </button>
        )}
      >
        {t('vip.cacheStored')}
      </SubLabel>
      {buckets === null ? (
        <p className="text-[12px] text-zinc-500 dark:text-zinc-400 px-1">{t('common.loading')}</p>
      ) : total === 0 ? (
        <p className="text-[12px] text-zinc-500 dark:text-zinc-400 px-1">{t('vip.cacheEmpty')}</p>
      ) : (
        <ListGroup>
          {buckets.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-2 px-3 min-h-[40px] text-[13px]">
              <span className="truncate text-zinc-700 dark:text-zinc-300">{t(BUCKET_LABEL_KEYS[b.id])}</span>
              <span className="text-[12px] tabular-nums text-zinc-500 dark:text-zinc-400 shrink-0">
                {b.count} · {formatBytes(b.bytes)}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between gap-2 px-3 min-h-[40px] text-[13px]">
            <span className="font-medium text-zinc-800 dark:text-zinc-100">{t('vip.total')}</span>
            <span className="text-[12px] tabular-nums font-medium text-zinc-700 dark:text-zinc-200">
              {total} · {formatBytes(totalBytes)}
            </span>
          </div>
        </ListGroup>
      )}
      {confirming && (
        <Callout tone="warning" icon={<AlertTriangle size={14} />}>
          {richText(t('vip.clearCacheBody'), { no: <strong className="font-semibold">{t('vip.clearCacheNot')}</strong> })}
          <div className="flex gap-2 mt-3">
            <Button size="sm" variant="dangerSolid" className="flex-1" disabled={busy} onClick={clearAll}>
              {busy ? t('vip.clearing') : t('vip.clearAllYes')}
            </Button>
            <Button size="sm" variant="secondary" className="flex-1" disabled={busy} onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </Callout>
      )}
    </div>
  );
}
