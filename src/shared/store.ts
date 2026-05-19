import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import { encryptSecret, decryptSecret, isEncrypted } from './secret-store';
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
  TelemetrySettings,
} from './types';
import { setTelemetryEnabled } from './telemetry';

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
  // The original lingva.ml host went down in 2024; thedaviddelta runs a
  // long-lived Vercel deployment at this domain. Users can point at their own
  // self-hosted instance or any of the mirrors listed at
  // https://github.com/thedaviddelta/lingva-translate#instances .
  lingvaUrl: 'https://lingva.thedaviddelta.com',
  cacheTtlDays: 30,
  // Dual caption (target-language subtitle below the source) is on by default
  // — matches Language Reactor / Trancy behaviour and the user-provided mock.
  showDualSubtitle: true,
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
  tts: TtsSettings;
  panelPosition: PanelPosition | null;
  onboarding: OnboardingState;
  telemetry: TelemetrySettings;
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
  setTts: (t: TtsSettings | ((prev: TtsSettings) => TtsSettings)) => void;
  setPanelPosition: (p: PanelPosition | null) => void;
  setOnboarding: (o: OnboardingState | ((prev: OnboardingState) => OnboardingState)) => void;
  setTelemetry: (t: TelemetrySettings | ((prev: TelemetrySettings) => TelemetrySettings)) => void;
  setAudioCaptureActive: (v: boolean) => void;
  resetSubtitleStyles: () => void;
}

/**
 * Fields inside the persisted state JSON that hold sensitive credentials
 * and must be cipher-text at rest. Anything else is stored plaintext.
 *
 * The persist middleware sees only the JSON string we hand it from
 * `setItem`, so we transform the JSON in place — encrypt these fields on
 * write, decrypt them on read — keeping the in-memory store plaintext for
 * the React components.
 */
const SECRET_FIELDS: Array<{ section: 'translate' | 'ai' | 'ankiMapping' | 'tts'; field: string }> = [
  { section: 'translate', field: 'deeplToken' },
  { section: 'translate', field: 'googleToken' },
  { section: 'translate', field: 'libreTranslateToken' },
  { section: 'ai', field: 'apiKey' },
  { section: 'ankiMapping', field: 'apiKey' },
  { section: 'tts', field: 'elevenLabsApiKey' },
];

async function transformSecrets(
  raw: string,
  direction: 'encrypt' | 'decrypt',
): Promise<string> {
  let parsed: { state?: Record<string, Record<string, unknown>> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  const state = parsed?.state;
  if (!state || typeof state !== 'object') return raw;

  let mutated = false;
  for (const { section, field } of SECRET_FIELDS) {
    const node = state[section];
    if (!node || typeof node !== 'object') continue;
    const value = (node as Record<string, unknown>)[field];
    if (typeof value !== 'string' || !value) continue;

    if (direction === 'encrypt') {
      // Already encrypted (idempotent on persist tick) — leave alone.
      if (isEncrypted(value)) continue;
      const cipher = await encryptSecret(value);
      (node as Record<string, unknown>)[field] = cipher;
      mutated = cipher !== value;
    } else {
      if (!isEncrypted(value)) continue; // legacy plaintext, pass through
      const plain = await decryptSecret(value);
      (node as Record<string, unknown>)[field] = plain;
      mutated = true;
    }
  }
  if (!mutated) return raw;
  try {
    return JSON.stringify(parsed);
  } catch {
    return raw;
  }
}

const fallbackStorage = new Map<string, string>();

/**
 * chrome.storage adapter for zustand's persist middleware. Falls back to
 * in-memory storage when chrome.storage is unavailable (e.g. unit tests).
 *
 * Wraps the read/write path with `transformSecrets` so credentials are
 * encrypted at rest in chrome.storage but plaintext in the React store.
 */
function makeChromeStorage(area: 'sync' | 'local' = 'sync'): StateStorage {
  return {
    async getItem(name: string): Promise<string | null> {
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
      if (raw == null) {
        raw = fallbackStorage.get(name) ?? null;
      }
      if (raw == null) return null;
      try {
        return await transformSecrets(raw, 'decrypt');
      } catch {
        return raw;
      }
    },
    async setItem(name: string, value: string): Promise<void> {
      let toStore = value;
      try {
        toStore = await transformSecrets(value, 'encrypt');
      } catch {
        toStore = value;
      }
      try {
        if (typeof chrome !== 'undefined' && chrome.storage?.[area]) {
          await chrome.storage[area].set({ [name]: toStore });
          return;
        }
      } catch {
        // fall through
      }
      try {
        fallbackStorage.set(name, toStore);
      } catch {
        // ignore
      }
    },
    async removeItem(name: string): Promise<void> {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage?.[area]) {
          await chrome.storage[area].remove(name);
          return;
        }
      } catch {
        // fall through
      }
      try {
        fallbackStorage.delete(name);
      } catch {
        // ignore
      }
    },
  };
}

const STORE_KEY = 'kivara-lingo-state';

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
    tts: { ...DEFAULT_TTS, ...(persisted.tts ?? {}) },
    panelPosition: persisted.panelPosition ?? DEFAULT_PANEL_POSITION,
    onboarding: { ...DEFAULT_ONBOARDING, ...(persisted.onboarding ?? {}) },
    telemetry: { ...DEFAULT_TELEMETRY, ...(persisted.telemetry ?? {}) },
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
      tts: DEFAULT_TTS,
      panelPosition: DEFAULT_PANEL_POSITION,
      onboarding: DEFAULT_ONBOARDING,
      telemetry: DEFAULT_TELEMETRY,
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
      setAudioCaptureActive: (v) => set({ audioCaptureActive: v }),
      resetSubtitleStyles: () => set({ subtitleStyles: DEFAULT_SUBTITLE_STYLES }),
    }),
    {
      name: STORE_KEY,
      storage: createJSONStorage(() => makeChromeStorage('sync')),
      partialize: (state) => ({
        enabled: state.enabled,
        subtitlesVisible: state.subtitlesVisible,
        panelOpen: state.panelOpen,
        isPopupMode: state.isPopupMode,
        isDarkMode: state.isDarkMode,
        mode: state.mode,
        subtitleStyles: state.subtitleStyles,
        ankiMapping: state.ankiMapping,
        capture: state.capture,
        cleanup: state.cleanup,
        translate: state.translate,
        asr: state.asr,
        ai: state.ai,
        tts: state.tts,
        panelPosition: state.panelPosition,
        onboarding: state.onboarding,
        telemetry: state.telemetry,
      }),
      // Deep-merge defaults into the persisted slice so a snapshot saved by an
      // older build (e.g. missing translate.tiersEnabled) doesn't crash the
      // panel with `Cannot read properties of undefined (reading 'free')`.
      merge: (persisted, current) => mergePersisted(persisted, current as KivaraState),
    },
  ),
);

// Cross-context state sync: when another extension context (popup / options /
// background) writes to chrome.storage.sync, rehydrate this store so the
// content script picks up the change without a full reload.
try {
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && Object.prototype.hasOwnProperty.call(changes, STORE_KEY)) {
        void useKivaraStore.persist.rehydrate();
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
