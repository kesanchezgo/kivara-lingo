/**
 * Full-track helpers shared by the platform adapters (docs/REDESIGN-V2.md
 * §4.5). Two sources exist across the platforms:
 *
 *  - `textTracks`: the browser's own cue list, available on YouTube, Max and
 *    the generic `<video>` page. Cues may be `null` until the track mode stops
 *    being `disabled`, which is why the adapters set it to `hidden`.
 *  - the intercepted bus: TTML/WebVTT/JSON3 responses the MAIN-world script
 *    caught. This is the only full track Netflix, Max and Prime expose.
 *
 * Both are normalised to `SubtitleCue` (milliseconds) and sorted, so the
 * transcript rail can render and seek without knowing where the cues came
 * from.
 */
import type { RawCue } from './parsers';
import type { SubtitleCue } from './types';

function primaryLang(code: string | null | undefined): string {
  return (code ?? '').trim().toLowerCase().split(/[-_]/)[0];
}

/**
 * Normalise a cue's text for cross-source matching.
 *
 * The caption DOM and the intercepted track are two renderings of the same
 * line: the DOM may join lines differently, drop punctuation or carry a
 * speaker label. Comparing the words (letters/digits only, NFKC, lowercased)
 * makes the re-anchor deterministic without letting a fuzzy match invent a
 * line.
 */
export function normalizeCueText(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * The cue whose window contains `timeMs`, or `null` in a gap.
 *
 * Shared by the generic intercepted adapter and the YouTube adapter so the
 * containment rule cannot drift: strict `start <= t <= end`, first hit wins
 * (the parsers emit time-sorted cues).
 */
export function findCueAt<T extends { start: number; end: number }>(
  cues: readonly T[],
  timeMs: number,
): T | null {
  for (const cue of cues) {
    if (timeMs >= cue.start && timeMs <= cue.end) return cue;
  }
  return null;
}

/**
 * The bus cue that matches a piece of caption text.
 *
 * Exact normalised equality first; then a containment fallback (the DOM may
 * carry a single line of a two-line cue, or the cue may carry a speaker label
 * the DOM dropped). On a tie the longest shared text wins, which keeps the
 * pick stable across sources.
 */
export function findCueByText<T extends { start: number; end: number; text: string }>(
  cues: readonly T[],
  text: string,
): T | null {
  const wanted = normalizeCueText(text);
  if (!wanted) return null;
  let best: T | null = null;
  let bestScore = 0;
  for (const cue of cues) {
    const candidate = normalizeCueText(cue.text);
    if (!candidate) continue;
    if (candidate === wanted) return cue;
    if (candidate.includes(wanted) || wanted.includes(candidate)) {
      const score = Math.min(candidate.length, wanted.length);
      if (score > bestScore) {
        best = cue;
        bestScore = score;
      }
    }
  }
  return best;
}

/**
 * Convert one intercepted cue to the adapter shape. The id scheme is shared
 * with `cuesFromRawTrack`, so an active cue emitted from the bus and the full
 * track the transcript rail reads carry the SAME ids — App locates the active
 * cue by id to build `contextLines`.
 */
export function cueFromRaw(cue: RawCue, language: string, prefix: string): SubtitleCue {
  return {
    id: `${prefix}-${cue.start}-${cue.end}`,
    start: cue.start,
    end: cue.end,
    text: cue.text,
    language,
    align: cue.align,
  };
}

export function cuesFromRawTrack(
  raw: readonly RawCue[],
  language: string,
  prefix: string,
): SubtitleCue[] {
  return raw
    .filter((cue) => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start)
    .map((cue) => cueFromRaw(cue, language, prefix))
    .sort((a, b) => a.start - b.start);
}

/**
 * Find the cue from `cues` that best matches the requested time / range.
 *
 * Lookup order:
 *   1. If `sourceRange` is given, find the cue with the MAXIMUM temporal
 *      overlap with `[sourceRange.start, sourceRange.end]`. This is the
 *      deterministic behaviour: for any two tracks with even partial
 *      overlap we always pick the same alt cue, regardless of how the
 *      timestamps drift.
 *   2. Containment of the point: any cue whose window covers `timeMs`.
 *   3. Nearest cue (by midpoint distance) within `NEAREST_TOLERANCE_MS`
 *      of `timeMs`. Catches the edge case where the alt cue starts or
 *      ends a few hundred ms before/after the source cue.
 *
 * Returns `null` when even the nearest cue is too far to be plausible.
 *
 * Shared by `intercepted-adapter.ts` and the YouTube adapter, which used to
 * carry a byte-for-byte copy of this function.
 */
export function pickBestAltCue<
  T extends { start: number; end: number; text: string; align?: SubtitleCue['align'] },
>(
  cues: readonly T[],
  timeMs: number,
  sourceRange?: { start: number; end: number },
): T | null {
  if (cues.length === 0) return null;

  // 1. Range-aware overlap pick — most deterministic when we know
  //    the source range.
  if (sourceRange && sourceRange.end > sourceRange.start) {
    let bestOverlap = 0;
    let bestCue: T | null = null;
    let bestDistance = Infinity;
    for (const c of cues) {
      // Skip cues that can't possibly overlap the source range.
      if (c.end < sourceRange.start) continue;
      if (c.start > sourceRange.end) break; // cues are time-sorted
      const overlapStart = Math.max(c.start, sourceRange.start);
      const overlapEnd = Math.min(c.end, sourceRange.end);
      const overlap = overlapEnd - overlapStart;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestCue = c;
        bestDistance = 0;
      } else if (overlap === bestOverlap && bestCue && overlap > 0) {
        // Tie-break by midpoint proximity to source midpoint.
        const sourceMid = (sourceRange.start + sourceRange.end) / 2;
        const cMid = (c.start + c.end) / 2;
        const dist = Math.abs(cMid - sourceMid);
        if (dist < bestDistance) {
          bestCue = c;
          bestDistance = dist;
        }
      }
    }
    if (bestCue) return bestCue;
  }

  // 2. Strict containment of the requested timestamp.
  const contained = findCueAt(cues, timeMs);
  if (contained) return contained;

  // 3. Nearest cue by midpoint distance, with a generous tolerance so
  //    we still resolve when the alt track lags or leads the source by
  //    up to 1.5 s — beyond that we'd risk attaching the wrong line.
  const NEAREST_TOLERANCE_MS = 1500;
  let nearest: T | null = null;
  let nearestDelta = Infinity;
  for (const c of cues) {
    if (c.end < timeMs - NEAREST_TOLERANCE_MS) continue;
    if (c.start > timeMs + NEAREST_TOLERANCE_MS) break;
    const mid = (c.start + c.end) / 2;
    const delta = Math.abs(mid - timeMs);
    if (delta < nearestDelta) {
      nearestDelta = delta;
      nearest = c;
    }
  }
  return nearest;
}

