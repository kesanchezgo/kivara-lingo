/**
 * UI i18n barrel: `t(key, vars)` with the es/en dictionaries split by area.
 *
 * Locale source: chrome.i18n.getUILanguage() (see ./locale). Keys are
 * `area.thing`, placeholders are `{name}`. Background modules import `t`
 * from ./sw instead, so the worker never carries the UI dictionary.
 */
import { useSyncExternalStore } from 'react';
import { LOCALE, makeT } from './locale';
import type { Locale, StringMap } from './types';
import { common } from './common';
import { settings } from './settings';
import { cards } from './cards';
import { dict } from './dict';
import { popup } from './popup';
import { onboarding } from './onboarding';
import { panel } from './panel';
import { popover } from './popover';
import { shortcuts } from './shortcuts';
import { vip } from './vip';
import { sw } from './sw';

const { t, tAll, keysWithPrefix, messages } = makeT([common, settings, cards, dict, popup, onboarding, panel, popover, shortcuts, vip, sw]);

export { t, tAll, keysWithPrefix };
export type { Locale, StringMap } from './types';

/** Every merged key, for the parity tests. */
export const ALL_MESSAGES: { es: StringMap; en: StringMap } = messages;

/** BCP-47 tag per app locale: numbers/dates follow the app language. */
const INTL_TAG: Record<Locale, string> = { es: 'es-ES', en: 'en-US' };

export function currentLocale(): Locale {
  return LOCALE;
}

/** 248000 → "248.000" (es) / "248,000" (en). */
export function fmtNumber(n: number): string {
  return n.toLocaleString(INTL_TAG[LOCALE]);
}

/** Duration in days with real plural: "1 día", "30 días". */
export function fmtDays(n: number): string {
  return n === 1 ? t('common.daysOne') : t('common.daysN', { n });
}

/** Epoch ms → localized date + time. */
export function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString(INTL_TAG[LOCALE]);
}

/** Epoch ms → short localized date ("12 nov 2025" / "Nov 12, 2025"). */
export function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(INTL_TAG[LOCALE], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Stable hook: the locale never changes at runtime, but components may
 * subscribe to it — kept as a hook so a future selector is a one-file change. */
export function useLocale(): Locale {
  return useSyncExternalStore(
    () => () => {},
    () => LOCALE,
  );
}
