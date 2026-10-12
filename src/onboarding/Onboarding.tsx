import React, { useEffect, useState } from 'react';
import { t } from '../shared/i18n';
import {
  STEPS as OB_STEPS,
  DEMO_URL,
  canAdvance as obCanAdvance,
  nextStepId as obNextStepId,
  prevStepId as obPrevStepId,
  type StepId,
} from './steps';

import { WelcomeStep } from './steps/WelcomeStep';
import { AnkiStep } from './steps/AnkiStep';
import { MappingStep } from './steps/MappingStep';
import { AIStep } from './steps/AIStep';
import { DemoStep } from './steps/DemoStep';
import { DoneStep } from './steps/DoneStep';
import { LangStep } from './steps/LangStep';
import { DictStep } from './steps/DictStep';

import { sendMessage } from 'webext-bridge/options';
import { CheckCircle2, ChevronRight, ChevronLeft, Moon, Sun } from 'lucide-react';
import { useKivaraStore } from '../shared/store';
import { autoMapFields } from '../shared/anki-field-detect';
import type { AnkiPingResponse, AnkiListsResponse, AnkiFieldsResponse } from '../shared/types';

/* ─── Stepper config ──────────────────────────────────────────────────────── */


/* ─── Source-badge palette (re-used from CardsTab) ────────────────────────── */


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
    } catch (err) {
      // An unhandled rejection here took the whole onboarding wizard down on a
      // cold Anki: the promise from `sendMessage` was floating, so a failed
      // ping on entry left the user on a broken step with no way back.
      setPing({ status: 'error', error: err instanceof Error ? err.message : 'unknown' });
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
        // FUNCTIONAL update: this runs after an await, and `ankiMapping` was
        // captured when the effect started. Spreading the captured object
        // wrote back every edit the user made in between (deck name, another
        // mapping) — the same trap `CardsTab` avoids by writing `(prev) =>`.
        setAnkiMapping((prev) => ({
          ...prev,
          modelName,
          fieldSources: autoMapFields(r.fields!, prev.fieldSources),
        }));
      } else {
        setFields([]);
      }
    } catch (err) {
      setFields([]);
      setPing({ status: 'error', error: err instanceof Error ? err.message : 'unknown' });
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
    // `done` is terminal. Keeping this guard explicit prevents a future
    // refactor from refreshing completedAt if a terminal CTA is added.
    if (step === 'done') return;
    // steps.ts owns the ordering; the `completed` write stays here because
    // the pure function only returns the id and this is the one side effect
    // that belongs to the root — it IS the onboarding's whole point.
    const n = obNextStepId(step);
    setDirection(1);
    if (n === 'done' && !onboarding.completed) {
      // Last regular step ('demo') → mark complete and slide into 'done'.
      setOnboarding({ completed: true, completedAt: Date.now() });
    }
    setStep(n);
  }

  function prev() {
    const n = obPrevStepId(step);
    // `n === step` means there is nowhere to go: welcome, or done.
    if (n === step) return;
    setDirection(-1);
    setStep(n);
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
  // The lock rules live in steps.ts; the buttons ask that, not a copy.
  const canAdvance = obCanAdvance(step, {
    ping,
    ankiMapping: { deckName: ankiMapping.deckName, modelName: ankiMapping.modelName },
  });

  const stepIndex = OB_STEPS.findIndex((s) => s.id === step);

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
            type="button"
            aria-label={isDarkMode ? 'Tema claro' : 'Tema oscuro'}
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
          {OB_STEPS.map((s, i) => {
            const done = step === 'done' || i < stepIndex;
            const active = i === stepIndex;
            return (
              <React.Fragment key={s.id}>
                <div className="flex items-center gap-2 shrink-0">
                  <div
                    data-testid={`onboarding-step-${s.id}`}
                    data-step-state={done ? 'done' : active ? 'active' : 'pending'}
                    data-step-index={i}
                    aria-current={active ? 'step' : undefined}
                    className={`w-6 h-6 rounded-full flex items-center justify-center transition-all duration-300 ${
                    done
                      ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/40'
                      : active
                        ? 'bg-white dark:bg-zinc-950 ring-2 ring-indigo-500 text-indigo-600 dark:text-indigo-400'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600'
                  }`}
                  >
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
                      <span className="text-[9px] text-zinc-400 dark:text-zinc-600 leading-tight">{t('onb.optionalTag')}</span>
                    )}
                    {s.recommended && (
                      <span className="text-[9px] text-amber-500 dark:text-amber-400 leading-tight">{t('onb.recommendedTag')}</span>
                    )}
                  </div>
                </div>
                {i < OB_STEPS.length - 1 && (
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
          type="button"
          aria-label={t('common.back')}
          data-testid="onboarding-back"
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
                {t('onb.confirmAnki')}</span>
            )}
            {step === 'mapping' && !canAdvance && (
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500 hidden sm:block">
                {t('onb.pickDeckModel')}</span>
            )}
            {(step === 'dict' || step === 'ai') && (
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500 hidden sm:block">
                {step === 'dict'
                  ? t('onb.recommendedLater')
                  : t('onb.optionalStep')}
              </span>
            )}
            <button
              type="button"
              aria-label={step === 'demo' ? t('onb.startAction') : t('onb.nextAction')}
              data-testid="onboarding-next"
              onClick={next}
              disabled={!canAdvance}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md hover:shadow-indigo-500/20 transition-all"
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {step === 'demo' ? t('onb.startAction') : t('onb.nextAction')}
              </span>
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}
