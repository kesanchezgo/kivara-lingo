export interface SubtitleCue {
  id: string;
  start: number;
  end: number;
  text: string;
  language: string;
  /**
   * Optional horizontal alignment hint extracted from the platform's cue
   * (VTT `align:start` setting, TTML `tts:textAlign`, or the WebVTT
   * `TextTrackCue.align` enum on `<track>` elements). Honoured by the
   * overlay when the user enables "keepNativeAlignment". Adapters that
   * cannot extract an alignment leave this `undefined`, in which case the
   * overlay falls back to its centered default.
   */
  align?: 'start' | 'center' | 'end' | 'left' | 'right';
}

export type CueListener = (cues: SubtitleCue[]) => void;

export interface SubtitleSource {
  platform: 'netflix' | 'youtube' | 'disney' | 'hbo' | 'prime' | 'generic';

  onCueChange(listener: CueListener): void;
  getCurrentTime(): number;
  getActiveCue(): SubtitleCue | null;
  seek(timeMs: number): void;

  hideNativeSubtitles(): void;
  showNativeSubtitles(): void;

  /**
   * Pick the matching cue from an *alternate* language track (e.g. the
   * native Spanish track running parallel to the active English captions).
   *
   * Two call shapes are supported:
   *   1. `getAltCueAt(timeMs, lang)` — point lookup. Returns the cue whose
   *      time window contains `timeMs`. Used by the polling tick from the
   *      current video time.
   *   2. `getAltCueAt(timeMs, lang, sourceRange)` — range-aware lookup.
   *      When a new source cue arrives we know its full `[start, end]`
   *      range; passing it lets the adapter find the alt cue with the
   *      MAXIMUM TEMPORAL OVERLAP with the source range, which is
   *      deterministic regardless of how the two tracks' timestamps drift
   *      against each other (a common problem on HBO Max / Netflix where
   *      the source and target tracks are authored independently and can
   *      drift by hundreds of milliseconds in either direction).
   *
   * Returns `null` when no track has been intercepted for `lang` or when
   * no plausible match is found. Text comes from the platform's own
   * translators — preferred over MT.
   */
  getAltCueAt?(
    timeMs: number,
    lang: string,
    sourceRange?: { start: number; end: number },
  ): SubtitleCue | null;

  /** List of alternate languages currently known to the adapter. */
  getAvailableAltLanguages?(): string[];
}
