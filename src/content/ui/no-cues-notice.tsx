/**
 * Point 2 — the empty state explained.
 *
 * With no cue source at all (subtitles off in the player, no track, no bus
 * cues), the transcript and the overlay used to sit BLANK forever. After ~5 s
 * of PLAYBACK the UI now says what a user needs to know: turn the player's
 * subtitles on — any language — Kivara reads from there.
 *
 * The countdown runs on playback time, but the notice itself is STICKY once
 * it fires: a pause is not "subtitles appeared", and hiding on pause left the
 * user staring at a blank caption with no explanation (QA: the notice
 * vanished the moment the player paused for a buffer). It goes away on the
 * first cue or when the episode changes.
 */
import { useEffect, useRef, useState } from 'react';
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

export function useNoCueNotice(
  playing: boolean,
  cueCount: number,
  delayMs = 5_000,
  /** Identity of what is playing; a change is a new episode and re-arms. */
  episodeKey = '',
): boolean {
  const [visible, setVisible] = useState(false);
  const keyRef = useRef(episodeKey);

  // A new episode is a new empty state: forget the previous verdict.
  useEffect(() => {
    if (keyRef.current === episodeKey) return;
    keyRef.current = episodeKey;
    setVisible(false);
  }, [episodeKey]);

  useEffect(() => {
    // The first cue is the only thing that retires the notice early.
    if (cueCount > 0) {
      setVisible(false);
      return;
    }
    // Once shown, stay shown: pausing, seeking or buffering is not subtitles.
    if (visible) return;
    // Never arm outside playback — the countdown is playback time.
    if (!playing) return;
    const id = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(id);
  }, [playing, cueCount, delayMs, visible]);

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
