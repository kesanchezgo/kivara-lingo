/**
 * Index behind the Preferences search box (ported from the prototype's
 * settingsSearch.ts).
 *
 * Each entry lists the i18n keys of everything the user sees inside the
 * section, the prefixes of the big sub-sections (so a new control is indexed
 * by construction) and a few loose terms (brands, synonyms). The search runs
 * over BOTH dictionaries through `tAll`, accent- and case-insensitively, so
 * "atajos", "shortcuts" or "deepl" work whatever the UI language is.
 */
import { tAll, keysWithPrefix } from '../../../shared/i18n';
import { SHORTCUT_DEFS } from '../../../shared/shortcuts';

export type SearchId =
  | 'q-reading' | 'q-translation' | 'q-pause' | 'q-autopause' | 'q-listen' | 'q-sounds'
  | 'lang' | 'translate' | 'translate-tokens' | 'dict' | 'vip' | 'ai' | 'tts'
  | 'capture' | 'perm' | 'cleanup' | 'keys' | 'about';

interface Entry {
  keys: string[];
  prefixes?: string[];
  extra?: string[];
}

const INDEX: Record<SearchId, Entry> = {
  'q-reading': { keys: ['set.quickAccess', 'set.readingMode', 'set.hideHoverDesc', 'set.noPopovers', 'set.learningHint'] },
  'q-translation': { keys: ['set.quickAccess', 'tr.title', 'tr.desc', 'tr.visible', 'tr.blur', 'tr.hidden'], extra: ['bilingüe', 'bilingual', 'subtítulo doble', 'dual'] },
  'q-pause': { keys: ['set.quickAccess', 'ovl.pauseOnHover', 'set.pauseOnLookupDesc'] },
  'q-autopause': { keys: ['set.quickAccess', 'rail.autoPause', 'rail.autoPauseHint'] },
  'q-listen': { keys: ['set.quickAccess', 'listen.title', 'listen.desc'], extra: ['escuchar', 'listening', 'comprensión auditiva'] },
  'q-sounds': { keys: ['set.quickAccess', 'set.sounds', 'set.soundsDesc'], extra: ['audio', 'sonido'] },
  lang: {
    keys: ['set.languageSection', 'set.langDesc', 'set.learningLang', 'set.myLang', 'set.learningAudioLabel', 'set.autoTrackDesc',
      'lang.en', 'lang.es', 'lang.fr', 'lang.de', 'lang.it', 'lang.pt', 'lang.ru', 'lang.ja', 'lang.ko', 'lang.zh'],
  },
  translate: {
    keys: ['set.translate', 'set.translateDesc', 'set.mode', 'set.chain', 'set.single', 'set.chainHint', 'set.singleHint',
      'set.tierFree', 'set.tierPremium', 'set.provider', 'set.providerOffline', 'set.providerMyMemory', 'set.providerLingva',
      'set.providerLibreTranslate', 'set.providerDeepl', 'set.providerGoogleCloud', 'set.cache'],
  },
  'translate-tokens': {
    keys: ['set.apiTokensTitle', 'set.mymemoryEmail', 'set.lingvaUrl', 'set.deeplKey', 'set.googleCloudKey', 'set.libreTranslateUrl', 'set.libreTranslateKey'],
    extra: ['api key', 'token', 'clave'],
  },
  dict: { keys: ['set.sectionOfflineDicts', 'set.dictDesc'], prefixes: ['dict.', 'dictpack.'], extra: ['pack', 'kaikki', 'wiktionary', 'yomitan', 'offline', 'diccionario', 'dictionary'] },
  vip: {
    keys: ['set.sectionEnrichment', 'set.sourcesDesc'],
    prefixes: ['vip.', 'vipx.'],
    extra: ['VIP', 'Unsplash', 'Pixabay', 'Wordnik', 'Tatoeba', 'Cambridge', 'Oxford', 'Longman', 'Merriam-Webster', 'Reverso',
      'Linguee', 'WordReference', 'SpanishDict', 'imagen', 'image', 'ejemplos', 'examples'],
  },
  ai: {
    keys: ['set.sectionAiPremium', 'set.aiDesc'],
    prefixes: ['ai.', 'aicompat.'],
    extra: ['IA', 'AI', 'OpenAI', 'GPT', 'ChatGPT', 'Anthropic', 'Claude', 'Gemini', 'DeepSeek', 'Qwen', 'Ollama', 'BYOK', 'api key', 'clave'],
  },
  tts: {
    keys: ['set.sectionTtsPremium', 'set.ttsDesc', 'set.ttsAuto', 'set.elevenLabsKey', 'set.elevenLabsVoiceId', 'set.elevenLabsModel'],
    extra: ['ElevenLabs', 'OpenAI', 'TTS', 'voz', 'voice', 'pronunciación', 'pronunciation'],
  },
  capture: {
    keys: ['set.sectionAdvancedCapture', 'set.captureDesc', 'set.rollingBuffer', 'set.bufferDesc', 'set.sentenceEndLabel',
      'set.vadLabel', 'set.cueExact', 'set.vadModeDesc', 'set.exactModeDesc'],
    extra: ['VAD', 'audio', 'buffer', 'frame'],
  },
  perm: { keys: ['set.sectionHostAccess'], prefixes: ['perm.'], extra: ['permisos', 'permissions', 'Netflix', 'YouTube', 'Max', 'Disney+', 'Prime Video'] },
  cleanup: { keys: ['set.cleanupVisual', 'set.cleanupDesc', 'set.hidePlayerUiLabel', 'set.hideProgressDesc', 'set.noShadowsLabel', 'set.hideGradientsDesc'] },
  keys: {
    keys: ['set.keyboardShortcutsTitle', 'set.shortcutsDesc', 'set.splitExpression', ...SHORTCUT_DEFS.map((d) => d.label)],
    prefixes: ['sc.'],
    extra: ['Alt', 'Ctrl', 'Shift', 'teclado', 'keyboard', 'hotkeys'],
  },
  about: { keys: ['set.groupAbout', 'set.supportProject', 'set.repeatInit'], extra: ['Ko-fi', 'GitHub', 'Sponsors', 'PayPal', 'donar', 'donate', 'onboarding', 'asistente', 'wizard'] },
};

