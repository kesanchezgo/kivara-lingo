import React, {
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import { t } from '../../../shared/i18n';
import {
  Keyboard, EyeOff, Wand2, SlidersHorizontal, BookOpen, Languages, Sparkles,
  Globe, Zap, KeyRound, Heart, Coffee, Github, Mic2,
} from 'lucide-react';
import { useKivaraStore } from '../../../shared/store';
import type { PremiumTtsProvider, TranslateProvider } from '../../../shared/types';
import { getAiPreset } from '../../../shared/ai-presets';
import { SHORTCUT_DEFS } from '../../../shared/shortcuts';
import { SecretKeyInput } from '../SecretKeyInput';
import { SyncWriteErrorBanner } from '../SyncWriteErrorBanner';
import { HostPermissionsRow } from '../HostPermissionsRow';
import { ensureProviderHosts } from '../../../shared/host-permissions';
import { consumeOpenSettingsSection } from '../../../shared/open-settings-section';
import { useShortcuts } from '../../hooks/useShortcuts';
import { ShortcutEditor } from '../ShortcutEditor';
import { InfoHint } from '../InfoHint';
import { DictPacksSection } from './DictPacksSection';
import { VipSection } from './VipSection';
import { AiByokSection } from './AiByokSection';
import { Accordion, CompactSlider, DonateBtn, NestedAccordion, PaypalIcon, QuickRow, Row, SegmentedControl, Toggle } from './settings-primitives';

/**
 * Settings tab — restructured per the design mock:
 *
 *  - t('set.quickAccess') QuickRow strip at the top (autoMode, modo lectura,
 *    subtítulo bilingüe). These are the toggles users flip most often.
 *  - "Captura avanzada" only appears when autoMode is OFF.
 *  - Idioma is its own always-visible card (you can't translate without
 *    knowing source/target).
 *  - Everything else (Traducción, Diccionarios, IA, TTS, Limpieza,
 *    Sincronización, Atajos) collapses into Accordions with a compact
 *    summary line so the panel feels far less crowded by default.
 *
 * All wiring still goes through `useKivaraStore` — this is purely a UI
 * reshuffle.
 */
/** The `#section` part of the current URL, if any. */
function readHashSection(): string | undefined {
  return window.location.hash.replace('#', '').trim() || undefined;
}

export function SettingsTab({
  initialSection,
  initialNonce,
}: { initialSection?: string; initialNonce?: number } = {}) {
  const {
    capture, setCapture, cleanup, setCleanup, mode, setMode,
    translate, setTranslate, ai, setAi, tts, setTts, vip,
  } = useKivaraStore();

  // Sub-section open/closed state. Each accordion key is a stable string
  // — the dictionary packs section is special-cased because it ships its
  // own header.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  const isOpen = (id: string) => !!open[id];

  // DEEP LINK. The popover's "held back" strip opens Settings for a reason, so
  // the requested section is expanded for it. SidePanel consumes the section
  // (hash first, then the storage.session slot the OPEN_SETTINGS handler
  // writes) when picking its initial tab and forwards it here; the URL hash
  // also stands alone so a direct options.html#perm still works.
  //
  // `initialNonce` exists because the section ALONE is not an event: a second
  // deep link while this tab is already mounted sends the same 'perm' again,
  // the state is already 'perm', and React fires no change — nothing opened
  // and nothing scrolled. One increment per click from SidePanel is what makes
  // a repeat a repeat, and the number is meaningless on purpose.
  const [deepLinkSection, setDeepLinkSection] = useState<string | undefined>(
    () =>
      initialSection ?? (typeof window !== 'undefined' ? readHashSection() : undefined),
  );

  // A new nonce re-runs the expand (and scroll) below even for the same section —
  // AND a DIFFERENT section arriving while this tab is mounted changes what is
  // expanded: `deepLinkSection` is only seeded from the prop, so without the
  // assignment here a perm → tts sequence reopened perm.
  const lastNonce = useRef<number | undefined>(initialNonce);
  const [expandTick, bumpExpandTick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (initialNonce === undefined || initialNonce === lastNonce.current) return;
    lastNonce.current = initialNonce;
    if (initialSection) setDeepLinkSection(initialSection);
    bumpExpandTick();
  }, [initialNonce, initialSection]);

  // No panel forwarding (a direct navigation): read the slot once here too.
  // The panel path already consumed it on mount, so this normally finds none.
  useEffect(() => {
    if (initialSection || deepLinkSection) return;
    let alive = true;
    void (async () => {
      const fallback = await consumeOpenSettingsSection();
      if (alive && fallback) setDeepLinkSection(fallback);
    })();
    return () => {
      alive = false;
    };
  }, [initialSection, deepLinkSection]);

  useEffect(() => {
    const section = deepLinkSection;
    if (!section) return;
    setOpen((prev) => ({ ...prev, [section]: true }));
    window.requestAnimationFrame(() => {
      document
        .getElementById(`kivara-section-${section}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [deepLinkSection, expandTick]);

  // User-customisable shortcut combos (synced via the store, see useShortcuts).
  // We surface the first three combos in the accordion summary line so the
  // panel reflects user changes without expanding the section.
  const { map: shortcutMap } = useShortcuts();
  const keysSummary = SHORTCUT_DEFS.slice(0, 3)
    .map((s) => shortcutMap[s.id] || s.defaultCombo)
    .join(' · ');

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
    ['en', t('lang.en')], ['es', t('lang.es')], ['fr', t('lang.fr')], ['de', t('lang.de')],
    ['it', t('lang.it')], ['pt', t('lang.pt')], ['ja', t('lang.ja')],
    ['ko', t('lang.ko')], ['zh', t('lang.zh')],
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

        {/* Sync write failure — quota / sync disabled. Discreet, above the
            quick bar, so a "saved" toggle that never reached sync is
            explainable instead of looking like a revert. */}
        <SyncWriteErrorBanner compact />

        {/* ── Quick bar — always visible ───────────────────────────────── */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="px-2.5 py-1.5 border-b border-zinc-100 dark:border-zinc-800/60 bg-zinc-50/60 dark:bg-zinc-900/60">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              <Zap size={9} /> {t('set.quickAccess')}</span>
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {/* autoMode QuickRow removed (audit #11, part 2): the captured
                mode is not read by background or content — grep for
                capture.autoMode across src/background/** and
                src/content/** returns zero calls. The toggle appears here
                to be dead. */}
            <QuickRow label={t('set.readingMode')} info={t('set.hideHoverDesc')} hint={readingMode ? t('set.noPopovers') : t('set.learningHint')}>
              <Toggle on={readingMode} onChange={setReadingMode} />
            </QuickRow>
            <QuickRow label={t('set.bilingualSub')} info={t('set.bilingualSubDesc')} hint={translate.showDualSubtitle ? t('set.visibleHint') : t('set.hiddenHint')}>
              <Toggle
                on={translate.showDualSubtitle}
                onChange={(v) => setTranslate({ ...translate, showDualSubtitle: v })}
              />
            </QuickRow>
          </div>
        </div>

        {/* ── Captura avanzada — only captures-settings that DO get consumed ── */}
        <Accordion
          icon={<Wand2 size={10} />}
          title={t('set.sectionAdvancedCapture')}
          summary={`${bufferSize}s`}
          open={isOpen('capture')}
          onToggle={() => toggle('capture')}
          description={t('set.captureDesc')}
        >
          {/* audioSource removed (audit #11, part 2): nothing in background
              or content reads capture.audioSource — the segmented control
              was a no-op UI. */}
          <Row label="Buffer rolling" value={`${bufferSize}s`} hint={t('set.bufferDesc')}>
            <input
              type="range" min={10} max={60} step={5} value={bufferSize}
              onChange={(e) => setBufferSize(Number(e.target.value))}
              className="sl-range w-full"
            />
          </Row>
          <Row label={t('set.sentenceEndLabel')} hint={endDetect === 'vad' ? t('set.vadModeDesc') : t('set.exactModeDesc')}>
            <SegmentedControl
              options={[{ v: 'vad', l: 'VAD' }, { v: 'cue', l: 'Cue exacto' }]}
              value={endDetect}
              onChange={setEndDetect}
            />
          </Row>
          {/* frameMoment removed (audit #11, part 2): nothing reads
              capture.frameMoment — same dead control shape as audioSource. */}
        </Accordion>

        {/* ── Idioma — always visible (paired source / target) ─────────── */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="px-2.5 py-1.5 border-b border-zinc-100 dark:border-zinc-800/60 bg-zinc-50/60 dark:bg-zinc-900/60">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              <Globe size={9} /> {t('set.languageSection')}
              <InfoHint text={<>{t('set.langDesc')}</>} />
            </span>
          </div>
          <div className="p-2.5 grid grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <label className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 block">{t('set.learningLang')}</label>
              <select
                value={translate.sourceLang || 'en'}
                onChange={(e) => setTranslate({ ...translate, sourceLang: e.target.value })}
                className="sl-select w-full"
              >
                {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="space-y-0.5">
              <label className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 block">{t('set.myLang')}</label>
              <select
                value={translate.targetLanguage || 'es'}
                onChange={(e) => setTranslate({ ...translate, targetLanguage: e.target.value })}
                className="sl-select w-full"
              >
                {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          <QuickRow
            label={t('set.learningAudioLabel')}
            info={<>{t('set.autoTrackDesc')}<br /><br />{t('set.trackLimitsNote')}</>}
            hint={translate.autoSelectSourceAudio ? t('set.activeHint') : t('set.manualHint')}
          >
            <Toggle
              on={translate.autoSelectSourceAudio}
              onChange={(v) => setTranslate({ ...translate, autoSelectSourceAudio: v })}
            />
          </QuickRow>
        </div>

        {/* ── Traducción ─────────────────────────────────────────────── */}
        <Accordion
          icon={<Languages size={10} />}
          title={t('set.translate')}
          summary={
            translate.mode === 'chain'
              ? `cadena · ${translate.tiersEnabled.free ? 'free' : ''}${translate.tiersEnabled.free && translate.tiersEnabled.premium ? '+' : ''}${translate.tiersEnabled.premium ? 'premium' : ''}`
              : translate.provider
          }
          open={isOpen('translate')}
          onToggle={() => toggle('translate')}
          description={t('set.translateDesc')}
        >
          <Row label="Modo" hint={translate.mode === 'chain' ? t('set.chainHint') : t('set.singleHint')}>
            <SegmentedControl
              options={[{ v: 'chain', l: t('set.chain') }, { v: 'single', l: t('set.single') }]}
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
                onChange={(e) => {
                  const provider = e.target.value as TranslateProvider;
                  setTranslate({ ...translate, provider });
                  // Optional host permission, from inside the click (the only
                  // place chrome will show a prompt).
                  void ensureProviderHosts(`translate:${provider}`);
                }}
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
            title={t('set.apiTokensTitle')}
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
              <SecretKeyInput
                stored={translate.deeplToken}
                onChange={(v) => setTranslate({ ...translate, deeplToken: v })}
                placeholder="xxxxxxxx:fx"
                section="translate"
                field="deeplToken"
              />
            </Row>
            <Row label="Google Cloud API key">
              <SecretKeyInput
                stored={translate.googleToken}
                onChange={(v) => setTranslate({ ...translate, googleToken: v })}
                placeholder="AIza..."
                section="translate"
                field="googleToken"
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
              <SecretKeyInput
                stored={translate.libreTranslateToken}
                onChange={(v) => setTranslate({ ...translate, libreTranslateToken: v })}
                placeholder={t('set.ltKeyPlaceholder')}
                section="translate"
                field="libreTranslateToken"
              />
            </Row>
          </NestedAccordion>

          <Row label={t('set.cache')} value={`${translate.cacheTtlDays}d`}>
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
          title={t('set.sectionOfflineDicts')}
          summary="yomitan"
          open={isOpen('dict')}
          onToggle={() => toggle('dict')}
          noPadding
          description={t('set.dictDesc')}
        >
          <DictPacksSection />
        </Accordion>

        {/* ── VIP enrichment chain ─────────────────────────────────── */}
        <Accordion
          icon={<Sparkles size={10} />}
          title={t('set.sectionEnrichment')}
          summary={vip.enabled ? 'VIP activo' : 'solo Standard'}
          summaryColor={vip.enabled ? 'text-fuchsia-500 dark:text-fuchsia-400' : undefined}
          open={isOpen('vip')}
          onToggle={() => toggle('vip')}
          noPadding
          description={t('set.sourcesDesc')}
        >
          <VipSection />
        </Accordion>

        {/* ── IA premium ─────────────────────────────────────────────── */}
        <Accordion
          icon={<Sparkles size={10} />}
          title={t('set.sectionAiPremium')}
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
          description={t('set.aiDesc')}
        >
          <AiByokSection />
        </Accordion>

        {/* ── TTS premium ────────────────────────────────────────────── */}
        <Accordion
          icon={<Mic2 size={10} />}
          title={t('set.sectionTtsPremium')}
          summary={tts.provider === 'disabled' ? 'desactivado' : tts.provider}
          summaryColor={tts.provider !== 'disabled' ? 'text-indigo-500 dark:text-indigo-400' : undefined}
          open={isOpen('tts')}
          onToggle={() => toggle('tts')}
          description={t('set.ttsDesc')}
        >
          <Row label="Proveedor">
            <select
              value={tts.provider}
              onChange={(e) => {
                const provider = e.target.value as PremiumTtsProvider;
                setTts({ ...tts, provider });
                // Optional host permission, asked inside the click.
                void ensureProviderHosts(`tts:${provider}`);
              }}
              className="sl-select w-full"
            >
              <option value="auto">Auto (ElevenLabs ▸ OpenAI ▸ template)</option>
              <option value="elevenlabs">ElevenLabs</option>
              <option value="openai">OpenAI tts-1</option>
              <option value="disabled">{t('set.deactivatedTemplate')}</option>
            </select>
          </Row>
          {(tts.provider === 'auto' || tts.provider === 'elevenlabs') && (
            <>
              <Row label="ElevenLabs · API key">
                <SecretKeyInput
                  stored={tts.elevenLabsApiKey}
                  onChange={(v) => setTts({ ...tts, elevenLabsApiKey: v })}
                  placeholder="xi-..."
                  section="tts"
                  field="elevenLabsApiKey"
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
                  <option value="eleven_turbo_v2_5">{t('set.ttsModelCheap')}</option>
                  <option value="eleven_monolingual_v1">eleven_monolingual_v1 (solo EN)</option>
                </select>
              </Row>
            </>
          )}
        </Accordion>

        {/* ── Permisos de red (opcionales) ────────────────────────────── */}
        <Accordion
          id="kivara-section-perm"
          icon={<KeyRound size={10} />}
          title={t('set.sectionHostAccess')}
          open={isOpen('perm')}
          onToggle={() => toggle('perm')}
          description={t('perm.intro')}
        >
          <HostPermissionsRow />
        </Accordion>
        {/* ── Limpieza visual ────────────────────────────────────────── */}
        <Accordion
          icon={<EyeOff size={10} />}
          title={t('set.cleanupVisual')}
          summary={`UI ${hideUI ? 'off' : 'on'} · sombras ${hideShadows ? 'off' : 'on'}`}
          open={isOpen('cleanup')}
          onToggle={() => toggle('cleanup')}
          description={t('set.cleanupDesc')}
        >
          <Row label={t('set.hidePlayerUiLabel')} hint={t('set.hideProgressDesc')}>
            <Toggle on={hideUI} onChange={setHideUI} />
          </Row>
          <Row label={t('set.noShadowsLabel')} hint={t('set.hideGradientsDesc')}>
            <Toggle on={hideShadows} onChange={setHideShadows} />
          </Row>
        </Accordion>

        {/* Sincronización fina (pre-roll / post-roll / cueMerge) removed:
            audit #11. The CompactSliders inside it had no onChange wired
            to `capture` — they were visual-only. Rather than promise
            behavior we do not deliver, they are omitted until the
            capture pipeline consumes the values. */}

        {/* ── Atajos ─────────────────────────────────────────────────── */}
        <Accordion
          icon={<Keyboard size={10} />}
          title={t('set.keyboardShortcutsTitle')}
          summary={keysSummary}
          open={isOpen('keys')}
          onToggle={() => toggle('keys')}
          description={t('set.shortcutsDesc')}
        >
          <ShortcutEditor compact />
          <div className="mt-2 flex items-center justify-between py-1 text-[10.5px] text-zinc-500 dark:text-zinc-500 px-1">
            <span>{t('set.splitExpression')}</span>
            <span className="flex items-center gap-0.5">
              <kbd className="font-sans text-[10px] bg-zinc-50 dark:bg-zinc-800/70 border border-zinc-200 dark:border-zinc-700 rounded px-1.5 py-px text-zinc-600 dark:text-zinc-400">Scroll</kbd>
              <span className="text-zinc-400 dark:text-zinc-600 text-[9px] mx-0.5">+</span>
              <kbd className="font-sans text-[10px] bg-zinc-50 dark:bg-zinc-800/70 border border-zinc-200 dark:border-zinc-700 rounded px-1.5 py-px text-zinc-600 dark:text-zinc-400">hover</kbd>
            </span>
          </div>
        </Accordion>

        {/* ── Apoyar el proyecto ─────────────────────────────────────── */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2.5 py-2 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[10.5px] text-zinc-500 dark:text-zinc-400 min-w-0">
            <Heart size={10} className="text-zinc-400 dark:text-zinc-500 shrink-0" />
            <span className="truncate">{t('set.supportProject')}</span>
          </span>
          <span className="flex items-center gap-0.5 shrink-0">
            <DonateBtn href="https://ko-fi.com/kivara"            icon={<Coffee size={11} />}  label="Ko-fi" />
            <DonateBtn href="https://github.com/sponsors/kivara"  icon={<Github size={11} />}  label="GitHub Sponsors" />
            <DonateBtn href="https://paypal.me/kivara"            icon={<PaypalIcon />}        label="PayPal" />
          </span>
        </div>

        {/* ── Repetir configuración inicial ─────────────────────────── */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-2.5">
          <button
            type="button"
            onClick={reopenOnboarding}
            className="w-full flex items-center justify-center gap-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50/60 dark:hover:bg-indigo-500/10 py-1.5 rounded-md transition-colors"
          >
            {t('set.repeatInit')}</button>
        </div>
      </div>
    </div>
  );
}
