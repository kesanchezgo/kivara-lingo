import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { t } from '../../../shared/i18n';
import { richText } from '../../../shared/i18n/rich';
import { sendMessage } from 'webext-bridge/content-script';
import type {
  AnkiMapping,
  FieldSource,
  AnkiListsResponse,
  AnkiFieldsResponse,
  AnkiPingResponse,
  AnkiPingErrorCode,
} from '../../../shared/types';
import {
  RefreshCw, RotateCcw, Volume2, Camera, Mic, Wand2, Layers,
  ChevronDown, Loader2, AlertCircle, Plug,
} from '../../../ui/icons';
import { detectFieldSource } from '../../../shared/anki-field-detect';
import { SecretKeyInput } from '../SecretKeyInput';
import { InfoHint } from '../InfoHint';
import { useKivaraStore } from '../../../shared/use-kivara-store';
import { aiConfigured } from '../../../shared/ai-configured';
import { deckFor, withDeck } from '../../../shared/study/decks';
import { getGrantedOrigins, subscribeHostPermissions } from '../../../shared/host-permissions-store';
import { CardFace, type CardPreviewData } from './CardPreview';
import { RecentCards } from './RecentCards';
import {
  Button, Callout, Collapse, Group, ui, SegmentedControl, IconButton, IconTile, Badge, FOCUS,
} from '../../../ui/primitives/settings-primitives';
import { Select, inputCls } from '../../../ui/primitives/controls';
import { resolveWordAudio, type WordAudioStatus } from './word-audio-status';

interface CardsTabProps {
  mapping: AnkiMapping;
  /** Accepts a value OR an updater, so effects can re-merge against the
   * latest mapping instead of a possibly stale closure copy. */
  setMapping: (mapping: AnkiMapping | ((prev: AnkiMapping) => AnkiMapping)) => void;
  mockData: CardPreviewData;
  /** Language of the playing subtitles, so its deck row gets the
   * "This episode" badge. Falls back to the active language. */
  episodeLang?: string;
  /** Opens the Vocabulary tab — target of the "see your level" link. */
  onOpenVocab?: () => void;
}

const FALLBACK_DECKS = [t('cards.wordField'), 'Default'];
const FALLBACK_MODELS = ['KivaraLingo', 'Basic'];
const FALLBACK_FIELDS: Record<string, string[]> = {
  'KivaraLingo': ['word', 'phonetic', 'sentence', 'translation', 'bilingual', 'monolingual', 'picture', 'sentence audio', 'word audio'],
  'Basic': ['Front', 'Back'],
};

// Use the shared detector — no duplicate regex here.
const detectSource = detectFieldSource;

/** Copy shown next to a ping failure. The code is the production enum; the
 * labels resolve through `t()` so nothing user-visible is a literal. */
const PING_ERROR_LABEL: Record<AnkiPingErrorCode, string> = {
  NETWORK:  t('cards.ankiDown'),
  CORS:     t('cards.ankiCors'),
  TIMEOUT:  t('cards.ankiTimeout'),
  HTTP:     t('cards.ankiHttp'),
  ANKI:     t('cards.ankiInternal'),
  API_KEY:  t('cards.ankiApiKeyWrong'),
  LOOPBACK_REFUSED: t('cards.ankiLoopbackRefused'),
};

/** Extra hint under the error: "open Anki" when it does not answer, the
 * "free add-on" advice when the add-on is the problem. */
const PING_ERROR_HINT: Partial<Record<AnkiPingErrorCode, string>> = {
  NETWORK: 'cards.ankiNeedOpenHint',
  TIMEOUT: 'cards.ankiNeedOpenHint',
  ANKI:    'cards.ankiNeedOpenHint',
  CORS:    'cards.ankiAddonFreeHint',
  HTTP:    'cards.ankiAddonFreeHint',
};

/** Label and description per source, as i18n keys resolved at render. The
 * colour family comes from `familyDot()`. */
