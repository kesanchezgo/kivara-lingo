export interface SubtitleStyles {
  fontSize: number;
  color: string;
  backgroundColor: string;
  backgroundOpacity: number;
  position: 'top' | 'middle' | 'bottom';
  /** 0..100 — vertical center of the subtitle expressed as % of the video height */
  verticalOffset: number;
  fontWeight: 'normal' | 'bold' | '900';
  /** 0..100 — text shadow intensity (0 = off) */
  textShadow: number;
  /**
   * When true, preserve the platform's original line breaks (`\n` inside the
   * cue text) instead of collapsing them into a single line. Off by default
   * because Kivara's own renderer wraps on the natural word boundary and
   * looks tidier than the platform's hard breaks.
   */
  keepNativeLineBreaks: boolean;
  /**
   * When true, honour the cue's `align` setting from the platform (left /
   * center / right) instead of always centering. Falls back to center when
   * the adapter couldn't extract an alignment hint.
   */
  keepNativeAlignment: boolean;
  /**
   * Background opacity (0..100) used while the subtitle is being hovered in
   * learning mode. Always coerced to be ≥ `backgroundOpacity` so hovering
   * can only ever make the plate MORE legible, never less. Default 80.
   */
  hoverOpacity: number;
  /**
   * Apply a `backdrop-filter: blur(2px)` behind the plate during hover so
   * busy scenes don't bleed through onto the popover. Default true.
   */
  hoverBlur: boolean;
}

/** Native cue alignment as preserved by the parser/adapter. */
export type CueAlign = 'start' | 'center' | 'end' | 'left' | 'right';

/**
 * One source of data that can populate a single Anki note field. The names
 * mirror the labels users see in the field-mapping UI; keep them stable —
 * persisted mappings refer to them by string.
 *
 * The "kivara default" Anki model ships with nine fields (word, phonetic,
 * sentence, translation, bilingual, monolingual, picture, sentence audio,
 * word audio); each one has a matching `FieldSource` so a sensible mapping
 * can be auto-detected.
 *
 *  - `selection`      — the token the user hovered / clicked          → word
 *  - `cue`            — the full subtitle the cue belongs to          → sentence
 *  - `phonetic`       — IPA pronunciation from the dictionary         → phonetic
 *  - `translation`    — short translation (remote translator OR dict) → translation
 *  - `bilingual`      — gram-cat + short bilingual definition         → bilingual
 *  - `monolingual`    — definition in the source language             → monolingual
 *  - `examples`       — usage examples joined by <br>                 → (extra)
 *  - `frame`          — JPG screenshot of the video at the cue        → picture
 *  - `sentence-audio` — captured tab audio for the full cue           → sentence audio
 *  - `word-audio`     — TTS audio of the word (or live capture slice) → word audio
 *  - `dictionary`     — DEPRECATED catch-all for users coming from
 *                       the legacy mapping; falls back to bilingual.
 *  - `tabCapture`     — DEPRECATED alias for `sentence-audio`.
 *  - `tts`            — DEPRECATED alias for `word-audio`.
 *  - `ai-*`           — premium AI enrichment fields. AI mnemonic /
 *                       etymology feed the base `mnemonic` / `etymology`
 *                       sources instead of having duplicate fields.
 *  - `manual`         — user fills in the value themselves.
 */
export type FieldSource =
  | 'selection'
  | 'cue'
  | 'phonetic'
  | 'translation'
  | 'bilingual'
  | 'monolingual'
  | 'examples'
  | 'frame'
  | 'sentence-audio'
  | 'word-audio'
  | 'dictionary'
  | 'translate'
  | 'tabCapture'
  | 'tts'
  | 'ai-definition'
  | 'ai-synonyms'
  | 'ai-collocations'
  | 'ai-nuance'
  | 'ai-register'
  /* Multi-source enrichment (Standard + VIP) — exposed as Anki
   * fields so the user can build a mazo with rich data without
   * any API key. Each one is automatically populated by the
   * orchestrator's merged DictionaryEntry / VipEnrichment. */
  | 'synonyms'
  | 'antonyms'
  | 'collocations'
  | 'etymology'
  | 'mnemonic'
  | 'image'
  | 'video-link'
  | 'manual';

export interface AudioClipResponse {
  ok: boolean;
  /** data URL: `data:audio/webm;base64,...` */
  dataUrl?: string;
  /** MIME type the offscreen recorder produced */
  mimeType?: string;
  /** Duration of the slice in milliseconds */
  durationMs?: number;
  error?: string;
}

