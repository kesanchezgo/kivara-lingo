import React, { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../../shared/i18n';
import { sendMessage } from 'webext-bridge/content-script';
import type { AnkiMapping, FieldSource } from '../../../shared/types';
import type {
  AnkiListsResponse,
  AnkiFieldsResponse,
  AnkiPingResponse,
  AnkiPingErrorCode,
} from '../../../shared/types';
import {
  RefreshCw, RotateCcw, Volume2, Camera, Wand2, Layers,
  ChevronDown, Loader2, AlertCircle, Cpu, Database, FileText, Plug,
} from '../../../ui/icons';
import { detectFieldSource } from '../../../shared/anki-field-detect';
import { SecretKeyInput } from '../SecretKeyInput';
import { InfoHint } from '../InfoHint';
import { useKivaraStore } from '../../../shared/use-kivara-store';
import { CardFace, type CardPreviewData } from './CardPreview';
import { RecentCards } from './RecentCards';

interface CardsTabProps {
  mapping: AnkiMapping;
  /** Accepts a value OR an updater, so effects can re-merge against the
   * latest mapping instead of a possibly stale closure copy. */
  setMapping: (mapping: AnkiMapping | ((prev: AnkiMapping) => AnkiMapping)) => void;
  mockData: CardPreviewData;
}

const FALLBACK_DECKS = [t('cards.wordField'), 'Default'];
const FALLBACK_MODELS = ['KivaraLingo', 'Basic'];
const FALLBACK_FIELDS: Record<string, string[]> = {
  'KivaraLingo': ['word', 'phonetic', 'sentence', 'translation', 'bilingual', 'monolingual', 'picture', 'sentence audio', 'word audio'],
  'Basic': ['Front', 'Back'],
};

// Use the shared detector — no duplicate regex here.
const detectSource = detectFieldSource;

const SOURCE_META: Record<FieldSource, { label: string; color: string; description: string }> = {
  selection:        { label: 'cards.wordSelection',        color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',     description: 'cards.srcDescSelectedWord' },
  cue:              { label: 'cards.srcLabelCue',          color: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',                 description: 'cards.srcDescActiveCue' },
  context:          { label: 'cards.srcLabelContext',       color: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',                 description: 'cards.srcDescContext' },
  cloze:            { label: 'cards.srcLabelCloze', color: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',              description: 'cards.srcDescCloze' },
  source:           { label: 'cards.srcLabelSource', color: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300',           description: 'cards.srcDescSource' },
  phonetic:         { label: 'cards.phonetic',       color: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',     description: 'cards.srcDescDictIpa' },
  translation:      { label: 'cards.translation',     color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', description: 'cards.nativeTranslation' },
  bilingual:        { label: 'cards.srcLabelBilingual',       color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',         description: 'cards.bilingualGloss' },
  monolingual:      { label: 'cards.srcLabelMonolingual',     color: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',     description: 'cards.definition' },
  examples:         { label: 'cards.examples',       color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300',     description: 'cards.srcDescDictExamples' },
  frame:            { label: 'cards.srcLabelPicture',        color: 'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300',             description: 'cards.srcDescCueScreenshot' },
  'sentence-audio': { label: 'cards.srcLabelSentenceAudio', color: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',             description: 'cards.tabAudio' },
  'word-audio':     { label: 'cards.srcLabelWordAudio',     color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',             description: 'cards.srcDescWordTts' },
  'ai-definition':  { label: 'cards.aiDefinitionLabel',    color: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300', description: 'cards.aiDefinitionHint' },
  'ai-synonyms':    { label: 'cards.aiSynonymsLabel',     color: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300', description: 'cards.aiSynonymsHint' },
  'ai-collocations':{ label: 'cards.aiCollocationsLabel',  color: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300', description: 'cards.srcDescAiCollocations' },
  'ai-nuance':      { label: 'cards.aiNuanceLabel',        color: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300', description: 'cards.nuancedTranslation' },
  'ai-register':    { label: 'cards.aiRegisterLabel',     color: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300', description: 'cards.srcDescAiRegister' },
  // Multi-source enrichment chain (Standard + VIP).
  synonyms:         { label: 'cards.synonyms',           color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', description: 'cards.synonymsHint' },
  antonyms:         { label: 'cards.antonyms',           color: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',             description: 'cards.antonymsHint' },
  collocations:     { label: 'cards.srcLabelCombos',       color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',     description: 'cards.srcDescCollocations' },
  frequency:        { label: 'cards.srcLabelFrequency',          color: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',                 description: 'cards.srcDescFreqBands' },
  etymology:        { label: 'cards.etymology',          color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',         description: 'cards.etymologyHint' },
  mnemonic:         { label: 'cards.mnemonic',        color: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',     description: 'cards.mnemonicHint' },
  image:             { label: 'cards.srcLabelImage',             color: 'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300',             description: 'cards.srcDescImage' },
  'video-link':     { label: 'cards.srcLabelVideoLink',          color: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',                 description: 'cards.srcDescYouglish' },
  // Deprecated / backward-compatible labels.
  dictionary:       { label: 'cards.srcLabelDictionary',    color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',         description: 'cards.srcDescLegacyCatchall' },
  translate:        { label: 'cards.srcLabelTranslate',       color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', description: 'cards.srcDescLegacyChain' },
  tabCapture:       { label: 'cards.srcLabelTabCapture',     color: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',             description: 'cards.legacyTabAudio' },
  tts:              { label: 'cards.srcLabelTts',            color: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300',                description: 'cards.srcDescTts' },
  manual:           { label: 'cards.srcLabelManual',         color: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',                description: 'cards.writeItYourself' },
};

/**
 * Source picker grouped per the design mock — Nativas / IA / Otros — so a
 * note model with 30+ fields stays scannable. Order matches the mock and
 * SOURCE_META entries above.
 */
const SOURCE_GROUPS: { label: string; options: FieldSource[] }[] = [
  {
    label: 'cards.groupNative',
    options: [
      'selection', 'cue', 'context', 'cloze', 'source', 'phonetic', 'translation', 'bilingual',
      'monolingual', 'examples', 'frame', 'sentence-audio', 'word-audio',
    ],
  },
  {
    label: 'cards.groupMulti',
    options: ['synonyms', 'antonyms', 'collocations', 'frequency', 'etymology', 'image', 'video-link'],
  },
  {
    label: 'cards.groupAi',
    options: ['ai-definition', 'ai-synonyms', 'ai-collocations', 'ai-nuance', 'ai-register', 'mnemonic'],
  },
  {
    label: 'cards.groupOther',
    options: ['manual'],
  },
];

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'error';

/**
 * Translate the production-side `AnkiPingErrorCode` into the human-friendly
 * copy the mock surfaces inline. Keeps a single source of truth for error
 * codes (the production enum) without forcing the UI to hand-roll every
 * string.
 */
const PING_ERROR_LABEL: Record<AnkiPingErrorCode, string> = {
  NETWORK:  t('cards.ankiDown'),
  CORS:     t('cards.ankiCors'),
  TIMEOUT:  t('cards.ankiTimeout'),
  HTTP:     t('cards.ankiHttp'),
  ANKI:     t('cards.ankiInternal'),
  API_KEY:  t('cards.ankiApiKeyWrong'),
  LOOPBACK_REFUSED: t('cards.ankiLoopbackRefused'),
};

export function CardsTab({ mapping, setMapping, mockData }: CardsTabProps) {
  const [conn, setConn] = useState<ConnectionState>('idle');
  const [pingCode, setPingCode] = useState<AnkiPingErrorCode | null>(null);
  const [pingError, setPingError] = useState<string | null>(null);
  const [fieldFilter, setFieldFilter] = useState('');
  const [onlyUnmapped, setOnlyUnmapped] = useState(false);
  const [previewSide, setPreviewSide] = useState<'front' | 'back'>('front');
  const [editingField, setEditingField] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [decks, setDecks] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [fieldsByModel, setFieldsByModel] = useState<Record<string, string[]>>({});

  // One deck per language (docs/REDESIGN-V2.md H9): `decks[lang]` is the
  // source of truth from v3 on; `deckName` is the read fallback for profiles
  // that predate it, and is still kept in sync because the create-card
  // pipeline reads it until F4.
  const sourceLang = useKivaraStore((s) => s.translate.sourceLang) || 'en';
  const aiOn = useKivaraStore((s) => s.ai.provider !== 'disabled' && s.ai.apiKey.trim() !== '');
  const activeDeck = mapping.decks?.[sourceLang] ?? mapping.deckName;
  const setDeck = (deck: string) =>
    setMapping({ ...mapping, deckName: deck, decks: { ...(mapping.decks ?? {}), [sourceLang]: deck } });

  const ankiFields = useMemo(
    () => fieldsByModel[mapping.modelName] ?? FALLBACK_FIELDS[mapping.modelName] ?? [],
    [fieldsByModel, mapping.modelName],
  );

  // Sequence guard + unmount guard for the whole probe: `refreshAnki` runs on
  // mount AND every 5 s while disconnected, so two passes are always in
  // flight (mount, the URL just landed; retry, a moment later). The slower
  // reply used to overwrite the state of the faster one, and a reply landing
  // after the tab went away set state on an unmounted component.
  const probesRef = useRef(0);
  const mountedRef = useRef(true);
  const markSeq = () => ++probesRef.current;
  const isCurrent = (seq: number) => mountedRef.current && seq === probesRef.current;

  async function refreshAnki() {
    const seq = markSeq();
    setConn('connecting');
    setPingCode(null);
    setPingError(null);
    try {
      const ping = (await sendMessage(
        'ANKI_PING',
        { url: mapping.ankiUrl, apiKey: mapping.apiKey },
        'background',
      )) as AnkiPingResponse;
      if (!isCurrent(seq)) return;
      if (!ping?.ok) {
        setConn('error');
        setPingCode(ping?.code ?? null);
        setPingError(ping?.error ?? null);
        setDecks([]);
        setModels([]);
        return;
      }
      const lists = (await sendMessage(
        'ANKI_DECKS',
        { url: mapping.ankiUrl, apiKey: mapping.apiKey },
        'background',
      )) as AnkiListsResponse;
      if (!isCurrent(seq)) return;
      setDecks(lists.decks ?? []);
      setModels(lists.models ?? []);
      if (lists.models?.length) {
        await Promise.all(
          lists.models.map(async (m) => {
            const res = (await sendMessage(
              'ANKI_FIELDS',
              { url: mapping.ankiUrl, apiKey: mapping.apiKey, modelName: m },
              'background',
            )) as AnkiFieldsResponse;
            if (!isCurrent(seq)) return;
            setFieldsByModel((prev) => ({ ...prev, [m]: res.fields ?? [] }));
          }),
        );
      }
      if (isCurrent(seq)) setConn('connected');
    } catch (err) {
      if (!isCurrent(seq)) return;
      setConn('error');
      setPingError(err instanceof Error ? err.message : 'unknown error');
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    // Mount-only on purpose: `refreshAnki` reads the LIVE mapping on every
    // pass, so re-running it when the mapping changes would turn every edit
    // into a network round trip.
    void refreshAnki();
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-retry every 5s while we're disconnected so the UI recovers as soon
  // as the user opens Anki — no need to switch tabs to hit "Probar".
  useEffect(() => {
    if (conn !== 'error') return;
    const interval = window.setInterval(() => {
      void refreshAnki();
    }, 5000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, mapping.ankiUrl, mapping.apiKey]);

  useEffect(() => {
    if (conn !== 'connected' || ankiFields.length === 0) return;
    // Functional update: the old form spread `mapping` captured by the effect
    // closure, so a source the user changed between the reconnect and this run
    // was silently reverted by the stale snapshot.
    setMapping((prev) => {
      const next: Record<string, FieldSource> = {};
      let changed = false;
      for (const f of ankiFields) {
        next[f] = prev.fieldSources[f] ?? detectSource(f);
        if (prev.fieldSources[f] !== next[f]) changed = true;
      }
      if (!changed && Object.keys(prev.fieldSources).length === ankiFields.length) return prev;
      return { ...prev, fieldSources: next };
    });
  }, [mapping.modelName, conn, ankiFields, setMapping]);

  const setSource = (field: string, src: FieldSource) => {
    setMapping({ ...mapping, fieldSources: { ...mapping.fieldSources, [field]: src } });
  };

  const applyAutoPreset = () => {
    const next: Record<string, FieldSource> = {};
    ankiFields.forEach((f) => { next[f] = detectSource(f); });
    setMapping({ ...mapping, fieldSources: next });
  };

  const allAuto = ankiFields.length > 0 && ankiFields.every((f) => mapping.fieldSources[f] === detectSource(f));
  const mappedCount = ankiFields.filter((f) => mapping.fieldSources[f] && mapping.fieldSources[f] !== 'manual').length;

  const visibleFields = useMemo(() => {
    const q = fieldFilter.trim().toLowerCase();
    return ankiFields.filter((f) => {
      if (q && !f.toLowerCase().includes(q)) return false;
      if (onlyUnmapped) {
        const src = mapping.fieldSources[f];
        if (src && src !== 'manual') return false;
      }
      return true;
    });
  }, [ankiFields, fieldFilter, onlyUnmapped, mapping.fieldSources]);

  const connError = conn === 'error'
    ? (pingCode ? PING_ERROR_LABEL[pingCode] : pingError ?? t('cards.ankiUnknown'))
    : null;

  return (
    <div className="flex flex-col h-full min-h-0 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* `pb-6` keeps the last mapping row readable above the docked
          preview (which has its own `border-t`). */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 pb-6 space-y-3">

        {/* Conexión */}
        <Section
          icon={<Plug size={10} />}
          title={t('cards.connection')}
          hint={
            <>
              {t('cards.ankiSendVia')}<strong>AnkiConnect</strong>{t('cards.ankiAddonFree')}<span className="font-mono">http://127.0.0.1:8765</span>{t('cards.ankiNeedOpen')}<span className="font-mono">2055492159</span>{t('cards.ankiApiKeyPre')}<em>API key</em> {t('cards.ankiApiKeyPost')}</>
          }
          collapsible
          open={setupOpen}
          onToggle={() => setSetupOpen(!setupOpen)}
          headerRight={<ConnPill state={conn} />}
        >
          {conn !== 'connected' && (
            <div className={`rounded-md border px-2 py-1.5 text-[10.5px] leading-snug flex items-start gap-1.5 ${
              conn === 'error'
                ? 'border-rose-200/70 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300'
                : conn === 'connecting'
                  ? 'border-amber-200/70 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/30 text-zinc-600 dark:text-zinc-400'
            }`}>
              <AlertCircle size={11} className="shrink-0 mt-px" />
              <span className="flex-1 min-w-0">
                {conn === 'error' && <>{connError}</>}
                {conn === 'connecting' && <>{t('cards.testChecking')}</>}
                {conn === 'idle' && <>{t('cards.testIdlePre')} <strong>{t('cards.testIdleAction')}</strong> {t('cards.testConnectPost')}</>}
              </span>
            </div>
          )}

          <Row label={<span className="flex items-center gap-1"><Cpu size={10} className="text-zinc-400" />{t('cards.endpoint')}</span>}>
            <div className="flex gap-1.5">
              <input
                value={mapping.ankiUrl}
                onChange={(e) => setMapping({ ...mapping, ankiUrl: e.target.value })}
                className="sl-input sl-mono flex-1 min-w-0"
                placeholder="http://127.0.0.1:8765"
              />
              <button
                onClick={() => void refreshAnki()}
                disabled={conn === 'connecting'}
                className={`text-[10px] font-semibold px-2 py-1 rounded inline-flex items-center gap-1 transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                  conn === 'connected'
                    ? 'border border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20'
                    : 'bg-indigo-600 text-white hover:bg-indigo-500'
                }`}
              >
                {conn === 'connecting' ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                {conn === 'connected' ? t('cards.reconnect') : t('cards.test')}
              </button>
            </div>
          </Row>

          <Row label={<span className="flex items-center gap-1"><Plug size={10} className="text-zinc-400" />{t('cards.apiKey')}</span>}>
            <SecretKeyInput
              stored={mapping.apiKey ?? ''}
              onChange={(v) => setMapping({ ...mapping, apiKey: v })}
              placeholder={t('cards.apiKeyPlaceholder')}
              section="ankiMapping"
              field="apiKey"
            />
          </Row>

          <Row label={<span className="flex items-center gap-1"><Database size={10} className="text-zinc-400" />{t("cards.deck")}</span>}>
            <select
              value={activeDeck}
              onChange={(e) => setDeck(e.target.value)}
              disabled={conn !== 'connected'}
              className="sl-select"
              aria-label={`${t('cards.deck')} · ${t(`lang.${sourceLang}`)}`}
            >
              {conn === 'connected'
                ? (decks.length ? decks : FALLBACK_DECKS).map((d) => <option key={d}>{d}</option>)
                : <option>{t('cards.offline')}</option>}
            </select>
          </Row>

          <Row label={<span className="flex items-center gap-1"><FileText size={10} className="text-zinc-400" />{t('cards.noteType')}</span>}>
            <select
              value={mapping.modelName}
              onChange={(e) => setMapping({ ...mapping, modelName: e.target.value, fieldSources: {} })}
              disabled={conn !== 'connected'}
              className="sl-select"
            >
              {conn === 'connected'
                ? (models.length ? models : FALLBACK_MODELS).map((n) => <option key={n}>{n}</option>)
                : <option>{t('cards.offline')}</option>}
            </select>
          </Row>
        </Section>

        {/* Mapeo de campos */}
        <Section
          icon={<Layers size={10} />}
          title={<>{t('cards.mappingTitle')} · <span className="font-mono normal-case">{mapping.modelName}</span></>}
          hint={
            <>
              {t('cards.fieldEachStart')}<em>note type</em> {t('cards.fieldFillWith')}<strong>{t('cards.fieldSource')}</strong> {t('cards.fieldAutoDetect')}<span className="font-mono">word</span> → {t('cards.fieldSourceWord')}, <span className="font-mono">sentence audio</span> {t('cards.fieldNoMatch')}<em>Manual</em> {t('cards.fieldAssignSelf')}</>
          }
          headerRight={
            <span className="text-[10px] font-mono tabular-nums text-zinc-400 dark:text-zinc-400">
              {mappedCount}/{ankiFields.length}
            </span>
          }
        >
          {conn === 'connected' && ankiFields.length > 0 && !allAuto && (
            <button
              onClick={applyAutoPreset}
              className="w-full flex items-center gap-1.5 text-[11px] font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/15 border border-indigo-200 dark:border-indigo-500/25 rounded-md px-2 py-1.5 transition-colors"
            >
              <Wand2 size={11} /> {t('cards.restoreAutoMap')}
            </button>
          )}

          {conn === 'connected' && ankiFields.length > 0 && allAuto && (
            <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 dark:text-zinc-400 px-1">
              <Wand2 size={10} className="text-indigo-400" />
              <span>{t('cards.autoMapActive')}</span>
            </div>
          )}

          {conn !== 'connected' && (
            <EmptyState icon={<AlertCircle size={13} />} text={t('cards.connectToSee')} />
          )}

          {conn === 'connected' && ankiFields.length === 0 && (
            <EmptyState icon={<AlertCircle size={13} />} text={t('cards.noFields')} />
          )}

          {conn === 'connected' && ankiFields.length > 3 && (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={fieldFilter}
                onChange={(e) => setFieldFilter(e.target.value)}
                placeholder={t('cards.searchFieldPh')}
                className="sl-input flex-1 min-w-0 text-[11px]"
                spellCheck={false}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setOnlyUnmapped((v) => !v)}
                className={`shrink-0 text-[10px] font-semibold px-2 py-1 rounded border transition-colors ${
                  onlyUnmapped
                    ? 'border-indigo-300 dark:border-indigo-500/40 bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300'
                    : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                }`}
                title={t('cards.showUnmappedTitle')}
              >
                {t('cards.onlyUnmapped')}
              </button>
            </div>
          )}

          {conn === 'connected' && ankiFields.length > 0 && visibleFields.length === 0 && (
            <EmptyState icon={<AlertCircle size={13} />} text={t('cards.noFieldMatch')} />
          )}

          {conn === 'connected' && visibleFields.map((field, i) => {
            const src = mapping.fieldSources[field] ?? detectSource(field);
            const meta = SOURCE_META[src] ?? SOURCE_META['manual'];
            const isOpen = editingField === field;
            const auto = src === detectSource(field);
            return (
              <div
                key={field}
                className="rounded-md bg-zinc-50/70 dark:bg-zinc-800/30 border border-zinc-200/60 dark:border-zinc-800/70 overflow-hidden sl-animate-fade-up"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <button
                  onClick={() => setEditingField(isOpen ? null : field)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-100/60 dark:hover:bg-zinc-800/60 transition-colors"
                >
                  <span className="flex-1 min-w-0 flex items-center gap-1.5 text-left">
                    <span className="text-[11px] font-mono font-medium text-zinc-800 dark:text-zinc-200 leading-tight truncate">
                      {field}
                    </span>
                    {auto && <Wand2 size={8} className="text-indigo-400/70 shrink-0" />}
                  </span>
                  <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${meta.color}`}>
                    {t(meta.label)}
                  </span>
                  <ChevronDown size={10} className={`text-zinc-400 transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateRows: isOpen ? '1fr' : '0fr',
                    transition: 'grid-template-rows 200ms ease',
                  }}
                >
                  <div className="overflow-hidden">
                    <div className="border-t border-zinc-200/60 dark:border-zinc-800/60 p-1.5 bg-white dark:bg-zinc-900 space-y-1">
                      <div className="text-[10px] text-zinc-500 dark:text-zinc-400 px-1 leading-snug">
                        {t(meta.description)}
                      </div>
                      <div className="space-y-1.5">
                        {SOURCE_GROUPS.map((group) => (
                          <div key={group.label} className="space-y-1">
                            <div className="text-[9px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-400 px-1">
                              {t(group.label)}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {group.options.map((s) => (
                                <button
                                  key={s}
                                  onClick={() => setSource(field, s)}
                                  className={`text-[10px] px-1.5 py-0.5 rounded border font-medium transition-colors ${
                                    src === s
                                      ? `${SOURCE_META[s].color} border-current`
                                      : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-700'
                                  }`}
                                >
                                  {t(SOURCE_META[s].label)}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </Section>

        <RecentCards />
      </div>

      {/* Preview Anki — docked */}
      <div className="bg-zinc-50 dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 p-3 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            <Layers size={10} className="text-indigo-500" /> Preview
          </span>
          <div className="flex items-center gap-1.5">
            <div className="flex bg-zinc-200/80 dark:bg-zinc-800/80 rounded-md p-0.5">
              {(['front', 'back'] as const).map((side) => (
                <button
                  key={side}
                  onClick={() => setPreviewSide(side)}
                  className={`text-[9px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded transition-all ${
                    previewSide === side
                      ? 'bg-white dark:bg-zinc-700 text-indigo-600 dark:text-indigo-300 shadow-sm'
                      : 'text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  {side === 'front' ? t('cards.front') : t('cards.back')}
                </button>
              ))}
            </div>
            <button
              onClick={() => setPreviewSide(previewSide === 'front' ? 'back' : 'front')}
              className="p-1 rounded-md text-zinc-400 hover:text-indigo-400 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-all duration-300 hover:rotate-180"
              title={t('cards.flip')}
            >
              <RotateCcw size={11} />
            </button>
          </div>
        </div>

        <div
          key={previewSide}
          className="rounded-xl shadow-md overflow-hidden kvl-pop-in bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 p-3"
        >
          <CardFace
            side={previewSide}
            mapping={mapping}
            fields={ankiFields.length ? ankiFields : (FALLBACK_FIELDS[mapping.modelName] ?? [])}
            card={mockData}
            aiOn={aiOn}
          />
        </div>

        <div className="flex items-center justify-between gap-2 mt-2 px-0.5">
          <div className="flex items-center gap-1">
            <QualityBadge icon={<Volume2 size={9} />} label={t('cards.audioBadge')} detail={t('cards.vadCenter')} />
            <QualityBadge icon={<Camera size={9} />} label={t('cards.frameBadge')} detail={t('cards.vadCenter')} />
          </div>
          <span className="text-[9px] text-zinc-400 dark:text-zinc-400 font-mono">
            {mappedCount}/{ankiFields.length} · 14KB
          </span>
        </div>
      </div>
    </div>
  );
}

/* ---------- shared (matches SubtitlesTab/SettingsTab) ---------- */

function Section({
  icon, title, children, collapsible, open, onToggle, headerRight, hint,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  children: React.ReactNode;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
  headerRight?: React.ReactNode;
  hint?: React.ReactNode;
}) {
  // The header is NOT a <button>: it holds an InfoHint (itself a focusable
  // role="button") and nesting interactive controls is both an axe violation
  // and a screen-reader trap. The row keeps click-to-toggle for the mouse; the
  // chevron is the real button keyboard users Tab to.
  const header = (
    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-zinc-50/60 dark:bg-zinc-900/60 border-b border-zinc-100 dark:border-zinc-800/60">
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {icon}{title}
        {hint && <InfoHint text={hint} />}
      </span>
      <span className="flex items-center gap-1.5">
        {headerRight}
        {collapsible && (
          <button
            type="button"
            aria-expanded={open}
            onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
            className="inline-flex items-center justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
          >
            <span className="sr-only">{typeof title === 'string' ? title : t('panel.tabCards')}</span>
            <ChevronDown size={12} aria-hidden="true" className={`text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
      </span>
    </div>
  );
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      {collapsible
        ? <div onClick={onToggle} className="w-full text-left cursor-pointer hover:bg-zinc-100/40 dark:hover:bg-zinc-800/40 transition-colors">{header}</div>
        : header}
      {(!collapsible || open) && (
        <div className="p-2.5 space-y-2">{children}</div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">{label}</label>
      {children}
    </div>
  );
}

function ConnDot({ state }: { state: ConnectionState }) {
  const color =
    state === 'connected' ? 'bg-emerald-500'
    : state === 'connecting' ? 'bg-amber-500'
    : state === 'error' ? 'bg-rose-500'
    : 'bg-zinc-400';
  return (
    <span className="relative inline-flex w-2 h-2">
      {state === 'connected' && (
        <span className="absolute inset-0 rounded-full bg-emerald-400/40 animate-ping" style={{ animationDuration: '2.4s' }} />
      )}
      <span className={`relative inline-flex w-2 h-2 rounded-full ${color}`} />
    </span>
  );
}

function ConnPill({ state }: { state: ConnectionState }) {
  const meta =
    state === 'connected'  ? { label: t('cards.connActive'),     pill: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' } :
    state === 'connecting' ? { label: t('cards.connConnecting'),  pill: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' } :
    state === 'error'      ? { label: t('cards.offline'), pill: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' } :
                             { label: t('cards.connInactive'),   pill: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' };
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold normal-case tracking-normal px-1.5 py-0.5 rounded ${meta.pill}`}>
      <ConnDot state={state} />
      {meta.label}
    </span>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="rounded-md border border-dashed border-zinc-300 dark:border-zinc-700 p-3 text-center text-[11px] text-zinc-500 dark:text-zinc-400 flex flex-col items-center gap-1">
      <span className="text-zinc-400">{icon}</span>
      {text}
    </div>
  );
}

function QualityBadge({ icon, label, detail }: { icon: React.ReactNode; label: string; detail: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200/70 dark:border-emerald-500/20">
      {icon}<span className="font-semibold">{label}</span><span className="opacity-70">· {detail}</span>
    </span>
  );
}
