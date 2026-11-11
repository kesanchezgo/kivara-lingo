/* Language catalogue for the onboarding language step.
 *
 * Derived from the single registry (`shared/languages`) so the wizard and
 * Preferences › Language can never drift: `learn` / `speak` decide which slot
 * a language can fill and the rest render as "Coming soon". */
import { t } from '../../shared/i18n';
import { LANGUAGES, languageOf, type LanguageInfo } from '../../shared/languages';

export type LangMeta = {
  code: string;
  name: string;
  native: string;
  flag: string;
  /** Available as the language you learn. */
  learn: boolean;
  /** Available as your language (translation destination). */
  speak: boolean;
};

function meta(l: LanguageInfo): LangMeta {
  return {
    code: l.code,
    name: t(`lang.${l.code}`),
    native: l.endonym,
    flag: l.flag,
    learn: l.learn,
    speak: l.speak,
  };
}

export const ONBOARDING_LANGS: LangMeta[] = LANGUAGES.map(meta);

export function getLang(code: string): LangMeta {
  return meta(languageOf(code));
}