export interface AudioCaptureStatus {
  active: boolean;
  tabId: number | null;
  /** mimeType currently used by the recorder */
  mimeType?: string;
  error?: string;
}

export interface TranslateRequest {
  text: string;
  sourceLang: string;
  targetLang?: string;
}

export interface TranslateResponse {
  ok: boolean;
  translatedText?: string;
  provider?: string;
  cached?: boolean;
  error?: string;
}

export interface TtsSpeakRequest {
  text: string;
  lang: string;
}

export interface TtsResponse {
  ok: boolean;
  error?: string;
}

export interface AnkiMapping {
  ankiUrl: string;
  /**
   * Optional AnkiConnect API key. Recent AnkiConnect versions allow
   * protecting the endpoint with a shared secret; when set we send it
   * with every request as `params.key`.
   */
  apiKey?: string;
  deckName: string;
  modelName: string;
  /** key = exact Anki field name, value = source */
  fieldSources: Record<string, FieldSource>;
}

export type Mode = 'learning' | 'reading';

export type AudioSource = 'tab' | 'mic';
export type FrameMoment = 'start' | 'center' | 'end';
export type EndDetect = 'vad' | 'cue';

export interface CaptureSettings {
  autoMode: boolean;
  audioSource: AudioSource;
  frameMoment: FrameMoment;
  endDetect: EndDetect;
  /** rolling buffer length in seconds */
  bufferSize: number;
  /** ms before cue.start that is also captured */
  preRoll: number;
  /** ms after cue.end that is also captured */
  postRoll: number;
  /** ms — merge adjacent cues separated by less than this */
  cueMerge: number;
}

export interface CleanupSettings {
  hideUI: boolean;
  hideShadows: boolean;
}

/**
 * Concrete translation providers (in roughly the same order they're tried
 * inside a chain): the bundled offline dictionary, two zero-config FREE
 * networked services, three BYOK premium services, and a sentinel value
 * ('none') we use when callers want to signal "no remote translation at all"
 * inside a single-provider config.
 *
 * The chain mode walks them in tier order (offline → free → premium) and
 * returns the first successful result.
 */
export type TranslateProvider =
  | 'offline'
  | 'mymemory'
  | 'lingva'
  | 'libretranslate'
  | 'deepl'
  | 'google';

export type TranslateMode = 'single' | 'chain';

export type TranslateTier = 'offline' | 'free' | 'premium';

export interface TranslateSettings {
  /**
   * Selection strategy:
   *  - 'single' picks just `provider` (legacy behaviour).
   *  - 'chain' walks `tiersEnabled` from offline → free → premium until one
   *    succeeds. This is the recommended default.
   */
  mode: TranslateMode;
  /** Active provider when `mode === 'single'`. */
  provider: TranslateProvider;
  /**
   * Which tiers participate in chain mode. Offline is always tried first and
   * is non-disable-able (the bundled dictionary is free and fast).
   */
  tiersEnabled: { free: boolean; premium: boolean };
  /**
   * Ordered list of free providers to attempt in chain mode. The default is
   * `['mymemory', 'lingva']` — MyMemory first because it returns higher quality
   * for short tokens, Lingva second because it's an unauthenticated Google
   * proxy and may rate-limit when used heavily.
   */
  freeChain: TranslateProvider[];
  /**
   * Ordered list of premium providers tried after the free chain. Each one
   * requires its own credential (see fields below); a provider with a missing
   * credential is silently skipped.
   */
  premiumChain: TranslateProvider[];
  /** Native target language (BCP-47). Default 'es'. This is the user's
   *  mother tongue — translations go INTO this language. */
  targetLanguage: string;
  /**
   * Source language the user is LEARNING (BCP-47). Default 'en'. Used to:
   *  - Select which subtitle track to show (prefer English over others).
   *  - Tell the translate chain which direction to translate.
   *  - Inform the tokenizer which dictionary to load.
   */
  sourceLang: string;
  /** DeepL API token (free or pro) */
  deeplToken: string;
  /** Google Cloud Translate v3 / v2 API key */
  googleToken: string;
  /** LibreTranslate base URL (e.g. https://libretranslate.com or self-hosted) */
  libreTranslateUrl: string;
  /** Optional API key for paid LibreTranslate instances */
  libreTranslateToken: string;
  /**
   * Optional email passed to MyMemory's `de` parameter. Anonymous = 5000
   * chars/day; with an email = 50000 chars/day.
   */
  myMemoryEmail: string;
  /**
   * Lingva base URL. Defaults to a well-known mirror. Self-host with
   * `docker run -p 3000:3000 thedaviddelta/lingva-translate` and point this at
   * `http://localhost:3000`.
   */
  lingvaUrl: string;
  /** Cache TTL in days (default 30) */
  cacheTtlDays: number;
  /**
   * Render the translated full-sentence as a second subtitle line below the
   * source caption. Standard dual-caption feature in Language Reactor /
   * Trancy. Default true.
   */
  showDualSubtitle: boolean;
  /**
   * Auto-select the audio track that matches the user's `sourceLang` when
   * the platform exposes multiple language audio tracks (HBO Max,
   * Disney+, Prime Video). Off by default — many users prefer the audio
   * track that ships native to their region (LATAM dub, etc.) and use
   * Kivara only for subtitles. Switching this on means: when the player
   * loads a manifest with multiple audio AdaptationSets, we pick the one
   * tagged `sourceLang` and tell the player to use it. Doesn't affect
   * YouTube (single audio track per video). Doesn't affect Netflix
   * (audio track switch happens via the Netflix player API which is
   * heavily restricted in the browser).
   */
  autoSelectSourceAudio: boolean;
}