const SOURCE_META: Record<FieldSource, { label: string; description: string }> = {
  selection:        { label: 'cards.wordSelection',        description: 'cards.srcDescSelectedWord' },
  cue:              { label: 'cards.srcLabelCue',          description: 'cards.srcDescActiveCue' },
  context:          { label: 'cards.srcLabelContext',      description: 'cards.srcDescContext' },
  cloze:            { label: 'cards.srcLabelCloze',        description: 'cards.srcDescCloze' },
  source:           { label: 'cards.srcLabelSource',       description: 'cards.srcDescSource' },
  phonetic:         { label: 'cards.phonetic',             description: 'cards.srcDescDictIpa' },
  translation:      { label: 'cards.translation',          description: 'cards.nativeTranslation' },
  bilingual:        { label: 'cards.srcLabelBilingual',    description: 'cards.bilingualGloss' },
  monolingual:      { label: 'cards.srcLabelMonolingual',  description: 'cards.definition' },
  examples:         { label: 'cards.examples',             description: 'cards.srcDescDictExamples' },
  frame:            { label: 'cards.srcLabelPicture',      description: 'cards.srcDescCueScreenshot' },
  'sentence-audio': { label: 'cards.srcLabelSentenceAudio', description: 'cards.tabAudio' },
  'word-audio':     { label: 'cards.srcLabelWordAudio',    description: 'cards.srcDescWordTts' },
  'ai-definition':  { label: 'cards.aiDefinitionLabel',    description: 'cards.aiDefinitionHint' },
  'ai-synonyms':    { label: 'cards.aiSynonymsLabel',      description: 'cards.aiSynonymsHint' },
  'ai-collocations':{ label: 'cards.aiCollocationsLabel',  description: 'cards.srcDescAiCollocations' },
  'ai-nuance':      { label: 'cards.aiNuanceLabel',        description: 'cards.nuancedTranslation' },
  'ai-register':    { label: 'cards.aiRegisterLabel',      description: 'cards.srcDescAiRegister' },
  synonyms:         { label: 'cards.synonyms',             description: 'cards.synonymsHint' },
  antonyms:         { label: 'cards.antonyms',             description: 'cards.antonymsHint' },
  collocations:     { label: 'cards.srcLabelCombos',       description: 'cards.srcDescCollocations' },
  frequency:        { label: 'cards.srcLabelFrequency',    description: 'cards.srcDescFreqBands' },
  etymology:        { label: 'cards.etymology',            description: 'cards.etymologyHint' },
  mnemonic:         { label: 'cards.mnemonic',             description: 'cards.mnemonicHint' },
  image:            { label: 'cards.srcLabelImage',        description: 'cards.srcDescImage' },
  'video-link':     { label: 'cards.srcLabelVideoLink',    description: 'cards.srcDescYouglish' },
  dictionary:       { label: 'cards.srcLabelDictionary',   description: 'cards.srcDescLegacyCatchall' },
  translate:        { label: 'cards.srcLabelTranslate',    description: 'cards.srcDescLegacyChain' },
  tabCapture:       { label: 'cards.srcLabelTabCapture',   description: 'cards.legacyTabAudio' },
  tts:              { label: 'cards.srcLabelTts',          description: 'cards.srcDescTts' },
  manual:           { label: 'cards.srcLabelManual',       description: 'cards.writeItYourself' },
};

/** Source picker grouped per the mock — Natives / Multi-source / AI / Other —
 * so a note model with 30+ fields stays scannable. */
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

/** Colour dot of a source family (same four families as SOURCE_GROUPS). */
function familyDot(src: FieldSource): string {
  if (src === 'manual' || !SOURCE_GROUPS.some((g) => g.options.includes(src))) return 'bg-zinc-300 dark:bg-zinc-600';
  if (SOURCE_GROUPS[1].options.includes(src)) return 'bg-emerald-500';
  if (SOURCE_GROUPS[2].options.includes(src)) return 'bg-fuchsia-500';
  return 'bg-indigo-500';
}

const NO_ORIGINS: string[] = [];

