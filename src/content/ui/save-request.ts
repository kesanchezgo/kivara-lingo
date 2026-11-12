/**
 * Pure builder for the cue-derived fields of `CREATE_CARD`.
 *
 * The active cue id is the one the adapter emitted. For the YouTube adapter it
 * is `youtube-<start>-<end>`, the same id scheme the full track uses, so the
 * cue can be located in `episode.cues` and its neighbours become
 * `contextLines`. Keeping this out of `App.tsx` makes the mapping testable
 * without React — and it is the mapping the B7 fix depends on: without the
 * track's real id, `cueIndex` was -1 and the save carried no `contextLines`.
 */
import type { SubtitleCue } from '../platform-adapters/types';

export interface ActiveCueRef {
  id: string;
  start?: number;
  end?: number;
}

export interface CueRequestFields {
  /** Previous / next line of the episode track, for the card's context. */
  contextLines?: { prev?: string; next?: string };
  /** Active cue bounds, in video milliseconds. */
  cueStart?: number;
  cueEnd?: number;
}

export function buildCueRequestFields(
  activeCue: ActiveCueRef | null,
  cues: readonly Pick<SubtitleCue, 'id' | 'text'>[],
): CueRequestFields {
  if (!activeCue) return {};
  const index = cues.findIndex((cue) => cue.id === activeCue.id);
  return {
    contextLines: index >= 0
      ? { prev: cues[index - 1]?.text, next: cues[index + 1]?.text }
      : undefined,
    cueStart: activeCue.start,
    cueEnd: activeCue.end,
  };
}
