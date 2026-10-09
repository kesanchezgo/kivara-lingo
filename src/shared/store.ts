import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import { pushSecretsToLocal, pullSecretsFromLocal, isOwnLocalWrite } from './secret-store';
import type {
  SubtitleStyles,
  AnkiMapping,
  Mode,
  CaptureSettings,
  CleanupSettings,
  TranslateSettings,
  AsrSettings,
  AiSettings,
  TtsSettings,
  OnboardingState,
  VipSettings,
  TelemetrySettings,
} from './types';
import { setTelemetryEnabled } from './telemetry';
import { DEFAULT_SHORTCUT_MAP, type ShortcutMap } from './shortcuts';

export const DEFAULT_SUBTITLE_STYLES: SubtitleStyles = {
  fontSize: 32,
  color: '#FCD34D',
  backgroundColor: '#000000',
  backgroundOpacity: 60,
  position: 'bottom',
  verticalOffset: 85,
  fontWeight: 'bold',
  textShadow: 80,
  // Kivara replaces the platform's defaults with its own layout — single-line
  // wrap, centered. The user can opt back into the platform's defaults from
  // the Subtitles tab.
  keepNativeLineBreaks: false,
  keepNativeAlignment: false,
  // Hover affordance defaults — match the design mock so the plate becomes
  // clearly more opaque while the user reads, with a soft blur to drown out
  // busy scenes.
  hoverOpacity: 80,
  hoverBlur: true,
};

export const DEFAULT_ANKI_MAPPING: AnkiMapping = {
  ankiUrl: 'http://127.0.0.1:8765',
  apiKey: '',
  // Empty by default — the onboarding wizard prompts the user to pick a
  // deck and model from their actual Anki collection. We don't ship
  // hard-coded defaults like 'Vocabulario Inglés' / 'Basic' because they
  // confuse the picker (looks like a value is selected when it isn't) and
  // some users may not have those deck names at all.
  deckName: '',
  modelName: '',
  fieldSources: {},
};

export const DEFAULT_CAPTURE: CaptureSettings = {
  autoMode: true,
  audioSource: 'tab',
  frameMoment: 'center',
  endDetect: 'vad',
  bufferSize: 30,
  preRoll: 300,
  postRoll: 400,
  cueMerge: 300,
};

export const DEFAULT_CLEANUP: CleanupSettings = {
  hideUI: true,
  hideShadows: true,
};

export const DEFAULT_TRANSLATE: TranslateSettings = {
  // Chain mode by default — offline first, then free providers, then any
  // configured premium API. Single mode is still selectable in Settings for
  // users who want exact control over which API gets hit.
  mode: 'chain',
  provider: 'offline',
  tiersEnabled: { free: true, premium: true },
  // MyMemory first because for short tokens (most subtitle hovers) its corpus
  // returns better quality than the unauthenticated Google scrape that Lingva
  // performs.
  freeChain: ['mymemory', 'lingva'],
  // Premium chain skips any provider that lacks credentials at call time.
  premiumChain: ['deepl', 'google', 'libretranslate'],
  targetLanguage: 'es',
  sourceLang: 'en',
  deeplToken: '',
  googleToken: '',
  libreTranslateUrl: 'https://libretranslate.com',
  libreTranslateToken: '',
  myMemoryEmail: '',
  // The original lingva.ml went down briefly in 2024 but came back in 2025
  // and is once again the canonical instance. The Vercel deployment at
  // `thedaviddelta.com` was DEPLOYMENT_PAUSED in 2026-Q2, so we no longer
  // default to it. The translator implementation falls back automatically
  // to a curated mirror list (`translate.plausibility.cloud`, `lingva.lunar.icu`)
  // if the configured host returns 5xx, so this default is safe.
  lingvaUrl: 'https://lingva.ml',
  cacheTtlDays: 30,
  // Dual caption (target-language subtitle below the source) is on by default
  // — matches Language Reactor / Trancy behaviour and the user-provided mock.
  showDualSubtitle: true,
  // Off by default — see TranslateSettings.autoSelectSourceAudio docstring.
  autoSelectSourceAudio: false,
};

export const DEFAULT_ASR: AsrSettings = {
  enabled: false,
  model: 'tiny',
};