export function CardsTab({ mapping, setMapping, mockData, episodeLang, onOpenVocab }: CardsTabProps) {
  const [conn, setConn] = useState<ConnectionState>('idle');
  const [pingCode, setPingCode] = useState<AnkiPingErrorCode | null>(null);
  const [pingError, setPingError] = useState<string | null>(null);
  const [fieldFilter, setFieldFilter] = useState('');
  const [onlyUnmapped, setOnlyUnmapped] = useState(false);
  const [previewSide, setPreviewSide] = useState<'front' | 'back'>('front');
  // The docked preview is ~400px tall: collapsed by default to leave room for
  // the mapping and Recent cards (what gets consulted daily).
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [decks, setDecks] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [fieldsByModel, setFieldsByModel] = useState<Record<string, string[]>>({});

  // One deck per language. The active learning language's deck is shown, plus
  // the deck of the language actually on screen when it differs: cards go to
  // the deck of their subtitles' language, so that is the one to expose.
  const activeLang = useKivaraStore((s) => s.translate.sourceLang) || 'en';
  const episode = episodeLang ?? activeLang;
  const deckLangs = activeLang === episode ? [activeLang] : [activeLang, episode];

  // Preview quality indicators read the live settings.
  const ai = useKivaraStore((s) => s.ai);
  const vip = useKivaraStore((s) => s.vip);
  const tts = useKivaraStore((s) => s.tts);
  const endDetect = useKivaraStore((s) => s.capture.endDetect);
  const aiOn = aiConfigured(ai);
  const granted = useSyncExternalStore(subscribeHostPermissions, getGrantedOrigins, () => NO_ORIGINS);
  const pron = useMemo<WordAudioStatus>(
    () => resolveWordAudio(mockData.word, { vip, tts, ai }),
    // The granted list guards the subscription: `hasOrigin()` reads the same
    // store, so a grant/revoke must re-run the resolver.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mockData.word, vip, tts, ai, granted],
  );

  const ankiFields = useMemo(
    () => fieldsByModel[mapping.modelName] ?? FALLBACK_FIELDS[mapping.modelName] ?? [],
    [fieldsByModel, mapping.modelName],
  );

  // Sequence guard + unmount guard for the whole probe: `refreshAnki` runs on
  // mount AND every 5 s while disconnected, so two passes can be in flight.
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
      setPingError(err instanceof Error ? err.message : null);
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

  // Auto-retry every 5s while disconnected so the UI recovers as soon as the
  // user opens Anki — no need to switch tabs to hit "Probar".
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
    // Functional update: a source the user changed between the reconnect and
    // this run must not be reverted by a stale closure snapshot.
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
  const mappedCount = ankiFields.filter((f) => (mapping.fieldSources[f] ?? detectSource(f)) !== 'manual').length;

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
  const pingHintKey = pingCode ? (PING_ERROR_HINT[pingCode] ?? 'cards.ankiNeedOpenHint') : 'cards.ankiNeedOpenHint';

  const deckList = decks.length ? decks : FALLBACK_DECKS;
  const deckOptionsFor = (d: string) => (d && !deckList.includes(d) ? [d, ...deckList] : deckList);

  return (
    <div className="flex flex-col h-full min-h-0 text-zinc-900 dark:text-zinc-100">
      <div className={`flex-1 min-h-0 overflow-y-auto kvl-scroll ${ui.body}`}>

        {/* Recientes + retry queue */}
        <RecentCards />

        {/* Connection */}
        <Section
          icon={<Plug size={13} />}
          title={t('cards.connection')}
          hint={<>{richText(t('cards.connHint'), {
            addon: <strong>AnkiConnect</strong>,
            url: <span className="font-mono">http://127.0.0.1:8765</span>,
            code: <span className="font-mono">2055492159</span>,
          })}</>}
          collapsible
          open={setupOpen}
          onToggle={() => setSetupOpen(!setupOpen)}
          headerRight={<ConnPill state={conn} />}
        >
          {conn !== 'connected' && (
            <Callout
              tone={conn === 'error' ? 'danger' : conn === 'connecting' ? 'warning' : 'neutral'}
              icon={conn === 'connecting' ? <Loader2 size={14} className="animate-spin" /> : <AlertCircle size={14} />}
              role={conn === 'error' ? 'alert' : 'status'}
            >
              {conn === 'error' && (
                <span className="inline-flex items-center gap-1">
                  {connError}
                  <InfoHint text={t(pingHintKey)} />
                </span>
              )}
              {conn === 'connecting' && <>{t('cards.testChecking')}</>}
              {conn === 'idle' && <>{richText(t('cards.testIdle'), { action: <strong>{t('cards.testIdleAction')}</strong> })}</>}
            </Callout>
          )}

          <Row label={t('cards.endpoint')}>
            <div className="flex gap-2">
              <input
                value={mapping.ankiUrl}
                onChange={(e) => setMapping({ ...mapping, ankiUrl: e.target.value })}
                className={`${inputCls} font-mono !text-[12px] flex-1 min-w-0`}
                placeholder="http://127.0.0.1:8765"
                aria-label={t('cards.endpoint')}
              />
              <Button
                variant={conn === 'connected' ? 'secondary' : 'primary'}
                onClick={() => void refreshAnki()}
                disabled={conn === 'connecting'}
                icon={conn === 'connecting' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              >
                {conn === 'connected' ? t('cards.reconnect') : t('cards.test')}
              </Button>
            </div>
          </Row>

          <Row label={t('cards.apiKey')}>
            <SecretKeyInput
              stored={mapping.apiKey ?? ''}
              onChange={(v) => setMapping({ ...mapping, apiKey: v })}
              placeholder={t('cards.apiKeyPlaceholder')}
              section="ankiMapping"
              field="apiKey"
            />
          </Row>

          {/* One deck per language: target of new cards, not your vocabulary.
              Profile and level belong to the language, not the deck. */}
          {deckLangs.map((l, i) => {
            const d = deckFor(mapping, l);
            const label = t('cards.deckFor', { lang: t(`lang.${l}`) });
            return (
              <Row
                key={l}
                label={
                  <span className="inline-flex items-center gap-1.5">
                    {label}
                    {i === 0 && <InfoHint text={t('cards.deckLangInfo')} />}
                    {l === episode && l !== activeLang && <Badge tone="indigo">{t('cards.deckThisEpisode')}</Badge>}
                  </span>
                }
              >
                <Select
                  value={d}
                  onChange={(e) => setMapping(withDeck(mapping, l, e.target.value))}
                  disabled={conn !== 'connected'}
                  className="w-full"
                  aria-label={label}
                >
                  {/* Offline: show the saved deck (disabled) instead of a blank
                      trigger. A deck that does not exist yet (another
                      language's default) is listed as new and is created with
                      the first card. */}
                  {conn === 'connected'
                    ? deckOptionsFor(d).map((o) => <option key={o} value={o}>{deckList.includes(o) ? o : t('cards.deckNew', { deck: o })}</option>)
                    : <option value={d}>{d || t('cards.offline')}</option>}
                </Select>
              </Row>
            );
          })}
          <p className="text-[12px] leading-4 text-zinc-500 dark:text-zinc-400" data-deck-hint>
            {deckLangs.length > 1 ? t('cards.deckEpisodeHint', { deck: deckFor(mapping, episode) }) : t('cards.deckLangHint')}{' '}
            <button
              type="button"
              data-open-vocab
              onClick={() => onOpenVocab?.()}
              className={`inline text-[12px] leading-4 font-medium text-indigo-600 dark:text-indigo-400 hover:underline underline-offset-2 rounded-sm ${FOCUS}`}
            >
              {t('cards.toVocab')} ›
            </button>
          </p>

          <Row label={t('cards.noteType')}>
            <Select
              value={mapping.modelName}
              onChange={(e) => setMapping({ ...mapping, modelName: e.target.value, fieldSources: {} })}
              disabled={conn !== 'connected'}
              className="w-full"
            >
              {conn === 'connected'
                ? (models.length ? models : FALLBACK_MODELS).map((n) => <option key={n}>{n}</option>)
                : <option value={mapping.modelName}>{mapping.modelName || t('cards.offline')}</option>}
            </Select>
          </Row>
        </Section>

        {/* Field mapping */}
        <Section
          icon={<Layers size={13} />}
          title={<>{t('cards.mappingTitle')} · <span className="font-normal text-zinc-400 dark:text-zinc-500">{mapping.modelName}</span></>}
          hint={t('cards.mapHint')}
          // The count only with the fields in view (connected): before
          // connecting there is nothing to count.
          headerRight={conn === 'connected' && ankiFields.length > 0 ? (
            <span className="text-[12px] tabular-nums text-zinc-500 dark:text-zinc-400">
              {mappedCount}/{ankiFields.length}
            </span>
          ) : undefined}
        >
          {conn === 'connected' && ankiFields.length > 0 && !allAuto && (
            <div>
              <Button size="sm" variant="soft" onClick={applyAutoPreset} icon={<Wand2 size={14} />}>
                {t('cards.restoreAutoMap')}
              </Button>
            </div>
          )}

          {conn === 'connected' && ankiFields.length > 0 && allAuto && (
            <div className="flex items-center gap-2 text-[12px] text-zinc-500 dark:text-zinc-400">
              <Wand2 size={14} className="text-indigo-500 dark:text-indigo-400" />
              <span>{t('cards.autoMapActive')}</span>
            </div>
          )}

          {conn !== 'connected' && (
            <EmptyState icon={<AlertCircle size={16} />} text={t('cards.connectToSee')} />
          )}

          {conn === 'connected' && ankiFields.length === 0 && (
            <EmptyState icon={<AlertCircle size={16} />} text={t('cards.noFields')} />
          )}

          {conn === 'connected' && ankiFields.length > 3 && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={fieldFilter}
                onChange={(e) => setFieldFilter(e.target.value)}
                placeholder={t('cards.searchFieldPh')}
                aria-label={t('cards.searchFieldPh')}
                className={`${inputCls} flex-1 min-w-0`}
                spellCheck={false}
                autoComplete="off"
              />
              <Button
                variant={onlyUnmapped ? 'soft' : 'secondary'}
                onClick={() => setOnlyUnmapped((v) => !v)}
                aria-pressed={onlyUnmapped}
                title={t('cards.showUnmappedTitle')}
              >
                {t('cards.onlyUnmapped')}
              </Button>
            </div>
          )}

          {conn === 'connected' && ankiFields.length > 0 && visibleFields.length === 0 && (
            <EmptyState icon={<AlertCircle size={16} />} text={t('cards.noFieldMatch')} />
          )}

          {conn === 'connected' && ankiFields.length > 0 && (
            <div className="!py-0 h-px bg-zinc-900/[0.06] dark:bg-white/[0.06] overflow-hidden" aria-hidden>
              <div className="h-full bg-indigo-500 transition-[width] duration-300" style={{ width: `${(mappedCount / ankiFields.length) * 100}%` }} />
            </div>
          )}

          {conn === 'connected' && visibleFields.length > 0 && (
          <div className="!py-0 !pr-0 divide-y divide-zinc-900/[0.06] dark:divide-white/[0.06]">
          {visibleFields.map((field, i) => {
            const src = mapping.fieldSources[field] ?? detectSource(field);
            const meta = SOURCE_META[src] ?? SOURCE_META['manual'];
            const isOpen = editingField === field;
            const auto = src === detectSource(field);
            return (
              <div key={field} className="sl-animate-fade-up" style={{ animationDelay: `${i * 30}ms` }}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setEditingField(isOpen ? null : field)}
                  className="group/f w-full flex items-center gap-2.5 pr-4 min-h-[44px] py-2 outline-none focus-visible:bg-zinc-900/[0.03] dark:focus-visible:bg-white/[0.04]"
                >
                  <span className="flex-1 min-w-0 flex items-center gap-1.5 text-left">
                    <span className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100 leading-[18px] truncate group-hover/f:text-zinc-950 dark:group-hover/f:text-white">
                      {field}
                    </span>
                    {auto && <Wand2 size={12} className="text-zinc-400 dark:text-zinc-500 shrink-0" aria-label={t('cards.autoMapActive')} />}
                  </span>
                  <span className={`shrink-0 max-w-[50%] flex items-center gap-1.5 text-[12px] ${src === 'manual' ? 'text-zinc-400 dark:text-zinc-500' : 'text-zinc-500 dark:text-zinc-400'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${familyDot(src)}`} />
                    <span className="truncate">{t(meta.label)}</span>
                  </span>
                  <ChevronDown size={14} className={`text-zinc-400 dark:text-zinc-500 transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Collapse (shared primitive): when folded it stays `inert`,
                    so Tab does not enter the hidden picker. */}
                <Collapse open={isOpen}>
                    <div className="pr-4 pb-4 space-y-3">
                      <div className="text-[12px] text-zinc-500 dark:text-zinc-400 leading-[17px]">
                        {t(meta.description)}
                      </div>
                      <div className="space-y-3">
                        {SOURCE_GROUPS.map((group) => (
                          <div key={group.label} className="space-y-1.5">
                            <div className="text-[12px] font-medium text-zinc-400 dark:text-zinc-500">
                              {t(group.label)}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {group.options.map((s) => (
                                <button
                                  key={s}
                                  type="button"
                                  aria-pressed={src === s}
                                  onClick={() => setSource(field, s)}
                                  className={`text-[12px] h-7 px-2.5 rounded-lg font-medium kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
                                    src === s
                                      ? 'bg-indigo-500 text-white shadow-[0_1px_2px_rgba(79,70,229,.25)]'
                                      : 'bg-white dark:bg-white/[0.05] ring-1 ring-zinc-900/[0.08] dark:ring-white/[0.07] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/[0.08]'
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
                </Collapse>
              </div>
            );
          })}
          </div>
          )}
        </Section>
      </div>

      {/* Anki preview — docked */}
      {/* With the preview open the rest of the tab stays visible: max height
          and its own scroll. */}
      <div className="border-t border-zinc-900/[0.06] dark:border-white/[0.06] px-4 py-3 shrink-0 max-h-[70%] overflow-y-auto kvl-scroll">
        <div className={`flex items-center justify-between min-h-[32px] ${previewOpen ? 'mb-3' : ''}`}>
          <button
            type="button"
            onClick={() => setPreviewOpen((v) => !v)}
            aria-expanded={previewOpen}
            className={`${ui.title} rounded-md hover:opacity-80 transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40`}
          >
            <IconTile><Layers size={16} /></IconTile> {t('cards.preview')}
            <ChevronDown size={14} className={`!size-3.5 text-zinc-400 transition-transform ${previewOpen ? '' : 'rotate-180'}`} />
          </button>
          {previewOpen && <div className="flex items-center gap-1">
            <SegmentedControl
              ariaLabel={t('cards.preview')}
              size="sm"
              className="w-[156px]"
              options={[{ v: 'front', l: t('cards.front') }, { v: 'back', l: t('cards.back') }]}
              value={previewSide}
              onChange={(v) => setPreviewSide(v)}
            />
            <IconButton
              aria-label={t('cards.flip')}
              onClick={() => setPreviewSide(previewSide === 'front' ? 'back' : 'front')}
              className="transition-all duration-300 hover:rotate-180"
              title={t('cards.flip')}
            >
              <RotateCcw size={14} />
            </IconButton>
          </div>}
        </div>

        {previewOpen && <>
        {/* Flip card — both faces share one grid cell so height follows the
            taller one. `minmax(0,1fr)` + `min-w-0` keep a long text from
            widening the column and pushing the reverse out of view. */}
        <div
          role="button"
          tabIndex={0}
          aria-label={t('cards.flip')}
          onClick={() => setPreviewSide(previewSide === 'front' ? 'back' : 'front')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPreviewSide(previewSide === 'front' ? 'back' : 'front'); } }}
          className="cursor-pointer rounded-2xl [perspective:1200px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
        >
          <div
            className="grid grid-cols-[minmax(0,1fr)] transition-transform duration-500 ease-[cubic-bezier(.2,.8,.2,1)]"
            style={{ transformStyle: 'preserve-3d', transform: previewSide === 'back' ? 'rotateY(180deg)' : 'none' }}
          >
            {(['front', 'back'] as const).map((side) => (
              <div
                key={side}
                aria-hidden={previewSide !== side}
                className="[grid-area:1/1] min-w-0 rounded-2xl bg-white dark:bg-[#12151d] ring-1 ring-zinc-900/[0.06] dark:ring-white/[0.07] shadow-[0_1px_2px_rgba(0,0,0,.04),0_12px_32px_-16px_rgba(0,0,0,.22)] dark:shadow-[0_1px_0_rgba(255,255,255,.04)_inset,0_16px_40px_-20px_rgba(0,0,0,.8)] p-5 flex flex-col justify-center"
                style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: side === 'back' ? 'rotateY(180deg)' : undefined }}
              >
                <CardFace side={side} mapping={mapping} fields={ankiFields} card={mockData} aiOn={aiOn} />
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-3 px-0.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 min-w-0">
            <QualityBadge icon={<Volume2 size={12} />} label={t('cards.sentenceBadge')} detail={endDetect === 'vad' ? t('set.vadLabel') : t('set.cueExact')} title={t('cards.sentenceBadgeTitle')} />
            <QualityBadge icon={<Camera size={12} />} label={t('cards.frameBadge')} detail={t('cards.vadCenter')} />
            <QualityBadge
              icon={<Mic size={12} />}
              label={t('cards.wordBadge')}
              detail={pron.kind === 'human' ? pron.source ?? '' : pron.kind === 'tts' ? t('cards.pronTts') : t('cards.pronNone')}
              title={pron.heldBack ? t('cards.pronHeld') : t('cards.wordBadgeTitle')}
              muted={pron.kind !== 'human'}
            />
          </div>
          {conn === 'connected' && ankiFields.length > 0 && (
            <span className="ml-auto text-[12px] text-zinc-400 dark:text-zinc-500 tabular-nums whitespace-nowrap">
              {mappedCount}/{ankiFields.length}
            </span>
          )}
        </div>
        </>}
      </div>
    </div>
  );
}

