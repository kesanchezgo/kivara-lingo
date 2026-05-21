import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sendMessage } from 'webext-bridge/content-script';
import {
  Keyboard, EyeOff, ChevronDown, ChevronRight, Wand2,
  SlidersHorizontal, BookOpen, Languages, Volume2, Sparkles, Mic2,
  Globe, Zap, ExternalLink, CheckCircle2, AlertTriangle, Loader2, Eye, KeyRound,
} from 'lucide-react';
import { useKivaraStore } from '../../../shared/store';
import type { PremiumTtsProvider, TranslateProvider, AiEnrichResponse } from '../../../shared/types';
import {
  AI_PRESETS,
  getAiPreset,
  pickModelForProvider,
  type ConfigurableAiProvider,
} from '../../../shared/ai-presets';
import {
  WHISPER_MODEL_PRESETS,
  type WhisperModelKey,
} from '../../../shared/whisper-presets';
import { DictPacksSection } from './DictPacksSection';

/**
 * Settings tab — restructured per the design mock:
 *
 *  - "Acceso rápido" QuickRow strip at the top (autoMode, modo lectura,
 *    subtítulo bilingüe). These are the toggles users flip most often.
 *  - "Captura avanzada" only appears when autoMode is OFF.
 *  - Idioma is its own always-visible card (you can't translate without
 *    knowing source/target).
 *  - Everything else (Traducción, Diccionarios, IA, TTS, ASR, Limpieza,
 *    Sincronización, Atajos) collapses into Accordions with a compact
 *    summary line so the panel feels far less crowded by default.
 *
 * All wiring still goes through `useKivaraStore` — this is purely a UI
 * reshuffle.
 */
