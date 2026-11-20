/**
 * Convert a SAVED cue window (video time) into wall-clock ring-buffer bounds
 * and slice the offscreen buffer — the piece "add this scene" uses so the
 * note receives the line's audio instead of whatever plays at click time.
 * The conversion itself is computeCueWindow (shared with resolveAudio).
 */
import { computeCueWindow } from './cue-window';
import type { AudioClipResponse } from '../shared/types';

export interface CueClipRequest {
  /** Video-time ms where the cue starts. */
  cueStartMs: number;
  /** Video-time ms where the cue ends. */
  cueEndMs: number;
  /** Video `currentTime` (ms) captured at the save instant. */
  videoTimeAtSave: number;
  /** Wall-clock ms of the save instant (defaults to now). */
  requestedAt?: number;
}

export interface CueClipDeps {
  extractAudioClip: (startMs: number, endMs: number, options?: {
    format?: 'mp3' | 'wav' | 'webm';
    useVad?: boolean;
    preRollMs?: number;
    postRollMs?: number;
  }) => Promise<AudioClipResponse>;
  preRollMs?: number;
  postRollMs?: number;
  useVad?: boolean;
}

export async function extractCueClip(
  req: CueClipRequest,
  deps: CueClipDeps,
): Promise<AudioClipResponse> {
  const { start, end, cueEndInFuture } = computeCueWindow({
    cueStart: req.cueStartMs,
    cueEnd: req.cueEndMs,
    videoTimeAtSave: req.videoTimeAtSave,
    requestedAt: req.requestedAt ?? Date.now(),
    preRollMs: deps.preRollMs ?? 0,
    postRollMs: deps.postRollMs ?? 0,
  });
  void cueEndInFuture;
  return deps.extractAudioClip(start, end, {
    format: 'mp3',
    useVad: deps.useVad ?? true,
    preRollMs: deps.preRollMs ?? 0,
    postRollMs: deps.postRollMs ?? 0,
  });
}
