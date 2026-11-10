import type { MediaInfo, MediaPlatform } from '../../shared/types';

export type { MediaInfo };

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

/**
 * The single vetted path for seeking, playback and rate changes
 * (docs/REDESIGN-V2.md §4.5, §3 H2).
 *
 * Every jump in the UI — transcript click, previous/next line, loop, slow
 * repeat, the post-capture rewind — goes through this object, never through
 * `video.currentTime`. On Netflix the seek crosses into the MAIN world and
 * calls the player API: writing `currentTime` there interrupts playback
 * (error M7375). The shape mirrors the PlaybackController port in
 * `src/ui/ports/types.ts`; both are structural, so the adapter instance can be
 * handed to the port unchanged.
 */
export interface PlaybackController {
  /** Jump to `timeMs`. Rejects when the platform cannot seek (Netflix without its player API). */
  seek(timeMs: number): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  getRate(): number;
  setRate(rate: number): void;
  isPaused(): boolean;
  currentTimeMs(): number;
}

export interface SubtitleSource {
  platform: MediaPlatform;

  onCueChange(listener: CueListener): void;
  getCurrentTime(): number;
  getActiveCue(): SubtitleCue | null;
  seek(timeMs: number): void;

  hideNativeSubtitles(): void;
  showNativeSubtitles(): void;

  /**
   * Best-effort episode metadata for the card tags and the Anki `source`
   * field (docs/REDESIGN-V2.md §4.5). Every adapter implements it; a page
   * that cannot tell us more falls back to `document.title`.
   */
  getMediaInfo?(): MediaInfo;

  /**
   * Release everything the adapter owns: polling intervals, bus
   * subscriptions, listener arrays and injected styles.
   *
   * WHY: content scripts are re-created on every SPA navigation, and each
   * navigation used to leave the previous adapter running. Its 50 ms interval
   * kept firing, its `onTrack` subscription kept receiving, and its injected
   * `<style>` stayed in the document — so after watching four videos the page
   * was running four subtitle pollers and replying with cues from whichever
   * one won the race.
   *
   * Called by the entry point on every unmount (and on re-mount). Optional so
   * adapters written before this existed keep working; every adapter in this
   * folder implements it. Safe to call twice.
   */
  destroy?(): void;

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

  /**
   * The FULL subtitle track of the current episode, or an empty array while it
   * is still loading (docs/REDESIGN-V2.md §4.5). The transcript rail, the
   * episode words view and the explain card all read from here.
   */
  getTrackCues?(): SubtitleCue[];

  /** Subscribe to track updates (the track can arrive in pieces, and a DASH
   *  download can finish after mount). Returns the unsubscribe function. */
  onTrackCues?(cb: (cues: SubtitleCue[]) => void): () => void;

  /**
   * The platform playback controller. Obligatory for F6 adapters; optional in
   * the type only so an adapter written before F6 keeps compiling.
   */
  playback?: PlaybackController;
}