export const DEFAULT_AI: AiSettings = {
  provider: 'disabled',
  apiKey: '',
  model: 'gpt-4o-mini',
  enrichOnSave: false,
  enrichOnHover: false,
  cacheTtlDays: 30,
  // AI overlay defaults: mnemonic ON (LLMs write better mnemonics
  // than the bundled placeholders), etymology ON (Etymonline often
  // returns nothing for inflected forms, LLM fills the gap), DALL-E
  // OFF (paid, opt-in only).
  preferAiMnemonic: true,
  preferAiEtymology: true,
  enableDalleFallback: false,
};

/**
 * Default VIP enrichment settings. Master switch off so the public Chrome
 * Web Store build doesn't fan out to third-party domains by accident — the
 * user opts in from Settings. Once on, every individual source defaults
 * to `true` so the user sees the full power immediately and can prune
 * down per source if they prefer a lean popover.
 */
export const DEFAULT_VIP: VipSettings = {
  enabled: false,
  // Standard tier — on by default since they don't need VIP master
  // switched on (they're free APIs without scraping or tokens).
  freeDictionary: true,
  datamuse: true,
  wiktionary: true,
  wiktionaryHtml: true,
  wiktionaryApi: true,
  wiktApi: true,
  mobyThesaurus: true,
  thesaurusCom: true,
  wordHippo: true,
  theIdioms: true,
  bundled: true,
  wordnet: true,
  yomitanPacks: true,
  // VIP editorial scrapers — gated by the master switch.
  britannicaDictionary: true,
  cambridge: true,
  oxfordLearners: true,
  longman: true,
  collins: true,
  merriamWebster: true,
  merriamWebsterThesaurus: true,
  oxfordCollocations: true,
  ozdic: true,
  pons: true,
  babla: true,
  dictCc: true,
  reverso: true,
  linguee: true,
  promtContext: true,
  wordReference: true,
  spanishDict: true,
  tatoeba: true,
  cambridgeAudio: true,
  oxfordAudio: true,
  forvo: true,
  linguaLibre: true,
  googleTtsFallback: true,
  unsplash: true,
  pixabay: true,
  bingImages: true,
  openverse: true,
  wikimediaCommons: true,
  duckduckgoImages: true,
  youglish: true,
  etymonline: true,
  perSourceTimeoutMs: 4000,
  cacheTtlDays: 14,
  unsplashAccessKey: '',
  pixabayApiKey: '',
};

export const DEFAULT_TTS: TtsSettings = {
  // 'auto' picks ElevenLabs if credentials are set, otherwise OpenAI when
  // the user already has an OpenAI AI provider configured, and finally
  // falls back to the SpeechSynthesis template (Anki's `{{tts}}`).
  provider: 'auto',
  elevenLabsApiKey: '',
  // "Rachel" — the canonical sample voice on the free tier.
  elevenLabsVoiceId: '21m00Tcm4TlvDq8ikWAM',
  // Multilingual v2 supports the languages we care about (EN, ES, FR, …).
  elevenLabsModelId: 'eleven_multilingual_v2',
};

/**
 * Floating panel position. `null` means "use default position" (top-right
 * corner). When the user drags the panel we persist the new offset here so
 * the position sticks across reloads/sessions. Coordinates are
 * **viewport-relative** (top/left CSS), so the panel always lands inside
 * the visible area regardless of scroll position.
 */
export interface PanelPosition {
  /** Pixels from viewport top */
  top: number;
  /** Pixels from viewport left */
  left: number;
}

export const DEFAULT_PANEL_POSITION: PanelPosition | null = null;

export const DEFAULT_ONBOARDING: OnboardingState = {
  completed: false,
  completedAt: null,
};

export const DEFAULT_TELEMETRY: TelemetrySettings = {
  // Local-only by design — no data leaves the device — so the default is
  // “on”. The user can flip it off in the dict-packs panel.
  enabled: true,
};

/**
 * Default user-customisable shortcut combos.
 *
 * Mirrors `DEFAULT_SHORTCUT_MAP` from `./shortcuts`. We re-export the value
 * so the persist `merge` helper can fall back when the persisted snapshot
 * is missing or older than the shortcut feature.
 */
export const DEFAULT_SHORTCUTS: ShortcutMap = DEFAULT_SHORTCUT_MAP;