/* ---------- shared components ---------- */

function Section({
  icon, title, children, collapsible, open, onToggle, hint, headerRight,
}: {
  icon: React.ReactNode; title: React.ReactNode; children: React.ReactNode;
  collapsible?: boolean; open?: boolean; onToggle?: () => void;
  hint?: React.ReactNode; headerRight?: React.ReactNode;
}) {
  return (
    <Group icon={icon} title={title} hint={hint} collapsible={collapsible} open={open ?? true} onToggle={onToggle} right={headerRight}>
      {children}
    </Group>
  );
}

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[12px] font-medium text-zinc-500 dark:text-zinc-400">{label}</label>
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
    <span className="relative inline-flex w-1.5 h-1.5">
      {state === 'connected' && (
        <span className="absolute inset-0 rounded-full bg-emerald-400/40 animate-ping [animation-duration:2.4s]" />
      )}
      <span className={`relative inline-flex w-1.5 h-1.5 rounded-full ${color}`} />
    </span>
  );
}

function ConnPill({ state }: { state: ConnectionState }) {
  const label =
    state === 'connected'  ? t('cards.connActive') :
    state === 'connecting' ? t('cards.connConnecting') :
    state === 'error'      ? t('cards.offline') :
                             t('cards.connInactive');
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] text-zinc-500 dark:text-zinc-400">
      <ConnDot state={state} />
      {label}
    </span>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="py-7 px-6 text-center text-[12px] leading-[18px] text-zinc-500 dark:text-zinc-400 flex flex-col items-center gap-2.5">
      <IconTile className="!w-8 !h-8">{icon}</IconTile>
      <span className="max-w-[240px]">{text}</span>
    </div>
  );
}

/** `muted`: works, but it is not the best possible (synthetic voice instead
 * of a native recording). */
function QualityBadge({ icon, label, detail, title, muted }: { icon: React.ReactNode; label: string; detail: string; title?: string; muted?: boolean }) {
  return (
    <span title={title} className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] text-zinc-500 dark:text-zinc-400 min-w-0">
      <span className={`${muted ? 'text-zinc-400 dark:text-zinc-500' : 'text-emerald-500 dark:text-emerald-400'} inline-flex`}>{icon}</span>
      <span className="font-medium text-zinc-700 dark:text-zinc-300">{label}</span><span>{detail}</span>
    </span>
  );
}
