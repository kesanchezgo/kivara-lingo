import { t } from './i18n/core';
/**
 * Single learner-facing frequency band shared by the popover and the Anki
 * card writer. The three evidence scales are not comparable (Longman spoken
 * top-1000 vs written top-1000 vs corpus-per-million bands), so averaging or
 * listing them all teaches nothing — one band answers "how common is this
 * word". Longman spoken wins over written over books-band; Standard rows
 * carry books-band alone and are unaffected.
 *
 * Verified 2026-09-09 corpus: every vip row with Longman S1/W1 also carries
 * books-band (`run` → Hablado S1 + Escrito W1 + Libros 2 renders as three
 * chips saying nothing). Unknown scales fall back to the raw value so a new
 * source never renders blank.
 */

/** Learner ladder for a subtitle rank (mirrors the prototype `rankBand`). */
export type RankBand = 'veryFrequent' | 'frequent' | 'common' | 'uncommon';

/**
 * Rank → band. Windows are the prototype's: up to 1000 very frequent, up to
 * 3000 frequent, up to 8000 common, everything else uncommon.
 */
export function rankBand(rank: number): RankBand {
  if (rank <= 1000) return 'veryFrequent';
  if (rank <= 3000) return 'frequent';
  if (rank <= 8000) return 'common';
  return 'uncommon';
}

/** Band → i18n key (UI dictionary: src/shared/i18n/popover.ts). */
const RANK_BAND_KEY: Record<RankBand, string> = {
  veryFrequent: 'freq.veryFrequent',
  frequent: 'freq.frequent',
  common: 'freq.common',
  uncommon: 'freq.uncommon',
};

/** Rank → band label. `translate` lets the UI resolve the popover dictionary
 * while the worker keeps the core subset. */
export function formatRankBand(rank: number, translate: (key: string) => string = t): string {
  return translate(RANK_BAND_KEY[rankBand(rank)]);
}

/** Longman band → i18n key. */
const LONGMAN_BAND_KEY: Record<string, string> = {
  S1: 'freq.topSpoken1000',
  S2: 'freq.topSpoken2000',
  S3: 'freq.topSpoken3000',
  W1: 'freq.topWritten1000',
  W2: 'freq.topWritten2000',
  W3: 'freq.topWritten3000',
};

/**
 * Worker fallback labels: `formatFrequencyBand` also runs in the service
 * worker (Anki context field), whose dictionary is the core subset. When the
 * active translator does not carry the Longman key, the label stays readable
 * instead of printing the raw key.
 */
const LONGMAN_BAND_LABEL: Record<string, string> = {
  S1: 'Top 1000 hablado',
  S2: 'Top 2000 hablado',
  S3: 'Top 3000 hablado',
  W1: 'Top 1000 escrito',
  W2: 'Top 2000 escrito',
  W3: 'Top 3000 escrito',
};

/** books-band value → i18n key. */
const BOOKS_BAND_KEY: Record<number, string> = {
  1: 'freq.veryFrequent',
  2: 'freq.frequent',
  3: 'freq.common',
  4: 'freq.uncommon',
};

/** books-band worker fallbacks, same reason as the Longman table. */
const BOOKS_BAND_LABEL: Record<number, string> = {
  1: 'Muy frecuente',
  2: 'Frecuente',
  3: 'Común',
  4: 'Poco común',
};

/** Resolve a key, keeping the readable fallback when the current dictionary
 * (the worker's core subset) does not carry it. */
function labelOf(
  key: string,
  translate: (key: string) => string,
  fallback: string,
): string {
  const out = translate(key);
  return out === key ? fallback : out;
}

export function formatFrequencyBand(
  scale: string,
  value: number | string,
  translate: (key: string) => string = t,
): string {
  if (scale === 'longman-spoken' || scale === 'longman-written') {
    const band = String(value).toUpperCase();
    const key = LONGMAN_BAND_KEY[band];
    if (key) return labelOf(key, translate, LONGMAN_BAND_LABEL[band]);
  }
  if (scale === 'books-band') {
    const band = Number(value);
    const key = BOOKS_BAND_KEY[band];
    if (key) return labelOf(key, translate, BOOKS_BAND_LABEL[band]);
  }
  return `${scale}: ${value}`;
}

/** Pick the single winning evidence item from a merged evidence list. */
export function pickFrequencyWinner<T extends { scale: string }>(
  evidence: T[],
): T | undefined {
  return (
    evidence.find((item) => item.scale === 'longman-spoken') ??
    evidence.find((item) => item.scale === 'longman-written') ??
    evidence.find((item) => item.scale === 'books-band')
  );
}