export interface KivaraState {
  enabled: boolean;
  /**
   * Per-page visibility of the subtitle overlay. Distinct from `enabled`
   * (the master extension toggle): the user can briefly hide the captions
   * via the `toggle_subtitles` hotkey without disabling the whole extension.
   * Defaults to `true`.
   */
  subtitlesVisible: boolean;
  panelOpen: boolean;
  isPopupMode: boolean;
  isDarkMode: boolean;
  mode: Mode;
  subtitleStyles: SubtitleStyles;
  ankiMapping: AnkiMapping;
  capture: CaptureSettings;
  cleanup: CleanupSettings;
  translate: TranslateSettings;
  asr: AsrSettings;
  ai: AiSettings;
  vip: VipSettings;
  tts: TtsSettings;
  panelPosition: PanelPosition | null;
  onboarding: OnboardingState;
  telemetry: TelemetrySettings;
  shortcuts: ShortcutMap;
  audioCaptureActive: boolean;

  setEnabled: (v: boolean) => void;
  setSubtitlesVisible: (v: boolean) => void;
  setPanelOpen: (v: boolean) => void;
  setIsPopupMode: (v: boolean) => void;
  setIsDarkMode: (v: boolean) => void;
  setMode: (m: Mode) => void;
  setSubtitleStyles: (s: SubtitleStyles | ((prev: SubtitleStyles) => SubtitleStyles)) => void;
  setAnkiMapping: (m: AnkiMapping | ((prev: AnkiMapping) => AnkiMapping)) => void;
  setCapture: (c: CaptureSettings | ((prev: CaptureSettings) => CaptureSettings)) => void;
  setCleanup: (c: CleanupSettings | ((prev: CleanupSettings) => CleanupSettings)) => void;
  setTranslate: (t: TranslateSettings | ((prev: TranslateSettings) => TranslateSettings)) => void;
  setAsr: (a: AsrSettings | ((prev: AsrSettings) => AsrSettings)) => void;
  setAi: (a: AiSettings | ((prev: AiSettings) => AiSettings)) => void;
  setVip: (v: VipSettings | ((prev: VipSettings) => VipSettings)) => void;
  setTts: (t: TtsSettings | ((prev: TtsSettings) => TtsSettings)) => void;
  setPanelPosition: (p: PanelPosition | null) => void;
  setOnboarding: (o: OnboardingState | ((prev: OnboardingState) => OnboardingState)) => void;
  setTelemetry: (t: TelemetrySettings | ((prev: TelemetrySettings) => TelemetrySettings)) => void;
  setShortcuts: (s: ShortcutMap | ((prev: ShortcutMap) => ShortcutMap)) => void;
  setAudioCaptureActive: (v: boolean) => void;
  resetSubtitleStyles: () => void;
}

/**
 * Fields inside the persisted state JSON that hold sensitive credentials
 * and must be cipher-text at rest. Anything else is stored plaintext.
 *
 * The persist middleware sees only the JSON string we hand it from
 * `setItem`, so we transform the JSON in place — but the SECRETS THEMSELVES
 * no longer live in this blob: `pushSecretsToLocal` moves each one into its
 * own `chrome.storage.local` slot and blanks it here (sync carries zero
 * secret material, see secret-store.ts for why ciphertext-in-sync was
 * destroying keys cross-device). If the local write fails we fall back to
 * the old inline-encryption behavior so a storage hiccup can never lose a
 * key. On read, `pullSecretsFromLocal` injects them back as plaintext for
 * the React store.
 */

const fallbackStorage = new Map<string, string>();
/** Ring of the last blobs THIS context wrote per storage key — used to
 * recognise our own onChanged echo (skip the pointless rehydrate) and to
 * invalidate the write-through fallback only on genuine REMOTE changes.
 *
 * A ring, not a single slot: two saves fired back to back (A then B) make
 * Chrome deliver A's echo AFTER B was written. With one remembered blob,
 * A's echo looked REMOTE, the fallback was dropped and the debounced
 * rehydrate read storage while B was still in flight — the UI silently
 * reverted to A. Remembering the last few writes closes that window. */
const MAX_OWN_SYNC_WRITES = 8;
const ownSyncWrites = new Map<string, string[]>();

function rememberOwnSyncWrite(storageId: string, blob: string): void {
  const list = ownSyncWrites.get(storageId) ?? [];
  if (list[list.length - 1] !== blob) list.push(blob);
  while (list.length > MAX_OWN_SYNC_WRITES) list.shift();
  ownSyncWrites.set(storageId, list);
}

function isOwnSyncWrite(storageId: string, incoming: unknown): boolean {
  const list = ownSyncWrites.get(storageId);
  return typeof incoming === 'string' && !!list && list.includes(incoming);
}