/** Pick the subtitle/caption track that best matches `language`. */
function pickTrack(video: HTMLVideoElement, language: string): TextTrack | null {
  const tracks = Array.from(video.textTracks ?? []).filter(
    (track) => track.kind === 'subtitles' || track.kind === 'captions',
  );
  if (tracks.length === 0) return null;
  const wanted = primaryLang(language);
  return (
    tracks.find((track) => primaryLang(track.language) === wanted) ??
    tracks.find((track) => track.mode === 'showing' || track.mode === 'hidden') ??
    tracks[0]
  );
}

/**
 * Full cue list from the element's `textTracks`. Reading `cues` requires the
 * track to be enabled; a `disabled` track is flipped to `hidden` (loaded, not
 * painted) exactly like the live-cue path does.
 */
export function cuesFromTextTracks(
  video: HTMLVideoElement | null,
  language: string,
  prefix: string,
): SubtitleCue[] {
  if (!video) return [];
  const track = pickTrack(video, language);
  if (!track) return [];
  if (track.mode === 'disabled') {
    try {
      track.mode = 'hidden';
    } catch {
      return [];
    }
  }
  const cues = track.cues;
  if (!cues || cues.length === 0) return [];
  const out: SubtitleCue[] = [];
  for (let i = 0; i < cues.length; i += 1) {
    const cue = cues[i] as VTTCue;
    if (typeof cue.startTime !== 'number' || typeof cue.endTime !== 'number') continue;
    out.push({
      id: `${prefix}-${cue.startTime}-${cue.endTime}-${i}`,
      start: cue.startTime * 1000,
      end: cue.endTime * 1000,
      text: String(cue.text ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim(),
      language: track.language || language,
      align: cue.align as SubtitleCue['align'],
    });
  }
  return out.filter((cue) => cue.text.length > 0).sort((a, b) => a.start - b.start);
}
