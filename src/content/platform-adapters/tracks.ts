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

export function cuesFromRawTrack(
  raw: readonly RawCue[],
  language: string,
  prefix: string,
): SubtitleCue[] {
  return raw
    .filter((cue) => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start)
    .map((cue) => ({
      id: `${prefix}-${cue.start}-${cue.end}`,
      start: cue.start,
      end: cue.end,
      text: cue.text,
      language,
      align: cue.align,
    }))
    .sort((a, b) => a.start - b.start);
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
