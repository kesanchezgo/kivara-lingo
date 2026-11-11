/** i18n types shared by every area file and the barrel. */
export type Locale = 'es' | 'en';
export type StringMap = Record<string, string>;
export interface AreaDict {
  es: StringMap;
  en: StringMap;
}