export const normalize = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Settings that live in other panel tabs: offered as a shortcut. */
export type OtherTab = 'subtitles' | 'vocab' | 'cards';

const OTHER_TABS: Record<OtherTab, Entry> = {
  subtitles: {
    keys: ['panel.tabSubtitles', 'ws.sectionTitle', 'ws.sectionHint', 'ws.marks', 'ws.newMarks', 'ws.newMarksHint', 'ws.newMarksDotted', 'ws.newMarksNone', 'ws.learningMeta', 'ws.newMeta', 'ws.knownMeta', 'ws.exprMeta'],
    prefixes: ['subs.', 'sub.'],
    extra: ['estilo', 'style', 'fuente', 'font'],
  },
  vocab: {
    keys: ['panel.tabVocab', 'vc.title', 'ws.episodeTitle', 'ws.ankiTitle', 'ws.ankiHint', 'ws.evTestNone'],
    prefixes: ['ws.level', 'ws.vocab', 'ws.self', 'ws.coverage', 'ws.ep.', 'vc.', 'vt.'],
    extra: ['nivel', 'level', 'MCER', 'CEFR', 'vocabulario', 'vocabulary', 'prueba', 'test', 'cobertura', 'coverage'],
  },
  cards: { keys: ['panel.tabCards'], prefixes: ['cards.', 'recent.', 'queue.'], extra: ['Anki', 'AnkiConnect', 'mazo', 'deck', 'nota', 'note'] },
};

const build = (e: Entry) =>
  normalize([...e.keys, ...keysWithPrefix(e.prefixes ?? [])].map(tAll).concat(e.extra ?? []).join(' '));

let hay: Record<SearchId, string> | null = null;
function haystacks(): Record<SearchId, string> {
  if (!hay) {
    hay = {} as Record<SearchId, string>;
    for (const [id, e] of Object.entries(INDEX) as [SearchId, Entry][]) hay[id] = build(e);
  }
  return hay;
}

let otherHay: Record<OtherTab, string> | null = null;

const termsOf = (query: string) => normalize(query).split(/\s+/).filter(Boolean);

/** Other tabs that contain every term (empty when nothing is being searched). */
export function searchOtherTabs(query: string): OtherTab[] {
  const terms = termsOf(query);
  if (!terms.length) return [];
  if (!otherHay) otherHay = { subtitles: build(OTHER_TABS.subtitles), vocab: build(OTHER_TABS.vocab), cards: build(OTHER_TABS.cards) };
  const h = otherHay;
  return (Object.keys(OTHER_TABS) as OtherTab[]).filter((tab) => terms.every((term) => h[tab].includes(term)));
}

export const SEARCH_IDS = Object.keys(INDEX) as SearchId[];

/** Ids containing every term of the query (an empty query matches all). */
export function searchSettings(query: string): Set<SearchId> {
  const terms = termsOf(query);
  if (!terms.length) return new Set(SEARCH_IDS);
  const h = haystacks();
  return new Set(SEARCH_IDS.filter((id) => terms.every((term) => h[id].includes(term))));
}
