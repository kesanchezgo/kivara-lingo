/**
 * Point 2 — the empty state explained.
 *
 * With no cue source at all (subtitles off in the player, no track, no bus
 * cues), the transcript and the overlay used to sit BLANK forever. After ~5 s
 * of PLAYBACK the UI now says what a user needs to know: turn the player's
 * subtitles on — any language — Kivara reads from there.
 *
 * The notice disappears the moment the first cue arrives (its condition is
 * `cueCount === 0`), and pausing freezes the countdown: it is a playback
 * state, not a wall-clock one.
 */
import { useEffect, useState } from 'react';
import { t } from '../../shared/i18n';

/** Kivara's UI names for the platforms it knows (generic falls to ''). */
const PLATFORM_NAMES: Record<string, string> = {
  youtube: 'YouTube',
  netflix: 'Netflix',
  disney: 'Disney+',
  hbo: 'Max',
  prime: 'Prime Video',
};

function platformPlayerName(platform: string | undefined): string {
  return (platform && PLATFORM_NAMES[platform]) || '';
}

export function useNoCueNotice(playing: boolean, cueCount: number, delayMs = 5_000): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!playing || cueCount > 0) {
      setVisible(false);
      return;
    }
    const id = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(id);
  }, [playing, cueCount, delayMs]);
  return visible;
}

/**
 * `ariaLive` marks the overlay variant: the e2e state publishes `[aria-live]`
 * text as `live`, so the suite can assert the notice inside the closed root.
 */
export function NoSubtitlesNotice({
  platform,
}: {
  platform?: string;
}) {
  const name = platformPlayerName(platform);
  return (
    <div
      data-kvl-no-subs
      aria-live="polite"
      className="w-full rounded-lg bg-amber-500/10 ring-1 ring-inset ring-amber-500/30 px-3 py-2.5 text-[12.5px] leading-snug text-amber-700 dark:text-amber-300"
    >
      {name
        ? t('rail.noSubs', { platform: name })
        : t('rail.noSubsGeneric')}
    </div>
  );
}
