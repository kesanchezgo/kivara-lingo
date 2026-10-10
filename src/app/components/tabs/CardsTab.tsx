import React, { useEffect, useMemo, useState } from 'react';
import { t } from '../../../shared/i18n';
import { sendMessage } from 'webext-bridge/content-script';
import { AnkiMapping, FieldSource } from '../../types';
import type {
  AnkiListsResponse,
  AnkiFieldsResponse,
  AnkiPingResponse,
  AnkiPingErrorCode,
} from '../../../shared/types';
import {
  RefreshCw, RotateCcw, Volume2, Camera, Wand2, Layers,
  ChevronDown, Loader2, AlertCircle, Server, Database, FileText, Plug,
} from 'lucide-react';
import { detectFieldSource } from '../../../shared/anki-field-detect';
import { SecretKeyInput } from '../SecretKeyInput';
import { InfoHint } from '../InfoHint';

interface CardsTabProps {
  mapping: AnkiMapping;
  /** Accepts a value OR an updater, so effects can re-merge against the
   * latest mapping instead of a possibly stale closure copy. */
  setMapping: (mapping: AnkiMapping | ((prev: AnkiMapping) => AnkiMapping)) => void;
  mockData: {
    targetSentence: string;
    nativeSentence: string;
    word: string;
    translation: string;
    phonetic?: string;
    bilingual?: string;
    monolingual?: string;
  };
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
  selection:        { label: 'Palabra',        color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',     description: t('cards.srcDescSelectedWord') },
  cue:              { label: 'Frase',          color: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',                 description: t('cards.srcDescActiveCue') },
  phonetic:         { label: t('cards.phonetic'),       color: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',     description: t('cards.srcDescDictIpa') },
  translation:      { label: t('cards.translation'),     color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', description: t('cards.nativeTranslation') },
  bilingual:        { label: t('cards.srcLabelBilingual'),       color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',         description: t('cards.bilingualGloss') },
  monolingual:      { label: t('cards.srcLabelMonolingual'),     color: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',     description: t('cards.definition') },
  examples:         { label: 'Ejemplos',       color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300',     description: t('cards.srcDescDictExamples') },
  frame:            { label: 'Picture',        color: 'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300',             description: t('cards.srcDescCueScreenshot') },
  'sentence-audio': { label: 'Sentence audio', color: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',             description: t('cards.tabAudio') },
  'word-audio':     { label: 'Word audio',     color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',             description: t('cards.srcDescWordTts') },
  'ai-definition':  { label: t('cards.aiDefinitionLabel'),    color: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300', description: t('cards.aiDefinitionHint') },
  'ai-synonyms':    { label: t('cards.aiSynonymsLabel'),     color: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300', description: t('cards.aiSynonymsHint') },
  'ai-collocations':{ label: 'IA · Colocaciones',  color: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300', description: 'Colocaciones comunes' },
  'ai-nuance':      { label: 'IA · Matiz',        color: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300', description: t('cards.nuancedTranslation') },
  'ai-register':    { label: 'IA · Registro',     color: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300', description: 'Registro (formal / informal / slang)' },
  // Multi-source enrichment chain (Standard + VIP).
  synonyms:         { label: t('cards.synonyms'),           color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', description: t('cards.synonymsHint') },
  antonyms:         { label: t('cards.antonyms'),           color: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',             description: t('cards.antonymsHint') },
  collocations:     { label: 'Combinaciones',       color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',     description: 'Colocaciones editoriales o corroboradas' },
  frequency:        { label: 'Frecuencia',          color: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',                 description: t('cards.srcDescFreqBands') },
  etymology:        { label: t('cards.etymology'),          color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',         description: t('cards.etymologyHint') },
  mnemonic:         { label: t('cards.mnemonic'),        color: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',     description: t('cards.mnemonicHint') },
  image:             { label: 'Imagen',             color: 'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300',             description: 'Imagen Unsplash / Pixabay / Wikimedia / DDG' },
  'video-link':     { label: 'Video link',          color: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',                 description: t('cards.srcDescYouglish') },
  // Deprecated / backward-compatible labels.
  dictionary:       { label: 'Diccionario',    color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',         description: t('cards.srcDescLegacyCatchall') },
  translate:        { label: 'Traducir',       color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', description: t('cards.srcDescLegacyChain') },
  tabCapture:       { label: 'tabCapture',     color: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',             description: t('cards.legacyTabAudio') },
  tts:              { label: 'TTS',            color: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300',                description: '(legacy) Text-to-speech' },
  manual:           { label: 'Manual',         color: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',                description: t('cards.writeItYourself') },
};

/**
 * Source picker grouped per the design mock — Nativas / IA / Otros — so a
 * note model with 30+ fields stays scannable. Order matches the mock and
 * SOURCE_META entries above.
 */
const SOURCE_GROUPS: { label: string; options: FieldSource[] }[] = [
  {
    label: 'Nativas',
    options: [
      'selection', 'cue', 'phonetic', 'translation', 'bilingual', 'monolingual',
      'examples', 'frame', 'sentence-audio', 'word-audio',
    ],
  },
  {
    label: 'Multi-fuente',
    options: ['synonyms', 'antonyms', 'collocations', 'frequency', 'etymology', 'image', 'video-link'],
  },
  {
    label: 'IA',
    options: ['ai-definition', 'ai-synonyms', 'ai-collocations', 'ai-nuance', 'ai-register', 'mnemonic'],
  },
  {
    label: 'Otros',
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
  API_KEY:  'API key incorrecta o caducada.',
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

  const ankiFields = useMemo(
    () => fieldsByModel[mapping.modelName] ?? FALLBACK_FIELDS[mapping.modelName] ?? [],
    [fieldsByModel, mapping.modelName],
  );

  async function refreshAnki() {
    setConn('connecting');
    setPingCode(null);
    setPingError(null);
    try {
      const ping = (await sendMessage(
        'ANKI_PING',
        { url: mapping.ankiUrl, apiKey: mapping.apiKey },
        'background',
      )) as AnkiPingResponse;
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
            setFieldsByModel((prev) => ({ ...prev, [m]: res.fields ?? [] }));
          }),
        );
      }
      setConn('connected');
    } catch (err) {
      setConn('error');
      setPingError(err instanceof Error ? err.message : 'unknown error');
    }
  }

  useEffect(() => {
    void refreshAnki();
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
  }, [mapping.modelName, conn, ankiFields, setMapping]); // eslint-disable-line react-hooks/exhaustive-deps

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
    ? (pingCode ? PING_ERROR_LABEL[pingCode] : pingError ?? 'No se pudo contactar AnkiConnect.')
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

          <Row label={<span className="flex items-center gap-1"><Server size={10} className="text-zinc-400" />Endpoint</span>}>
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

          <Row label={<span className="flex items-center gap-1"><Plug size={10} className="text-zinc-400" />API key</span>}>
            <SecretKeyInput
              stored={mapping.apiKey ?? ''}
              onChange={(v) => setMapping({ ...mapping, apiKey: v })}
              placeholder={t('cards.apiKeyPlaceholder')}
              section="ankiMapping"
              field="apiKey"
            />
          </Row>

          <Row label={<span className="flex items-center gap-1"><Database size={10} className="text-zinc-400" />Mazo</span>}>
            <select
              value={mapping.deckName}
              onChange={(e) => setMapping({ ...mapping, deckName: e.target.value })}
              disabled={conn !== 'connected'}
              className="sl-select"
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
              {t('cards.fieldEachStart')}<em>note type</em> {t('cards.fieldFillWith')}<strong>fuente</strong> {t('cards.fieldAutoDetect')}<span className="font-mono">word</span> → Palabra, <span className="font-mono">sentence audio</span> {t('cards.fieldNoMatch')}<em>Manual</em> {t('cards.fieldAssignSelf')}</>
          }
          headerRight={
            <span className="text-[10px] font-mono tabular-nums text-zinc-400 dark:text-zinc-500">
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
            <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 dark:text-zinc-500 px-1">
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
                    {meta.label}
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
                      <div className="text-[10px] text-zinc-500 dark:text-zinc-500 px-1 leading-snug">
                        {meta.description}
                      </div>
                      <div className="space-y-1.5">
                        {SOURCE_GROUPS.map((group) => (
                          <div key={group.label} className="space-y-1">
                            <div className="text-[9px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 px-1">
                              {group.label}
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
                                  {SOURCE_META[s].label}
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
                  {side === 'front' ? 'Frente' : 'Reverso'}
                </button>
              ))}
            </div>
            <button
              onClick={() => setPreviewSide(previewSide === 'front' ? 'back' : 'front')}
              className="p-1 rounded-md text-zinc-400 hover:text-indigo-400 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-all duration-300 hover:rotate-180"
              title="Voltear"
            >
              <RotateCcw size={11} />
            </button>
          </div>
        </div>

        <div
          key={previewSide}
          className="rounded-xl shadow-md overflow-hidden kvl-pop-in bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 p-3"
        >
          {previewSide === 'front' ? <FrontTemplate mockData={mockData} /> : <BackTemplate mockData={mockData} />}
        </div>

        <div className="flex items-center justify-between gap-2 mt-2 px-0.5">
          <div className="flex items-center gap-1">
            <QualityBadge icon={<Volume2 size={9} />} label="Audio" detail="VAD" />
            <QualityBadge icon={<Camera size={9} />} label="Frame" detail="centro" />
          </div>
          <span className="text-[9px] text-zinc-400 dark:text-zinc-500 font-mono">
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
  const header = (
    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-zinc-50/60 dark:bg-zinc-900/60 border-b border-zinc-100 dark:border-zinc-800/60">
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {icon}{title}
        {hint && <InfoHint text={hint} />}
      </span>
      <span className="flex items-center gap-1.5">
        {headerRight}
        {collapsible && (
          <ChevronDown size={12} className={`text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
      </span>
    </div>
  );
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      {collapsible
        ? <button onClick={onToggle} className="w-full text-left hover:bg-zinc-100/40 dark:hover:bg-zinc-800/40 transition-colors">{header}</button>
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

function FrontTemplate({ mockData }: { mockData: CardsTabProps['mockData'] }) {
  return (
    <div className="font-sans">
      {/* Top bar — POS badge + audio button. The mock dropped the legacy
          two-column layout in favor of a centered hero word with the
          context sentence pinned underneath. */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded">
          noun
        </span>
        <button
          className="rounded-full flex items-center justify-center transition-colors bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/25"
          style={{ width: 26, height: 26 }}
          title="Reproducir audio"
        >
          <Volume2 size={11} />
        </button>
      </div>
      <div className="text-center py-1 mb-3">
        <div className="text-[28px] font-bold text-zinc-900 dark:text-white leading-tight tracking-tight">{mockData.word}</div>
        <div className="text-[11px] font-mono text-indigo-700 dark:text-indigo-300/70 mt-1 inline-block bg-zinc-100 dark:bg-zinc-800/60 px-2 py-0.5 rounded">
          {mockData.phonetic ?? '/ipa/'}
        </div>
      </div>
      <div className="border-t border-zinc-200 dark:border-zinc-800/60 pt-2.5">
        <div className="text-[10px] text-zinc-500 italic text-center leading-snug">{mockData.targetSentence}</div>
      </div>
    </div>
  );
}

function BackTemplate({ mockData }: { mockData: CardsTabProps['mockData'] }) {
  return (
    <div className="font-sans space-y-2">
      {/* Word header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-base font-bold text-zinc-900 dark:text-white leading-tight truncate">{mockData.word}</div>
          <div className="text-[10px] font-mono text-zinc-500">{mockData.phonetic ?? '/ipa/'}</div>
        </div>
        <button
          className="rounded-full flex items-center justify-center shrink-0 transition-colors bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/25"
          style={{ width: 24, height: 24 }}
          title="Reproducir audio"
        >
          <Volume2 size={10} />
        </button>
      </div>

      {/* Translation */}
      <div className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-800/50 rounded-lg px-2 py-1.5">
        <span className="text-[9px] font-medium text-zinc-500 italic shrink-0">noun</span>
        <span className="w-px h-3 bg-zinc-300 dark:bg-zinc-700 shrink-0" />
        <span className="text-[11px] text-zinc-800 dark:text-zinc-200 leading-tight">{mockData.translation}</span>
      </div>

      {/* Scene image with overlaid sentence */}
      <div className="relative rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700" style={{ height: 72 }}>
        <img
          src="https://images.unsplash.com/photo-1574923930958-9b653a0e5148?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400&q=80"
          alt="Escena"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <div className="absolute bottom-1 inset-x-2 flex justify-center">
          <span
            className="text-[9px] font-semibold text-yellow-300 leading-tight text-center"
            style={{ textShadow: '0 1px 3px rgba(0,0,0,1)' }}
          >
            {mockData.targetSentence}
          </span>
        </div>
        <span className="absolute top-1 right-1 text-[8px] font-mono uppercase tracking-wider bg-black/50 text-emerald-400 px-1 py-0.5 rounded">
          clean
        </span>
      </div>

      {/* Monolingual definition */}
      <div className="text-[10px] text-zinc-600 dark:text-zinc-400 italic px-1 leading-snug">
        {mockData.monolingual ?? t('cards.defaultMonolingual')}
      </div>

      {/* Sentence pair (target + native) with a per-row audio button */}
      <div className="flex items-start gap-2 bg-zinc-100 dark:bg-zinc-800/30 rounded-lg px-2 py-1.5">
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="text-[10px] text-zinc-800 dark:text-zinc-200 leading-snug">{mockData.targetSentence}</div>
          <div className="text-[10px] text-zinc-500 italic leading-snug">{mockData.nativeSentence}</div>
        </div>
        <button
          className="rounded-full flex items-center justify-center shrink-0 mt-0.5 transition-colors bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/25"
          style={{ width: 22, height: 22 }}
          title={t('cards.playSentence')}
        >
          <Volume2 size={9} />
        </button>
      </div>
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
