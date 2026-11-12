import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import { t, fmtDays } from '../../../shared/i18n';
import {
  Keyboard, EyeOff, Wand2, BookOpen, Languages, Sparkles,
  Globe, Zap, KeyRound, Heart, Coffee, Github, Mic2, Search, X,
  Subtitles, GraduationCap, LayoutGrid, ChevronRight,
} from '../../../ui/icons';
import { DEFAULT_STUDY } from '../../../shared/store';
import { LANGUAGES } from '../../../shared/languages';
import { useKivaraStore } from '../../../shared/use-kivara-store';
import type {
  EndDetect,
  PremiumTtsProvider,
  TranslateProvider,
  TranslationMode,
} from '../../../shared/types';
import { getAiPreset } from '../../../shared/ai-presets';
import { SHORTCUT_DEFS } from '../../../shared/shortcuts';
import { SecretKeyInput } from '../SecretKeyInput';
import { SyncWriteErrorBanner } from '../SyncWriteErrorBanner';
import { HostPermissionsRow } from '../HostPermissionsRow';
import { ensureProviderHosts } from '../../../shared/host-permissions';
import { consumeOpenSettingsSection } from '../../../shared/open-settings-section';
import { useShortcuts } from '../../hooks/useShortcuts';
import { ShortcutEditor } from '../ShortcutEditor';
import { IconTile, Kbd, ui, tx } from '../../../ui/primitives/settings-primitives';
import {
  Accordion, DonateBtn, Field, NestedAccordion, PaypalIcon, QuickRow, Row,
  Section, SectionLabel, SegmentedControl, Toggle,
} from '../../../ui/primitives/settings-primitives';
import { Select, inputCls, Slider } from '../../../ui/primitives/controls';
import { DictPacksSection } from './DictPacksSection';
import { packsSummary } from './section-summaries';
import { VipSection } from './VipSection';
import { AiByokSection } from './AiByokSection';
import { playSound } from '../../../ui/sounds';
import { searchSettings, searchOtherTabs, type SearchId, type OtherTab } from './settingsSearch';
import { VOCAB_TAB_ENABLED } from './VocabTab';

/**
 * Preferences — the prototype's layout over the repo's settings.
 *
 * Order: quick access (reading mode, translation mode, pause on lookup,
 * auto-pause, listen first, sounds) → language → content group (translation,
 * dictionaries, enrichment, AI, TTS) → advanced group (capture, host access,
 * visual cleanup, shortcuts) → about.
 *
 * Every wire is the repo's: the synced store, `ensureProviderHosts` from the
 * provider gesture, encrypted `SecretKeyInput` slots, and the sync-write
 * banner. Search indexes both dictionaries (see settingsSearch.ts).
 */

/** The `#section` part of the current URL, if any. */
function readHashSection(): string | undefined {
  return window.location.hash.replace('#', '').trim() || undefined;
}

/** Text of each tab in the search's "In other tabs" group. */
const OTHER_TAB_TEXT: Record<OtherTab, { label: string; desc: string }> = {
  subtitles: { label: 'panel.tabSubtitles', desc: 'set.searchInSubtitles' },
  vocab: { label: 'panel.tabVocab', desc: 'set.searchInVocab' },
  cards: { label: 'panel.tabCards', desc: 'set.searchInCards' },
};

