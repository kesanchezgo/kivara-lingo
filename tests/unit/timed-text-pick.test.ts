/**
 * The app picks the subtitle track itself.
 *
 * QA: the overlay asked the user to "change the subtitle track in the player".
 * That is the product's job: Kivara knows the language being learned, Netflix
 * exposes the track list and a setter, so the app switches and the user never
 * touches a subtitle menu.
 */
import { describe, expect, it } from 'vitest';
import { pickTimedTextTrack, type TimedTextTrackInfo } from '../../src/content/platform-adapters/timed-text';

/** The real list Netflix returned for the QA episode (trimmed). */
const QA_TRACKS: TimedTextTrackInfo[] = [
  { trackId: 'T:1:0;0;es;0;0;0;0;', bcp47: 'es', displayName: 'Español', trackType: 'PRIMARY', rawTrackType: 'SUBTITLES', isNoneTrack: false, isForcedNarrative: true },
  { trackId: 'T:2:0;1;es;0;0;0;0;', bcp47: 'es', displayName: 'Español', trackType: 'PRIMARY', rawTrackType: 'SUBTITLES', isNoneTrack: false, isForcedNarrative: false },
  { trackId: 'T:2:1;1;en;0;0;0;0;', bcp47: 'en', displayName: 'Inglés', trackType: 'ASSISTIVE', rawTrackType: 'CLOSEDCAPTIONS', isNoneTrack: false, isForcedNarrative: false },
];

describe('pickTimedTextTrack', () => {
  it('picks the track in the language being learned', () => {
    expect(pickTimedTextTrack(QA_TRACKS, 'en')?.trackId).toBe('T:2:1;1;en;0;0;0;0;');
  });

  it('matches by primary subtag, not by display name', () => {
    expect(pickTimedTextTrack(QA_TRACKS, 'en-US')?.bcp47).toBe('en');
    expect(pickTimedTextTrack(QA_TRACKS, 'es')?.trackId).toBe('T:2:0;1;es;0;0;0;0;');
  });

  it('never picks a forced narrative track when a normal one exists', () => {
    const onlyForced: TimedTextTrackInfo[] = [
      { trackId: 'forced', bcp47: 'en', isNoneTrack: false, isForcedNarrative: true },
      { trackId: 'normal', bcp47: 'en', isNoneTrack: false, isForcedNarrative: false },
    ];
    expect(pickTimedTextTrack(onlyForced, 'en')?.trackId).toBe('normal');
    // ...but a forced track is better than nothing.
    expect(pickTimedTextTrack([onlyForced[0]], 'en')?.trackId).toBe('forced');
  });

  it('ignores the off track and image-based tracks', () => {
    const tracks: TimedTextTrackInfo[] = [
      { trackId: 'none', isNoneTrack: true },
      { trackId: 'img', bcp47: 'en', isImageBased: true, isNoneTrack: false },
    ];
    expect(pickTimedTextTrack(tracks, 'en')).toBeNull();
  });

  it('returns null when the language is not offered', () => {
    expect(pickTimedTextTrack(QA_TRACKS, 'fr')).toBeNull();
    expect(pickTimedTextTrack([], 'en')).toBeNull();
  });
});
