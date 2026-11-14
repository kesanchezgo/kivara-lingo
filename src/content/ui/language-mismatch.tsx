/**
 * Point 4 — the track is in another language than the one being learned.
 *
 * Shown in the overlay and in the transcript rail, next to the no-subtitles
 * notice and for the same reason: without it, Kivara looks broken (every card
 * looks up the wrong dictionary) when the real problem is the selected track.
 */
import { t } from '../../shared/i18n';
import { languageOf } from '../../shared/languages';

const PLATFORM_NAMES: Record<string, string> = {
  youtube: 'YouTube',
  netflix: 'Netflix',
  disney: 'Disney+',
  hbo: 'Max',
  prime: 'Prime Video',
};

/** Human name for a two-letter code: its endonym, which both locales agree on. */
function languageLabel(code: string): string {
  const info = languageOf((code || '').slice(0, 2).toLowerCase());
  return info?.endonym ?? code;
}

export interface LanguageMismatchProps {
  /** Language the cues are actually in (`es`). */
  track: string;
  /** `translate.sourceLang`: the language being learned (`en`). */
  learning: string;
  /** Source platform tag, for the "change it in X" half of the sentence. */
  platform?: string;
}

export function LanguageMismatchNotice({ track, learning, platform }: LanguageMismatchProps) {
  const name = (platform && PLATFORM_NAMES[platform]) || '';
  const vars = { track: languageLabel(track), learning: languageLabel(learning), platform: name };
  return (
    <div
      data-kvl-lang-mismatch
      aria-live="polite"
      className="w-full rounded-lg bg-sky-500/10 ring-1 ring-inset ring-sky-500/30 px-3 py-2.5 text-[12.5px] leading-snug text-sky-700 dark:text-sky-300"
    >
      {name ? t('rail.langMismatch', vars) : t('rail.langMismatchGeneric', vars)}
    </div>
  );
}