export interface AsrSettings {
  /** Whether the user opted-in to on-device transcription as fallback */
  enabled: boolean;
  /**
   * Whisper model size. The trade-off is download size vs. transcription
   * accuracy and speed. Whisper.cpp WASM runs on CPU only (no GPU), so
   * larger models are 5-10× slower on the same machine — this is more
   * about hardware budget than network.
   *
   *  - `tiny`   — ~75 MB,  fastest, ~5 % WER on clean speech.
   *  - `base`   — ~150 MB, ~3.5 % WER. Good middle ground.
   *  - `small`  — ~466 MB, ~2.5 % WER. Slow on older laptops.
   *  - `medium` — ~1.5 GB, ~2 % WER. Only for desktop / multi-core.
   */
  model: 'tiny' | 'base' | 'small' | 'medium';
  /**
   * Optional override for the Whisper.cpp glue script URL. Defaults to a
   * pinned jsdelivr CDN URL inside `whisper-asr.ts`. Surfaced here so the
   * user can point at a self-hosted build (e.g. for offline environments).
   */
  glueUrl?: string;
  /**
   * Optional override for the ggml model URL. Leave empty to use the
   * preset that matches `model`. The preset table lives in
   * `whisper-asr.ts::DEFAULT_MODEL_URLS`.
   */
  modelUrl?: string;
}

export interface TranscribeRequest {
  startMs: number;
  endMs: number;
  /** BCP-47 language tag; 'auto' lets Whisper detect */
  language?: string;
  /** Trim to detected speech via RMS-based VAD. Default true. */
  useVad?: boolean;
  preRollMs?: number;
  postRollMs?: number;
  /** Override the Whisper.cpp loader at runtime */
  whisperConfig?: {
    glueUrl?: string;
    modelUrl?: string;
    cacheName?: string;
  };
}

export interface TranscribeSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export type TranscribeResponse =
  | {
      ok: true;
      text: string;
      segments: TranscribeSegment[];
      language?: string;
      /** Clip metadata so the caller can attach it to a card. */
      clip: AudioClipResponse;
    }
  | { ok: false; error: string; transient?: boolean };

export type AiProvider = 'openai' | 'anthropic' | 'google-ai' | 'disabled';

/**
 * Premium TTS providers that emit a downloadable audio blob (so we can
 * attach the file to an Anki note instead of just speaking it).
 *
 *  - `'auto'`: prefer any premium provider with credentials, otherwise
 *    fall back to OpenAI tts-1 (requires OpenAI provider configured) and
 *    finally to the SpeechSynthesis template.
 *  - `'openai'`: force OpenAI tts-1 — uses the same `apiKey` the user
 *    already configured under AI provider when `ai.provider === 'openai'`.
 *  - `'elevenlabs'`: 11Labs `text-to-speech` endpoint. Higher fidelity,
 *    ~10× more expensive than OpenAI.
 *  - `'disabled'`: never make remote TTS calls. Cards keep the cue audio
 *    if available, or fall back to Anki's `{{tts}}` template.
 */
export type PremiumTtsProvider = 'auto' | 'openai' | 'elevenlabs' | 'disabled';

