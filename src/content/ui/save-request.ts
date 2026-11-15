/**
 * Pure builder for the cue-derived fields of `CREATE_CARD`.
 *
 * The active cue id is the one the adapter emitted. For the YouTube adapter it
 * is `youtube-<start>-<end>`, the same id scheme the full track uses, so the
 * cue can be located in `episode.cues` and its neighbours become
 * `contextLines`. Keeping this out of `App.tsx` makes the mapping testable
 * without React — and it is the mapping the B7 fix depends on: without the
 * track's real id, `cueIndex` was -1 and the save carried no `contextLines`.
 *
 * Overlapping cues (#124) made the id COMPOSITE — `netflix-2000-4000|3300-6000`
 * lists one span per line — and an equality lookup found nothing, so the card
 * lost its context. The builder now resolves the member lines by those spans
 * (or by time), and the caller can name the line the saved word sits in.
 */
import type { SubtitleCue } from '../platform-adapters/types';

export interface ActiveCueRef {
  id: string;
  start?: number;
  end?: number;
}

export interface CueRequestOptions {
  /**
   * Index of the member line the saved word sits in, when the overlay knows
   * it. Omitted (or null) saves the whole set — a selection or the full plate.
   */
  lineIndex?: number | null;
  /** Explicit "save the set": a selection or the whole phrase. */
  whole?: boolean;
}

export interface CueRequestFields {
  /** Previous / next line of the episode track, for the card's context. */
  contextLines?: { prev?: string; next?: string };
  /** Active cue bounds, in video milliseconds. */
  cueStart?: number;
  cueEnd?: number;
  /**
   * The phrase to save: the member line that holds the word, or every member
   * when the set is saved. Left undefined for a single cue, where the caller's
   * own sentence is already the line.
   */
  sentence?: string;
}

type CueLike = Pick<SubtitleCue, 'id' | 'text' | 'start' | 'end'>;

/** Every `start-end` span inside an id (`netflix-2000-4000|3300-6000`). */
function cueSpans(id: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  for (const match of id.matchAll(/(\d+)-(\d+)/g)) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) spans.push({ start, end });
  }
  return spans;
}

/**
 * Track indices of the lines this active cue is made of, in track order.
 *
 * Three answers, most precise first: the id itself (single cue), the spans the
 * composite id lists, and finally the playhead — which covers an adapter that
 * hands over a live id we never saw in the track.
 */
function memberIndices(activeCue: ActiveCueRef, cues: readonly CueLike[]): number[] {
  const byId = cues.findIndex((cue) => cue.id === activeCue.id);
  if (byId >= 0) return [byId];

  const spans = cueSpans(activeCue.id);
  if (spans.length > 0) {
    const found = cues.flatMap((cue, index) =>
      spans.some((span) => Math.abs(cue.start - span.start) < 2 && Math.abs(cue.end - span.end) < 2)
        ? [index]
        : [],
    );
    if (found.length > 0) return found;
  }

  const { start, end } = activeCue;
  if (start == null || end == null) return [];
  const overlapping = cues.flatMap((cue, index) => (cue.start < end && cue.end > start ? [index] : []));
  if (overlapping.length > 0) return overlapping;

  // The playhead can sit in a gap between lines: fall back to the line under
  // it, then to the first one after it.
  const under = cues.findIndex((cue) => cue.start <= start && cue.end >= start);
  if (under >= 0) return [under];
  const next = cues.findIndex((cue) => cue.start >= start);
  return next >= 0 ? [next] : [];
}

export function buildCueRequestFields(
  activeCue: ActiveCueRef | null,
  cues: readonly CueLike[],
  options: CueRequestOptions = {},
): CueRequestFields {
  if (!activeCue) return {};
  const members = memberIndices(activeCue, cues);
  if (members.length === 0) {
    return { cueStart: activeCue.start, cueEnd: activeCue.end };
  }

  const whole = options.whole === true || options.lineIndex == null || members.length === 1;
  if (!whole) {
    const lineIndex = members[Math.min(Math.max(options.lineIndex!, 0), members.length - 1)]!;
    const line = cues[lineIndex]!;
    return {
      sentence: line.text,
      cueStart: line.start,
      cueEnd: line.end,
      contextLines: { prev: cues[lineIndex - 1]?.text, next: cues[lineIndex + 1]?.text },
    };
  }

  const first = members[0]!;
  const last = members[members.length - 1]!;
  return {
    // A single cue keeps the caller's own sentence: it is that same line.
    sentence: members.length > 1 ? members.map((index) => cues[index]!.text).join('\n') : undefined,
    // The bounds belong to the LINES, not to the emitted window: a cue resolved
    // by time (live id) still carries the track's own start/end.
    cueStart: cues[first]!.start,
    cueEnd: cues[last]!.end,
    contextLines: { prev: cues[first - 1]?.text, next: cues[last + 1]?.text },
  };
}

interface CueLineSpan {
  /** Character span of the line inside the collapsed plate. */
  start: number;
  end: number;
  text: string;
}

const collapse = (line: string): string => line.replace(/\s+/g, ' ').trim();

/**
 * The member lines of a cue plate, with where each one starts and ends in the
 * text the overlay renders (each line's inner whitespace collapsed, a single
 * space between lines). Token offsets computed over the plate point into
 * these spans, so the overlay can tell WHICH line a word came from.
 */
export function cueLineSpans(text: string): CueLineSpan[] {
  const spans: CueLineSpan[] = [];
  let cursor = 0;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = collapse(raw);
    if (!line) continue;
    const start = cursor === 0 ? 0 : cursor + 1;
    spans.push({ start, end: start + line.length, text: line });
    cursor = start + line.length;
  }
  return spans;
}

/** The span that contains `offset`, or the last one before it. */
export function lineIndexOfOffset(spans: readonly CueLineSpan[], offset: number): number {
  if (spans.length === 0) return 0;
  for (let i = spans.length - 1; i >= 0; i--) {
    if (offset >= spans[i]!.start) return i;
  }
  return 0;
}