/* ──────────────────────────────────────────────────────────────────────────
 * SYNC WRITE FAILURE — visible, not just a console line.
 *
 * chrome.storage.sync writes fail for one boring reason: the 8 KB per-item /
 * 100 KB total quota, or a user who turned sync off / is signed out. The old
 * code warned on the console and moved on, so the settings looked saved while
 * chrome.storage kept the stale blob — and the next rehydrate "reverted" the
 * UI with no explanation. The adapter now records the failure here and the
 * popup / settings render a discreet banner (i18n key
 * `storage.syncWriteFailed`).
 *
 * Deliberately NOT a field of KivaraState: `setItem` runs INSIDE a persist
 * write, so writing the flag through the store would schedule another
 * persist write, which writes the flag again… A tiny external store breaks
 * that cycle and keeps the failure out of the persisted blob.
 * ────────────────────────────────────────────────────────────────────────── */
let syncWriteFailed = false;
const syncWriteErrorListeners = new Set<(failed: boolean) => void>();

/** Current sync-write health. `false` = the last write reached sync. */
export function getSyncWriteFailed(): boolean {
  return syncWriteFailed;
}

/** Subscribe to sync-write failures (useSyncExternalStore-friendly: the
 * snapshot is a stable boolean). Returns the unsubscribe function. */
export function subscribeSyncWriteError(listener: (failed: boolean) => void): () => void {
  syncWriteErrorListeners.add(listener);
  return () => {
    syncWriteErrorListeners.delete(listener);
  };
}

function setSyncWriteError(failed: boolean): void {
  if (syncWriteFailed === failed) return;
  syncWriteFailed = failed;
  for (const listener of syncWriteErrorListeners) {
    try {
      listener(failed);
    } catch {
      // a broken subscriber must not break the storage write
    }
  }
}

/** SAVE: extract secrets into local slots. `pushSecretsToLocal` handles
 * both outcomes internally — slots written (state blanked) or local write
 * failed (state inline-encrypted as a fallback). Either way the JSON is
 * safe to persist: never plaintext, never a lost key. */
async function sealForSync(raw: string): Promise<string> {
  let parsed: { state?: Record<string, Record<string, unknown>> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  const state = parsed?.state;
  if (!state || typeof state !== 'object') return raw;

  await pushSecretsToLocal(state);
  try {
    return JSON.stringify(parsed);
  } catch {
    return raw;
  }
}

/** LOAD: inject local-slot secrets (migrating legacy inline values out). */
async function openFromSync(raw: string): Promise<string> {
  let parsed: { state?: Record<string, Record<string, unknown>> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  const state = parsed?.state;
  if (!state || typeof state !== 'object') return raw;

  await pullSecretsFromLocal(state);
  try {
    return JSON.stringify(parsed);
  } catch {
    return raw;
  }
}

/**
 * chrome.storage adapter for zustand's persist middleware. Falls back to
 * in-memory storage when chrome.storage is unavailable (e.g. unit tests).
 *
 * Wraps the read/write path with `transformSecrets` so credentials are
 * encrypted at rest in chrome.storage but plaintext in the React store.
 *
 * Exported for the unit tests: the fallback priority, the own-echo ring and
 * the write-failure flag are all observable through this surface.
 */
export function makeChromeStorage(area: 'sync' | 'local' = 'sync'): StateStorage {
  return {
    async getItem(name: string): Promise<string | null> {
      // Write-through fallback FIRST: it holds this context's latest write.
      // It is deleted on genuine remote onChanged events (see below), so a
      // present entry is always fresher than chrome.storage — which matters
      // when our own chrome write was slow or failed silently: without this
      // preference a debounced rehydrate would read the stale blob and
      // overwrite the adjustments made in the meantime.
      const fb = fallbackStorage.get(name);
      if (fb != null) {
        try {
          return await openFromSync(fb);
        } catch {
          return fb;
        }
      }
      let raw: string | null = null;
      try {
        if (typeof chrome !== 'undefined' && chrome.storage?.[area]) {
          const result = await chrome.storage[area].get(name);
          const value = result[name];
          raw = typeof value === 'string' ? value : null;
        }
      } catch {
        // fall through
      }
      if (raw == null) return null;
      try {
        return await openFromSync(raw);
      } catch {
        return raw;
      }
    },
    async setItem(name: string, value: string): Promise<void> {
      let toStore = value;
      try {
        toStore = await sealForSync(value);
      } catch {
        toStore = value;
      }
      // Write-through: the fallback always mirrors our latest write so a
      // later rehydrate in THIS context reads our value even if the chrome
      // write is still in flight or failed silently.
      try {
        fallbackStorage.set(name, toStore);
      } catch {
        // ignore
      }
      rememberOwnSyncWrite(`${area}:${name}`, toStore);
      try {
        if (typeof chrome !== 'undefined' && chrome.storage?.[area]) {
          await chrome.storage[area].set({ [name]: toStore });
          setSyncWriteError(false); // the blob is durable in sync again
          return;
        }
      } catch (err) {
        // VISIBLE failure — the old code swallowed this, so a quota/
        // disabled-sync failure silently left chrome.storage stale while
        // memory moved on; the next rehydrate then "reverted" the UI. The
        // flag drives the banner in the popup and in Settings.
        console.warn('[Kivara store] chrome.storage.set failed, using in-memory fallback', err);
        setSyncWriteError(true);
      }
    },
    async removeItem(name: string): Promise<void> {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage?.[area]) {
          await chrome.storage[area].remove(name);
          // Drop the write-through copy too: keeping it would make every
          // later getItem in THIS context resurrect the removed state, and
          // the stale own-echo ring would then hide the removal from the
          // cross-context listener.
          fallbackStorage.delete(name);
          ownSyncWrites.delete(`${area}:${name}`);
          setSyncWriteError(false);
          return;
        }
      } catch (err) {
        console.warn('[Kivara store] chrome.storage.remove failed', err);
        setSyncWriteError(true);
      }
      try {
        fallbackStorage.delete(name);
      } catch {
        // ignore
      }
      ownSyncWrites.delete(`${area}:${name}`);
    },
  };
}

