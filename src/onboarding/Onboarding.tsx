import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { sendMessage } from 'webext-bridge/options';
import {
  CheckCircle2, AlertTriangle, Loader2, Play, ChevronRight, ChevronLeft,
  ExternalLink, Subtitles, LayoutGrid, Sparkles, Moon, Sun, Wand2,
  Download, ShieldCheck,
} from 'lucide-react';
import { useKivaraStore } from '../shared/store';
import { autoMapFields, detectFieldSource } from '../shared/anki-field-detect';
import { importYomitanPackFromUrl, listYomitanPacks } from '../content/nlp/yomitan';
import {
  CURATED_DICT_PACKS,
  defaultSelection,
  pickPacksToInstall,
  type OnboardingDictPack,
} from './dict-onboarding';
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
  phonetic:         { label: 'Fonética',       color: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300' },
  translation:      { label: 'Traducción',     color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' },
  bilingual:        { label: 'Bilingüe',       color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  monolingual:      { label: 'Monolingüe',     color: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300' },
  examples:         { label: 'Ejemplos',       color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300' },
  frame:            { label: 'Picture',        color: 'bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300' },
  'sentence-audio': { label: 'Sentence audio', color: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' },
  'word-audio':     { label: 'Word audio',     color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300' },
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
      // We DON'T open the demo URL automatically here — the user needs to
      // click "Ir al reproductor" on the success screen so they understand
      // what's about to happen (matches the mock UX exactly).
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
    // Onboarding lives on its own extension tab — closing the window is
    // the natural "skip" action. Falls through if `window.close` is
    // disallowed (e.g. dev preview).
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
            <div className="text-[10px] text-zinc-500 leading-tight">Configuración inicial</div>
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
          <div className="max-w-2xl mx-auto px-6 py-10">
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
                provider={ai.provider}
                setProvider={(v) => setAi({ ...ai, provider: v })}
                apiKey={ai.apiKey}
                setApiKey={(v) => setAi({ ...ai, apiKey: v })}
                model={ai.model}
                setModel={(v) => setAi({ ...ai, model: v })}
                enrichOnSave={ai.enrichOnSave}
                setEnrichOnSave={(v) => setAi({ ...ai, enrichOnSave: v })}
                enrichOnHover={ai.enrichOnHover}
                setEnrichOnHover={(v) => setAi({ ...ai, enrichOnHover: v })}
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
          <span style={{ fontSize: 13 }}>Atrás</span>
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
                  ? 'Recomendado — podés instalar más desde Settings'
                  : 'Paso opcional — puedes configurarlo después en Settings'}
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

/* ─── Step sub-components ─────────────────────────────────────────────────── */

function WelcomeStep() {
  return (
    <StepSection
      title="Bienvenido a Kivara Lingo"
      subtitle="Aprende idiomas mientras ves Netflix, HBO, Disney+, Prime o YouTube. Esta configuración rápida (≈ 1 minuto) dejará todo listo."
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          {
            icon: <Subtitles size={18} />,
            iconBg: 'bg-indigo-500/10 text-indigo-500 dark:bg-indigo-500/15 dark:text-indigo-400',
            title: 'Subtítulos interactivos',
            desc: 'Hover sobre cualquier palabra: traducción, fonética y definición en un clic.',
          },
          {
            icon: <LayoutGrid size={18} />,
            iconBg: 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
            title: 'Tarjetas Anki al instante',
            desc: 'Guarda palabra + frase + frame + audio directamente en tu mazo, sin copiar nada.',
          },
          {
            icon: <Sparkles size={18} />,
            iconBg: 'bg-amber-500/10 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
            title: 'IA opcional',
            desc: 'Enriquece las tarjetas con definiciones contextuales, sinónimos y colocaciones.',
          },
        ].map((f, i) => (
          <div
            key={f.title}
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3 sl-animate-fade-up"
            style={{ animationDelay: `${80 + i * 90}ms` }}
          >
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${f.iconBg}`}>
              {f.icon}
            </div>
            <div>
              <p className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100 leading-snug">{f.title}</p>
              <p className="text-[12px] text-zinc-500 dark:text-zinc-400 leading-relaxed mt-1">{f.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
        <p className="text-[12px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
          Si no tienes Anki instalado, descárgalo en{' '}
          <a className="text-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-300 hover:underline font-medium" href="https://apps.ankiweb.net" target="_blank" rel="noreferrer">
            apps.ankiweb.net
          </a>{' '}
          e instala el complemento <span className="font-semibold text-zinc-700 dark:text-zinc-300">AnkiConnect</span> (código <span className="font-mono text-[11px] bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-600 dark:text-zinc-300">2055492159</span>). Luego vuelve aquí.
        </p>
      </div>
    </StepSection>
  );
}

interface AnkiStepProps {
  mapping: AnkiMapping;
  setMapping: (m: AnkiMapping) => void;
  ping: { status: 'idle' | 'pinging' | 'ok' | 'error'; version?: number; error?: string };
  onRunPing: () => void;
}

function AnkiStep({ mapping, setMapping, ping, onRunPing }: AnkiStepProps) {
  return (
    <StepSection
      title="Conexión con Anki"
      subtitle="AnkiConnect crea una pequeña API local cuando Anki está abierto. La dirección por defecto ya está configurada."
    >
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-4">
        <div className="space-y-1.5">
          <label className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-300 block">URL de AnkiConnect</label>
          <input
            type="text"
            value={mapping.ankiUrl}
            onChange={(e) => setMapping({ ...mapping, ankiUrl: e.target.value })}
            className="sl-input sl-lg w-full"
          />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={onRunPing}
            disabled={ping.status === 'pinging'}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-60 shadow-sm transition-all"
          >
            {ping.status === 'pinging' ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            <span style={{ fontSize: 13, fontWeight: 600 }}>Probar conexión</span>
          </button>

          {ping.status === 'ok' && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/25">
              <span className="relative flex w-2 h-2">
                <span className="absolute inset-0 rounded-full bg-emerald-400/50 animate-ping" style={{ animationDuration: '2s' }} />
                <span className="relative w-2 h-2 rounded-full bg-emerald-500" />
              </span>
              <span className="text-[12px] text-emerald-700 dark:text-emerald-400 font-medium">
                Conectado · AnkiConnect v{ping.version}
              </span>
            </div>
          )}
          {ping.status === 'error' && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/25">
              <AlertTriangle size={13} className="text-rose-500 shrink-0" />
              <span className="text-[12px] text-rose-700 dark:text-rose-400">{ping.error || 'No responde'}</span>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 p-4">
        <p className="text-[12px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
          Si no responde: abre Anki, ve a <span className="font-medium text-zinc-700 dark:text-zinc-300">Tools → Add-ons → AnkiConnect → Config</span> y comprueba que{' '}
          <span className="font-mono text-[11px] bg-white dark:bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300">webBindAddress</span> es{' '}
          <span className="font-mono text-[11px] bg-white dark:bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300">127.0.0.1</span>.
        </p>
      </div>
    </StepSection>
  );
}

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
      subtitle="Elegimos dónde guardar tus tarjetas y cómo Kivara Lingo mapea la información capturada a cada campo."
    >
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800 overflow-hidden">

        {/* Mazo */}
        <div className="p-4 space-y-2">
          <label className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-300 block">Mazo destino</label>
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
            className="text-[12px] text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            {deckCreateMode ? '← Elegir mazo existente' : '+ Crear nuevo mazo'}
          </button>
        </div>

        {/* Modelo */}
        <div className="p-4 space-y-2">
          <label className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-300 block">Modelo de nota</label>
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
          <div className="flex items-center gap-3">
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
              className="text-[12px] text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              {modelCreateMode ? '← Elegir modelo existente' : '+ Usar modelo nuevo'}
            </button>
            {busy && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
                <Loader2 size={11} className="animate-spin" /> cargando campos…
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Field mapping */}
      {fields && fields.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
              Mapeo de campos
            </p>
            <span className="inline-flex items-center gap-1 text-[10px] text-indigo-500 dark:text-indigo-400">
              <Wand2 size={10} /> Auto-detectado
            </span>
          </div>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800">
            {fields.map((field) => {
              const current: FieldSource = mapping.fieldSources[field] ?? 'manual';
              const isAuto = current === detectFieldSource(field);
              const badge = SOURCE_BADGE[current] ?? SOURCE_BADGE['manual']!;
              return (
                <div key={field} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <span className="text-[13px] font-medium text-zinc-800 dark:text-zinc-200 truncate">{field}</span>
                    {isAuto && (
                      <span className="text-[9px] font-medium text-indigo-400 dark:text-indigo-500 shrink-0">auto</span>
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
                    <option value="phonetic">Fonética / IPA</option>
                    <option value="translation">Traducción</option>
                    <option value="bilingual">Bilingüe</option>
                    <option value="monolingual">Monolingüe</option>
                    <option value="examples">Ejemplos</option>
                    <option value="frame">Picture (frame)</option>
                    <option value="sentence-audio">Sentence audio</option>
                    <option value="word-audio">Word audio</option>
                  </select>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed px-0.5">
            Cada campo se detectó automáticamente por su nombre. Puedes cambiar cualquier asignación con el selector a la derecha.
          </p>
        </div>
      )}
    </StepSection>
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
        // The packs section in Settings will surface real errors later.
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
    // Seed every selected pack as 'queued' so the UI shows the full pipeline
    // before the first download starts.
    setStatuses((prev) => {
      const next = { ...prev };
      for (const p of toInstall) next[p.url] = { status: 'queued' };
      return next;
    });
    for (const pack of toInstall) {
      setStatuses((prev) => ({ ...prev, [pack.url]: { status: 'downloading' } }));
      try {
        const result = await importYomitanPackFromUrl(pack.url);
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

  const totalSelectedSize = toInstall.length;

  return (
    <StepSection
      title="Diccionarios offline"
      subtitle="Recomendado — instala los packs marcados para que cada hover devuelva traducción, fonética y ejemplos sin depender de internet."
    >
      <div className="rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/25 p-4 flex gap-3">
        <ShieldCheck size={18} className="text-indigo-500 shrink-0 mt-0.5" />
        <div className="text-[12px] text-indigo-800 dark:text-indigo-200 leading-relaxed space-y-1">
          <p>
            <strong className="font-semibold">Por qué importan:</strong> el diccionario incluido cubre ~4 100 palabras CEFR.
            Los packs Wiktionary suben la cobertura local a ~98% y agregan IPA, ejemplos y categoría gramatical.
          </p>
          <p className="text-indigo-700/80 dark:text-indigo-300/80">
            Todo se guarda en tu navegador (IndexedDB). Puedes modificar la selección luego desde Settings → Diccionarios offline.
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {CURATED_DICT_PACKS.map((pack) => {
          const isInstalled = installedTitles.has(pack.title);
          const status = statuses[pack.url];
          const hasFailed = status?.status === 'error';
          const isDisabled = pack.disabledInOnboarding;
          const checked = !isDisabled && !hasFailed && (selection.has(pack.url) || isInstalled);
          const checkboxDisabled = isInstalled || running || isDisabled || hasFailed;
          const tierBorder =
            pack.tier === 'core'
              ? 'border-amber-300 dark:border-amber-700/60 bg-amber-50/40 dark:bg-amber-900/10'
              : pack.tier === 'premium'
                ? 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
                : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900';
          return (
            <li
              key={pack.url}
              className={`rounded-xl border ${tierBorder} px-4 py-3 flex items-start gap-3 transition-colors ${isDisabled ? 'opacity-60' : ''}`}
            >
              <input
                type="checkbox"
                id={`dict-onb-${pack.url}`}
                checked={checked}
                disabled={checkboxDisabled}
                onChange={() => toggle(pack.url)}
                className="mt-1 accent-indigo-600 cursor-pointer disabled:cursor-not-allowed"
              />
              <label
                htmlFor={`dict-onb-${pack.url}`}
                className="flex-1 min-w-0 cursor-pointer select-none"
              >
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100">
                    {pack.title}
                  </span>
                  <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{pack.size}</span>
                  <span
                    className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                      pack.tier === 'core'
                        ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300'
                        : pack.tier === 'premium'
                          ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                          : 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300'
                    }`}
                  >
                    {pack.benefit}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-snug mt-0.5">
                  {pack.description}
                </p>
                {isDisabled && pack.disabledReason && (
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-500 mt-1 leading-snug">
                    {pack.disabledReason}
                  </p>
                )}
                <DictStepRowStatus
                  isInstalled={isInstalled}
                  installedTermCount={installedTermCounts[pack.title]}
                  status={status}
                />
              </label>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => void installAll()}
          disabled={running || totalSelectedSize === 0}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm hover:shadow-md hover:shadow-indigo-500/20 transition-all"
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          <span className="text-[12px] font-medium">
            {running
              ? 'Instalando…'
              : totalSelectedSize === 0
                ? allDone
                  ? 'Todo listo'
                  : 'Nada seleccionado'
                : `Instalar ${totalSelectedSize} ${totalSelectedSize === 1 ? 'pack' : 'packs'}`}
          </span>
        </button>
        {allDone && totalSelectedSize === 0 && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={13} />
            Los packs marcados ya están instalados.
          </span>
        )}
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

/* ─── AIStep ──────────────────────────────────────────────────────────────── */

interface AIStepProps {
  provider: AiProvider;
  setProvider: (v: AiProvider) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  model: string;
  setModel: (v: string) => void;
  enrichOnSave: boolean;
  setEnrichOnSave: (v: boolean) => void;
  enrichOnHover: boolean;
  setEnrichOnHover: (v: boolean) => void;
  isDarkMode: boolean;
}

function AIStep({
  provider, setProvider, apiKey, setApiKey, model, setModel,
  enrichOnSave, setEnrichOnSave, enrichOnHover, setEnrichOnHover, isDarkMode,
}: AIStepProps) {
  const providers: { value: AiProvider; label: string; badge?: string }[] = [
    { value: 'disabled', label: 'Desactivado', badge: 'omitir' },
    { value: 'openai', label: 'OpenAI', badge: 'GPT-4o' },
    { value: 'anthropic', label: 'Anthropic', badge: 'Claude' },
    { value: 'google-ai', label: 'Google Gemini', badge: 'Gemini' },
  ];

  return (
    <StepSection
      title="Enriquecimiento IA (opcional)"
      subtitle="Si quieres definiciones contextuales, sinónimos y matices generados por IA al guardar tarjetas. Puedes activarlo después en Settings."
    >
      {/* Provider selector */}
      <div className="grid grid-cols-2 gap-2">
        {providers.map((p) => (
          <button
            key={p.value}
            onClick={() => setProvider(p.value)}
            className={`relative flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
              provider === p.value
                ? p.value === 'disabled'
                  ? 'border-zinc-400 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-800'
                  : 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 shadow-sm shadow-indigo-500/10'
                : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700'
            }`}
          >
            <div className="flex-1 min-w-0">
              <p className={`text-[13px] font-semibold leading-tight ${
                provider === p.value && p.value !== 'disabled'
                  ? 'text-indigo-700 dark:text-indigo-300'
                  : 'text-zinc-800 dark:text-zinc-200'
              }`}>{p.label}</p>
              {p.badge && (
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">{p.badge}</p>
              )}
            </div>
            {provider === p.value && (
              <CheckCircle2 size={15} className={p.value === 'disabled' ? 'text-zinc-500' : 'text-indigo-500'} />
            )}
          </button>
        ))}
      </div>

      {provider !== 'disabled' && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800 overflow-hidden">
          <div className="p-4 space-y-1.5">
            <label className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-300 block">API key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={provider === 'openai' ? 'sk-...' : provider === 'anthropic' ? 'sk-ant-...' : 'AIza...'}
              className="sl-input sl-lg w-full"
            />
            {!apiKey && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <AlertTriangle size={11} />
                Sin API key las llamadas IA se omitirán (no bloquea el flujo).
              </p>
            )}
          </div>
          <div className="p-4 space-y-1.5">
            <label className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-300 block">Modelo</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={
                provider === 'openai' ? 'gpt-4o-mini'
                : provider === 'anthropic' ? 'claude-3-5-haiku-latest'
                : 'gemini-1.5-flash'
              }
              className="sl-input sl-lg w-full"
            />
          </div>
          <div className="p-4 space-y-2">
            <ToggleRow
              label="Enriquecer al guardar"
              description="Llama a la IA cada vez que guardas una tarjeta en Anki."
              on={enrichOnSave}
              onChange={setEnrichOnSave}
              isDarkMode={isDarkMode}
            />
          </div>
          <div className="p-4 space-y-2">
            <ToggleRow
              label="Sinónimos en hover"
              description="Muestra colocaciones y sinónimos al hacer hover sobre una palabra."
              on={enrichOnHover}
              onChange={setEnrichOnHover}
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
  return (
    <StepSection
      title="¡Todo listo para probar!"
      subtitle="Al pulsar Empezar abriremos un video corto en YouTube para que veas la extensión en acción."
    >
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/60">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Qué verás
          </p>
        </div>
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {[
            { num: '1', text: 'Subtítulos estilizados superpuestos sobre el reproductor.' },
            { num: '2', text: 'Hover sobre cualquier palabra → popover con traducción y fonética.' },
            { num: '3', text: 'Clic en "Guardar" → nota en Anki con frame + audio capturado.' },
            { num: '4', text: 'Panel lateral listo con el mapeo de campos que acabas de configurar.' },
          ].map((item) => (
            <div key={item.num} className="flex items-start gap-3 px-4 py-3">
              <span
                className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0 mt-0.5"
                style={{ fontSize: 10, fontWeight: 700 }}
              >
                {item.num}
              </span>
              <p className="text-[13px] text-zinc-700 dark:text-zinc-300 leading-relaxed">{item.text}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/25 p-4">
        <p className="text-[12px] text-indigo-700 dark:text-indigo-300 leading-relaxed">
          Para activar la captura de audio del tab (necesaria para "Sentence audio" en las tarjetas), haz clic en el icono de la extensión en la barra del navegador → <span className="font-semibold">Activar captura de audio</span>.
        </p>
      </div>
    </StepSection>
  );
}

/* ─── DoneStep ────────────────────────────────────────────────────────────── */

function DoneStep({ completedAt, onComplete }: { completedAt: number | null; onComplete: () => void }) {
  return (
    <StepSection title="¡Todo listo!" subtitle="">
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
          <p className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">Kivara Lingo está listo</p>
          <p className="text-[13px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
            Para volver a este asistente ve a{' '}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">Settings → Repetir configuración inicial</span>.
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

const ONBOARDING_LANGS = [
  ['en', 'Inglés'],
  ['es', 'Español'],
  ['fr', 'Francés'],
  ['de', 'Alemán'],
  ['it', 'Italiano'],
  ['pt', 'Portugués'],
  ['ja', 'Japonés (日本語)'],
  ['ko', 'Coreano (한국어)'],
  ['zh', 'Chino (中文)'],
] as const;

function LangStep({
  sourceLang, setSourceLang, targetLang, setTargetLang,
}: {
  sourceLang: string; setSourceLang: (v: string) => void;
  targetLang: string; setTargetLang: (v: string) => void;
}) {
  const sameLanguage = sourceLang === targetLang;
  return (
    <StepSection
      title="¿Qué idioma aprendes?"
      subtitle="Configura el par de idiomas. Puedes cambiarlo en cualquier momento desde Settings → Idioma."
    >
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800 overflow-hidden">
        <div className="p-4 space-y-1.5">
          <label className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-300 block">Idioma que aprendo</label>
          <select
            value={sourceLang}
            onChange={(e) => setSourceLang(e.target.value)}
            className="sl-select sl-lg w-full"
          >
            {ONBOARDING_LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="p-4 space-y-1.5">
          <label className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-300 block">Mi idioma nativo</label>
          <select
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value)}
            className="sl-select sl-lg w-full"
          >
            {ONBOARDING_LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      {sameLanguage && (
        <div className="rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 p-4">
          <p className="text-[12px] text-amber-800 dark:text-amber-300 leading-relaxed">
            El idioma de aprendizaje y el nativo son el mismo. Asegúrate de seleccionar idiomas distintos para que las traducciones funcionen correctamente.
          </p>
        </div>
      )}

      <div className="rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 p-4">
        <p className="text-[12px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
          Este par de idiomas controla la dirección de las traducciones en los subtítulos, las tarjetas Anki y el enriquecimiento con IA.
        </p>
      </div>
    </StepSection>
  );
}

/* ─── Shared primitives ───────────────────────────────────────────────────── */

function StepSection({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{title}</h2>
        {subtitle && <p className="text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
      </header>
      <div className="space-y-4">{children}</div>
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
