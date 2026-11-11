/**
 * Locale detection and the `t()` factory.
 *
 * Locale source: chrome.i18n.getUILanguage() — the closest thing MV3 gives us
 * to a user-facing preference — falling back to navigator.language and then
 * Spanish. No language selector: the browser UI language decides (D10).
 */
import type { AreaDict, Locale, StringMap } from './types';

export function detectLocale(): Locale {
  try {
    const chromeI18n = (globalThis as { chrome?: { i18n?: { getUILanguage?: () => string } } }).chrome?.i18n;
    const fromChrome = chromeI18n?.getUILanguage?.();
    const tag = fromChrome || (typeof navigator !== 'undefined' ? navigator.language : '') || 'es';
    return /^en\b/i.test(tag) ? 'en' : 'es';
  } catch {
    return 'es';
  }
}

export const LOCALE: Locale = detectLocale();

/** Translate `key` into the detected locale with the given areas loaded.
 * Unknown keys fall back to the Spanish dictionary, then to the key itself. */
export function makeT(areas: readonly AreaDict[]) {
  const messages: Record<Locale, StringMap> = {
    es: Object.assign({}, ...areas.map((a) => a.es)),
    en: Object.assign({}, ...areas.map((a) => a.en)),
  };
  const t = (key: string, vars?: Record<string, string | number>): string => {
    const dict = LOCALE === 'en' ? messages.en : messages.es;
    let out = dict[key] ?? messages.es[key] ?? key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        out = out.split(`{${name}}`).join(String(value));
      }
    }
    return out;
  };
  /** Both languages of one key, for the Preferences search index. */
  const tAll = (key: string): string => `${messages.es[key] ?? ''} ${messages.en[key] ?? ''}`;
  const keysWithPrefix = (prefixes: readonly string[]): string[] =>
    Object.keys(messages.es).filter((k) => prefixes.some((p) => k.startsWith(p)));
  return { t, tAll, keysWithPrefix, messages };
}
