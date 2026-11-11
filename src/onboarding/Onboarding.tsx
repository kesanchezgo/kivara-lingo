/**
 * Onboarding root — the 8-step wizard (F8; docs/REDESIGN-V2.md §5.4, §7 F8).
 *
 * The view is the prototype's (slim stepper, centred step, footer actions);
 * the machine is the repo's. `steps.ts` owns the order and the lock rules, the
 * root only drives them, and the one side effect that belongs here is the
 * `completed` write when the last regular step emits `done`.
 *
 * The Anki state machine keeps the repo's guards: each ping and each field
 * list carries an id so a late reply from a superseded request cannot
 * overwrite a newer one, and only the latest request owns the busy flag.
 */
import React, { useEffect, useRef, useState } from 'react';
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
import { LevelStep } from './steps/LevelStep';
import { MappingStep } from './steps/MappingStep';
import { AIStep } from './steps/AIStep';
import { DemoStep } from './steps/DemoStep';
import { DoneStep } from './steps/DoneStep';
import { LangStep } from './steps/LangStep';
import { DictStep } from './steps/DictStep';

import { sendMessage } from 'webext-bridge/options';
import { CheckCircle2, ChevronRight, ChevronLeft, Moon, Sun } from '../ui/icons';
import { BrandGlyph } from '../ui/BrandGlyph';
import { Badge, Button } from '../ui/primitives/settings-primitives';
import { useKivaraStore } from '../shared/use-kivara-store';
import { autoMapFields } from '../shared/anki-field-detect';
import { deckFor } from '../shared/study/decks';
import { useWordStudy } from '../content/ui/study';
import type { AnkiPingResponse, AnkiListsResponse, AnkiFieldsResponse } from '../shared/types';

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
  /** Last ping request issued, so a late reply from a superseded one is dropped. */
  const pingIdRef = useRef(0);
  /** Last field-list request issued — the same idea, per model switch. */
  const fieldIdRef = useRef(0);
  const fieldQueueId = () => ++fieldIdRef.current;
  const [ping, setPing] = useState<{ status: 'idle' | 'pinging' | 'ok' | 'error'; version?: number; error?: string }>({ status: 'idle' });
  const [decks, setDecks] = useState<string[] | null>(null);
  const [models, setModels] = useState<string[] | null>(null);
  const [fields, setFields] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [deckCreateMode, setDeckCreateMode] = useState(false);
  const [modelCreateMode, setModelCreateMode] = useState(false);

  const sourceLang = translate.sourceLang || 'en';
  const targetLang = translate.targetLanguage || 'es';
  // The Level step's evidence, read through the F5 engine: the gate must
  // follow what was actually written, not a local copy.
  const study = useWordStudy(sourceLang);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
  }, [isDarkMode]);

  const url = ankiMapping.ankiUrl;
  const apiKey = ankiMapping.apiKey;

  async function runPing() {
    // Tag the run so a stale response cannot overwrite a newer one. The user
    // edits the URL while a previous ping is still in flight (Anki cold takes
    // seconds), and two ticks ago that older `.ok` would land on top of the
    // newer attempt's state — the wizard moved on to a connection that no
    // longer matched what was typed.
    const id = pingIdRef.current + 1;
    pingIdRef.current = id;
    setPing({ status: 'pinging' });
    try {
      const r = (await sendMessage('ANKI_PING', { url, apiKey }, 'background')) as AnkiPingResponse;
      if (id !== pingIdRef.current) return; // superseded while waiting
      if (r.ok) {
        setPing({ status: 'ok', version: r.version });
        // Eagerly load decks + models so the next step is ready instantly.
        void loadDecksAndModels(id);
      } else {
        setPing({ status: 'error', error: r.error });
      }
    } catch (err) {
      if (id !== pingIdRef.current) return; // superseded while waiting
      setPing({ status: 'error', error: err instanceof Error ? err.message : 'unknown' });
    }
  }

  async function loadDecksAndModels(afterPingId = pingIdRef.current) {
    setBusy(true);
    try {
      const r = (await sendMessage('ANKI_DECKS', { url, apiKey }, 'background')) as AnkiListsResponse;
      if (afterPingId !== pingIdRef.current) return; // a newer ping owns the state
      if (r.decks) setDecks(r.decks);
      if (r.models) setModels(r.models);
    } catch (err) {
      // An unhandled rejection here took the whole onboarding wizard down on a
      // cold Anki: the promise from `sendMessage` was floating, so a failed
      // ping on entry left the user on a broken step with no way back.
      if (afterPingId !== pingIdRef.current) return;
      setPing({ status: 'error', error: err instanceof Error ? err.message : 'unknown' });
    } finally {
      // Only the LATEST request owns the busy flag: the earlier one used to
      // clear it while the newer one was still running, so the button looked
      // idle while the wrong list was in flight.
      if (afterPingId === pingIdRef.current) setBusy(false);
    }
  }

  async function loadFields(modelName: string, afterQueueId = fieldIdRef.current) {
    const id = fieldQueueId();
    setBusy(true);
    try {
      const r = (await sendMessage('ANKI_FIELDS', { url, apiKey, modelName }, 'background')) as AnkiFieldsResponse;
      // Tagged, like the pings: the user switches model while the field list
      // for the previous one is still in flight, and the stale reply set
      // `modelName` BACK to a model they had already moved away from.
      if (id !== fieldIdRef.current) return;
      if (r.fields?.length) {
        setFields(r.fields);
        // FUNCTIONAL update: this runs after an await, and `ankiMapping` was
        // captured when the effect started. Spreading the captured object
        // wrote back every edit the user made in between — the same trap
        // `CardsTab` avoids with `(prev) =>`.
        setAnkiMapping((prev) => ({
          ...prev,
          modelName,
          fieldSources: autoMapFields(r.fields!, prev.fieldSources),
        }));
      } else {
        setFields([]);
      }
    } catch (err) {
      if (id !== fieldIdRef.current) return;
      setFields([]);
      setPing({ status: 'error', error: err instanceof Error ? err.message : 'unknown' });
    } finally {
      // Only the LATEST queued request owns the busy flag: the earlier one
      // used to clear it while the newer one was still running, so the button
      // looked idle while the wrong field list was being fetched.
      if (id === fieldIdRef.current) setBusy(false);
      void afterQueueId;
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

  // If the persisted deck/model name doesn't appear in the lists, switch into
  // "create" mode so the user's value stays editable. The deck is the one of
  // the language being learned (`mapping.decks[lang]`), not a global one.
  const deck = deckFor(ankiMapping, sourceLang);
  useEffect(() => {
    if (decks && deck && !decks.includes(deck)) {
      setDeckCreateMode(true);
    }
  }, [decks, deck]);
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
    ankiMapping: {
      deckName: ankiMapping.deckName,
      modelName: ankiMapping.modelName,
      decks: ankiMapping.decks,
    },
    lang: sourceLang,
    level: {
      selfLevel: study.profile.selfLevel,
      tested: Boolean(study.profile.vocabTest),
    },
  });

  const stepIndex = OB_STEPS.findIndex((s) => s.id === step);

  return (
    <div
      className={`kvl-ui fixed inset-0 z-[100] flex flex-col ${isDarkMode ? 'dark bg-zinc-950 text-zinc-100' : 'bg-zinc-50 text-zinc-900'}`}
      style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}
    >
      {/* Header — icon-only badge, no separate logo text */}
      <header className="shrink-0 border-b border-zinc-900/[0.06] dark:border-white/[0.06] bg-white dark:bg-zinc-950 px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
            <BrandGlyph size={16} className="text-white" />
          </div>
          <div>
            <div className="text-[15px] font-semibold tracking-[-0.01em] text-zinc-900 dark:text-white leading-5">
              Kivara <span className="text-indigo-500 dark:text-indigo-400">Lingo</span>
            </div>
            <div className="text-[12px] text-zinc-500 leading-tight">{t('onb.configInit')}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => setIsDarkMode(!isDarkMode)}
            aria-label={t('popup.theme', { mode: isDarkMode ? t('popup.theme.light') : t('popup.theme.dark') })}
            title={t('popup.theme', { mode: isDarkMode ? t('popup.theme.light') : t('popup.theme.dark') })}
            icon={isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
            className="!w-8 !px-0"
          />
          <Button variant="ghost" onClick={skipAll} className="duration-150">
            {t('onb.skip')} <ChevronRight size={14} />
          </Button>
        </div>
      </header>

      {/* Stepper */}
      <div className="shrink-0 bg-white dark:bg-zinc-950 border-b border-zinc-900/[0.06] dark:border-white/[0.06]">
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
                    className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors duration-300 ${
                      done
                        ? 'bg-indigo-600 dark:bg-indigo-500 text-white'
                        : active
                          ? 'bg-white dark:bg-zinc-950 ring-2 ring-indigo-500 text-indigo-600 dark:text-indigo-400'
                          : 'bg-zinc-900/[0.05] dark:bg-white/[0.06] text-zinc-500'
                    }`}
                  >
                    {done
                      ? <CheckCircle2 size={12} />
                      : <span className="text-[11px] font-semibold tabular-nums">{i + 1}</span>}
                  </div>
                  <div className={`${active ? 'flex' : 'hidden lg:flex'} items-center gap-1.5 whitespace-nowrap`}>
                    <span className={`text-[12px] font-medium transition-colors leading-tight ${
                      active
                        ? 'text-zinc-900 dark:text-zinc-100'
                        : done
                          ? 'text-indigo-500 dark:text-indigo-400'
                          : 'text-zinc-500'
                    }`}>{t(s.label)}</span>
                    {s.recommended && <Badge tone="amber">{t('onb.recommendedTag')}</Badge>}
                    {s.optional && <Badge>{t('onb.optionalTag')}</Badge>}
                  </div>
                </div>
                {i < OB_STEPS.length - 1 && (
                  <div className={`flex-1 h-px mx-3 transition-colors duration-500 rounded-full ${
                    done ? 'bg-indigo-400 dark:bg-indigo-600' : 'bg-zinc-900/[0.08] dark:bg-white/[0.08]'
                  }`} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Main content (animated step transition) */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden kvl-scroll bg-zinc-50/80 dark:bg-transparent">
        <div key={step} className={direction === 1 ? 'sl-animate-step-fwd' : 'sl-animate-step-back'}>
          <div className="max-w-2xl mx-auto px-6 py-6">
            {step === 'welcome' && <WelcomeStep steps={OB_STEPS.length} />}
            {step === 'lang' && (
              <LangStep
                sourceLang={sourceLang}
                setSourceLang={(v) => setTranslate({ ...translate, sourceLang: v })}
                targetLang={targetLang}
                setTargetLang={(v) => setTranslate({ ...translate, targetLanguage: v })}
              />
            )}
            {step === 'level' && <LevelStep sourceLang={sourceLang} />}
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
                lang={sourceLang}
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
                aiCacheTtlDays={ai.cacheTtlDays}
                setAiCacheTtlDays={(v) => setAi({ ...ai, cacheTtlDays: v })}
              />
            )}
            {step === 'demo' && <DemoStep />}
            {step === 'done' && (
              <DoneStep
                completedAt={onboarding.completedAt}
                onComplete={openDemo}
                sourceLang={sourceLang}
                targetLang={targetLang}
                mapping={ankiMapping}
                aiProvider={ai.provider}
              />
            )}
          </div>
        </div>
      </main>

      {/* Navigation footer */}
      <footer className="shrink-0 border-t border-zinc-900/[0.06] dark:border-white/[0.06] bg-white dark:bg-zinc-950 px-6 h-14 flex items-center justify-between">
        <Button
          variant="secondary"
          aria-label={t('common.back')}
          data-testid="onboarding-back"
          onClick={prev}
          disabled={step === 'welcome' || step === 'done'}
          icon={<ChevronLeft size={14} />}
        >
          {t('common.back')}
        </Button>

        {step !== 'done' && (
          <div className="flex items-center gap-3">
            {step === 'anki' && ping.status !== 'ok' && (
              <span className="text-[12px] text-zinc-400 dark:text-zinc-400 hidden sm:block">
                {t('onb.confirmAnki')}
              </span>
            )}
            {step === 'mapping' && !canAdvance && (
              <span className="text-[12px] text-zinc-400 dark:text-zinc-400 hidden sm:block">
                {t('onb.pickDeckModel')}
              </span>
            )}
            {step === 'level' && !canAdvance && (
              <span className="text-[12px] text-zinc-400 dark:text-zinc-400 hidden sm:block">
                {t('onb.pickLevel')}
              </span>
            )}
            {(step === 'dict' || step === 'ai') && (
              <span className="text-[12px] text-zinc-400 dark:text-zinc-400 hidden sm:block">
                {step === 'dict' ? t('onb.recommendedLater') : t('onb.optionalStep')}
              </span>
            )}
            <Button
              variant="primary"
              aria-label={step === 'demo' ? t('onb.startAction') : t('onb.nextAction')}
              data-testid="onboarding-next"
              onClick={next}
              disabled={!canAdvance}
            >
              {step === 'demo' ? t('onb.startAction') : t('onb.nextAction')}
              <ChevronRight size={14} />
            </Button>
          </div>
        )}
      </footer>
    </div>
  );
}