const STORE_KEY = 'kivara-lingo-state';
/** Single source of truth for the chrome.storage key. Background
 * readers import this instead of re-declaring the literal (six copies
 * used to drift independently). */
export const PERSIST_STORE_KEY = STORE_KEY;

/** The one sync adapter the persist middleware uses. Exported so
 * `retrySyncWrite` can re-run a failed write through the same code path
 * (own-echo ring, failure flag, fallback update) instead of hand-rolling a
 * second chrome.storage call. */
export const syncStateStorage: StateStorage = makeChromeStorage('sync');

/** Re-send the blob this context already sealed. Called from the banner's
 * retry button once the user frees sync space or re-enables Chrome sync.
 * Returns false when there is nothing to retry yet. */
export async function retrySyncWrite(): Promise<boolean> {
  const blob = fallbackStorage.get(STORE_KEY);
  if (typeof blob !== 'string') return false;
  await syncStateStorage.setItem(STORE_KEY, blob);
  return !getSyncWriteFailed();
}

/**
 * Defensive merge for persisted state. Zustand's default shallow merge only
 * fills in MISSING top-level keys — it doesn't recurse, so a snapshot saved
 * before a `translate.tiersEnabled` field existed will load with
 * `translate.tiersEnabled === undefined` and crash SettingsTab.
 *
 * This walks each top-level settings group and re-applies the default if
 * either the group is missing or any of its inner fields are missing. Existing
 * user choices are preserved.
 */
