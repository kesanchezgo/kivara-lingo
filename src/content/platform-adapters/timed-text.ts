/**
 * Picking the subtitle track in the language being learned.
 *
 * The app knows the learning language and the platform exposes its track list,
 * so Kivara switches the track itself. Reading a user-facing menu is not an
 * acceptable fallback for something this mechanical.
 *
 * Pure over the platform's list shape (Netflix `getTimedTextTrackList()`)
 * so the choice is unit-testable without a player.
 */

export interface TimedTextTrackInfo {
  /** Platform id used to select the track. */
  trackId?: string;
  /** BCP-47 language of the track (`en`, `es`, `en-US`). */
  bcp47?: string;
  /** Locale display name ("Inglés"); never used for matching. */
  displayName?: string;
  /** PRIMARY (the main subtitle) or ASSISTIVE (CC / SDH). */
  trackType?: string;
  /** SUBTITLES or CLOSEDCAPTIONS. */
  rawTrackType?: string;
  /** The "off" row. */
  isNoneTrack?: boolean;
  /** Forced-narrative track: only translates on-screen foreign dialogue. */
  isForcedNarrative?: boolean;
  /** Image-based subtitles cannot be read as text. */
  isImageBased?: boolean;
}

const primarySubtag = (value: string | undefined): string =>
  (value ?? '').trim().toLowerCase().replace('_', '-').split('-')[0] ?? '';

/**
 * The best track for `lang`, or null when the language is not offered.
 *
 * Order: same language → not forced (a forced track skips most dialogue) →
 * plain subtitles before CC → the platform's PRIMARY before ASSISTIVE.
 */
export function pickTimedTextTrack(
  tracks: readonly TimedTextTrackInfo[],
  lang: string,
): TimedTextTrackInfo | null {
  const want = primarySubtag(lang);
  if (!want) return null;
  const candidates = tracks.filter(
    (track) => !track.isNoneTrack && !track.isImageBased && track.trackId
      && primarySubtag(track.bcp47) === want,
  );
  if (candidates.length === 0) return null;
  const score = (track: TimedTextTrackInfo): number => {
    let value = 0;
    if (!track.isForcedNarrative) value += 4;
    if (track.rawTrackType === 'SUBTITLES') value += 2;
    if (track.trackType === 'PRIMARY') value += 1;
    return value;
  };
  return [...candidates].sort((a, b) => score(b) - score(a))[0] ?? null;
}