export function SettingsTab() {
  const {
    capture, setCapture, cleanup, setCleanup, mode, setMode,
    translate, setTranslate, asr, setAsr, ai, setAi, tts, setTts,
  } = useKivaraStore();

  // Sub-section open/closed state. Each accordion key is a stable string
  // — the dictionary packs section is special-cased because it ships its
  // own header.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  const isOpen = (id: string) => !!open[id];

  // Flatten store paths to local handlers so the JSX stays readable.
  const autoMode = capture.autoMode;
  const setAutoMode = (v: boolean) => setCapture({ ...capture, autoMode: v });
  const audioSource = capture.audioSource;
  const setAudioSource = (v: typeof capture.audioSource) => setCapture({ ...capture, audioSource: v });
  const frameMoment = capture.frameMoment;
  const setFrameMoment = (v: typeof capture.frameMoment) => setCapture({ ...capture, frameMoment: v });
  const endDetect = capture.endDetect;
  const setEndDetect = (v: typeof capture.endDetect) => setCapture({ ...capture, endDetect: v });
  const bufferSize = capture.bufferSize;
  const setBufferSize = (v: number) => setCapture({ ...capture, bufferSize: v });
  const hideUI = cleanup.hideUI;
  const setHideUI = (v: boolean) => setCleanup({ ...cleanup, hideUI: v });
  const hideShadows = cleanup.hideShadows;
  const setHideShadows = (v: boolean) => setCleanup({ ...cleanup, hideShadows: v });
  const readingMode = mode === 'reading';
  const setReadingMode = (v: boolean) => setMode(v ? 'reading' : 'learning');

  /* ── Language label table ──────────────────────────────────────────── */
  const LANGS: Array<[string, string]> = [
    ['en', 'Inglés'], ['es', 'Español'], ['fr', 'Francés'], ['de', 'Alemán'],
    ['it', 'Italiano'], ['pt', 'Portugués'], ['ja', 'Japonés (日本語)'],
    ['ko', 'Coreano (한국어)'], ['zh', 'Chino (中文)'],
  ];

  function reopenOnboarding() {
    try {
      // Service worker opens the onboarding page in a fresh tab — the
      // content script can't call chrome.tabs directly.
      chrome.runtime.sendMessage({
        type: 'OPEN_URL',
        url: chrome.runtime.getURL('src/onboarding/index.html'),
      });
    } catch {
      window.open(chrome.runtime.getURL('src/onboarding/index.html'), '_blank');
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-y-auto">
      <div className="p-3 pb-6 space-y-2">

        {/* ── Quick bar — always visible ───────────────────────────────── */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="px-2.5 py-1.5 border-b border-zinc-100 dark:border-zinc-800/60 bg-zinc-50/60 dark:bg-zinc-900/60">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              <Zap size={9} /> Acceso rápido
            </span>
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            <QuickRow label="Captura automática" hint={autoMode ? 'VAD · 30s' : 'manual'}>
              <Toggle on={autoMode} onChange={setAutoMode} />
            </QuickRow>
            <QuickRow label="Modo lectura" hint={readingMode ? 'sin popovers' : 'aprendizaje'}>
              <Toggle on={readingMode} onChange={setReadingMode} />
            </QuickRow>
            <QuickRow label="Subtítulo bilingüe" hint={translate.showDualSubtitle ? 'visible' : 'oculto'}>
              <Toggle
                on={translate.showDualSubtitle}
                onChange={(v) => setTranslate({ ...translate, showDualSubtitle: v })}
              />
            </QuickRow>
          </div>
        </div>

        {/* ── Captura avanzada — only when modo manual is selected ─────── */}
        {!autoMode && (
          <Accordion
            icon={<Wand2 size={10} />}
            title="Captura avanzada"
            summary={`${audioSource} · ${bufferSize}s`}
            open={isOpen('capture')}
            onToggle={() => toggle('capture')}
          >
            <Row label="Fuente audio">
              <SegmentedControl
                options={[{ v: 'tab', l: 'Pestaña' }, { v: 'mic', l: 'Mic' }]}
                value={audioSource}
                onChange={setAudioSource}
              />
            </Row>
            <Row label="Buffer rolling" value={`${bufferSize}s`}>
              <input
                type="range" min={10} max={60} step={5} value={bufferSize}
                onChange={(e) => setBufferSize(Number(e.target.value))}
                className="sl-range w-full"
              />
            </Row>
            <Row label="Fin de frase">
              <SegmentedControl
                options={[{ v: 'vad', l: 'VAD' }, { v: 'cue', l: 'Cue exacto' }]}
                value={endDetect}
                onChange={setEndDetect}
              />
            </Row>
            <Row label="Momento del frame">
              <SegmentedControl
                options={[
                  { v: 'start', l: 'Inicio' },
                  { v: 'center', l: 'Centro' },
                  { v: 'end', l: 'Final' },
                ]}
                value={frameMoment}
                onChange={setFrameMoment}
              />
            </Row>
          </Accordion>
        )}

        {/* ── Idioma — always visible (paired source / target) ─────────── */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="px-2.5 py-1.5 border-b border-zinc-100 dark:border-zinc-800/60 bg-zinc-50/60 dark:bg-zinc-900/60">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              <Globe size={9} /> Idioma
            </span>
          </div>
          <div className="p-2.5 grid grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <label className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 block">Aprendo</label>
              <select
                value={translate.sourceLang || 'en'}
                onChange={(e) => setTranslate({ ...translate, sourceLang: e.target.value })}
                className="sl-select w-full"
              >
                {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="space-y-0.5">
              <label className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 block">Mi idioma</label>
              <select
                value={translate.targetLanguage || 'es'}
                onChange={(e) => setTranslate({ ...translate, targetLanguage: e.target.value })}
                className="sl-select w-full"
              >
                {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* ── Traducción ─────────────────────────────────────────────── */}
        <Accordion
          icon={<Languages size={10} />}
          title="Traducción"
          summary={
            translate.mode === 'chain'
              ? `cadena · ${translate.tiersEnabled.free ? 'free' : ''}${translate.tiersEnabled.free && translate.tiersEnabled.premium ? '+' : ''}${translate.tiersEnabled.premium ? 'premium' : ''}`
              : translate.provider
          }
          open={isOpen('translate')}
          onToggle={() => toggle('translate')}
        >
          <Row label="Modo">
            <SegmentedControl
              options={[{ v: 'chain', l: 'Cadena' }, { v: 'single', l: 'Único' }]}
              value={translate.mode}
              onChange={(v) => setTranslate({ ...translate, mode: v as 'chain' | 'single' })}
            />
          </Row>

          {translate.mode === 'chain' && (
            <>
              <Row label="Nivel free (MyMemory, Lingva)">
                <Toggle
                  on={translate.tiersEnabled.free}
                  onChange={(v) =>
                    setTranslate({
                      ...translate,
                      tiersEnabled: { ...translate.tiersEnabled, free: v },
                    })
                  }
                />
              </Row>
              <Row label="Nivel premium (DeepL, Google…)">
                <Toggle
                  on={translate.tiersEnabled.premium}
                  onChange={(v) =>
                    setTranslate({
                      ...translate,
                      tiersEnabled: { ...translate.tiersEnabled, premium: v },
                    })
                  }
                />
              </Row>
            </>
          )}
          {translate.mode === 'single' && (
            <Row label="Proveedor">
              <select
                value={translate.provider}
                onChange={(e) => setTranslate({ ...translate, provider: e.target.value as TranslateProvider })}
                className="sl-select w-full"
              >
                <option value="offline">Offline (diccionario local)</option>
                <option value="mymemory">MyMemory (free)</option>
                <option value="lingva">Lingva (free)</option>
                <option value="libretranslate">LibreTranslate</option>
                <option value="deepl">DeepL</option>
                <option value="google">Google Cloud Translate</option>
              </select>
            </Row>
          )}

          {/* Nested API tokens accordion */}
          <NestedAccordion
            title="Tokens de API"
            open={isOpen('translate-tokens')}
            onToggle={() => toggle('translate-tokens')}
          >
            <Row label="MyMemory email (opcional)">
              <input
                type="email"
                value={translate.myMemoryEmail}
                onChange={(e) => setTranslate({ ...translate, myMemoryEmail: e.target.value })}
                placeholder="you@example.com"
                className="sl-input w-full"
              />
            </Row>
            <Row label="Lingva URL">
              <input
                type="text"
                value={translate.lingvaUrl}
                onChange={(e) => setTranslate({ ...translate, lingvaUrl: e.target.value })}
                placeholder="https://lingva.thedaviddelta.com"
                className="sl-input sl-mono w-full"
              />
            </Row>
            <Row label="DeepL API key">
              <input
                type="password"
                value={translate.deeplToken}
                onChange={(e) => setTranslate({ ...translate, deeplToken: e.target.value })}
                placeholder="xxxxxxxx:fx"
                className="sl-input sl-mono w-full"
              />
            </Row>
            <Row label="Google Cloud API key">
              <input
                type="password"
                value={translate.googleToken}
                onChange={(e) => setTranslate({ ...translate, googleToken: e.target.value })}
                placeholder="AIza..."
                className="sl-input sl-mono w-full"
              />
            </Row>
            <Row label="LibreTranslate URL">
              <input
                type="text"
                value={translate.libreTranslateUrl}
                onChange={(e) => setTranslate({ ...translate, libreTranslateUrl: e.target.value })}
                placeholder="https://libretranslate.com"
                className="sl-input sl-mono w-full"
              />
            </Row>
            <Row label="LibreTranslate key">
              <input
                type="password"
                value={translate.libreTranslateToken}
                onChange={(e) => setTranslate({ ...translate, libreTranslateToken: e.target.value })}
                placeholder="(vacío para instancias públicas)"
                className="sl-input w-full"
              />
            </Row>
          </NestedAccordion>

          <Row label="Caché" value={`${translate.cacheTtlDays}d`}>
            <input
              type="range" min={1} max={90} step={1} value={translate.cacheTtlDays}
              onChange={(e) => setTranslate({ ...translate, cacheTtlDays: Number(e.target.value) })}
              className="sl-range w-full"
            />
          </Row>
        </Accordion>

        {/* ── Diccionarios offline ───────────────────────────────────── */}
        <Accordion
          icon={<BookOpen size={10} />}
          title="Diccionarios offline"
          summary="yomitan"
          open={isOpen('dict')}
          onToggle={() => toggle('dict')}
          noPadding
        >
          <DictPacksSection />
        </Accordion>

        {/* ── IA premium ─────────────────────────────────────────────── */}
        <Accordion
          icon={<Sparkles size={10} />}
          title="IA premium"
          summary={
            ai.provider === 'disabled'
              ? 'desactivada'
              : ai.apiKey
                ? `${getAiPreset(ai.provider)?.label ?? ai.provider}`
                : `${getAiPreset(ai.provider)?.label ?? ai.provider} · sin key`
          }
          summaryColor={ai.provider !== 'disabled' && ai.apiKey ? 'text-indigo-500 dark:text-indigo-400' : undefined}
          open={isOpen('ai')}
          onToggle={() => toggle('ai')}
        >
          <AiByokSection />
        </Accordion>

        {/* ── TTS premium ────────────────────────────────────────────── */}
        <Accordion
          icon={<Mic2 size={10} />}
          title="TTS premium"
          summary={tts.provider === 'disabled' ? 'desactivado' : tts.provider}
          summaryColor={tts.provider !== 'disabled' ? 'text-indigo-500 dark:text-indigo-400' : undefined}
          open={isOpen('tts')}
          onToggle={() => toggle('tts')}
        >
          <Row label="Proveedor">
            <select
              value={tts.provider}
              onChange={(e) => setTts({ ...tts, provider: e.target.value as PremiumTtsProvider })}
              className="sl-select w-full"
            >
              <option value="auto">Auto (ElevenLabs ▸ OpenAI ▸ template)</option>
              <option value="elevenlabs">ElevenLabs</option>
              <option value="openai">OpenAI tts-1</option>
              <option value="disabled">Desactivado (sólo template)</option>
            </select>
          </Row>
          {(tts.provider === 'auto' || tts.provider === 'elevenlabs') && (
            <>
              <Row label="ElevenLabs · API key">
                <input
                  type="password"
                  value={tts.elevenLabsApiKey}
                  onChange={(e) => setTts({ ...tts, elevenLabsApiKey: e.target.value })}
                  placeholder="xi-..."
                  className="sl-input w-full"
                />
              </Row>
              <Row label="ElevenLabs · Voice ID">
                <input
                  type="text"
                  value={tts.elevenLabsVoiceId}
                  onChange={(e) => setTts({ ...tts, elevenLabsVoiceId: e.target.value.trim() })}
                  placeholder="21m00Tcm4TlvDq8ikWAM (Rachel)"
                  className="sl-input w-full"
                />
              </Row>
              <Row label="ElevenLabs · Modelo">
                <select
                  value={tts.elevenLabsModelId}
                  onChange={(e) => setTts({ ...tts, elevenLabsModelId: e.target.value })}
                  className="sl-select w-full"
                >
                  <option value="eleven_multilingual_v2">eleven_multilingual_v2 (29 idiomas)</option>
                  <option value="eleven_turbo_v2_5">eleven_turbo_v2_5 (más barato)</option>
                  <option value="eleven_monolingual_v1">eleven_monolingual_v1 (solo EN)</option>
                </select>
              </Row>
            </>
          )}
        </Accordion>

        {/* ── Whisper ASR (on-device) ────────────────────────────────── */}
        <Accordion
          icon={<Volume2 size={10} />}
          title="Transcripción on-device"
          summary={asr.enabled ? asr.model : 'desactivada'}
          summaryColor={asr.enabled ? 'text-indigo-500 dark:text-indigo-400' : undefined}
          open={isOpen('asr')}
          onToggle={() => toggle('asr')}
        >
          <Row label="Habilitar Whisper ASR">
            <Toggle on={asr.enabled} onChange={(v) => setAsr({ ...asr, enabled: v })} />
          </Row>
          {asr.enabled && (
            <>
              <Row label="Modelo">
                <select
                  value={asr.model}
                  onChange={(e) => {
                    const next = e.target.value as WhisperModelKey;
                    setAsr({
                      ...asr,
                      model: next,
                      modelUrl: WHISPER_MODEL_PRESETS[next].url,
                    });
                  }}
                  className="sl-select w-full"
                >
                  {(Object.entries(WHISPER_MODEL_PRESETS) as Array<[
                    WhisperModelKey,
                    (typeof WHISPER_MODEL_PRESETS)[WhisperModelKey],
                  ]>).map(([key, preset]) => (
                    <option key={key} value={key}>{preset.label}</option>
                  ))}
                </select>
              </Row>
              <Row label="Glue URL (whisper.js)">
                <input
                  type="text"
                  value={asr.glueUrl ?? ''}
                  onChange={(e) => setAsr({ ...asr, glueUrl: e.target.value.trim() || undefined })}
                  placeholder="https://tu-cdn.com/whisper.js"
                  className="sl-input sl-mono w-full"
                />
              </Row>
              <Row label="Modelo URL (override)">
                <input
                  type="text"
                  value={asr.modelUrl ?? ''}
                  onChange={(e) => setAsr({ ...asr, modelUrl: e.target.value.trim() || undefined })}
                  placeholder={WHISPER_MODEL_PRESETS[asr.model].url}
                  className="sl-input sl-mono w-full"
                />
              </Row>
              <WhisperModelProgress modelKey={asr.model} />
            </>
          )}
          <p className="text-[10px] text-zinc-500 dark:text-zinc-500 leading-snug">
            Whisper.cpp vía WebAssembly (sin GPU). <strong>Tiny</strong> recomendado para portátiles; <strong>Base</strong> para escritorios.
          </p>
        </Accordion>

        {/* ── Limpieza visual ────────────────────────────────────────── */}
        <Accordion
          icon={<EyeOff size={10} />}
          title="Limpieza visual"
          summary={`UI ${hideUI ? 'off' : 'on'} · sombras ${hideShadows ? 'off' : 'on'}`}
          open={isOpen('cleanup')}
          onToggle={() => toggle('cleanup')}
        >
          <Row label="Ocultar UI del player">
            <Toggle on={hideUI} onChange={setHideUI} />
          </Row>
          <Row label="Sin sombras / gradientes">
            <Toggle on={hideShadows} onChange={setHideShadows} />
          </Row>
        </Accordion>

        {/* ── Sincronización fina ────────────────────────────────────── */}
        <Accordion
          icon={<SlidersHorizontal size={10} />}
          title="Sincronización fina"
          summary="pre/post roll"
          open={isOpen('sync')}
          onToggle={() => toggle('sync')}
        >
          <CompactSlider label="Pre-roll"    defaultValue={300}  max={1500} unit="ms" />
          <CompactSlider label="Post-roll"   defaultValue={400}  max={1500} unit="ms" />
          <CompactSlider label="Fusión cues" defaultValue={300}  max={1000} unit="ms" />
        </Accordion>

        {/* ── Atajos ─────────────────────────────────────────────────── */}
        <Accordion
          icon={<Keyboard size={10} />}
          title="Atajos de teclado"
          summary="Ctrl+S · Alt+C · Alt+R"
          open={isOpen('keys')}
          onToggle={() => toggle('keys')}
        >
          <div className="-my-0.5">
            {[
              { l: 'Guardar tarjeta',         keys: ['Ctrl', 'S'] },
              { l: 'Toggle subtítulos',        keys: ['Alt', 'C'] },
              { l: 'Repetir frase',            keys: ['Alt', 'R'] },
              { l: 'Re-capturar frame',        keys: ['Alt', 'V'] },
              { l: 'Abrir / cerrar panel',     keys: ['Alt', 'K'] },
              { l: 'Separar expresión',        keys: ['Scroll', 'hover'] },
            ].map((s) => (
              <div key={s.l} className="flex items-center justify-between py-1 text-[11px]">
                <span className="text-zinc-600 dark:text-zinc-400">{s.l}</span>
                <span className="flex items-center gap-0.5">
                  {s.keys.map((k, i) => (
                    <React.Fragment key={k}>
                      {i > 0 && <span className="text-zinc-400 dark:text-zinc-600 text-[9px] mx-0.5">+</span>}
                      <kbd className="font-sans text-[10px] text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800/70 border border-zinc-200 dark:border-zinc-700 rounded px-1.5 py-px">
                        {k}
                      </kbd>
                    </React.Fragment>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </Accordion>

        {/* ── Repetir configuración inicial ─────────────────────────── */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-2.5">
          <button
            type="button"
            onClick={reopenOnboarding}
            className="w-full flex items-center justify-center gap-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50/60 dark:hover:bg-indigo-500/10 py-1.5 rounded-md transition-colors"
          >
            Repetir configuración inicial
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── AiByokSection ───────────────────────────────────────────────────── */

type AiTestStatus =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'ok'; provider: string; latencyMs: number; cached: boolean }
  | { state: 'error'; error: string };

/**
 * BYOK ("bring your own key") panel for the AI premium accordion.
 *
 * Three-card layout that surfaces each supported provider as a clickable
 * preset (Gemini · Claude · OpenAI). Selecting a card switches
 * `ai.provider`, fills in the recommended model id, and reveals the key
 * input + a "Probar conexión" button that fires a real `AI_ENRICH` against
 * the user's key. The kept-everywhere advanced toggles (hover / save /
 * cache) live below in a compact row so users who already configured the
 * provider can flip them without scrolling.
 */
function AiByokSection() {
  const ai = useKivaraStore((s) => s.ai);
  const setAi = useKivaraStore((s) => s.setAi);
  const translate = useKivaraStore((s) => s.translate);

  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<AiTestStatus>({ state: 'idle' });
  const activePreset = useMemo(() => getAiPreset(ai.provider), [ai.provider]);

  /**
   * Auto-validation guards. We track the last-validated triplet so the
   * debounced effect doesn't re-fire on unrelated re-renders, and we hold a
   * timer ref so successive keystrokes coalesce into a single network call.
   */
  const lastValidatedKey = useRef<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildValidationKey = useCallback(
    () => `${ai.provider}|${ai.model}|${ai.apiKey}`,
    [ai.provider, ai.model, ai.apiKey],
  );

  function selectPreset(provider: ConfigurableAiProvider) {
    const preset = getAiPreset(provider);
    if (!preset) return;
    lastValidatedKey.current = null;
    setTest({ state: 'idle' });
    setAi({
      ...ai,
      provider,
      model: pickModelForProvider(provider, ai.model),
    });
  }

  function disable() {
    lastValidatedKey.current = null;
    setTest({ state: 'idle' });
    setAi({ ...ai, provider: 'disabled' });
  }

  const runTest = useCallback(async () => {
    if (ai.provider === 'disabled' || !ai.apiKey.trim()) return;
    const validationKey = `${ai.provider}|${ai.model}|${ai.apiKey}`;
    setTest({ state: 'testing' });
    try {
      const response = (await sendMessage(
        'AI_ENRICH',
        {
          token: 'hello',
          sentence: 'Hello, how are you today?',
          sourceLang: translate.sourceLang || 'en',
          nativeLang: ai.nativeLanguage || translate.targetLanguage || 'es',
          platform: 'settings-byok-test',
        },
        'background',
      )) as AiEnrichResponse;
      if (response.ok) {
        lastValidatedKey.current = validationKey;
        setTest({
          state: 'ok',
          provider: response.data.provider,
          latencyMs: response.data.latencyMs,
          cached: response.data.cached,
        });
      } else {
        // Cache the error fingerprint too — we don't want to spam the
        // provider with the same bad key on every re-render.
        lastValidatedKey.current = validationKey;
        setTest({ state: 'error', error: response.error });
      }
    } catch (err) {
      setTest({
        state: 'error',
        error: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }, [ai.apiKey, ai.model, ai.nativeLanguage, ai.provider, translate.sourceLang, translate.targetLanguage]);

  /**
   * Debounced auto-validation: 600 ms after the user stops typing the key
   * (or switching the provider / model), fire a real `AI_ENRICH` to confirm
   * the credential works. The same `lastValidatedKey` ref shields us from
   * re-firing when the result already lives in state.
   */
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    if (ai.provider === 'disabled' || !ai.apiKey.trim()) {
      if (test.state !== 'idle') setTest({ state: 'idle' });
      return;
    }
    const key = buildValidationKey();
    if (key === lastValidatedKey.current) return;
    debounceTimer.current = setTimeout(() => {
      void runTest();
    }, 600);
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
    };
    // We intentionally exclude `test.state` from deps — including it would
    // re-arm the timer every time the test transitions, defeating the
    // debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai.provider, ai.apiKey, ai.model, buildValidationKey, runTest]);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug">
        Trae tu propia API key para enriquecer las tarjetas con definiciones contextuales,
        sinónimos, colocaciones y registro. <span className="font-medium text-zinc-700 dark:text-zinc-300">Tu key vive solo en tu navegador</span> — nunca se sube a un servidor nuestro.
      </p>

      <ul className="grid grid-cols-1 gap-1.5">
        {AI_PRESETS.map((preset) => {
          const selected = ai.provider === preset.provider;
          return (
            <li
              key={preset.provider}
              className={`rounded border px-2 py-1.5 transition-colors ${
                selected
                  ? 'border-indigo-400 dark:border-indigo-600/70 bg-indigo-50/60 dark:bg-indigo-500/10'
                  : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => selectPreset(preset.provider)}
                  className="flex-1 min-w-0 text-left flex items-center gap-2"
                >
                  <span
                    className={`shrink-0 w-3.5 h-3.5 rounded-full border-2 transition-colors ${
                      selected
                        ? 'border-indigo-500 dark:border-indigo-400 bg-indigo-500'
                        : 'border-zinc-300 dark:border-zinc-700'
                    }`}
                    aria-hidden="true"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5 flex-wrap">
                      <span className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-100 normal-case">
                        {preset.label}
                      </span>
                      {preset.recommended && (
                        <span className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                          Recomendado
                        </span>
                      )}
                      {preset.hasFreeTier && (
                        <span className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                          Gratis
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-500 dark:text-zinc-400 normal-case leading-snug">
                      {preset.tagline}
                    </div>
                    <div className="text-[10px] text-zinc-400 dark:text-zinc-500 normal-case">
                      {preset.pricingNote}
                    </div>
                  </div>
                </button>
                <a
                  href={preset.getKeyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 inline-flex items-center gap-1 text-[10px] px-1.5 py-1 rounded border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  title={`Abrir ${preset.getKeyUrl}`}
                >
                  Obtener key
                  <ExternalLink size={9} />
                </a>
              </div>
            </li>
          );
        })}
      </ul>

      {activePreset ? (
        <div className="space-y-2">
          <Row
            label={
              <span className="inline-flex items-center gap-1.5">
                <KeyRound size={10} className="text-zinc-400" />
                API key · {activePreset.label}
              </span>
            }
          >
            <div className="flex items-center gap-1.5">
              <input
                type={showKey ? 'text' : 'password'}
                value={ai.apiKey}
                onChange={(e) => setAi({ ...ai, apiKey: e.target.value })}
                placeholder={
                  activePreset.provider === 'openai'
                    ? 'sk-...'
                    : activePreset.provider === 'anthropic'
                      ? 'sk-ant-...'
                      : 'AIza...'
                }
                className="sl-input flex-1"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="p-1.5 rounded border border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                title={showKey ? 'Ocultar' : 'Mostrar'}
                aria-label={showKey ? 'Ocultar API key' : 'Mostrar API key'}
              >
                {showKey ? <EyeOff size={11} /> : <Eye size={11} />}
              </button>
            </div>
          </Row>
          <Row label="Modelo">
            <input
              type="text"
              value={ai.model}
              onChange={(e) => setAi({ ...ai, model: e.target.value })}
              placeholder={activePreset.defaultModel}
              className="sl-input w-full"
              spellCheck={false}
            />
          </Row>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => void runTest()}
              disabled={!ai.apiKey.trim() || test.state === 'testing'}
              className="text-[11px] inline-flex items-center gap-1.5 px-2 py-1 rounded border border-indigo-300 dark:border-indigo-700/60 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {test.state === 'testing' ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Zap size={11} />
              )}
              {test.state === 'testing' ? 'Probando…' : 'Probar conexión'}
            </button>
            <button
              type="button"
              onClick={disable}
              className="text-[10px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 underline-offset-2 hover:underline"
            >
              Desactivar IA
            </button>
            {test.state === 'idle' && ai.apiKey.trim() && (
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                Se valida automáticamente al pegar la key.
              </span>
            )}
            {test.state === 'ok' && (
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 size={11} />
                {test.cached ? 'Cache hit (la key no se validó)' : `${test.provider} respondió en ${test.latencyMs} ms`}
              </span>
            )}
            {test.state === 'error' && (
              <span className="inline-flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400">
                <AlertTriangle size={11} />
                {test.error}
              </span>
            )}
          </div>

          <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40 p-2 space-y-1.5">
            <Row label="Enriquecer al guardar">
              <Toggle on={ai.enrichOnSave} onChange={(v) => setAi({ ...ai, enrichOnSave: v })} />
            </Row>
            <Row label="Enriquecer en hover">
              <Toggle on={ai.enrichOnHover} onChange={(v) => setAi({ ...ai, enrichOnHover: v })} />
            </Row>
            <Row label="Idioma nativo (override)">
              <input
                type="text"
                value={ai.nativeLanguage ?? ''}
                onChange={(e) => setAi({ ...ai, nativeLanguage: e.target.value.trim() || undefined })}
                placeholder={`auto (${translate.targetLanguage})`}
                className="sl-input w-full"
              />
            </Row>
            <Row label="Caché" value={`${ai.cacheTtlDays}d`}>
              <input
                type="range"
                min={1}
                max={90}
                step={1}
                value={ai.cacheTtlDays}
                onChange={(e) => setAi({ ...ai, cacheTtlDays: Number(e.target.value) })}
                className="sl-range w-full"
              />
            </Row>
          </div>

          {!ai.apiKey.trim() && (
            <p className="text-[10px] text-rose-600 dark:text-rose-400 leading-snug">
              Falta la API key — las llamadas IA se omitirán hasta que la añadas.
            </p>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug">
          Elige un proveedor arriba para comenzar. Si no quieres usar IA, las traducciones
          siguen funcionando con el diccionario offline + el traductor remoto gratuito.
        </p>
      )}
    </div>
  );
}

/* ─── Accordion ───────────────────────────────────────────────────────── */

function Accordion({
  icon, title, summary, summaryColor, open, onToggle, children, noPadding,
}: {
  icon: React.ReactNode;
  title: string;
  summary?: string;
  summaryColor?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  noPadding?: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-2.5 py-2 bg-zinc-50/60 dark:bg-zinc-900/60 hover:bg-zinc-100/50 dark:hover:bg-zinc-800/40 transition-colors"
      >
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {icon}{title}
        </span>
        <span className="flex items-center gap-2 ml-auto shrink-0">
          {summary && !open && (
            <span className={`text-[10px] font-medium normal-case tracking-normal ${summaryColor ?? 'text-zinc-400 dark:text-zinc-500'}`}>
              {summary}
            </span>
          )}
          <ChevronDown size={12} className={`text-zinc-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      <div
        style={{
          display: 'grid',
          gridTemplateRows: open ? '1fr' : '0fr',
          transition: 'grid-template-rows 220ms ease',
        }}
      >
        <div className="overflow-hidden">
          <div className={noPadding ? '' : 'p-2.5 space-y-2 border-t border-zinc-100 dark:border-zinc-800/60'}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── NestedAccordion ────────────────────────────────────────────────── */

function NestedAccordion({
  title, open, onToggle, children,
}: {
  title: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-800/80 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 bg-zinc-50/50 dark:bg-zinc-800/30 hover:bg-zinc-100/50 dark:hover:bg-zinc-800/60 transition-colors"
      >
        <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">{title}</span>
        <ChevronRight size={11} className={`text-zinc-400 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>
      <div
        style={{
          display: 'grid',
          gridTemplateRows: open ? '1fr' : '0fr',
          transition: 'grid-template-rows 200ms ease',
        }}
      >
        <div className="overflow-hidden">
          <div className="p-2 space-y-2 border-t border-zinc-100 dark:border-zinc-800/60">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── QuickRow ───────────────────────────────────────────────────────── */

function QuickRow({
  label, hint, children,
}: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-2.5 py-2 gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
        {hint && <span className="text-[10px] text-zinc-400 dark:text-zinc-600 font-mono">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/* ─── Row ────────────────────────────────────────────────────────────── */

function Row({
  label, value, children,
}: {
  label: React.ReactNode; value?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">{label}</label>
        {value && (
          <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
            {value}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

/* ─── SegmentedControl ───────────────────────────────────────────────── */

function SegmentedControl<T extends string>({
  options, value, onChange,
}: {
  options: { v: T; l: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div className="flex bg-zinc-100 dark:bg-zinc-800/70 rounded-md p-0.5">
      {options.map((opt) => (
        <button
          key={opt.v}
          onClick={() => onChange(opt.v)}
          className={`flex-1 text-[11px] font-medium px-2 py-1 rounded transition-all ${
            value === opt.v
              ? 'bg-white dark:bg-zinc-700 text-indigo-600 dark:text-indigo-300 shadow-sm'
              : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
          }`}
        >
          {opt.l}
        </button>
      ))}
    </div>
  );
}

/* ─── Toggle ─────────────────────────────────────────────────────────── */

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  const ref = React.useRef<HTMLButtonElement>(null);
  const [isDark, setIsDark] = React.useState(false);
  React.useEffect(() => {
    if (ref.current) setIsDark(!!ref.current.closest('.dark'));
  }, []);
  const bgOn = isDark ? '#6366f1' : '#4f46e5';
  const bgOff = isDark ? '#3f3f46' : '#d4d4d8';
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onChange(!on)}
      style={{
        position: 'relative', flexShrink: 0, width: 34, height: 19,
        borderRadius: 9999, backgroundColor: on ? bgOn : bgOff,
        transition: 'background-color 150ms', border: 'none', cursor: 'pointer', padding: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: 2, width: 15, height: 15,
        borderRadius: 9999, backgroundColor: '#fff',
        boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        transition: 'transform 200ms',
        transform: on ? 'translateX(15px)' : 'translateX(0)',
      }} />
    </button>
  );
}

/* ─── CompactSlider ──────────────────────────────────────────────────── */

function CompactSlider({
  label, defaultValue, max, unit,
}: {
  label: string; defaultValue: number; max: number; unit: string;
}) {
  const [v, setV] = useState(defaultValue);
  return (
    <Row label={label} value={`${v}${unit}`}>
      <input
        type="range" min={0} max={max} step={50} value={v}
        onChange={(e) => setV(Number(e.target.value))}
        className="sl-range w-full"
      />
    </Row>
  );
}

/* ─── WhisperModelProgress ───────────────────────────────────────────── */

/**
 * Listens for `OFFSCREEN_WHISPER_MODEL_PROGRESS` messages broadcast by the
 * offscreen document when downloading a Whisper ggml model. Shows a minimal
 * progress bar that fills up during the (potentially long) first download,
 * then disappears when done or when the model is loaded from cache.
 *
 * The component only renders anything while a download is actively in
 * progress (fraction > 0 && fraction < 1).
 */
function WhisperModelProgress({ modelKey }: { modelKey: WhisperModelKey }) {
  const [progress, setProgress] = useState<{
    fraction: number;
    loadedBytes: number;
    totalBytes: number;
    done: boolean;
    cached: boolean;
  } | null>(null);

  useEffect(() => {
    const handler = (msg: Record<string, unknown>) => {
      if (msg?.type !== 'OFFSCREEN_WHISPER_MODEL_PROGRESS') return;
      const info = msg as {
        modelKey: string | null;
        fraction: number;
        loadedBytes: number;
        totalBytes: number;
        done: boolean;
        cached: boolean;
      };
      if (info.modelKey !== null && info.modelKey !== modelKey) return;
      setProgress({
        fraction: info.fraction,
        loadedBytes: info.loadedBytes,
        totalBytes: info.totalBytes,
        done: info.done,
        cached: info.cached,
      });
      if (info.done) {
        setTimeout(() => setProgress(null), 2000);
      }
    };
    try {
      chrome.runtime.onMessage.addListener(handler);
    } catch {
      /* not in an extension context (dev preview) — no-op */
    }
    return () => {
      try {
        chrome.runtime.onMessage.removeListener(handler);
      } catch {
        /* ignore */
      }
    };
  }, [modelKey]);

  if (!progress || progress.done || progress.fraction === 0) return null;

  const pct = Math.round(progress.fraction * 100);
  const mb = (progress.loadedBytes / 1_000_000).toFixed(1);
  const totalMb = (progress.totalBytes / 1_000_000).toFixed(0);

  return (
    <div className="space-y-1 -mt-0.5">
      <div className="flex items-center justify-between text-[10px] text-zinc-500 dark:text-zinc-400">
        <span>Descargando modelo…</span>
        <span className="font-mono tabular-nums">{mb} / {totalMb} MB ({pct}%)</span>
      </div>
      <div className="h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-indigo-500 rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
