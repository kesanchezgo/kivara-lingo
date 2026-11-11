/**
 * Language registry: the SINGLE list of the app (Preferences › Language, the
 * onboarding language step, its summary and the settings search). Each language
 * declares what the rest of the system needs to scale without touching
 * components:
 *
 *   - `segmentation`: how words are split. 'spaces' (English, Spanish, Russian,
 *     Korean...: the tokenizer looks for letters of any script) or 'dictionary'
 *     (Japanese, Chinese: no spaces, `Intl.Segmenter` is used). See
 *     `segments.ts · segmentWords`.
 *   - `script` and `dir`: writing system and direction (all LTR for now; the
 *     day an RTL one lands, the subtitle and the panel read `dir` from here).
 *   - `learn` / `speak`: available TODAY as the language you learn / as your
 *     language (the translation destination). The rest show as "Coming soon".
 *
 * Today English → Spanish works: the demo content, the dictionary, the
 * vocabulary test and the cognates are built for that pair. Opening a language
 * means: its dictionary and frequency list, test glosses in your language, and
 * setting `learn` / `speak` to true. Nothing else in the UI.
 */
export type Segmentation = 'spaces' | 'dictionary';
export type Script = 'latin' | 'cyrillic' | 'japanese' | 'han' | 'hangul';

export interface LanguageInfo {
  code: string;
  /** Name in its own language (not translated). */
  endonym: string;
  flag: string;
  script: Script;
  segmentation: Segmentation;
  dir: 'ltr' | 'rtl';
  /** Available today as the language you learn. */
  learn: boolean;
  /** Available today as your language (translation destination). */
  speak: boolean;
}

export const LANGUAGES: readonly LanguageInfo[] = [
  { code: 'en', endonym: 'English', flag: '🇬🇧', script: 'latin', segmentation: 'spaces', dir: 'ltr', learn: true, speak: false },
  { code: 'es', endonym: 'Español', flag: '🇪🇸', script: 'latin', segmentation: 'spaces', dir: 'ltr', learn: false, speak: true },
  { code: 'pt', endonym: 'Português', flag: '🇵🇹', script: 'latin', segmentation: 'spaces', dir: 'ltr', learn: false, speak: false },
  { code: 'fr', endonym: 'Français', flag: '🇫🇷', script: 'latin', segmentation: 'spaces', dir: 'ltr', learn: false, speak: false },
  { code: 'de', endonym: 'Deutsch', flag: '🇩🇪', script: 'latin', segmentation: 'spaces', dir: 'ltr', learn: false, speak: false },
  { code: 'it', endonym: 'Italiano', flag: '🇮🇹', script: 'latin', segmentation: 'spaces', dir: 'ltr', learn: false, speak: false },
  { code: 'ru', endonym: 'Русский', flag: '🇷🇺', script: 'cyrillic', segmentation: 'spaces', dir: 'ltr', learn: false, speak: false },
  { code: 'ja', endonym: '日本語', flag: '🇯🇵', script: 'japanese', segmentation: 'dictionary', dir: 'ltr', learn: false, speak: false },
  { code: 'ko', endonym: '한국어', flag: '🇰🇷', script: 'hangul', segmentation: 'spaces', dir: 'ltr', learn: false, speak: false },
  { code: 'zh', endonym: '中文', flag: '🇨🇳', script: 'han', segmentation: 'dictionary', dir: 'ltr', learn: false, speak: false },
];

export const DEFAULT_LEARN_LANG = 'en';
export const DEFAULT_NATIVE_LANG = 'es';

export function languageOf(code: string): LanguageInfo {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

export const canLearn = (code: string): boolean => Boolean(LANGUAGES.find((l) => l.code === code)?.learn);
export const canSpeak = (code: string): boolean => Boolean(LANGUAGES.find((l) => l.code === code)?.speak);

/** Valid "language you learn" today (a saved value for a still-closed language falls back to the default). */
export const resolveLearnLang = (code: unknown): string =>
  (typeof code === 'string' && canLearn(code) ? code : DEFAULT_LEARN_LANG);

/** Valid "your language" today (a saved value for a still-closed language falls back to the default). */
export const resolveNativeLang = (code: unknown): string =>
  (typeof code === 'string' && canSpeak(code) ? code : DEFAULT_NATIVE_LANG);

/** Separator between words when rebuilding an expression ('' in Japanese and Chinese). */
export const wordJoiner = (code: string): string => (languageOf(code).segmentation === 'spaces' ? ' ' : '');
