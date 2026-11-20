/**
 * Pure decisions for the SAVED scene ("create this meaning" / "add this scene").
 * Both the content script and the unit tests call the SAME functions.
 */

export interface SavedSceneFields {
  sentence?: string;
  frame?: string;
  cueStart?: number;
  cueEnd?: number;
  identityKey?: string;
  surface?: string;
}

export interface SavedSceneDecision {
  sentence?: string;
  frame?: string;
  cueStart?: number;
  cueEnd?: number;
  /** Whether the content script must capture a fresh frame. */
  captureFrame: boolean;
}

/**
 * When a saved scene rides along, its sentence, frame and cue window WIN over
 * whatever the video shows now — the user clicked an action on the notice
 * produced by THAT save, typically several cues later.
 */
export function applySavedScene(
  saved: SavedSceneFields | undefined,
  live: SavedSceneFields,
): SavedSceneDecision {
  if (!saved) {
    return {
      sentence: live.sentence,
      frame: live.frame,
      cueStart: live.cueStart,
      cueEnd: live.cueEnd,
      captureFrame: !live.frame,
    };
  }
  return {
    sentence: saved.sentence ?? live.sentence,
    frame: saved.frame ?? live.frame,
    cueStart: saved.cueStart ?? live.cueStart,
    cueEnd: saved.cueEnd ?? live.cueEnd,
    // A saved frame is already in hand: no shutter, no recapture.
    captureFrame: !saved.frame,
  };
}

/**
 * The note a scene belongs to: the SAVED identity, never a re-derived lemma.
 * When `pre` is DEFINED its identityKey travels AS-IS — a phrase-level save
 * sent none, and `??` would wrongly re-derive a word identity from whatever
 * happens to be playing at click time.
 */
export function sceneIdentity(
  pre: { identityKey?: string } | undefined,
  identity: { key: string },
): string | undefined {
  return pre ? pre.identityKey : identity.key;
}

/** The saved surface follows the same rule as the identity key. */
export function sceneSurface(
  pre: { surface?: string } | undefined,
  identity: { surface?: string },
): string | undefined {
  return pre ? pre.surface : identity.surface;
}

/** One anchor instant: video time, paused state and wall clock taken together. */
export interface SubtitleAudioAnchor {
  videoTimeAtSave?: number;
  videoPausedAtSave?: boolean;
  wallClockAtSave?: number;
}

export function captureAnchor(
  videoTimeAtSave: number | undefined,
  videoPausedAtSave: boolean | undefined,
  wallClockAtSave: number,
): SubtitleAudioAnchor {
  return { videoTimeAtSave, videoPausedAtSave, wallClockAtSave };
}