export interface TtsSettings {
  /** Which provider supplies the downloadable MP3 attached to Anki cards. */
  provider: PremiumTtsProvider;
  /** ElevenLabs API key (xi-api-key header). */
  elevenLabsApiKey: string;
  /**
   * ElevenLabs voice ID. Defaults to `21m00Tcm4TlvDq8ikWAM` ("Rachel"),
   * which is the canonical sample voice and works without a paid plan.
   */
  elevenLabsVoiceId: string;
  /**
   * ElevenLabs model. `eleven_multilingual_v2` covers EN/ES/FR/DE/etc.
   * `eleven_monolingual_v1` is cheaper but English-only.
   */
  elevenLabsModelId: string;
}

export interface AiSettings {
  /** Active AI backend */
  provider: AiProvider;
  /** API key (chrome.storage.sync — never committed) */
  apiKey: string;
  /** Model identifier (e.g. gpt-4o-mini, claude-haiku-4-5, gemini-2.5-flash) */
  model: string;
  /** Optional native language override (defaults to translate.targetLanguage) */
  nativeLanguage?: string;
  /** Enrich the saved card at save-time */
  enrichOnSave: boolean;
  /** Enrich the popover when the user hovers a word */
  enrichOnHover: boolean;
  /** Cache TTL in days for AI responses (default 30) */
  cacheTtlDays: number;
  /**
   * When true, AI mnemonic overrides the bundled / scraped one. When
   * false, the AI mnemonic is suppressed even if the provider returns
   * one — useful for users who prefer Etymology online's literal
   * etymology over an LLM paraphrase. Default true.
   */
  preferAiMnemonic: boolean;
  /**
   * When true, AI etymology overrides Etymonline's scrape. When false,
   * Etymonline's text wins whenever it's available. Default true (LLM
   * is more reliable when Etymonline returns empty).
   */
  preferAiEtymology: boolean;
  /**
   * When true, the OpenAI DALL-E 3 image generator is used as the last
   * fallback for the `image` Anki field when no free source returned a
   * photo. Costs ~$0.04 per card. Default false — opt-in to avoid
   * surprise charges.
   */
  enableDalleFallback: boolean;
}

/**
 * VIP enrichment settings — control which network sources to query for
 * the popover and the Anki card. Each source is a separate toggle so the
 * user can fine-tune the trade-off between completeness, latency, and
 * how often their browser hits other domains.
 *
 * The whole VIP layer can be disabled with `enabled: false` (default for
 * the version distributed in the Chrome Web Store; the user opts in
 * locally).
 */
export interface VipSettings {
  /** Master switch. When false, none of the VIP sources are consulted. */
  enabled: boolean;

  /* ── Standard tier (free, no token, run regardless of VIP) ────────── */
  freeDictionary: boolean;
  datamuse: boolean;
  /**
   * Wiktionary REST API (`en.wiktionary.org/api/rest_v1/page/definition/`).
   * Best free source for phrasal verbs ("look up"), idioms ("kick the
   * bucket") and compound MWEs ("big deal") — gaps the commercial
   * scrape sources (Cambridge / Oxford / Longman) miss for multi-word
   * expressions. Returns clean JSON with definitions + examples + POS.
   * Default true.
   */
  wiktionary: boolean;
  /**
   * Wiktionary HTML page parser (`en.wiktionary.org/api/rest_v1/page/html`).
   * Complements `wiktionary` (definition JSON) by extracting the etymology
   * section, synonyms, antonyms and related/derived terms — sections the
   * REST definition endpoint does NOT expose, especially for multi-word
   * phrases. Verified live for "kick the bucket" (full etymology), "piece
   * of cake" (etymology + "easy as pie"), "turn off" (8 synonyms + 1
   * antonym), "give up" (5 related terms). Default true.
   */
  wiktionaryHtml: boolean;
  /**
   * freedictionaryapi.com — Wiktionary REST mirror with full data for
   * multi-word phrases (kick the bucket → 18 synonyms with bite the
   * dust, buy the farm, etc.). CC-BY-SA, no token. Default true.
   */
  wiktionaryApi: boolean;
  /**
   * WiktApi (wiktapi.dev) — structured JSON backed by Wiktionary/Kaikki.
   * Adds Spanish translations, examples, forms, pronunciations and
   * etymology for single-word entries without scraping HTML. Default true.
   */
  wiktApi: boolean;
  /**
   * Moby Thesaurus (moby-thesaurus.org). Public-domain synonym list
   * by Grady Ward (1996). Up to 100+ synonyms for common words.
   * No antonyms (unidirectional). Default true.
   */
  mobyThesaurus: boolean;
  /**
   * Thesaurus.com (thesaurus.com/browse/<word>). Best free source for
   * antonyms of single-word abstract / technical nouns where every
   * other source returns nothing (algorithm → deviation, idleness,
   * inaction; apple → 66 antonyms; house → 157 antonyms; computer →
   * 29 antonyms). Single-word only — skips silently for phrases.
   * Default true.
   */
  thesaurusCom: boolean;
  /**
   * WordHippo (wordhippo.com). Best free source for ANTONYMS of
   * compound MWEs, phrasal verbs and idioms — covers cases no other
   * source touches (kick the bucket → bring back to life, big deal
   * → small potatoes, look up → look down on, apple → country).
   * Parsed from the deterministic `og:description` meta tag, no
   * token. Default true.
   */
  wordHippo: boolean;
  /**
   * theidioms.com — origin / meaning of English idioms. Best free
   * source for idiom etymology (kick the bucket, piece of cake, big
   * deal). Skips silently for single-word lookups (404 there).
   * Default true.
   */
  theIdioms: boolean;
  /**
   * Bundled dictionary lookup (en.json + en-extensions + en-cefr + mwes +
   * thesaurus + Academic Collocation List). Always available offline.
   * Default true.
   */
  bundled: boolean;
  /**
   * Yomitan packs installed by the user (kty-en-es / kty-en-en /
   * kty-en-ipa / etc.). Queries the IndexedDB-backed `dict_terms`
   * table. Most powerful Standard source for phrasal verbs, idioms,
   * MWEs and slang — `kty-en-es` alone has ~67k headwords. Default true.
   */
  yomitanPacks: boolean;

