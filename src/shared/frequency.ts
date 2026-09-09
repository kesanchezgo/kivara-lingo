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
const LONGMAN_BAND_LABEL: Record<string, string> = {
  S1: 'Top 1000 hablado',
  S2: 'Top 2000 hablado',
  S3: 'Top 3000 hablado',
  W1: 'Top 1000 escrito',
  W2: 'Top 2000 escrito',
  W3: 'Top 3000 escrito',
};

export function formatFrequencyBand(scale: string, value: number | string): string {
  if (scale === 'longman-spoken' || scale === 'longman-written') {
    const band = String(value).toUpperCase();
    const label = LONGMAN_BAND_LABEL[band];
    if (label) return label;
  }
  if (scale === 'books-band') {
    const band = Number(value);
    if (band === 1) return 'Muy frecuente';
    if (band === 2) return 'Frecuente';
    if (band === 3) return 'Común';
    if (band === 4) return 'Poco común';
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
