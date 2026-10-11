/* Lang catalogue for the onboarding language step. Moved verbatim. */
import { t } from '../../shared/i18n';

export type LangMeta = { code: string; name: string; native: string; flag: string };

export const ONBOARDING_LANGS: LangMeta[] = [
  { code: 'en', name: t('lang.en'),     native: 'English',    flag: '🇬🇧' },
  { code: 'es', name: t('lang.es'),    native: 'Español',    flag: '🇪🇸' },
  { code: 'fr', name: t('lang.fr'),    native: 'Français',   flag: '🇫🇷' },
  { code: 'de', name: t('lang.de'),     native: 'Deutsch',    flag: '🇩🇪' },
  { code: 'it', name: t('lang.it'),   native: 'Italiano',   flag: '🇮🇹' },
  { code: 'pt', name: t('lang.pt'),  native: 'Português',  flag: '🇵🇹' },
  { code: 'ja', name: t('lang.ja'),    native: '日本語',      flag: '🇯🇵' },
  { code: 'ko', name: t('lang.ko'),    native: '한국어',       flag: '🇰🇷' },
  { code: 'zh', name: t('lang.zh'),      native: '中文',        flag: '🇨🇳' },
];

export function getLang(code: string): LangMeta {
  return ONBOARDING_LANGS.find((l) => l.code === code) ?? ONBOARDING_LANGS[0];
}