function mergePersisted(persistedState: unknown, currentState: KivaraState): KivaraState {
  const persisted = (persistedState ?? {}) as Partial<KivaraState>;
  return {
    ...currentState,
    ...persisted,
    subtitleStyles: { ...DEFAULT_SUBTITLE_STYLES, ...(persisted.subtitleStyles ?? {}) },
    ankiMapping: {
      ...DEFAULT_ANKI_MAPPING,
      ...(persisted.ankiMapping ?? {}),
      fieldSources: {
        ...DEFAULT_ANKI_MAPPING.fieldSources,
        ...(persisted.ankiMapping?.fieldSources ?? {}),
      },
    },
    capture: { ...DEFAULT_CAPTURE, ...(persisted.capture ?? {}) },
    cleanup: { ...DEFAULT_CLEANUP, ...(persisted.cleanup ?? {}) },
    translate: {
      ...DEFAULT_TRANSLATE,
      ...(persisted.translate ?? {}),
      tiersEnabled: {
        ...DEFAULT_TRANSLATE.tiersEnabled,
        ...(persisted.translate?.tiersEnabled ?? {}),
      },
      freeChain: Array.isArray(persisted.translate?.freeChain)
        ? persisted.translate!.freeChain
        : DEFAULT_TRANSLATE.freeChain,
      premiumChain: Array.isArray(persisted.translate?.premiumChain)
        ? persisted.translate!.premiumChain
        : DEFAULT_TRANSLATE.premiumChain,
    },
    asr: { ...DEFAULT_ASR, ...(persisted.asr ?? {}) },
    ai: { ...DEFAULT_AI, ...(persisted.ai ?? {}) },
    vip: { ...DEFAULT_VIP, ...(persisted.vip ?? {}) },
    tts: { ...DEFAULT_TTS, ...(persisted.tts ?? {}) },
    panelPosition: persisted.panelPosition ?? DEFAULT_PANEL_POSITION,
    onboarding: { ...DEFAULT_ONBOARDING, ...(persisted.onboarding ?? {}) },
    telemetry: { ...DEFAULT_TELEMETRY, ...(persisted.telemetry ?? {}) },
    shortcuts: { ...DEFAULT_SHORTCUTS, ...(persisted.shortcuts ?? {}) },
  };
}

export const useKivaraStore = create<KivaraState>()(
  persist(
    (set) => ({
      enabled: true,
      subtitlesVisible: true,
      panelOpen: false,
      isPopupMode: false,
      isDarkMode: true,
      mode: 'learning',
      subtitleStyles: DEFAULT_SUBTITLE_STYLES,
      ankiMapping: DEFAULT_ANKI_MAPPING,
      capture: DEFAULT_CAPTURE,
      cleanup: DEFAULT_CLEANUP,
      translate: DEFAULT_TRANSLATE,
      asr: DEFAULT_ASR,
      ai: DEFAULT_AI,
      vip: DEFAULT_VIP,
      tts: DEFAULT_TTS,
      panelPosition: DEFAULT_PANEL_POSITION,
      onboarding: DEFAULT_ONBOARDING,
      telemetry: DEFAULT_TELEMETRY,
      shortcuts: DEFAULT_SHORTCUTS,
      audioCaptureActive: false,

      setEnabled: (v) => set({ enabled: v }),
      setSubtitlesVisible: (v) => set({ subtitlesVisible: v }),
      setPanelOpen: (v) => set({ panelOpen: v }),
      setIsPopupMode: (v) => set({ isPopupMode: v }),
      setIsDarkMode: (v) => set({ isDarkMode: v }),
      setMode: (m) => set({ mode: m }),
      setSubtitleStyles: (s) =>
        set((state) => ({
          subtitleStyles: typeof s === 'function' ? s(state.subtitleStyles) : s,
        })),
      setAnkiMapping: (m) =>
        set((state) => ({
          ankiMapping: typeof m === 'function' ? m(state.ankiMapping) : m,
        })),
      setCapture: (c) =>
        set((state) => ({
          capture: typeof c === 'function' ? c(state.capture) : c,
        })),
      setCleanup: (c) =>
        set((state) => ({
          cleanup: typeof c === 'function' ? c(state.cleanup) : c,
        })),
      setTranslate: (t) =>
        set((state) => ({
          translate: typeof t === 'function' ? t(state.translate) : t,
        })),
      setAsr: (a) =>
        set((state) => ({
          asr: typeof a === 'function' ? a(state.asr) : a,
        })),
      setAi: (a) =>
        set((state) => ({
          ai: typeof a === 'function' ? a(state.ai) : a,
        })),
      setVip: (v) =>
        set((state) => ({
          vip: typeof v === 'function' ? v(state.vip) : v,
        })),
      setTts: (t) =>
        set((state) => ({
          tts: typeof t === 'function' ? t(state.tts) : t,
        })),
      setPanelPosition: (p) => set({ panelPosition: p }),
      setOnboarding: (o) =>
        set((state) => ({
          onboarding: typeof o === 'function' ? o(state.onboarding) : o,
        })),
      setTelemetry: (t) =>
        set((state) => ({
          telemetry: typeof t === 'function' ? t(state.telemetry) : t,
        })),
      setShortcuts: (s) =>
        set((state) => ({
          shortcuts: typeof s === 'function' ? s(state.shortcuts) : s,
        })),
      setAudioCaptureActive: (v) => set({ audioCaptureActive: v }),
      resetSubtitleStyles: () => set({ subtitleStyles: DEFAULT_SUBTITLE_STYLES }),
    }),
    {
      name: STORE_KEY,
      storage: createJSONStorage(() => syncStateStorage),
      partialize: (state) => ({
        enabled: state.enabled,
        subtitlesVisible: state.subtitlesVisible,
        // panelOpen / isPopupMode / audioCaptureActive are per-tab, per-
        // instant UI state — persisting them to sync opened the panel on
        // every tab and every device on rehydrate. They stay in memory only.
        isDarkMode: state.isDarkMode,
        mode: state.mode,
        subtitleStyles: state.subtitleStyles,
        ankiMapping: state.ankiMapping,
        capture: state.capture,
        cleanup: state.cleanup,
        translate: state.translate,
        asr: state.asr,
        ai: state.ai,
        vip: state.vip,
        tts: state.tts,
        panelPosition: state.panelPosition,
        onboarding: state.onboarding,
        telemetry: state.telemetry,
        shortcuts: state.shortcuts,
      }),
      // Deep-merge defaults into the persisted slice so a snapshot saved by an
      // older build (e.g. missing translate.tiersEnabled) doesn't crash the
      // panel with `Cannot read properties of undefined (reading 'free')`.
      merge: (persisted, current) => mergePersisted(persisted, current as KivaraState),
    },
  ),
);