  /* ── Diccionarios premium (definitions, IPA, examples, collocations) ─ */
  cambridge: boolean;
  oxfordLearners: boolean;
  longman: boolean;
  collins: boolean;
  merriamWebster: boolean;
  oxfordCollocations: boolean;
  ozdic: boolean;

  /* ── Bilingual / contextual translations ──────────────────────────── */
  reverso: boolean;
  linguee: boolean;
  wordReference: boolean;
  spanishDict: boolean;
  tatoeba: boolean;

  /* ── Audio sources (word-level pronunciation) ─────────────────────── */
  cambridgeAudio: boolean;
  oxfordAudio: boolean;
  forvo: boolean;
  linguaLibre: boolean;
  /** Last-resort sintetic TTS via translate.google.com/translate_tts (no key). */
  googleTtsFallback: boolean;

  /* ── Image sources for the card front ─────────────────────────────── */
  /**
   * Unsplash — uses the official API when `unsplashAccessKey` is set,
   * otherwise inactive (no scraping fallback because Unsplash now sits
   * behind an Anubis JS-challenge gate that blocks all server-side and
   * SW fetches). Free Demo tier: 50 requests/hour at
   * https://unsplash.com/developers (no credit card).
   */
  unsplash: boolean;
  /** Pixabay — uses the official API when `pixabayApiKey` is set, otherwise
   *  falls back to scraping `pixabay.com/images/search/`. Free key: 100
   *  requests/minute at https://pixabay.com/api/docs/ (no credit card). */
  pixabay: boolean;
  /** Bing Images — async image-search endpoint, no token, ~25 cards per
   *  query. Mixed-license images so prefer Openverse / Wikimedia for
   *  reusable photos. */
  bingImages: boolean;
  /** Openverse — CC-licensed image API (Flickr + Wikimedia + museums).
   *  No token, ~240 results per query. Best free image source. */
  openverse: boolean;
  wikimediaCommons: boolean;
  duckduckgoImages: boolean;

  /* ── Video real-world pronunciation links ─────────────────────────── */
  youglish: boolean;

  /* ── Etymology ────────────────────────────────────────────────────── */
  etymonline: boolean;

  /**
   * Per-request timeout (ms). Fast sources should respond in 200-800 ms;
   * we cap each fetch so a single slow source never holds back the
   * popover.
   */
  perSourceTimeoutMs: number;

  /** TTL (days) for cached VIP responses in IndexedDB. */
  cacheTtlDays: number;

  /**
   * Optional Unsplash API access key. When empty, the Unsplash source is
   * inactive (their public site moved behind a JS-challenge gate that
   * blocks all server-side / SW scraping). When set, we hit
   * `api.unsplash.com/search/photos` directly. Free Demo tier (50
   * requests/hour) is enough for personal use; sign up at
   * https://unsplash.com/developers without a credit card.
   */
  unsplashAccessKey: string;

