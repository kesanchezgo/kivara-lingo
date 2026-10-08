import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { t } from '../shared/i18n';
import { sendMessage } from 'webext-bridge/options';
import {
  CheckCircle2, AlertTriangle, Loader2, Play, ChevronRight, ChevronLeft,
  ExternalLink, Subtitles, LayoutGrid, Sparkles, Moon, Sun, Wand2,
  Download, ShieldCheck, ArrowLeftRight, GraduationCap, Languages,
  Plug, Globe, Cpu, BookText, ListChecks, MousePointerClick, Save,
  Mic, Rocket, PlugZap, KeyRound, Brain, Zap, Ban, Keyboard,
} from 'lucide-react';
import { useKivaraStore } from '../shared/store';
import { autoMapFields, detectFieldSource } from '../shared/anki-field-detect';
import { listYomitanPacks } from '../content/nlp/yomitan';
import {
  CURATED_DICT_PACKS,
  defaultSelection,
  pickPacksToInstall,
  type OnboardingDictPack,
} from './dict-onboarding';
import { MODELS_BY_PROVIDER } from '../shared/ai-models';
import { SHORTCUT_DEFS, parseCombo } from '../shared/shortcuts';
import { useShortcuts } from '../app/hooks/useShortcuts';
import { ShortcutEditor } from '../app/components/ShortcutEditor';
import type {
  AiProvider,
  AnkiMapping,
  AnkiPingResponse,
  AnkiListsResponse,
  AnkiFieldsResponse,
  FieldSource,
} from '../shared/types';

/* ─── Stepper config ──────────────────────────────────────────────────────── */

type StepId = 'welcome' | 'lang' | 'anki' | 'mapping' | 'dict' | 'ai' | 'demo' | 'done';

const STEPS: { id: StepId; label: string; optional?: boolean; recommended?: boolean }[] = [
  { id: 'welcome', label: 'Bienvenida' },
  { id: 'lang',    label: 'Idioma' },
  { id: 'anki',    label: 'Anki' },
  { id: 'mapping', label: 'Mapeo' },
  { id: 'dict',    label: 'Diccionarios', recommended: true },
  { id: 'ai',      label: 'IA', optional: true },
  { id: 'demo',    label: 'Demo' },
];

const DEMO_URL = 'https://www.youtube.com/watch?v=arj7oStGLkU';

/* ─── Source-badge palette (re-used from CardsTab) ────────────────────────── */