// Cross-context state sync. TWO signals now:
//  • area 'sync' + our STORE_KEY → a non-secret setting changed elsewhere.
//  • area 'local' + a `kivara-secret:v1:*` key → a SECRET changed elsewhere.
//    Secrets no longer ride in sync (see secret-store.ts), so changing only
//    a key produces an IDENTICAL sync blob and Chrome fires no 'sync' event.
//    Without this branch the popup/content would keep the OLD key in memory
//    and their next persist could overwrite the new one.
// Debounced (250 ms): a burst of writes (slider drag, rapid toggles) used
// to trigger one full rehydrate + decrypt pass per write.
let rehydrateTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRehydrate() {
  if (rehydrateTimer) clearTimeout(rehydrateTimer);
  rehydrateTimer = setTimeout(() => {
    rehydrateTimer = null;
    void useKivaraStore.persist.rehydrate();
  }, 250);
}
try {
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && Object.prototype.hasOwnProperty.call(changes, STORE_KEY)) {
        const incoming = (changes as Record<string, { newValue?: unknown }>)[STORE_KEY]?.newValue;
        // Own echo — one of the blobs THIS context wrote (ring, so the echo
        // of an earlier write in a burst still matches). Our write-through
        // fallback already holds the newest one; rehydrating would only
        // waste a full decrypt pass — and on a burst it would read storage
        // while the last write was still in flight.
        if (isOwnSyncWrite(`sync:${STORE_KEY}`, incoming)) return;
        // Genuine REMOTE change: drop our write-through copy AND the own-echo
        // ring so the rehydrate reads the fresh chrome.storage blob, and so
        // a subsequent echo of the blobs we just replaced is no longer
        // mistaken for a remote change.
        try {
          fallbackStorage.delete(STORE_KEY);
        } catch {
          // ignore
        }
        ownSyncWrites.delete(`sync:${STORE_KEY}`);
        scheduleRehydrate();
        return;
      }
      if (area === 'local') {
        const entries = Object.entries(changes);
        // Own echo — every touched secret matches the ciphertext/tombstone
        // THIS context just wrote: skip the pointless rehydrate (it would
        // only re-run a full decrypt pass over identical bytes).
        const allOwn = entries.length > 0 && entries.every(([k, c]) =>
          k.startsWith('kivara-secret:v1:') &&
          isOwnLocalWrite(k, (c as { newValue?: unknown })?.newValue),
        );
        if (allOwn) return;
        const touchedSecret = entries.some(([k]) =>
          k.startsWith('kivara-secret:v1:'),
        );
        if (touchedSecret) scheduleRehydrate();
      }
    });
  }
} catch {
  // ignore — chrome.storage may not be available in test environments
}

// Keep the telemetry module's cached toggle in sync with the store so the
// service worker / content script can call `recordLookupHit` etc. without
// reading the store on every lookup.
setTelemetryEnabled(useKivaraStore.getState().telemetry.enabled);
useKivaraStore.subscribe((state, prev) => {
  if (state.telemetry.enabled !== prev.telemetry.enabled) {
    setTelemetryEnabled(state.telemetry.enabled);
  }
});
