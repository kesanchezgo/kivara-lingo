/**
 * Point 4 — which language are these subtitles actually in?
 *
 * The track's language used to come from `first.language || 'en'`: when the
 * adapter had no metadata, the learning language was stamped on cues that were
 * plainly Spanish. Every card then looked up an English dictionary for a
 * Spanish word, and the Anki tags said `lang:en`.
 *
 * Order of truth: the language the adapter DECLARED (TTML `xml:lang`, the
 * WebVTT `Language:` header, the bus track's language) → a detector run over
 * a sample long enough to be reliable → nothing. Never the learning language.
 */
import { detectLanguage } from '../nlp/detect-language';
import type { SubtitleCue } from '../platform-adapters/types';

/** `en-US` → `en`, `ES_419` → `es`, junk → ''. */
export function normalizeLang(code: string | null | undefined): string {
  return (code ?? '').trim().toLowerCase().replace('_', '-').split('-')[0] ?? '';
}

/**
 * The language the adapter put on the cues, when they agree. An empty string
 * means "the adapter said nothing" (or the cues disagree) — not a guess.
 */
export function declaredTrackLanguage(cues: readonly SubtitleCue[]): string {
  const counts = new Map<string, number>();
  for (const cue of cues) {
    const lang = normalizeLang(cue.language);
    if (!lang) continue;
    counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [lang, count] of counts) {
    if (count > bestCount) {
      best = lang;
      bestCount = count;
    }
  }
  // A minority label is noise (one stray cue), not a language.
  return bestCount >= Math.max(2, Math.ceil(cues.length * 0.5)) ? best : '';
}

/**
 * Declared language, else a detection over a sample big enough for the
 * detector to be trustworthy. Short samples answer '' — guessing there is how
 * the wrong-language lookups started.
 */
export function detectTrackLanguage(
  cues: readonly SubtitleCue[],
  declared?: string | null,
): string {
  const fromAdapter = normalizeLang(declared) || declaredTrackLanguage(cues);
  if (fromAdapter) return fromAdapter;
  const sample = cues
    .slice(0, 8)
    .map((c) => c.text.trim())
    .filter(Boolean)
    .join(' ');
  // Below ~60 characters trigram detection is a coin flip.
  if (sample.length < 60) return '';
  const detected = normalizeLang(detectLanguage(sample));
  return detected === 'und' ? '' : detected;
}

/** TRUE when the track's language is known and differs from the learning one. */
export function isLanguageMismatch(
  track: string | null | undefined,
  learning: string | null | undefined,
): boolean {
  const a = normalizeLang(track);
  const b = normalizeLang(learning);
  return !!a && !!b && a !== b;
}