const SOURCE_BADGE: Partial<Record<FieldSource, { label: string; color: string }>> = {
  selection:        { label: 'Palabra',        color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300' },
  cue:              { label: 'Frase',          color: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300' },
  phonetic:         { label: t('cards.phonetic'),       color: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300' },
  translation:      { label: t('cards.translation'),     color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' },
  bilingual:        { label: 'Bilingüe',       color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  monolingual:      { label: 'Monolingüe',     color: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300' },
  examples:         { label: 'Ejemplos',       color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300' },
  frame:            { label: 'Picture',        color: 'bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300' },
  'sentence-audio': { label: 'Sentence audio', color: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' },
  'word-audio':     { label: 'Word audio',     color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300' },
  synonyms:         { label: t('cards.synonyms'),      color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' },
  antonyms:         { label: t('cards.antonyms'),      color: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300' },
  collocations:     { label: 'Combinaciones',  color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300' },
  etymology:        { label: t('cards.etymology'),     color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  mnemonic:         { label: t('cards.mnemonic'),   color: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300' },
  image:            { label: 'Imagen',         color: 'bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300' },
  'video-link':     { label: 'Video link',     color: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300' },
  'ai-definition':  { label: 'IA def.',        color: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300' },
  'ai-synonyms':    { label: 'IA sin.',        color: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300' },
  'ai-collocations':{ label: 'IA coloc.',      color: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300' },
  'ai-nuance':      { label: 'IA matiz',       color: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300' },
  'ai-register':    { label: 'IA registro',    color: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300' },
  manual:           { label: 'Manual',         color: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' },
};

/* ─── Top-level component ─────────────────────────────────────────────────── */

export function Onboarding() {
  const {
    isDarkMode, setIsDarkMode,
    ankiMapping, setAnkiMapping,
    onboarding, setOnboarding,
    ai, setAi,
    translate, setTranslate,
  } = useKivaraStore();

  const [step, setStep] = useState<StepId>('welcome');
  const [direction, setDirection] = useState<1 | -1>(1);
  const [ping, setPing] = useState<{ status: 'idle' | 'pinging' | 'ok' | 'error'; version?: number; error?: string }>({ status: 'idle' });
  const [decks, setDecks] = useState<string[] | null>(null);
  const [models, setModels] = useState<string[] | null>(null);
  const [fields, setFields] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [deckCreateMode, setDeckCreateMode] = useState(false);
  const [modelCreateMode, setModelCreateMode] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
  }, [isDarkMode]);

  const url = ankiMapping.ankiUrl;
  const apiKey = ankiMapping.apiKey;

  async function runPing() {
    setPing({ status: 'pinging' });
    try {
      const r = (await sendMessage('ANKI_PING', { url, apiKey }, 'background')) as AnkiPingResponse;
      if (r.ok) {
        setPing({ status: 'ok', version: r.version });
        // Eagerly load decks + models so the next step is ready instantly.
        void loadDecksAndModels();
      } else {
        setPing({ status: 'error', error: r.error });
      }
    } catch (err) {
      setPing({ status: 'error', error: err instanceof Error ? err.message : 'unknown' });
    }
  }

  async function loadDecksAndModels() {
    setBusy(true);
    try {
      const r = (await sendMessage('ANKI_DECKS', { url, apiKey }, 'background')) as AnkiListsResponse;
      if (r.decks) setDecks(r.decks);
      if (r.models) setModels(r.models);
    } finally {
      setBusy(false);
    }
  }

  async function loadFields(modelName: string) {
    setBusy(true);
    try {
      const r = (await sendMessage('ANKI_FIELDS', { url, apiKey, modelName }, 'background')) as AnkiFieldsResponse;
      if (r.fields?.length) {
        setFields(r.fields);
        const mapped = autoMapFields(r.fields, ankiMapping.fieldSources);
        setAnkiMapping({ ...ankiMapping, modelName, fieldSources: mapped });
      } else {
        setFields([]);
      }
    } finally {
      setBusy(false);
    }
  }

  // Re-ping when the Anki step opens.
  useEffect(() => {
    if (step === 'anki' && ping.status === 'idle') void runPing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Pull fields the first time the mapping step opens with a known model.
  useEffect(() => {
    if (step === 'mapping' && fields == null && ankiMapping.modelName) {
      void loadFields(ankiMapping.modelName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // If the persisted deck/model name doesn't appear in the lists, switch
  // into "create" mode so the user's value stays editable.
  useEffect(() => {
    if (decks && ankiMapping.deckName && !decks.includes(ankiMapping.deckName)) {
      setDeckCreateMode(true);
    }
  }, [decks, ankiMapping.deckName]);
  useEffect(() => {
    if (models && ankiMapping.modelName && !models.includes(ankiMapping.modelName)) {
      setModelCreateMode(true);
    }
  }, [models, ankiMapping.modelName]);

  function next() {
    const idx = STEPS.findIndex((s) => s.id === step);
    setDirection(1);
    if (idx >= 0 && idx + 1 < STEPS.length) {
      setStep(STEPS[idx + 1].id);
    } else {
      // Last regular step ('demo') → mark complete and slide into 'done'.
      setOnboarding({ completed: true, completedAt: Date.now() });
      setStep('done');
    }
  }

  function prev() {
    const idx = STEPS.findIndex((s) => s.id === step);
    if (idx > 0) {
      setDirection(-1);
      setStep(STEPS[idx - 1].id);
    }
  }

  function openDemo() {
    try {
      chrome.tabs.create({ url: DEMO_URL });
      window.close();
    } catch {
      window.open(DEMO_URL, '_blank', 'noopener');
    }
  }

  function skipAll() {
    setOnboarding({ completed: true, completedAt: Date.now() });
    try {
      window.close();
    } catch {
      /* ignore */
    }
  }

  // Block "Siguiente" until each step's preconditions are met.
  const canAdvance = (() => {
    if (step === 'anki') return ping.status === 'ok';
    if (step === 'mapping') return Boolean(ankiMapping.deckName && ankiMapping.modelName);
    return true;
  })();

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className={`fixed inset-0 z-[100] flex flex-col font-sans ${isDarkMode ? 'dark bg-zinc-950 text-zinc-100' : 'bg-zinc-50 text-zinc-900'}`}
      style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}>

      {/* Header — icon-only badge, no separate logo text */}
      <header className="shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-md px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="6" width="18" height="13" rx="2.5" />
              <line x1="7" y1="12" x2="13" y2="12" />
              <line x1="7" y1="15.5" x2="11" y2="15.5" />
              <circle cx="17.5" cy="14" r="1.2" fill="white" stroke="none" />
            </svg>
          </div>
          <div>
            <div className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100 leading-tight">
              Kivara <span className="text-indigo-500 dark:text-indigo-400">Lingo</span>
            </div>
            <div className="text-[10px] text-zinc-500 leading-tight">{t('onb.configInit')}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            title={isDarkMode ? 'Tema claro' : 'Tema oscuro'}
          >
            {isDarkMode ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button
            onClick={skipAll}
            className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 px-2.5 py-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            Saltar <ChevronRight size={11} />
          </button>
        </div>
      </header>

      {/* Stepper */}
      <div className="shrink-0 bg-white/70 dark:bg-zinc-900/70 backdrop-blur border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-2xl mx-auto px-6 py-3.5 flex items-center">
          {STEPS.map((s, i) => {
            const done = step === 'done' || i < stepIndex;
            const active = i === stepIndex;
            return (
              <React.Fragment key={s.id}>
                <div className="flex items-center gap-2 shrink-0">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center transition-all duration-300 ${
                    done
                      ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/40'
                      : active
                        ? 'bg-white dark:bg-zinc-950 ring-2 ring-indigo-500 text-indigo-600 dark:text-indigo-400'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600'
                  }`}>
                    {done ? <CheckCircle2 size={12} /> : <span style={{ fontSize: 10, fontWeight: 700 }}>{i + 1}</span>}
                  </div>
                  <div className="hidden sm:flex flex-col items-start">
                    <span className={`text-[11px] font-medium transition-colors leading-tight ${
                      active
                        ? 'text-zinc-900 dark:text-zinc-100'
                        : done
                          ? 'text-indigo-500 dark:text-indigo-400'
                          : 'text-zinc-400 dark:text-zinc-600'
                    }`}>{s.label}</span>
                    {s.optional && (
                      <span className="text-[9px] text-zinc-400 dark:text-zinc-600 leading-tight">opcional</span>
                    )}
                    {s.recommended && (
                      <span className="text-[9px] text-amber-500 dark:text-amber-400 leading-tight">recomendado</span>
                    )}
                  </div>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`flex-1 h-px mx-3 transition-all duration-500 rounded-full ${
                    done ? 'bg-indigo-400 dark:bg-indigo-600' : 'bg-zinc-200 dark:bg-zinc-800'
                  }`} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Main content (animated step transition) */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden">
        <div
          key={step}
          className={direction === 1 ? 'sl-animate-step-fwd' : 'sl-animate-step-back'}
        >
          <div className="max-w-2xl mx-auto px-6 py-6">
            {step === 'welcome' && <WelcomeStep />}
            {step === 'lang' && (
              <LangStep
                sourceLang={translate.sourceLang || 'en'}
                setSourceLang={(v) => setTranslate({ ...translate, sourceLang: v })}
                targetLang={translate.targetLanguage || 'es'}
                setTargetLang={(v) => setTranslate({ ...translate, targetLanguage: v })}
              />
            )}
            {step === 'anki' && (
              <AnkiStep
                mapping={ankiMapping}
                setMapping={setAnkiMapping}
                ping={ping}
                onRunPing={() => void runPing()}
              />
            )}
            {step === 'mapping' && (
              <MappingStep
                mapping={ankiMapping}
                setMapping={setAnkiMapping}
                decks={decks}
                models={models}
                fields={fields}
                busy={busy}
                deckCreateMode={deckCreateMode}
                setDeckCreateMode={setDeckCreateMode}
                modelCreateMode={modelCreateMode}
                setModelCreateMode={setModelCreateMode}
                onLoadDecks={() => void loadDecksAndModels()}
                onLoadFields={(m) => void loadFields(m)}
              />
            )}
            {step === 'dict' && <DictStep />}
            {step === 'ai' && (
              <AIStep
                aiProvider={ai.provider}
                setAiProvider={(v) => setAi({ ...ai, provider: v })}
                aiApiKey={ai.apiKey}
                setAiApiKey={(v) => setAi({ ...ai, apiKey: v })}
                aiModel={ai.model}
                setAiModel={(v) => setAi({ ...ai, model: v })}
                aiEnrichOnSave={ai.enrichOnSave}
                setAiEnrichOnSave={(v) => setAi({ ...ai, enrichOnSave: v })}
                aiEnrichOnHover={ai.enrichOnHover}
                setAiEnrichOnHover={(v) => setAi({ ...ai, enrichOnHover: v })}
                isDarkMode={isDarkMode}
              />
            )}
            {step === 'demo' && <DemoStep />}
            {step === 'done' && (
              <DoneStep
                completedAt={onboarding.completedAt}
                onComplete={openDemo}
              />
            )}
          </div>
        </div>
      </main>

      {/* Navigation footer */}
      <footer className="shrink-0 border-t border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-md px-6 h-16 flex items-center justify-between">
        <button
          onClick={prev}
          disabled={step === 'welcome' || step === 'done'}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-30 transition-all"
        >
          <ChevronLeft size={14} />
          <span style={{ fontSize: 13 }}>{t('common.back')}</span>
        </button>

        {step !== 'done' && (
          <div className="flex items-center gap-3">
            {step === 'anki' && ping.status !== 'ok' && (
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500 hidden sm:block">
                Necesitamos confirmar la conexión con AnkiConnect
              </span>
            )}
            {step === 'mapping' && !canAdvance && (
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500 hidden sm:block">
                Elige un mazo y un modelo de notas
              </span>
            )}
            {(step === 'dict' || step === 'ai') && (
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500 hidden sm:block">
                {step === 'dict'
                  ? t('onb.recommendedLater')
                  : t('onb.optionalStep')}
              </span>
            )}
            <button
              onClick={next}
              disabled={!canAdvance}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md hover:shadow-indigo-500/20 transition-all"
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {step === 'demo' ? 'Empezar' : 'Siguiente'}
              </span>
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}

/* ─── WelcomeStep ─────────────────────────────────────────────────────────── */

function WelcomeStep() {
  const features = [
    {
      icon: <Subtitles size={18} />,
      iconBg: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 ring-1 ring-indigo-500/20',
      title: t('onb.interactiveSubs'),
      desc: t('onb.interactiveSubsDesc'),
    },
    {
      icon: <LayoutGrid size={18} />,
      iconBg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-1 ring-emerald-500/20',
      title: 'Tarjetas Anki al instante',
      desc: 'Guarda palabra + frase + frame + audio directamente en tu mazo, sin copiar nada.',
    },
    {
      icon: <Sparkles size={18} />,
      iconBg: 'bg-amber-500/10 text-amber-600 dark:text-amber-300 ring-1 ring-amber-500/20',
      title: 'IA opcional',
      desc: t('onb.enrichDesc'),
    },
  ];

  return (
    <section className="space-y-6">
      {/* Hero — gradient panel with subtitle preview */}
      <div className="relative overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-gradient-to-br from-indigo-50 via-white to-emerald-50/40 dark:from-indigo-500/10 dark:via-zinc-900 dark:to-emerald-500/5 p-6 sm:p-8">
        {/* decorative glow */}
        <div aria-hidden className="pointer-events-none absolute -top-20 -right-16 w-56 h-56 rounded-full bg-indigo-400/15 dark:bg-indigo-500/15 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-20 -left-16 w-56 h-56 rounded-full bg-emerald-400/10 dark:bg-emerald-500/10 blur-3xl" />

        <div className="relative space-y-3">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/70 dark:bg-zinc-900/60 ring-1 ring-zinc-200/80 dark:ring-zinc-700/60 text-[10.5px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-300">
            <Rocket size={10} /> Configuración ≈ 1 min · 7 pasos
          </div>
          <h2 className="text-[26px] sm:text-[28px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 leading-tight">
            Bienvenido a <span className="text-indigo-600 dark:text-indigo-300">Kivara Lingo</span>
          </h2>
          <p className="text-[13.5px] leading-relaxed text-zinc-600 dark:text-zinc-300 max-w-xl">
            Aprende idiomas mientras ves Netflix, HBO, Disney+, Prime o YouTube. Tokeniza los subtítulos en vivo, guarda tarjetas Anki en un clic y sigue tu progreso.
          </p>

          {/* Subtitle preview — non-interactive mock */}
          <div className="mt-4 pt-2">
            <div className="inline-block rounded-md bg-zinc-900/90 dark:bg-black/70 px-3 py-1.5 shadow-lg ring-1 ring-white/10">
              <span className="text-white text-[14px] leading-none">
                <span className="border-b border-dashed border-white/30 px-0.5">I</span>{' '}
                <span className="px-0.5 rounded bg-indigo-600 text-white shadow-[0_2px_8px_rgba(99,102,241,0.45)]">don't</span>{' '}
                <span className="border-b border-dashed border-white/30 px-0.5">travel</span>{' '}
                <span className="text-amber-300 border-b-2 border-dotted border-amber-400 px-0.5">these days</span>
              </span>
            </div>
            <div className="mt-1 text-[10.5px] text-zinc-500 dark:text-zinc-400 italic">
              Vista previa: tokens, MWE y palabras guardadas
            </div>
          </div>
        </div>
      </div>

      {/* Feature tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {features.map((f, i) => (
          <div
            key={f.title}
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3 sl-animate-fade-up hover:shadow-sm hover:border-zinc-300 dark:hover:border-zinc-700 transition-all"
            style={{ animationDelay: `${80 + i * 90}ms` }}
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${f.iconBg}`}>
              {f.icon}
            </div>
            <div>
              <p className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100 leading-snug">{f.title}</p>
              <p className="text-[12px] text-zinc-500 dark:text-zinc-400 leading-relaxed mt-1">{f.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Anki requirement note */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 flex gap-3">
        <div className="w-9 h-9 rounded-lg bg-amber-500/10 ring-1 ring-amber-500/20 text-amber-600 dark:text-amber-300 flex items-center justify-center shrink-0">
          <BookText size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold text-zinc-800 dark:text-zinc-100 leading-snug">¿Sin Anki instalado?</p>
          <p className="text-[12px] text-zinc-500 dark:text-zinc-400 leading-relaxed mt-1">
            Descárgalo en{' '}
            <a className="text-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-300 hover:underline font-medium" href="https://apps.ankiweb.net" target="_blank" rel="noreferrer">
              apps.ankiweb.net
            </a>{' '}
            e instala el complemento <span className="font-semibold text-zinc-700 dark:text-zinc-300">AnkiConnect</span> (código <span className="font-mono text-[11px] bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-600 dark:text-zinc-300">2055492159</span>). Luego vuelve aquí.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ─── AnkiStep ────────────────────────────────────────────────────────────── */

interface AnkiStepProps {
  mapping: AnkiMapping;
  setMapping: (m: AnkiMapping) => void;
  ping: { status: 'idle' | 'pinging' | 'ok' | 'error'; version?: number; error?: string };
  onRunPing: () => void;
}

function AnkiStep({ mapping, setMapping, ping, onRunPing }: AnkiStepProps) {
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
              {isOk ? `Conectado · AnkiConnect v${ping.version}`
                : isErr ? (ping.error || 'No responde')
                  : isBusy ? t('onb.testingConnection')
                    : 'Pendiente de prueba'}
            </span>
          </div>
        </div>
      </div>

      {/* URL + ping action */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-[12px] font-semibold text-zinc-700 dark:text-zinc-300">
            <Plug size={12} className="text-zinc-400" /> URL de AnkiConnect
          </label>
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
              <span style={{ fontSize: 13, fontWeight: 600 }}>Probar</span>
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 p-3 flex gap-2.5">
        <AlertTriangle size={13} className="text-zinc-400 mt-0.5 shrink-0" />
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
          Si no responde: abre Anki, ve a <span className="font-medium text-zinc-700 dark:text-zinc-300">Tools → Add-ons → AnkiConnect → Config</span> y comprueba que{' '}
          <span className="font-mono text-[10px] bg-white dark:bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300">webBindAddress</span> es{' '}
          <span className="font-mono text-[10px] bg-white dark:bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300">127.0.0.1</span>.
        </p>
      </div>
    </StepSection>
  );
}

function ConnNode({ icon, label, sub, tone }: { icon: React.ReactNode; label: string; sub: string; tone: 'indigo' | 'amber' }) {
  const t = tone === 'indigo'
    ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 ring-indigo-500/20'
    : 'bg-amber-500/10 text-amber-600 dark:text-amber-300 ring-amber-500/20';
  return (
    <div className="flex flex-col items-center text-center gap-1.5">
      <div className={`w-12 h-12 rounded-2xl ring-1 flex items-center justify-center ${t}`}>{icon}</div>
      <div>
        <div className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-100 leading-tight">{label}</div>
        <div className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-tight mt-0.5">{sub}</div>
      </div>
    </div>
  );
}

function ConnLink({ busy, ok, err, accentLine }: { busy: boolean; ok: boolean; err: boolean; accentLine: string }) {
  return (
    <div className="relative h-12 w-20 flex items-center justify-center" aria-hidden>
      <div className={`absolute inset-x-0 top-1/2 -translate-y-1/2 h-px ${accentLine} opacity-70`} />
      {busy && (
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px overflow-hidden">
          <div className="h-full w-1/3 bg-white/70 dark:bg-white/40 blur-[1px]" style={{ animation: 'sl-conn-flow 1.2s linear infinite' }} />
        </div>
      )}
      <div className={`relative w-6 h-6 rounded-full flex items-center justify-center bg-white dark:bg-zinc-900 ring-1 ${
        ok ? 'ring-emerald-400 text-emerald-500'
          : err ? 'ring-rose-400 text-rose-500'
            : busy ? 'ring-indigo-400 text-indigo-500'
              : 'ring-zinc-300 dark:ring-zinc-700 text-zinc-400'
      }`}>
        {ok ? <CheckCircle2 size={13} /> : err ? <AlertTriangle size={12} /> : busy ? <Loader2 size={12} className="animate-spin" /> : <PlugZap size={12} />}
      </div>
    </div>
  );
}

/* ─── MappingStep ─────────────────────────────────────────────────────────── */

interface MappingStepProps {
  mapping: AnkiMapping;
  setMapping: (m: AnkiMapping) => void;
  decks: string[] | null;
  models: string[] | null;
  fields: string[] | null;
  busy: boolean;
  deckCreateMode: boolean;
  setDeckCreateMode: (v: boolean) => void;
  modelCreateMode: boolean;
  setModelCreateMode: (v: boolean) => void;
  onLoadDecks: () => void;
  onLoadFields: (m: string) => void;
}

function MappingStep({
  mapping, setMapping, decks, models, fields, busy,
  deckCreateMode, setDeckCreateMode, modelCreateMode, setModelCreateMode,
  onLoadDecks, onLoadFields,
}: MappingStepProps) {
  return (
    <StepSection
      title="Mazo, modelo y campos"
      subtitle={t('onb.deckStepDesc')}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

        {/* Mazo card */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/60 flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-indigo-500/10 ring-1 ring-indigo-500/20 text-indigo-600 dark:text-indigo-300 flex items-center justify-center">
              <LayoutGrid size={12} />
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Mazo destino</span>
            {mapping.deckName && !deckCreateMode && (
              <CheckCircle2 size={12} className="ml-auto text-emerald-500" />
            )}
          </div>
          <div className="p-3 space-y-2">
            <div className="flex gap-2">
              {deckCreateMode ? (
                <input
                  type="text"
                  autoFocus
                  value={mapping.deckName}
                  onChange={(e) => setMapping({ ...mapping, deckName: e.target.value })}
                  placeholder="Nombre del nuevo mazo"
                  className="sl-input sl-lg flex-1"
                />
              ) : (
                <select
                  value={decks?.includes(mapping.deckName) ? mapping.deckName : ''}
                  onChange={(e) => setMapping({ ...mapping, deckName: e.target.value })}
                  disabled={!decks || decks.length === 0}
                  className="sl-select sl-lg flex-1"
                >
                  <option value="">{decks?.length ? '— Selecciona un mazo —' : 'Cargando…'}</option>
                  {(decks ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              )}
              <button
                onClick={onLoadDecks}
                disabled={busy}
                className="h-10 px-3.5 text-[12px] font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors shrink-0"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : 'Refrescar'}
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                if (deckCreateMode) {
                  setDeckCreateMode(false);
                  if (decks && !decks.includes(mapping.deckName)) setMapping({ ...mapping, deckName: '' });
                } else {
                  setDeckCreateMode(true);
                }
              }}
              className="text-[11.5px] text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              {deckCreateMode ? '← Elegir mazo existente' : '+ Crear nuevo mazo'}
            </button>
          </div>
        </div>

        {/* Modelo card */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/60 flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-emerald-500/10 ring-1 ring-emerald-500/20 text-emerald-600 dark:text-emerald-300 flex items-center justify-center">
              <ListChecks size={12} />
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Modelo de nota</span>
            {mapping.modelName && !modelCreateMode && (
              <CheckCircle2 size={12} className="ml-auto text-emerald-500" />
            )}
          </div>
          <div className="p-3 space-y-2">
            {modelCreateMode ? (
              <input
                type="text"
                autoFocus
                value={mapping.modelName}
                onChange={(e) => setMapping({ ...mapping, modelName: e.target.value })}
                placeholder="Nombre del nuevo modelo"
                className="sl-input sl-lg w-full"
              />
            ) : (
              <select
                value={mapping.modelName}
                onChange={(e) => {
                  const m = e.target.value;
                  setMapping({ ...mapping, modelName: m });
                  if (m) onLoadFields(m);
                }}
                disabled={!models || models.length === 0}
                className="sl-select sl-lg w-full"
              >
                <option value="">{models?.length ? '— Selecciona un modelo —' : 'Cargando…'}</option>
                {(models ?? (mapping.modelName ? [mapping.modelName] : [])).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            )}
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  if (modelCreateMode) {
                    setModelCreateMode(false);
                    if (models && !models.includes(mapping.modelName)) setMapping({ ...mapping, modelName: '' });
                  } else {
                    setModelCreateMode(true);
                  }
                }}
                className="text-[11.5px] text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                {modelCreateMode ? '← Elegir existente' : '+ Modelo nuevo'}
              </button>
              {busy && (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
                  <Loader2 size={11} className="animate-spin" /> cargando…
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Field mapping */}
      {fields && fields.length > 0 && (() => {
        const totalMapped = fields.filter((f) => (mapping.fieldSources[f] ?? 'manual') !== 'manual').length;
        const autoCount = fields.filter((f) => (mapping.fieldSources[f] ?? 'manual') === detectFieldSource(f)).length;
        return (
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/60 flex items-center gap-2 flex-wrap">
              <div className="w-6 h-6 rounded-md bg-violet-500/10 ring-1 ring-violet-500/20 text-violet-600 dark:text-violet-300 flex items-center justify-center">
                <Wand2 size={12} />
              </div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Mapeo de campos</span>
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500">·</span>
              <span className="text-[10.5px] text-zinc-500 dark:text-zinc-400">
                {totalMapped}/{fields.length} mapeados
              </span>
              <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/10 px-2 py-0.5 rounded-full ring-1 ring-indigo-500/15">
                <Wand2 size={9} /> {autoCount} auto-detectados
              </span>
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {fields.map((field) => {
                const current: FieldSource = mapping.fieldSources[field] ?? 'manual';
                const isAuto = current === detectFieldSource(field);
                const badge = SOURCE_BADGE[current] ?? SOURCE_BADGE['manual']!;
                const isManual = current === 'manual';
                return (
                  <div key={field} className="flex items-center gap-3 px-4 py-2.5">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isManual ? 'bg-zinc-300 dark:bg-zinc-700' : 'bg-emerald-500'}`} />
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <span className="text-[13px] font-medium text-zinc-800 dark:text-zinc-200 truncate font-mono">{field}</span>
                      {isAuto && !isManual && (
                        <span className="text-[9px] font-semibold text-indigo-500 dark:text-indigo-400 shrink-0 inline-flex items-center gap-0.5">
                          <Wand2 size={8} /> auto
                        </span>
                      )}
                    </div>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0 ${badge.color}`}>
                      {badge.label}
                    </span>
                    <select
                      value={current}
                      onChange={(e) => {
                        const src = e.target.value as FieldSource;
                        const next = { ...mapping.fieldSources };
                        if (src === 'manual') delete next[field];
                        else next[field] = src;
                        setMapping({ ...mapping, fieldSources: next });
                      }}
                      className="sl-select shrink-0"
                      style={{ width: 160 }}
                    >
                      <option value="manual">— No mapear —</option>
                      <option value="selection">Palabra</option>
                      <option value="cue">Frase completa</option>
                      <option value="phonetic">{t('onb.fieldPhonetic')}</option>
                      <option value="translation">{t('cards.translation')}</option>
                      <option value="bilingual">Bilingüe</option>
                      <option value="monolingual">Monolingüe</option>
                      <option value="examples">Ejemplos</option>
                      <option value="frame">Picture (frame)</option>
                      <option value="sentence-audio">Sentence audio</option>
                      <option value="word-audio">Word audio</option>
                      <option value="synonyms">{t('cards.synonyms')}</option>
                      <option value="antonyms">{t('cards.antonyms')}</option>
                      <option value="collocations">Combinaciones</option>
                      <option value="etymology">{t('cards.etymology')}</option>
                      <option value="mnemonic">{t('cards.mnemonic')}</option>
                      <option value="image">Imagen enriquecida</option>
                      <option value="video-link">Video link</option>
                      <option value="ai-definition">{t('cards.aiDefinitionLabel')}</option>
                      <option value="ai-synonyms">{t('cards.aiSynonymsLabel')}</option>
                      <option value="ai-collocations">IA · Colocaciones</option>
                      <option value="ai-nuance">IA · Matiz</option>
                      <option value="ai-register">IA · Registro</option>
                    </select>
                  </div>
                );
              })}
            </div>
            <div className="px-4 py-2.5 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-900/40">
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                Cada campo se detectó automáticamente por su nombre. Cambia cualquier asignación con el selector de la derecha.
              </p>
            </div>
          </div>
        );
      })()}
    </StepSection>
  );
}

/* ─── AIStep ──────────────────────────────────────────────────────────────── */

interface AIStepProps {
  aiProvider: AiProvider;
  setAiProvider: (v: AiProvider) => void;
  aiApiKey: string;
  setAiApiKey: (v: string) => void;
  aiModel: string;
  setAiModel: (v: string) => void;
  aiEnrichOnSave: boolean;
  setAiEnrichOnSave: (v: boolean) => void;
  aiEnrichOnHover: boolean;
  setAiEnrichOnHover: (v: boolean) => void;
  isDarkMode: boolean;
}

function AIStep({
  aiProvider, setAiProvider, aiApiKey, setAiApiKey, aiModel, setAiModel,
  aiEnrichOnSave, setAiEnrichOnSave, aiEnrichOnHover, setAiEnrichOnHover, isDarkMode,
}: AIStepProps) {
  type ProviderTile = {
    value: AiProvider;
    label: string;
    tag: string;
    icon: React.ReactNode;
    tone: 'zinc' | 'emerald' | 'amber' | 'sky';
    defaultModel?: string;
  };
  const providers: ProviderTile[] = [
    { value: 'disabled',  label: 'Sin IA',          tag: 'Solo diccionarios',   icon: <Ban size={18} />,      tone: 'zinc' },
    { value: 'openai',    label: 'OpenAI',          tag: 'GPT-4o mini',         icon: <Sparkles size={18} />, tone: 'emerald', defaultModel: 'gpt-4o-mini' },
    { value: 'anthropic', label: 'Anthropic',       tag: 'Claude Haiku',        icon: <Brain size={18} />,    tone: 'amber',   defaultModel: 'claude-haiku-4-5' },
    { value: 'google-ai', label: 'Google Gemini',   tag: 'Gemini 1.5 Flash',    icon: <Zap size={18} />,      tone: 'sky',     defaultModel: 'gemini-1.5-flash' },
  ];

  const toneClasses: Record<ProviderTile['tone'], { ring: string; bg: string; iconBg: string; iconText: string; label: string }> = {
    zinc:    { ring: 'ring-zinc-400/60 dark:ring-zinc-500/60',     bg: 'bg-zinc-50 dark:bg-zinc-800/40',         iconBg: 'bg-zinc-100 dark:bg-zinc-800',         iconText: 'text-zinc-500 dark:text-zinc-400',     label: 'text-zinc-700 dark:text-zinc-200' },
    emerald: { ring: 'ring-emerald-500/70 dark:ring-emerald-400/70', bg: 'bg-emerald-50 dark:bg-emerald-500/10', iconBg: 'bg-emerald-500/10',                    iconText: 'text-emerald-600 dark:text-emerald-300', label: 'text-emerald-700 dark:text-emerald-300' },
    amber:   { ring: 'ring-amber-500/70 dark:ring-amber-400/70',   bg: 'bg-amber-50 dark:bg-amber-500/10',       iconBg: 'bg-amber-500/10',                      iconText: 'text-amber-600 dark:text-amber-300',   label: 'text-amber-700 dark:text-amber-300' },
    sky:     { ring: 'ring-sky-500/70 dark:ring-sky-400/70',       bg: 'bg-sky-50 dark:bg-sky-500/10',           iconBg: 'bg-sky-500/10',                        iconText: 'text-sky-600 dark:text-sky-300',       label: 'text-sky-700 dark:text-sky-300' },
  };

  const placeholderFor = (p: AiProvider) =>
    p === 'openai' ? 'sk-...' : p === 'anthropic' ? 'sk-ant-...' : 'AIza...';

  return (
    <StepSection
      title="Enriquecimiento IA (opcional)"
      subtitle={t('onb.aiStepDesc')}
    >
      {/* Provider tiles */}
      <div className="grid grid-cols-2 gap-2.5">
        {providers.map((p) => {
          const active = aiProvider === p.value;
          const t = toneClasses[p.tone];
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => {
                setAiProvider(p.value);
                if (p.defaultModel && !aiModel) setAiModel(p.defaultModel);
              }}
              className={[
                'group relative flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all active:scale-[0.99]',
                active
                  ? `border-transparent ring-2 ${t.ring} ${t.bg} shadow-sm`
                  : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-sm',
              ].join(' ')}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${t.iconBg} ${t.iconText}`}>
                {p.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-[13px] font-semibold leading-tight ${active ? t.label : 'text-zinc-800 dark:text-zinc-100'}`}>{p.label}</p>
                <p className="text-[10.5px] text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">{p.tag}</p>
              </div>
              {active && (
                <CheckCircle2 size={15} className={`shrink-0 ${t.iconText}`} />
              )}
            </button>
          );
        })}
      </div>

      {aiProvider !== 'disabled' && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800 overflow-hidden">
          <div className="p-4 space-y-1.5">
            <label className="flex items-center gap-1.5 text-[12px] font-semibold text-zinc-700 dark:text-zinc-300">
              <KeyRound size={12} className="text-zinc-400" /> API key
            </label>
            <input
              type="password"
              value={aiApiKey}
              onChange={(e) => setAiApiKey(e.target.value)}
              placeholder={placeholderFor(aiProvider)}
              className="sl-input sl-lg w-full font-mono"
            />
            {!aiApiKey && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <AlertTriangle size={11} />
                Sin API key las llamadas IA se omitirán (no bloquea el flujo).
              </p>
            )}
          </div>
          <div className="p-4 space-y-1.5">
            <label className="flex items-center gap-1.5 text-[12px] font-semibold text-zinc-700 dark:text-zinc-300">
              <Cpu size={12} className="text-zinc-400" /> Modelo
            </label>
            {(() => {
              const opts = MODELS_BY_PROVIDER[aiProvider as Exclude<AiProvider, 'disabled'>] ?? [];
              const currentInList = opts.some((m) => m.value === aiModel);
              return (
                <>
                  <select
                    value={currentInList ? aiModel : ''}
                    onChange={(e) => setAiModel(e.target.value)}
                    className="sl-select sl-lg w-full font-mono"
                  >
                    <option value="">— Selecciona un modelo —</option>
                    {opts.map((m) => (
                      <option key={m.value} value={m.value}>{m.label} · {m.tag}</option>
                    ))}
                  </select>
                  {aiModel && (
                    <p className="text-[10.5px] text-zinc-500 dark:text-zinc-400 leading-snug pt-0.5">
                      {opts.find((m) => m.value === aiModel)?.tag ?? 'Modelo personalizado'}
                    </p>
                  )}
                </>
              );
            })()}
          </div>
          <div className="p-4">
            <ToggleRow
              label="Enriquecer al guardar"
              description="Llama a la IA cada vez que guardas una tarjeta en Anki."
              on={aiEnrichOnSave}
              onChange={setAiEnrichOnSave}
              isDarkMode={isDarkMode}
            />
          </div>
          <div className="p-4">
            <ToggleRow
              label={t('onb.synonymsOnHover')}
              description={t('onb.synonymsOnHoverDesc')}
              on={aiEnrichOnHover}
              onChange={setAiEnrichOnHover}
              isDarkMode={isDarkMode}
            />
          </div>
        </div>
      )}

      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed px-0.5">
        Las respuestas se cachean en IndexedDB con TTL configurable para no hacer llamadas duplicadas. Puedes cambiar el proveedor en <span className="font-medium text-zinc-700 dark:text-zinc-300">Settings → IA premium</span> cuando quieras.
      </p>
    </StepSection>
  );
}

/* ─── DemoStep ────────────────────────────────────────────────────────────── */

function DemoStep() {
  const items = [
    { icon: <Subtitles size={16} />,         text: t('onb.styledSubs'),                tone: 'indigo' as const },
    { icon: <MousePointerClick size={16} />, text: t('onb.hoverPopover'),       tone: 'sky' as const },
    { icon: <Save size={16} />,              text: 'Clic en "Guardar" → nota en Anki con frame + audio capturado.',            tone: 'emerald' as const },
    { icon: <LayoutGrid size={16} />,        text: 'Panel lateral listo con el mapeo de campos que acabas de configurar.',     tone: 'amber' as const },
  ];
  const toneMap = {
    indigo:  'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 ring-indigo-500/20',
    sky:     'bg-sky-500/10 text-sky-600 dark:text-sky-300 ring-sky-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-emerald-500/20',
    amber:   'bg-amber-500/10 text-amber-600 dark:text-amber-300 ring-amber-500/20',
  };
  return (
    <StepSection
      title={t('onb.allSetToTry')}
      subtitle={t('onb.allSetToTryDesc')}
    >
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/60 flex items-center gap-2">
          <Rocket size={13} className="text-indigo-500" />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Qué verás
          </p>
        </div>
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {items.map((item, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-3">
              <div className={`w-8 h-8 rounded-lg ring-1 flex items-center justify-center shrink-0 ${toneMap[item.tone]}`}>
                {item.icon}
              </div>
              <p className="text-[13px] text-zinc-700 dark:text-zinc-300 leading-relaxed mt-1">{item.text}</p>
            </div>
          ))}
        </div>
      </div>

      <ShortcutsPreview />

      <div className="rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/25 p-4 flex gap-3">
        <Mic size={16} className="text-indigo-500 shrink-0 mt-0.5" />
        <p className="text-[12px] text-indigo-700 dark:text-indigo-300 leading-relaxed">
          Para activar la captura de audio del tab (necesaria para "Sentence audio" en las tarjetas), haz clic en el icono de la extensión en la barra del navegador → <span className="font-semibold">Activar captura de audio</span>.
        </p>
      </div>
    </StepSection>
  );
}

function ShortcutsPreview() {
  const [customize, setCustomize] = useState(false);
  const { map } = useShortcuts();

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/60 flex items-center gap-2">
        <Keyboard size={12} className="text-zinc-500 dark:text-zinc-400" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 flex-1">
          Atajos de teclado
        </p>
        <button
          type="button"
          onClick={() => setCustomize((v) => !v)}
          className="text-[10px] font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors shrink-0 normal-case tracking-normal"
        >
          {customize ? 'Ver defaults' : 'Personalizar'}
        </button>
      </div>

      {!customize ? (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {SHORTCUT_DEFS.map((s) => {
            const combo = map[s.id] ?? s.defaultCombo;
            const keys = combo ? parseCombo(combo) : [];
            return (
              <div key={s.id} className="flex items-center justify-between gap-2 px-4 py-1.5">
                <span className="text-[11.5px] text-zinc-600 dark:text-zinc-400 truncate">{s.label}</span>
                <span className="flex items-center gap-0.5 shrink-0">
                  {keys.length === 0 ? (
                    <span className="text-[10px] text-zinc-400 italic">—</span>
                  ) : keys.map((k, i) => (
                    <React.Fragment key={`${k}-${i}`}>
                      {i > 0 && <span className="text-zinc-400 dark:text-zinc-600 text-[9px] mx-0.5">+</span>}
                      <kbd className="font-sans text-[10px] text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800/70 border border-zinc-200 dark:border-zinc-700 rounded px-1.5 py-px">
                        {k}
                      </kbd>
                    </React.Fragment>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="px-2 py-1.5">
          <ShortcutEditor compact />
        </div>
      )}
    </div>
  );
}

/* ─── DoneStep ────────────────────────────────────────────────────────────── */

function DoneStep({ completedAt, onComplete }: { completedAt: number | null; onComplete: () => void }) {
  return (
    <StepSection title={t('onb.allSet')} subtitle="">
      <div className="flex flex-col items-center gap-8 py-8">
        <div className="relative">
          <div
            className="absolute inset-0 rounded-full animate-pulse"
            style={{ background: 'radial-gradient(circle, rgba(74,222,128,0.25) 0%, transparent 70%)' }}
          />
          <div className="relative w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-500/15 ring-4 ring-emerald-200 dark:ring-emerald-500/30 ring-offset-2 ring-offset-white dark:ring-offset-zinc-950 flex items-center justify-center sl-animate-celebrate">
            <CheckCircle2 size={36} className="text-emerald-600 dark:text-emerald-400" />
          </div>
        </div>

        <div className="text-center space-y-2 max-w-sm">
          <p className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">{t('onb.readyTitle')}</p>
          <p className="text-[13px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
            Para volver a este asistente ve a{' '}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">{t('onb.repeatInit')}</span>.
          </p>
          {completedAt && (
            <p className="text-[10px] text-zinc-400 dark:text-zinc-600">
              Completado el {new Date(completedAt).toLocaleString()}
            </p>
          )}
        </div>

        <button
          onClick={onComplete}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm hover:shadow-md hover:shadow-indigo-500/25 transition-all"
        >
          <span style={{ fontSize: 14, fontWeight: 600 }}>Ir al reproductor</span>
          <ExternalLink size={14} />
        </button>
      </div>
    </StepSection>
  );
}

/* ─── LangStep ────────────────────────────────────────────────────────────── */

type LangMeta = { code: string; name: string; native: string; flag: string };

const ONBOARDING_LANGS: LangMeta[] = [
  { code: 'en', name: t('lang.en'),     native: 'English',    flag: '🇬🇧' },
  { code: 'es', name: t('lang.es'),    native: 'Español',    flag: '🇪🇸' },
  { code: 'fr', name: t('lang.fr'),    native: 'Français',   flag: '🇫🇷' },
  { code: 'de', name: t('lang.de'),     native: 'Deutsch',    flag: '🇩🇪' },
  { code: 'it', name: t('lang.it'),   native: 'Italiano',   flag: '🇮🇹' },
  { code: 'pt', name: t('lang.pt'),  native: 'Português',  flag: '🇵🇹' },
  { code: 'ja', name: t('lang.ja'),    native: '日本語',      flag: '🇯🇵' },
  { code: 'ko', name: t('lang.ko'),    native: '한국어',       flag: '🇰🇷' },
  { code: 'zh', name: t('lang.zh'),      native: '中文',        flag: '🇨🇳' },
];

function getLang(code: string): LangMeta {
  return ONBOARDING_LANGS.find((l) => l.code === code) ?? ONBOARDING_LANGS[0];
}

function LangStep({
  sourceLang, setSourceLang, targetLang, setTargetLang,
}: {
  sourceLang: string; setSourceLang: (v: string) => void;
  targetLang: string; setTargetLang: (v: string) => void;
}) {
  const [activeSlot, setActiveSlot] = useState<'source' | 'target'>('source');
  const sameLanguage = sourceLang === targetLang;
  const learning = getLang(sourceLang);
  const native = getLang(targetLang);

  const swap = () => {
    const a = sourceLang, b = targetLang;
    setSourceLang(b);
    setTargetLang(a);
  };

  const pickLang = (code: string) => {
    if (activeSlot === 'source') {
      // If user picks the same code as the other slot, auto-swap to avoid duplicate
      if (code === targetLang) setTargetLang(sourceLang);
      setSourceLang(code);
      setActiveSlot('target');
    } else {
      if (code === sourceLang) setSourceLang(targetLang);
      setTargetLang(code);
      setActiveSlot('source');
    }
  };

  return (
    <StepSection
      title={t('onb.whatLanguage')}
      subtitle="Configura el par de idiomas. Puedes cambiarlo en cualquier momento desde Settings → Idioma."
    >
      {/* Pair display: Aprendo ↔ Nativo */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
        <SlotCard
          icon={<GraduationCap size={13} />}
          label="Aprendo"
          lang={learning}
          active={activeSlot === 'source'}
          accent="indigo"
          onClick={() => setActiveSlot('source')}
        />
        <button
          type="button"
          onClick={swap}
          title="Intercambiar idiomas"
          className="self-center w-9 h-9 rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-300 hover:border-indigo-300 dark:hover:border-indigo-500/50 hover:shadow-md hover:shadow-indigo-500/10 transition-all flex items-center justify-center active:scale-95"
        >
          <ArrowLeftRight size={14} />
        </button>
        <SlotCard
          icon={<Languages size={13} />}
          label="Nativo"
          lang={native}
          active={activeSlot === 'target'}
          accent="emerald"
          onClick={() => setActiveSlot('target')}
        />
      </div>

      {/* Helper line: which slot is being edited */}
      <div className="flex items-center justify-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
        <span>Selecciona el idioma que</span>
        <span className={`font-semibold ${activeSlot === 'source' ? 'text-indigo-600 dark:text-indigo-300' : 'text-emerald-600 dark:text-emerald-300'}`}>
          {activeSlot === 'source' ? 'aprendes' : 'ya hablas'}
        </span>
      </div>

      {/* Language grid */}
      <div className="grid grid-cols-3 gap-2">
        {ONBOARDING_LANGS.map((l) => {
          const isLearning = l.code === sourceLang;
          const isNative = l.code === targetLang;
          const isActiveSelection =
            (activeSlot === 'source' && isLearning) || (activeSlot === 'target' && isNative);
          const accentRing = activeSlot === 'source'
            ? 'ring-indigo-500/70 dark:ring-indigo-400/70 bg-indigo-50 dark:bg-indigo-500/10'
            : 'ring-emerald-500/70 dark:ring-emerald-400/70 bg-emerald-50 dark:bg-emerald-500/10';
          return (
            <button
              key={l.code}
              type="button"
              onClick={() => pickLang(l.code)}
              className={[
                'group relative flex flex-col items-center justify-center gap-1 py-3 px-2 rounded-xl border transition-all duration-150 active:scale-[0.98]',
                isActiveSelection
                  ? `border-transparent ring-2 ${accentRing} shadow-sm`
                  : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-sm',
              ].join(' ')}
            >
              {/* Role badges in the corner — quietly show both assignments */}
              <div className="absolute top-1.5 right-1.5 flex gap-0.5">
                {isLearning && (
                  <span title="Aprendo" className="w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-sm">
                    <GraduationCap size={9} strokeWidth={2.5} />
                  </span>
                )}
                {isNative && (
                  <span title="Nativo" className="w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-sm">
                    <Languages size={9} strokeWidth={2.5} />
                  </span>
                )}
              </div>
              <span className="text-2xl leading-none select-none" aria-hidden>{l.flag}</span>
              <span className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-100 leading-tight">{l.name}</span>
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-tight">{l.native}</span>
            </button>
          );
        })}
      </div>

      {sameLanguage && (
        <div className="rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 p-3 flex items-start gap-2">
          <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <p className="text-[12px] text-amber-800 dark:text-amber-300 leading-relaxed">
            El idioma de aprendizaje y el nativo son el mismo. Elige idiomas distintos para que las traducciones funcionen correctamente.
          </p>
        </div>
      )}

      <div className="rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 p-3">
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
          Este par controla la dirección de las traducciones en los subtítulos, las tarjetas Anki y el enriquecimiento con IA.
        </p>
      </div>
    </StepSection>
  );
}

function SlotCard({
  icon, label, lang, active, accent, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  lang: LangMeta;
  active: boolean;
  accent: 'indigo' | 'emerald';
  onClick: () => void;
}) {
  const accentClasses = active
    ? accent === 'indigo'
      ? 'border-transparent ring-2 ring-indigo-500/70 dark:ring-indigo-400/70 bg-indigo-50/70 dark:bg-indigo-500/10'
      : 'border-transparent ring-2 ring-emerald-500/70 dark:ring-emerald-400/70 bg-emerald-50/70 dark:bg-emerald-500/10'
    : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700';
  const labelColor = accent === 'indigo'
    ? 'text-indigo-700 dark:text-indigo-300'
    : 'text-emerald-700 dark:text-emerald-300';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-xl border p-3 transition-all ${accentClasses}`}
    >
      <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${labelColor}`}>
        {icon}<span>{label}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2.5">
        <span className="text-2xl leading-none select-none" aria-hidden>{lang.flag}</span>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-50 leading-tight truncate">{lang.name}</div>
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-tight truncate">{lang.native}</div>
        </div>
      </div>
    </button>
  );
}

/* ─── DictStep — real Yomitan importer wired to the curated catalogue ────── */

type InstallStatus = 'idle' | 'queued' | 'downloading' | 'installed' | 'error';

interface InstallState {
  status: InstallStatus;
  /** Populated on `error` so the user can see why a pack failed. */
  error?: string;
  /** Populated on `installed` so we can surface the term count next to the title. */
  termsImported?: number;
}

function DictStep() {
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
            <strong className="font-semibold">Cobertura local ~98%</strong> con los packs Wiktionary, frente a ~4 100 palabras CEFR del diccionario incluido.
          </p>
          <p className="text-[11.5px] text-indigo-700/80 dark:text-indigo-200/70">
            Todo se guarda en tu navegador (IndexedDB). Puedes modificar la selección luego desde Settings → Diccionarios offline.
          </p>
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
                ? allDone ? t('onb.allPacksInstalled') : 'Selecciona al menos un pack para continuar'
                : `${toInstall.length} ${toInstall.length === 1 ? 'pack listo' : 'packs listos'} para instalar`}
          </p>
          <p className="text-[10.5px] text-zinc-500 dark:text-zinc-400 leading-tight mt-0.5">
            {running ? 'Se ejecuta secuencialmente para evitar saturar el navegador.' : 'Puedes saltarte este paso e instalarlos luego desde Settings.'}
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
        Compatible con cualquier diccionario en formato Yomitan o StarDict.
        Encuentra más packs y opciones avanzadas en{' '}
        <span className="font-medium text-zinc-600 dark:text-zinc-300">Settings → Diccionarios offline</span>.
      </p>
    </StepSection>
  );
}

interface DictStepRowStatusProps {
  isInstalled: boolean;
  installedTermCount?: number;
  status: InstallState | undefined;
}

function DictStepRowStatus({ isInstalled, installedTermCount, status }: DictStepRowStatusProps) {
  if (status?.status === 'installed') {
    return (
      <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 inline-flex items-center gap-1">
        <CheckCircle2 size={12} />
        Instalado · {(status.termsImported ?? 0).toLocaleString()} términos
      </p>
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
        {status.error || 'Error inesperado'}
      </p>
    );
  }
  if (isInstalled) {
    const count = installedTermCount ? ` · ${installedTermCount.toLocaleString()} términos` : '';
    return (
      <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 inline-flex items-center gap-1">
        <CheckCircle2 size={12} />
        Ya instalado{count}
      </p>
    );
  }
  return null;
}

/* ─── Shared primitives ───────────────────────────────────────────────────── */

function StepSection({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <header className="space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{title}</h2>
        {subtitle && <p className="text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function ToggleRow({
  label, description, on, onChange, isDarkMode,
}: {
  label: string; description?: string; on: boolean; onChange: (v: boolean) => void; isDarkMode: boolean;
}) {
  const bgOn = isDarkMode ? '#6366f1' : '#4f46e5';
  const bgOff = isDarkMode ? '#3f3f46' : '#d4d4d8';
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-zinc-800 dark:text-zinc-200 leading-snug">{label}</p>
        {description && (
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug mt-0.5">{description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onChange(!on)}
        style={{
          position: 'relative', flexShrink: 0, width: 36, height: 20,
          borderRadius: 9999, backgroundColor: on ? bgOn : bgOff,
          transition: 'background-color 150ms', border: 'none', cursor: 'pointer', padding: 0,
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: 2, width: 16, height: 16,
          borderRadius: 9999, backgroundColor: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
          transition: 'transform 200ms',
          transform: on ? 'translateX(16px)' : 'translateX(0)',
        }} />
      </button>
    </div>
  );
}