  /**
   * Optional Pixabay API key. When empty, the Pixabay source falls back
   * to HTML scraping (works but rate-limited by Cloudflare). When set,
   * we hit `pixabay.com/api/` directly. Free tier is 100 requests/minute;
   * sign up at https://pixabay.com/api/docs/ without a credit card.
   */
  pixabayApiKey: string;
}

export interface AiEnrichment {
  /** Definition tailored to the cue context */
  contextualDefinition: string;
  /** Up to 5 synonyms in the source language */
  synonyms: string[];
  /** Up to 5 common collocations in the source language */
  collocations: string[];
  /** Nuanced translation that respects the cue context */
  nuancedTranslation: string;
  /** Detected register */
  register: 'formal' | 'neutral' | 'informal' | 'slang' | 'literary';
  /** How appropriate the token is for the platform's typical audience */
  appropriateness: string;
  /**
   * Memorable mnemonic that helps the user remember the word — typically
   * a sound-alike association or a vivid image. One sentence, written in
   * the user's native language.
   */
  mnemonic?: string;
  /**
   * Concise etymology / origin paragraph — one or two sentences in the
   * user's native language. Complements the Etymonline scrape (when
   * available) with an LLM-generated plain-language summary.
   */
  etymology?: string;
  /** Which provider was used (filled by the wrapper) */
  provider: AiProvider;
  /** Latency of the call in ms (filled by the wrapper) */
  latencyMs: number;
  /** True when the value came from the IndexedDB cache */
  cached: boolean;
}

export interface AiEnrichRequest {
  token: string;
  sentence: string;
  sourceLang: string;
  nativeLang: string;
  platform?: string;
}

export type AiEnrichResponse =
  | { ok: true; data: AiEnrichment }
  | { ok: false; error: string; provider: AiProvider };

/** Streaming-style resolution for the WordPopover */
export interface ResolveWordRequest {
  token: string;
  sentence: string;
  sourceLang: string;
  /** Whether the caller wants the AI wave (only fires if AI settings allow it) */
  includeAi?: boolean;
}

export interface ResolveWordLocalWave {
  stage: 'local';
  entry: DictionaryEntry | null;
}

export interface ResolveWordRemoteWave {
  stage: 'remote';
  translation: string;
  provider: string;
  cached: boolean;
}

export interface ResolveWordAiWave {
  stage: 'ai';
  data: AiEnrichment;
}

export interface ResolveWordErrorWave {
  stage: 'error';
  scope: 'remote' | 'ai';
  message: string;
}

export type ResolveWordWave =
  | ResolveWordLocalWave
  | ResolveWordRemoteWave
  | ResolveWordAiWave
  | ResolveWordErrorWave;

export interface ResolveWordResponse {
  ok: true;
  waves: ResolveWordWave[];
}

/**
 * Streaming protocol for the word popover, transported over a
 * `chrome.runtime.connect` Port (port name `kvl-resolve-word`).
 *
 * The service worker emits these phases as soon as each is ready so the
 * popover paints the essential fields (translation / definition / IPA)
 * in <1 s and fills in the slower extras (synonyms / antonyms /
 * collocations / examples / etymology / VIP) without blocking:
 *
 *   1. `local`       — bundled/Yomitan dictionary hit (instant). May carry
 *                      a real translation already (known words) or a "—"
 *                      placeholder (unknown words / MWE stubs).
 *   2. `translation` — remote translator result, only emitted when the
 *                      local layer had no real translation.
 *   3. `enrichment`  — the fully-merged entry (synonyms / antonyms /
 *                      collocations / examples / etymology / VIP block).
 *   4. `ai`          — optional AI enrichment.
 *   5. `done`        — terminal; the popover stops every spinner.
 *
 * Each `entry`-bearing phase carries the BEST-KNOWN merged entry so far,
 * so the popover can simply adopt the latest non-null entry.
 */
export type ResolveWordStreamMsg =
  | { phase: 'local'; entry: DictionaryEntry | null }
  | { phase: 'translation'; entry: DictionaryEntry | null; provider: string; cached: boolean }
  | { phase: 'enrichment'; entry: DictionaryEntry | null }
  | { phase: 'ai'; data: AiEnrichment }
  | { phase: 'error'; scope: 'remote' | 'ai' | 'enrichment'; message: string }
  | { phase: 'done' };

/** Request envelope sent once over the resolve-word port. */
export interface ResolveWordStreamRequest {
  kind: 'resolve-word';
  token: string;
  sentence: string;
  sourceLang: string;
  includeAi?: boolean;
}