export function SettingsTab({
  initialSection,
  initialNonce,
  onOpenTab,
}: {
  initialSection?: string;
  initialNonce?: number;
  /** The search offers jumps to settings that live in other tabs. */
  onOpenTab?: (tab: OtherTab) => void;
} = {}) {
  const {
    capture, setCapture, cleanup, setCleanup, mode, setMode,
    translate, setTranslate, study, setStudy, ai, tts, setTts, vip,
  } = useKivaraStore();

  /* ── Open sections ───────────────────────────────────────────────────── */
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  const isOpen = (id: string) => !!open[id];

  /* ── Search ──────────────────────────────────────────────────────────── */
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const searching = query.trim().length > 0;
  const matches = searchSettings(query);
  const show = (...ids: SearchId[]) => ids.some((id) => matches.has(id));
  const resultCount = [...matches].filter(
    (id) => !(id === 'translate-tokens' && matches.has('translate')),
  ).length;
  const otherTabs = searchOtherTabs(query).filter(
    (tab) => tab !== 'vocab' || VOCAB_TAB_ENABLED,
  );
  // While searching, matches open; clearing restores what the user had open
  // before typing. The decision is made inside the event (with refs), not in
  // an effect: clearing and typing again must not lose the snapshot.
  const queryRef = useRef('');
  const openRef = useRef(open);
  useLayoutEffect(() => { openRef.current = open; });
  const preSearchOpen = useRef<Record<string, boolean> | null>(null);
  const changeQuery = (next: string) => {
    const was = queryRef.current.trim().length > 0;
    const now = next.trim().length > 0;
    queryRef.current = next;
    setQuery(next);
    if (now) {
      if (!was) preSearchOpen.current = openRef.current;
      const forced: Record<string, boolean> = {};
      const m = searchSettings(next);
      m.forEach((id) => { forced[id] = true; });
      if (m.has('translate-tokens')) forced.translate = true;
      setOpen(forced);
    } else if (was) {
      setOpen(preSearchOpen.current ?? {});
      preSearchOpen.current = null;
    }
  };
  // "/" focuses the search (GitHub / YouTube behaviour) when the tab is visible.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const input = searchRef.current;
      if (!input || input.offsetParent === null) return;
      e.preventDefault();
      input.focus();
      input.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ── Deep link ───────────────────────────────────────────────────────── */
  const [deepLinkSection, setDeepLinkSection] = useState<string | undefined>(
    () => initialSection ?? (typeof window !== 'undefined' ? readHashSection() : undefined),
  );
  const lastNonce = useRef<number | undefined>(initialNonce);
  const [expandTick, bumpExpandTick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (initialNonce === undefined || initialNonce === lastNonce.current) return;
    lastNonce.current = initialNonce;
    if (initialSection) setDeepLinkSection(initialSection);
    bumpExpandTick();
  }, [initialNonce, initialSection]);

  // Direct navigation: the panel path already consumed the slot, so this
  // normally finds none.
  useEffect(() => {
    if (initialSection || deepLinkSection) return;
    let alive = true;
    void (async () => {
      const fallback = await consumeOpenSettingsSection();
      if (alive && fallback) setDeepLinkSection(fallback);
    })();
    return () => { alive = false; };
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

  /* ── Summaries ───────────────────────────────────────────────────────── */
  const { map: shortcutMap } = useShortcuts();
  /** Enabled packs reported by DictPacksSection (it owns the pack listing). */
  const [packCount, setPackCount] = useState(0);
  const keysSummary = SHORTCUT_DEFS
    .slice(0, 3)
    .map((s) => shortcutMap[s.id] || s.defaultCombo)
    .join(' · ');
  const comboOf = (id: string) => shortcutMap[id] || SHORTCUT_DEFS.find((s) => s.id === id)?.defaultCombo;

  const readingMode = mode === 'reading';
  const setReadingMode = (v: boolean) => setMode(v ? 'reading' : 'learning');
  // A snapshot from before v3 (or a stripped test store) has no `study` slice;
  // the defaults are exactly what that build did, so read them as the base.
  const studyState = study ?? DEFAULT_STUDY;
  const setStudyKey = <K extends keyof typeof studyState>(key: K, value: (typeof studyState)[K]) => {
    void setStudy?.({ ...studyState, [key]: value });
  };

  const endDetect = capture.endDetect;
  const setEndDetect = (v: EndDetect) => setCapture({ ...capture, endDetect: v });
  const bufferSize = capture.bufferSize;
  const setBufferSize = (v: number) => setCapture({ ...capture, bufferSize: v });
  const hideUI = cleanup.hideUI;
  const setHideUI = (v: boolean) => setCleanup({ ...cleanup, hideUI: v });
  const hideShadows = cleanup.hideShadows;
  const setHideShadows = (v: boolean) => setCleanup({ ...cleanup, hideShadows: v });

  const langOption = (code: string, openFor: 'learn' | 'speak') => {
    const lang = LANGUAGES.find((l) => l.code === code);
    if (!lang) return null;
    const open = openFor === 'learn' ? lang.learn : lang.speak;
    const name = t(`lang.${lang.code}`);
    return (
      <option key={lang.code} value={lang.code} disabled={!open}>
        {open ? name : `${name} · ${t('lang.soon')}`}
      </option>
    );
  };

  // The message rejects asynchronously (SW asleep, no receiver) — a sync
  // try/catch never sees it, so the awaited call is what the catch guards.
  async function reopenOnboarding() {
    const url = chrome.runtime.getURL('src/onboarding/index.html');
    try {
      await chrome.runtime.sendMessage({ type: 'OPEN_URL', url });
    } catch {
      window.open(url, '_blank');
    }
  }

  const tiers = [
    translate.tiersEnabled.free && t('set.tierFree'),
    translate.tiersEnabled.premium && t('set.tierPaid'),
  ].filter(Boolean).join(' + ');
  const aiLabel = getAiPreset(ai.provider)?.label ?? ai.provider;
  const providerLabel: Record<TranslateProvider, string> = {
    offline: t('set.providerOffline'),
    mymemory: t('set.providerMyMemory'),
    lingva: t('set.providerLingva'),
    libretranslate: t('set.providerLibreTranslate'),
    deepl: t('set.providerDeepl'),
    google: t('set.providerGoogleCloud'),
  };
  const ttsLabel: Record<PremiumTtsProvider, string> = {
    auto: 'Auto',
    elevenlabs: 'ElevenLabs',
    openai: 'OpenAI',
    disabled: t('set.summaryOffM'),
  };
  const hiddenItems = [
    hideUI && t('set.controlsShort'),
    hideShadows && t('set.shadowsShort'),
  ].filter(Boolean).join(', ');

  return (
    <div className="flex flex-col h-full min-h-0 text-zinc-900 dark:text-zinc-100 overflow-y-auto kvl-scroll">
      {/* Search — pinned at the top */}
      <div role="search" className="sticky top-0 z-20 px-4 pt-3 pb-2.5 bg-zinc-50/90 dark:bg-zinc-950/90 backdrop-blur-md border-b border-zinc-900/[0.04] dark:border-white/[0.04]">
        <div className="relative">
          <Search size={14} aria-hidden="true" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-400 pointer-events-none" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.stopPropagation();
                changeQuery('');
              }
            }}
            placeholder={t('set.searchPlaceholder')}
            aria-label={t('set.searchPlaceholder')}
            spellCheck={false}
            autoComplete="off"
            className={`${inputCls} !pl-8 ${searching ? '!pr-24' : '!pr-9'} [&::-webkit-search-cancel-button]:appearance-none`}
          />
          <span className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
            {searching ? (
              <>
                <span className="text-[11px] font-medium tabular-nums text-zinc-400 dark:text-zinc-400" aria-live="polite">
                  {resultCount + otherTabs.length === 1
                    ? t('set.searchResultOne')
                    : t('set.searchResults', { n: resultCount + otherTabs.length })}
                </span>
                <button
                  type="button"
                  onClick={() => { changeQuery(''); searchRef.current?.focus(); }}
                  aria-label={t('set.searchClear')}
                  title={t('set.searchClear')}
                  className="w-6 h-6 inline-flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-900/[0.05] dark:hover:bg-white/[0.07] kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
                >
                  <X size={12} weight="bold" />
                </button>
              </>
            ) : (
              <Kbd className="mr-1 pointer-events-none">/</Kbd>
            )}
          </span>
        </div>
      </div>

      <div className={ui.body}>
        <SyncWriteErrorBanner compact />

        {searching && resultCount === 0 && otherTabs.length === 0 && (
          <div className="py-10 px-6 text-center flex flex-col items-center gap-2.5">
            <IconTile className="!w-8 !h-8"><Search size={16} /></IconTile>
            <div className="space-y-1 max-w-[260px]">
              <p className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100">
                {t('set.searchNoResults', { q: query.trim() })}
              </p>
              <p className="text-[12px] leading-[17px] text-zinc-500 dark:text-zinc-400">
                {t('set.searchNoResultsHint')}
              </p>
            </div>
          </div>
        )}

        {otherTabs.length > 0 && (
          <section>
            <SectionLabel>{t('set.searchOtherTabs')}</SectionLabel>
            <div className={ui.card}><div className={ui.divide}>
              {otherTabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => onOpenTab?.(tab)}
                  className={`kvl-row w-full flex items-center gap-3 min-h-[52px] py-2 text-left outline-none focus-visible:bg-zinc-900/[0.03] dark:focus-visible:bg-white/[0.04] ${ui.rowHover}`}
                >
                  <IconTile>
                    {tab === 'subtitles' ? <Subtitles size={16} />
                      : tab === 'vocab' ? <GraduationCap size={16} />
                        : <LayoutGrid size={16} />}
                  </IconTile>
                  <span className="flex-1 min-w-0">
                    <span className={`block ${tx.label} truncate`}>{t(OTHER_TAB_TEXT[tab].label)}</span>
                    <span className="block text-[12px] leading-4 text-zinc-500 dark:text-zinc-400 truncate">
                      {t(OTHER_TAB_TEXT[tab].desc)}
                    </span>
                  </span>
                  <ChevronRight size={14} className="text-zinc-400 dark:text-zinc-400 shrink-0" />
                </button>
              ))}
            </div></div>
          </section>
        )}

        {/* ── Quick access ─────────────────────────────────────────────── */}
        {show('q-reading', 'q-translation', 'q-pause', 'q-autopause', 'q-listen', 'q-sounds') && (
          <section>
            <SectionLabel icon={<Zap size={13} />}>{t('set.quickAccess')}</SectionLabel>
            <div className={ui.card}><div className={ui.divide}>
              {show('q-reading') && (
                <QuickRow
                  label={t('set.readingMode')}
                  info={t('set.hideHoverDesc')}
                  hint={readingMode ? t('set.noPopovers') : t('set.learningHint')}
                >
                  <Toggle on={readingMode} onChange={setReadingMode} ariaLabel={t('set.readingMode')} />
                </QuickRow>
              )}
              {show('q-translation') && (
                <div className="py-3">
                  <Row label={t('tr.title')} hint={t('tr.desc')}>
                    <SegmentedControl<TranslationMode>
                      size="sm"
                      className="w-full"
                      ariaLabel={t('tr.title')}
                      value={studyState.translation}
                      onChange={(v) => setStudyKey('translation', v)}
                      options={(['visible', 'blur', 'hidden'] as const).map((v) => ({ v, l: t(`tr.${v}`) }))}
                    />
                  </Row>
                </div>
              )}
              {show('q-pause') && (
                <QuickRow label={t('ovl.pauseOnHover')} info={t('set.pauseOnLookupDesc')}>
                  <Toggle
                    on={studyState.pauseOnLookup}
                    onChange={(v) => setStudyKey('pauseOnLookup', v)}
                    ariaLabel={t('ovl.pauseOnHover')}
                  />
                </QuickRow>
              )}
              {show('q-autopause') && (
                <QuickRow label={t('rail.autoPause')} info={t('rail.autoPauseHint')} hint={comboOf('autoPause')}>
                  <Toggle
                    on={studyState.autoPauseCue}
                    onChange={(v) => setStudyKey('autoPauseCue', v)}
                    ariaLabel={t('rail.autoPause')}
                  />
                </QuickRow>
              )}
              {show('q-listen') && (
                <QuickRow label={t('listen.title')} info={t('listen.desc')} hint={comboOf('listenFirst')}>
                  <Toggle
                    on={studyState.listenFirst}
                    onChange={(v) => setStudyKey('listenFirst', v)}
                    ariaLabel={t('listen.title')}
                  />
                </QuickRow>
              )}
              {show('q-sounds') && (
                <QuickRow label={t('set.sounds')} info={t('set.soundsDesc')}>
                  <Toggle
                    on={studyState.sounds}
                    onChange={(v) => {
                      setStudyKey('sounds', v);
                      if (v) setTimeout(() => playSound('saved'), 60);
                    }}
                    ariaLabel={t('set.sounds')}
                  />
                </QuickRow>
              )}
            </div></div>
          </section>
        )}

        {/* ── Language ─────────────────────────────────────────────────── */}
        {show('lang') && (
          <section>
            <SectionLabel icon={<Globe size={13} />} hint={<>{t('set.langDesc')}</>}>
              {t('set.languageSection')}
            </SectionLabel>
            <div className={ui.card}><div className={ui.divide}>
              <div className="py-3 grid grid-cols-2 gap-3">
                <Field label={t('set.learningLang')}>
                  <Select
                    value={translate.sourceLang || 'en'}
                    onChange={(e) => setTranslate({ ...translate, sourceLang: e.target.value })}
                    className="w-full"
                    aria-label={t('set.learningLang')}
                  >
                    {LANGUAGES.map((l) => langOption(l.code, 'learn'))}
                  </Select>
                </Field>
                <Field label={t('set.myLang')}>
                  <Select
                    value={translate.targetLanguage || 'es'}
                    onChange={(e) => setTranslate({ ...translate, targetLanguage: e.target.value })}
                    className="w-full"
                    aria-label={t('set.myLang')}
                  >
                    {LANGUAGES.map((l) => langOption(l.code, 'speak'))}
                  </Select>
                </Field>
              </div>
              <QuickRow
                label={t('set.learningAudioLabel')}
                info={<>{t('set.autoTrackDesc')}<br /><br />{t('set.trackLimitsNote')}</>}
                hint={translate.autoSelectSourceAudio ? t('set.activeHint') : t('set.manualHint')}
              >
                <Toggle
                  on={translate.autoSelectSourceAudio}
                  onChange={(v) => setTranslate({ ...translate, autoSelectSourceAudio: v })}
                  ariaLabel={t('set.learningAudioLabel')}
                />
              </QuickRow>
            </div></div>
          </section>
        )}

        {show('translate', 'translate-tokens', 'dict', 'vip', 'ai', 'tts') && (
          <Section title={t('set.groupContent')}>
            {show('translate', 'translate-tokens') && (
              <Accordion
                id="kivara-section-translate"
                icon={<Languages size={13} />}
                title={t('set.translate')}
                summary={translate.mode === 'chain' ? t('set.summaryChain', { tiers }) : providerLabel[translate.provider]}
                open={isOpen('translate')}
                onToggle={() => toggle('translate')}
                description={t('set.translateDesc')}
              >
                <Row label={t('set.mode')} description={translate.mode === 'chain' ? t('set.chainHint') : t('set.singleHint')}>
                  <SegmentedControl
                    ariaLabel={`${t('set.translate')} · ${t('set.mode')}`}
                    options={[{ v: 'chain', l: t('set.chain') }, { v: 'single', l: t('set.single') }]}
                    value={translate.mode}
                    onChange={(v) => setTranslate({ ...translate, mode: v as 'chain' | 'single' })}
                  />
                </Row>

                {translate.mode === 'chain' && (
                  <>
                    <Row label={t('set.tierFree')} inline>
                      <Toggle
                        on={translate.tiersEnabled.free}
                        onChange={(v) => setTranslate({ ...translate, tiersEnabled: { ...translate.tiersEnabled, free: v } })}
                        ariaLabel={t('set.tierFree')}
                      />
                    </Row>
                    <Row label={t('set.tierPremium')} inline>
                      <Toggle
                        on={translate.tiersEnabled.premium}
                        onChange={(v) => setTranslate({ ...translate, tiersEnabled: { ...translate.tiersEnabled, premium: v } })}
                        ariaLabel={t('set.tierPremium')}
                      />
                    </Row>
                  </>
                )}
                {translate.mode === 'single' && (
                  <Row label={t('set.provider')}>
                    <Select
                      value={translate.provider}
                      onChange={(e) => {
                        const provider = e.target.value as TranslateProvider;
                        setTranslate({ ...translate, provider });
                        void ensureProviderHosts(`translate:${provider}`);
                      }}
                      className="w-full"
                    >
                      <option value="offline">{t('set.providerOffline')}</option>
                      <option value="mymemory">{t('set.providerMyMemory')}</option>
                      <option value="lingva">{t('set.providerLingva')}</option>
                      <option value="libretranslate">{t('set.providerLibreTranslate')}</option>
                      <option value="deepl">{t('set.providerDeepl')}</option>
                      <option value="google">{t('set.providerGoogleCloud')}</option>
                    </Select>
                  </Row>
                )}

                <NestedAccordion
                  title={t('set.apiTokensTitle')}
                  open={isOpen('translate-tokens')}
                  onToggle={() => toggle('translate-tokens')}
                >
                  <Row label={t('set.mymemoryEmail')}>
                    <input
                      type="email"
                      value={translate.myMemoryEmail}
                      onChange={(e) => setTranslate({ ...translate, myMemoryEmail: e.target.value })}
                      placeholder="you@example.com"
                      className={`${inputCls} w-full`}
                    />
                  </Row>
                  <Row label={t('set.lingvaUrl')}>
                    <input
                      type="text"
                      value={translate.lingvaUrl}
                      onChange={(e) => setTranslate({ ...translate, lingvaUrl: e.target.value })}
                      placeholder="https://lingva.lunar.icu"
                      className={`${inputCls} font-mono !text-[12px] w-full`}
                    />
                  </Row>
                  <Row label={t('set.deeplKey')}>
                    <SecretKeyInput
                      stored={translate.deeplToken}
                      onChange={(v) => setTranslate({ ...translate, deeplToken: v })}
                      placeholder="xxxxxxxx:fx"
                      section="translate"
                      field="deeplToken"
                    />
                  </Row>
                  <Row label={t('set.googleCloudKey')}>
                    <SecretKeyInput
                      stored={translate.googleToken}
                      onChange={(v) => setTranslate({ ...translate, googleToken: v })}
                      placeholder="AIza..."
                      section="translate"
                      field="googleToken"
                    />
                  </Row>
                  <Row label={t('set.libreTranslateUrl')}>
                    <input
                      type="text"
                      value={translate.libreTranslateUrl}
                      onChange={(e) => setTranslate({ ...translate, libreTranslateUrl: e.target.value })}
                      placeholder="https://libretranslate.com"
                      className={`${inputCls} font-mono !text-[12px] w-full`}
                    />
                  </Row>
                  <Row label={t('set.libreTranslateKey')}>
                    <SecretKeyInput
                      stored={translate.libreTranslateToken}
                      onChange={(v) => setTranslate({ ...translate, libreTranslateToken: v })}
                      placeholder={t('set.ltKeyPlaceholder')}
                      section="translate"
                      field="libreTranslateToken"
                    />
                  </Row>
                </NestedAccordion>

                <Row label={t('set.cache')} value={fmtDays(translate.cacheTtlDays)}>
                  <Slider
                    min={1}
                    max={90}
                    step={1}
                    value={translate.cacheTtlDays}
                    onChange={(e) => setTranslate({ ...translate, cacheTtlDays: Number(e.target.value) })}
                    className="w-full"
                  />
                </Row>
              </Accordion>
            )}

            {show('dict') && (
              <Accordion
                id="kivara-section-dict"
                icon={<BookOpen size={13} />}
                title={t('set.sectionOfflineDicts')}
                summary={packsSummary(packCount)}
                open={isOpen('dict')}
                onToggle={() => toggle('dict')}
                noPadding
                description={t('set.dictDesc')}
              >
                <DictPacksSection onEnabledCountChange={setPackCount} />
              </Accordion>
            )}

            {show('vip') && (
              <Accordion
                id="kivara-section-vip"
                icon={<Sparkles size={13} />}
                title={t('set.sectionEnrichment')}
                summary={vip.enabled ? t('set.summaryVipOn') : t('set.summaryStdOnly')}
                summaryColor={vip.enabled ? 'text-fuchsia-500 dark:text-fuchsia-400' : undefined}
                open={isOpen('vip')}
                onToggle={() => toggle('vip')}
                noPadding
                description={t('set.sourcesDesc')}
              >
                <VipSection />
              </Accordion>
            )}

            {show('ai') && (
              <Accordion
                id="kivara-section-ai"
                icon={<Sparkles size={13} />}
                title={t('set.sectionAiPremium')}
                summary={
                  ai.provider === 'disabled'
                    ? t('set.summaryOffF')
                    : ai.apiKey ? aiLabel : `${aiLabel} · ${t('set.summaryNoKey')}`
                }
                summaryColor={ai.provider !== 'disabled' && ai.apiKey ? 'text-indigo-500 dark:text-indigo-400' : undefined}
                open={isOpen('ai')}
                onToggle={() => toggle('ai')}
                description={t('set.aiDesc')}
              >
                <AiByokSection />
              </Accordion>
            )}

            {show('tts') && (
              <Accordion
                id="kivara-section-tts"
                icon={<Mic2 size={13} />}
                title={t('set.sectionTtsPremium')}
                summary={ttsLabel[tts.provider]}
                summaryColor={tts.provider !== 'disabled' ? 'text-indigo-500 dark:text-indigo-400' : undefined}
                open={isOpen('tts')}
                onToggle={() => toggle('tts')}
                description={t('set.ttsDesc')}
              >
                <Row label={t('set.provider')}>
                  <Select
                    value={tts.provider}
                    onChange={(e) => {
                      const provider = e.target.value as PremiumTtsProvider;
                      setTts({ ...tts, provider });
                      void ensureProviderHosts(`tts:${provider}`);
                    }}
                    className="w-full"
                  >
                    <option value="auto">{t('set.ttsAuto')}</option>
                    <option value="elevenlabs">ElevenLabs</option>
                    <option value="openai">OpenAI tts-1</option>
                    <option value="disabled">{t('set.deactivatedTemplate')}</option>
                  </Select>
                </Row>
                {(tts.provider === 'auto' || tts.provider === 'elevenlabs') && (
                  <>
                    <Row label={t('set.elevenLabsKey')}>
                      <SecretKeyInput
                        stored={tts.elevenLabsApiKey}
                        onChange={(v) => setTts({ ...tts, elevenLabsApiKey: v })}
                        placeholder="xi-..."
                        section="tts"
                        field="elevenLabsApiKey"
                      />
                    </Row>
                    <Row label={t('set.elevenLabsVoiceId')}>
                      <input
                        type="text"
                        value={tts.elevenLabsVoiceId}
                        onChange={(e) => setTts({ ...tts, elevenLabsVoiceId: e.target.value.trim() })}
                        placeholder="21m00Tcm4TlvDq8ikWAM (Rachel)"
                        className={`${inputCls} w-full`}
                      />
                    </Row>
                    <Row label={t('set.elevenLabsModel')}>
                      <Select
                        value={tts.elevenLabsModelId}
                        onChange={(e) => setTts({ ...tts, elevenLabsModelId: e.target.value })}
                        className="w-full"
                      >
                        <option value="eleven_multilingual_v2">{t('set.elevenMultilingual')}</option>
                        <option value="eleven_turbo_v2_5">{t('set.ttsModelCheap')}</option>
                        <option value="eleven_monolingual_v1">{t('set.elevenMonolingual')}</option>
                      </Select>
                    </Row>
                  </>
                )}
              </Accordion>
            )}
          </Section>
        )}

        {show('capture', 'perm', 'cleanup', 'keys') && (
          <Section title={t('set.groupAdvanced')}>
            {show('capture') && (
              <Accordion
                id="kivara-section-capture"
                icon={<Wand2 size={13} />}
                title={t('set.sectionAdvancedCapture')}
                summary={`${bufferSize} s`}
                open={isOpen('capture')}
                onToggle={() => toggle('capture')}
                description={t('set.captureDesc')}
              >
                <Row label={t('set.rollingBuffer')} value={`${bufferSize} s`} description={t('set.bufferDesc')}>
                  <Slider
                    min={10}
                    max={60}
                    step={5}
                    value={bufferSize}
                    onChange={(e) => setBufferSize(Number(e.target.value))}
                    className="w-full"
                  />
                </Row>
                <Row
                  label={t('set.sentenceEndLabel')}
                  description={endDetect === 'vad' ? t('set.vadModeDesc') : t('set.exactModeDesc')}
                >
                  <SegmentedControl
                    ariaLabel={t('set.sentenceEndLabel')}
                    options={[{ v: 'vad', l: t('set.vadLabel') }, { v: 'cue', l: t('set.cueExact') }]}
                    value={endDetect}
                    onChange={setEndDetect}
                  />
                </Row>
              </Accordion>
            )}

            {show('perm') && (
              <Accordion
                id="kivara-section-perm"
                icon={<KeyRound size={13} />}
                title={t('set.sectionHostAccess')}
                open={isOpen('perm')}
                onToggle={() => toggle('perm')}
                description={t('perm.intro')}
              >
                <HostPermissionsRow />
              </Accordion>
            )}

            {show('cleanup') && (
              <Accordion
                id="kivara-section-cleanup"
                icon={<EyeOff size={13} />}
                title={t('set.cleanupVisual')}
                summary={hiddenItems ? t('set.summaryCleanupHidden', { items: hiddenItems }) : t('set.summaryCleanupNone')}
                open={isOpen('cleanup')}
                onToggle={() => toggle('cleanup')}
                description={t('set.cleanupDesc')}
              >
                <Row label={t('set.hidePlayerUiLabel')} hint={t('set.hideProgressDesc')} inline>
                  <Toggle on={hideUI} onChange={setHideUI} ariaLabel={t('set.hidePlayerUiLabel')} />
                </Row>
                <Row label={t('set.noShadowsLabel')} hint={t('set.hideGradientsDesc')} inline>
                  <Toggle on={hideShadows} onChange={setHideShadows} ariaLabel={t('set.noShadowsLabel')} />
                </Row>
              </Accordion>
            )}

            {show('keys') && (
              <Accordion
                id="kivara-section-keys"
                icon={<Keyboard size={13} />}
                title={t('set.keyboardShortcutsTitle')}
                summary={keysSummary}
                open={isOpen('keys')}
                onToggle={() => toggle('keys')}
                description={t('set.shortcutsDesc')}
              >
                <ShortcutEditor compact />
                <div className="flex items-center justify-between gap-2 text-[12px] text-zinc-500 dark:text-zinc-400">
                  <span className="truncate">{t('set.splitExpression')}</span>
                  <span className="flex items-center gap-1 shrink-0">
                    <Kbd>Alt</Kbd>
                    <span className="text-zinc-400 dark:text-zinc-600 text-[11px]">+</span>
                    <Kbd>Scroll</Kbd>
                  </span>
                </div>
              </Accordion>
            )}
          </Section>
        )}

        {/* ── Project: support + repeat setup ──────────────────────────── */}
        {show('about') && (
          <Section title={t('set.groupAbout')}>
            <div className="flex items-center justify-between gap-2 pl-3.5 pr-2 min-h-[48px] py-2.5">
              <span className={`flex items-center gap-3 min-w-0 ${tx.label}`}>
                <IconTile><Heart size={16} /></IconTile>
                <span className="truncate">{t('set.supportProject')}</span>
              </span>
              <span className="flex items-center gap-0.5 shrink-0">
                <DonateBtn href="https://ko-fi.com/kivara" icon={<Coffee size={14} />} label="Ko-fi" />
                <DonateBtn href="https://github.com/sponsors/kivara" icon={<Github size={14} />} label="GitHub Sponsors" />
                <DonateBtn href="https://paypal.me/kivara" icon={<PaypalIcon />} label="PayPal" />
              </span>
            </div>
            <button
              type="button"
              onClick={reopenOnboarding}
              className={`w-full flex items-center px-4 min-h-[44px] text-left text-[13px] font-medium text-indigo-600 dark:text-indigo-400 outline-none focus-visible:bg-zinc-900/[0.03] dark:focus-visible:bg-white/[0.04] ${ui.rowHover}`}
            >
              {t('set.repeatInit')}
            </button>
          </Section>
        )}
      </div>
    </div>
  );
}
