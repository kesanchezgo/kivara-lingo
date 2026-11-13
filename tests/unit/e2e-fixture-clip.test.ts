/**
 * The seekable e2e fixtures record their clip with MediaRecorder, and the
 * recording is the media under test: cue timings are absolute seconds, so the
 * clip has to reach past the last cue a test plays through. A loaded runner
 * drops the canvas tail — a 6500 ms recording measured 5.5 s of WebM on CI —
 * and then the media element pauses by itself at the end of the stream, which
 * reads exactly like the auto-pause firing early (B5: 5.503 s instead of
 * ≥ 5.85 s).
 *
 * This pins the recording length so the fixture cannot quietly get shorter
 * than the cue table again.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Cue 2 (3–6 s) is the one auto-pause and loop are exercised against. */
const CUE_TWO_END_MS = 6000;
/** Room for the dropped tail: 9000 ms measured 5.5 s under load once. */
const MIN_RECORDING_MS = 9000;

const FIXTURES = [
  'tests/e2e/fixtures/player-seekable.html',
  'tests/e2e/fixtures/player-dual.html',
] as const;

describe('seekable e2e fixtures', () => {
  for (const rel of FIXTURES) {
    it(`${rel} records long enough to play through cue 2`, () => {
      const html = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
      const match = /recorder\.stop\(\),\s*(\d+)\)/.exec(html);
      expect(match, `${rel} no longer schedules recorder.stop() with a delay`).not.toBeNull();
      const recordingMs = Number(match![1]);
      expect(recordingMs).toBeGreaterThanOrEqual(MIN_RECORDING_MS);
      // The recording is real time, so it must exceed the cue end outright —
      // the margin above is what absorbs the dropped frames.
      expect(recordingMs).toBeGreaterThan(CUE_TWO_END_MS);
    });
  }
});