export interface OnboardingState {
  /** Whether the user has completed initial setup */
  completed: boolean;
  /** Timestamp when onboarding finished (or null) */
  completedAt: number | null;
}

/**
 * Local-only telemetry for dictionary-pack coverage. None of this leaves the
 * device — it's persisted in IndexedDB so the user can see "this pack was
 * used 532 times" without us shipping their lookup history anywhere.
 *
 * When `enabled` is false every `record*` helper in `telemetry.ts`
 * short-circuits and existing rows stop being updated (but aren't deleted —
 * the user can re-enable later and resume counting on top of the same row).
 */
export interface TelemetrySettings {
  /** Master switch — when false every record* helper in telemetry.ts no-ops. */
  enabled: boolean;
}

export interface DictionaryEntry {
  token: string;
  /**
   * 'word' = single-word entry.
   * 'phrase' = multi-word expression. The render layer differentiates idiomatic
   * MWEs (e.g. "kick the bucket") from phrasal verbs (e.g. "look up") via the
   * optional `phraseKind` field below.
   */
  type: 'word' | 'phrase';
  /**
   * Optional sub-classification for phrase entries:
   *  - 'idiom'   — figurative meaning, ámbar-punteado in UI (default for phrase).
   *  - 'phrasal' — phrasal verb, rendered with a solid azul underline.
   */
  phraseKind?: 'idiom' | 'phrasal';
  phonetic?: string;
  translation: string;
  /**
   * When the dictionary hit was resolved via the lemmatizer (e.g. user looked
   * up "running" and we returned the entry for "run"), the lemma is recorded
   * here so the popover header can show "running → run".
   */
  lemmaOf?: string;
  bilingual?: string;
  monolingual?: string;
  level?: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  /**
   * Native-language example sentences from the dictionary. Rendered under the
   * monolingual definition in the popover and surfaced as a separate field in
   * the Anki auto-mapping when the user creates a card.
   */
  examples?: string[];
  /**
   * Source attribution surfaced in the popover footer. Useful for chain-mode
   * lookups so the user can see whether the translation came from the bundled
   * dictionary, MyMemory, DeepL, etc.
   */
  source?: string;
  /**
   * Synonyms in the source language. Populated by:
   *   - `WordNet` pack (Standard tier)
   *   - `Datamuse` API (Standard, sin token)
   *   - `Cambridge Thesaurus` scrape (VIP)
   */
  synonyms?: string[];
  /** Antonyms in the source language. Same fan-out as synonyms. */
  antonyms?: string[];
  /**
   * Collocations covering the word — multi-word fragments like
   * "big deal", "make sense", "take a shower". Populated by:
   *   - `Academic Collocation List` pack (Standard)
   *   - `Datamuse rel_bgb / rel_bga` (Standard, corpus-derived)
   *   - `Oxford Collocations Dictionary` pack (VIP)
   *   - `Cambridge collocations` scrape (VIP)
   * The popover renders these under "Combinaciones frecuentes" and the
   * Anki mapping can surface them as a dedicated field.
   */
  collocations?: string[];
  /** Frequency rank in the BNC/COCA corpus, 1 = most common. */
  frequencyRank?: number;
  /**
   * Audio URLs for the headword pronunciation. Populated by Free Dictionary
   * API (Wikimedia Commons), Cambridge MP3 scrape, Forvo scrape, Lingua
   * Libre, etc. Multiple sources are kept so the user can pick or auto-fall
   * back. Each entry is `{ url, accent?, source }`.
   */
  audio?: Array<{ url: string; accent?: 'US' | 'UK' | 'AU' | 'CA' | string; source: string }>;
  /**
   * Multi-source extra definitions / examples / etymology / mnemonic
   * collected by the VIP enrichment chain. Each layer is keyed by source so
   * the UI can render attribution and the user can disable noisy sources.
   */
  vip?: VipEnrichment;
}

/**
 * Source-attributed enrichment payload — populated by the network-fetched
 * chain that runs in addition to the local dictionary lookup. Despite the
 * historical `VipEnrichment` name, this can contain Standard and VIP sources:
 * Standard sources run even when the VIP master switch is off, while VIP
 * sources are appended when enabled. Every field is optional; sources fail
 * independently so a Cambridge timeout doesn't break the rest.
 */
export interface VipEnrichment {
  /** Per-source short definitions in the source language. */
  definitions?: Array<{ source: string; text: string }>;
  /** Per-source bilingual translations beyond the local dictionary. */
  translations?: Array<{ source: string; text: string }>;
  /** Sentence-level examples with optional translation pair. */
  examples?: Array<{ source: string; text: string; translation?: string }>;
  /** Etymology/origin paragraph (one source wins, see `enrich-vip.ts`). */
  etymology?: string;
  /** Memorable mnemonic generated by the AI provider. */
  mnemonic?: string;
  /** Hero image URL for the card front. */
  imageUrl?: string;
  /** YouGlish-style links to real-world video pronunciations. */
  videoLinks?: Array<{ url: string; source: string }>;
}

export interface CueSnapshot {
  id: string;
  text: string;
  start: number;
  end: number;
  language: string;
}

export interface CaptureContext {
  token: string;
  cue: CueSnapshot;
  platform: 'netflix' | 'youtube' | 'disney' | 'hbo' | 'prime' | 'generic';
  /** ISO BCP-47 of the cue language */
  language: string;
  /** JPEG blob of the active frame (base64) */
  frameDataUrl?: string;
  /** Audio blob (base64) — opt-in */
  audioDataUrl?: string;
  /** dictionary-resolved metadata */
  meta?: DictionaryEntry;
  /** Word-level translation selected by the dictionary / enrichment chain. */
  translation?: string;
  /** Bilingual definition or translation bundle. */
  bilingual?: string;
  /** Source-language definition selected by the dictionary / enrichment chain. */
  monolingual?: string;
  /** IPA pronunciation selected by the dictionary / enrichment chain. */
  phonetic?: string;
  /** Usage examples selected by the dictionary / enrichment chain. */
  examples?: string[];
  /** Multi-source synonyms in the source language. */
  synonyms?: string[];
  /** Multi-source antonyms in the source language. */
  antonyms?: string[];
  /** Multi-source collocations / common word combinations. */
  collocations?: string[];
  /** Etymology / word-origin paragraph. */
  etymology?: string;
  /** Mnemonic text generated or collected for the word. */
  mnemonic?: string;
  /** Hero image URL selected by the enrichment chain. */
  imageUrl?: string;
  /** First YouGlish-style video URL selected by the enrichment chain. */
  videoLink?: string;
  /** Word-level pronunciation audio URL selected by the enrichment chain. */
  wordAudioUrl?: string;
  /** Full source-attributed payload for rich card fields. */
  vip?: VipEnrichment;
}

export interface CreateCardRequest {
  token: string;
  sentence: string;
  /** The native-language translation of the full sentence (from dual subtitle
   *  or MT provider). Filled by the content script when available. */
  sentenceTranslation?: string;
  /** Optional: ISO-encoded frame as data URL (jpeg) */
  frame?: string;
  /** Optional: audio data URL (webm or mp3) */
  audio?: string;
  /** Cue start/end in ms (video-time) */
  cueStart?: number;
  cueEnd?: number;
  /**
   * Video element's currentTime (ms) at the moment the user triggered save.
   * Used together with cueStart/cueEnd to translate video-time → wall-clock
   * for the rolling audio buffer slice.
   */
  videoTimeAtSave?: number;
  /** Whether the media element was paused when the user triggered save. */
  videoPausedAtSave?: boolean;
  language?: string;
  platform?: string;
}

export interface CreateCardResponse {
  ok: boolean;
  noteId?: number;
  error?: string;
  warnings?: string[];
}

/**
 * Re-capture / update the frame of an existing Anki note.
 * Used by the `recapture_frame` hotkey (Alt+V).
 */
export interface UpdateNoteFrameRequest {
  noteId: number;
  /**
   * Name of the frame field in the user's note model. If omitted the
   * background side resolves it by scanning the current
   * `ankiMapping.fieldSources` for the `frame` source.
   */
  fieldName?: string | null;
  /** Base64 data URL (image/jpeg) for the new frame. */
  frame: string;
}

export interface UpdateNoteFrameResponse {
  ok: boolean;
  error?: string;
}

export type AnkiPingErrorCode = 'NETWORK' | 'CORS' | 'TIMEOUT' | 'HTTP' | 'ANKI' | 'API_KEY';

export interface AnkiPingResponse {
  ok: boolean;
  version?: number;
  error?: string;
  /** Machine-readable error class so the UI can show a tailored hint. */
  code?: AnkiPingErrorCode;
}

export interface AnkiListsResponse {
  decks: string[];
  models: string[];
}

export interface AnkiFieldsResponse {
  fields: string[];
}
